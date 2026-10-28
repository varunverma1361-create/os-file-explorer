import { app, ipcMain, shell, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import {
  absolute,
  errorMessage,
  listDirectory,
  preview,
  properties,
} from "./services/fileSystem";
import {
  create,
  rename,
  transfer,
  mutablePath,
} from "./services/fileOperations";
import { search } from "./services/search";
import { DirectoryWatcher } from "./services/fileWatcher";

export function registerIPC(window: BrowserWindow, trustedURL: string) {
  const watcher = new DirectoryWatcher();
  const searches = new Map<string, AbortController>();
  let mutation: Promise<unknown> = Promise.resolve();
  const string = (v: unknown, max = 32000) => {
    if (typeof v !== "string" || v.length > max)
      throw new Error("Invalid text argument.");
    return v;
  };
  const boolean = (v: unknown) => {
    if (typeof v !== "boolean") throw new Error("Invalid boolean argument.");
    return v;
  };
  const enumValue = <T extends string>(v: unknown, values: T[]): T => {
    if (!values.includes(v as T)) throw new Error("Invalid operation.");
    return v as T;
  };
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    places: async () => {
      const folders = [];
      for (const [name, key] of [
        ["Home", "home"],
        ["Desktop", "desktop"],
        ["Documents", "documents"],
        ["Downloads", "downloads"],
      ] as const) {
        const file = key === "home" ? os.homedir() : app.getPath(key);
        try {
          if ((await fs.stat(file)).isDirectory())
            folders.push({ name, path: file });
        } catch {
          /* Unavailable known folders are omitted. */
        }
      }
      const drives: string[] = [];
      if (process.platform === "win32")
        await Promise.all(
          Array.from(
            { length: 26 },
            (_, i) => `${String.fromCharCode(65 + i)}:\\`,
          ).map(async (drive) => {
            try {
              await fs.access(drive);
              drives.push(drive);
            } catch {
              /* Offline drives are omitted. */
            }
          }),
        );
      else drives.push("/");
      return { home: os.homedir(), folders, drives: drives.sort() };
    },
    list: async (p, h) => listDirectory(absolute(p), boolean(h)),
    create: async (p, n, k) =>
      create(
        absolute(p),
        string(n, 255),
        enumValue(k, ["folder", "text", "file"]),
      ),
    rename: async (p, n) => rename(absolute(p), string(n, 255)),
    transfer: async (s, d, m) =>
      transfer(absolute(s), absolute(d), enumValue(m, ["copy", "cut"])),
    trash: async (p) => shell.trashItem(mutablePath(absolute(p))),
    open: async (p) => {
      const file = absolute(p);
      await fs.stat(file);
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
    },
    properties: async (p) => properties(absolute(p)),
    preview: async (p) => preview(absolute(p)),
    search: async (p, q, r, h, id) => {
      const key = string(id, 100);
      const query = string(q, 255).trim();
      if (!query) throw new Error("Enter a search term.");
      for (const controller of searches.values()) controller.abort();
      const controller = new AbortController();
      searches.set(key, controller);
      try {
        return await search(
          absolute(p),
          query,
          boolean(r),
          boolean(h),
          controller.signal,
        );
      } finally {
        if (searches.get(key) === controller) searches.delete(key);
      }
    },
    cancelSearch: async (id) => {
      searches.get(string(id, 100))?.abort();
    },
    watch: async (p) => {
      const file = absolute(p);
      if (!(await fs.stat(file)).isDirectory())
        throw new Error("Cannot watch a non-directory.");
      watcher.start(file, (event) => {
        if (!window.isDestroyed()) window.webContents.send("fs:changed", event);
      });
    },
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`fs:${name}`, async (event, ...args: unknown[]) => {
      try {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== trustedURL
        )
          throw new Error("Untrusted IPC sender.");
        let value: unknown;
        if (["create", "rename", "transfer", "trash"].includes(name)) {
          const job = mutation.then(() => handler(...args));
          mutation = job.catch(() => {});
          value = await job;
        } else value = await handler(...args);
        return { ok: true, value };
      } catch (e) {
        console.error(`Filesystem ${name}:`, e);
        return { ok: false, error: errorMessage(e) };
      }
    });
  }
  window.on("closed", () => {
    watcher.close();
    for (const controller of searches.values()) controller.abort();
    for (const name of Object.keys(handlers))
      ipcMain.removeHandler(`fs:${name}`);
  });
}
