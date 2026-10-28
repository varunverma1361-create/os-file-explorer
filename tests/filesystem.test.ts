import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import {
  absolute,
  filename,
  listDirectory,
  properties,
  preview,
} from "../electron/services/fileSystem";
import { create, rename, transfer } from "../electron/services/fileOperations";
import { search } from "../electron/services/search";
import { DirectoryWatcher } from "../electron/services/fileWatcher";
import { sortEntries, type Entry } from "../shared/types";

async function sandbox(run: (root: string) => Promise<void>) {
  const temporary = path.resolve("tests/.tmp");
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, "os-explorer-test-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("list real metadata, empty folders, spaces, and nonexistent paths", async () =>
  sandbox(async (root) => {
    assert.equal((await listDirectory(root, true)).entries.length, 0);
    await create(root, "folder with spaces", "folder");
    await create(root, "hello.txt", "text");
    await fs.writeFile(path.join(root, "hello.txt"), "hello");
    const result = await listDirectory(root, true);
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries.find((e) => e.name === "hello.txt")?.size, 5);
    assert.equal(
      (await listDirectory(path.join(root, "folder with spaces"), true)).entries
        .length,
      0,
    );
    await assert.rejects(listDirectory(path.join(root, "missing"), true), {
      code: "ENOENT",
    });
    await assert.rejects(listDirectory(path.join(root, "hello.txt"), true), {
      code: "ENOTDIR",
    });
    const info = await properties(path.join(root, "hello.txt"));
    assert.equal(info.size, 5);
    assert.ok(info.created > 0);
    assert.ok(info.modified > 0);
    assert.ok(info.readable);
  }));
test("exclusive creation and Windows filename / path validation", async () =>
  sandbox(async (root) => {
    for (const name of [
      "CON",
      "CON.txt",
      "nul",
      "LPT1.doc",
      "x/y",
      "a\\b",
      "a:b",
      "a?b",
      "..",
      "trail.",
      "trail ",
      "",
    ])
      assert.throws(() => filename(name));
    for (const name of ["A file.txt", "résumé #1.txt", "config.json"])
      assert.equal(filename(name), name);
    assert.throws(() => absolute("relative"));
    if (process.platform === "win32") {
      assert.throws(() => absolute("\\rooted-but-drive-relative"));
      assert.throws(() => absolute("\\\\server-without-share"));
      assert.throws(() => absolute("//./pipe/example"));
      assert.throws(() => absolute("\\\\?\\C:\\example"));
      assert.throws(() => absolute("C:\\example:stream"));
      assert.equal(
        absolute("C:\\folder with spaces"),
        "C:\\folder with spaces",
      );
      assert.equal(
        absolute("\\\\server\\share\\folder"),
        "\\\\server\\share\\folder",
      );
    }
    assert.throws(() => absolute("C:\\bad\0path"));
    await create(root, "exists", "file");
    await assert.rejects(create(root, "exists", "file"), { code: "EEXIST" });
    await fs.writeFile(path.join(root, "exists"), "preserve");
    await assert.rejects(create(root, "exists", "folder"));
    assert.equal(
      await fs.readFile(path.join(root, "exists"), "utf8"),
      "preserve",
    );
  }));
test("rename, conflict, copy file / nested directory, move, cleanup", async () =>
  sandbox(async (root) => {
    await create(root, "original.txt", "file");
    await fs.writeFile(path.join(root, "original.txt"), "source");
    await rename(path.join(root, "original.txt"), "renamed.txt");
    await create(root, "conflict.txt", "file");
    await assert.rejects(
      rename(path.join(root, "renamed.txt"), "conflict.txt"),
      { code: "EEXIST" },
    );
    await create(root, "destination", "folder");
    await transfer(
      path.join(root, "renamed.txt"),
      path.join(root, "destination"),
      "copy",
    );
    assert.equal(
      await fs.readFile(path.join(root, "destination", "renamed.txt"), "utf8"),
      "source",
    );
    await assert.rejects(
      transfer(
        path.join(root, "renamed.txt"),
        path.join(root, "destination"),
        "copy",
      ),
      { code: "EEXIST" },
    );
    await create(root, "tree", "folder");
    await create(path.join(root, "tree"), "nested", "folder");
    await fs.writeFile(
      path.join(root, "tree", "nested", "data.txt"),
      "nested data",
    );
    await transfer(
      path.join(root, "tree"),
      path.join(root, "destination"),
      "copy",
    );
    assert.equal(
      await fs.readFile(
        path.join(root, "destination", "tree", "nested", "data.txt"),
        "utf8",
      ),
      "nested data",
    );
    await create(root, "move target", "folder");
    await transfer(
      path.join(root, "renamed.txt"),
      path.join(root, "move target"),
      "cut",
    );
    await assert.rejects(fs.stat(path.join(root, "renamed.txt")), {
      code: "ENOENT",
    });
    assert.equal(
      await fs.readFile(path.join(root, "move target", "renamed.txt"), "utf8"),
      "source",
    );
    await fs.rm(path.join(root, "destination"), { recursive: true });
    await assert.rejects(fs.stat(path.join(root, "destination")), {
      code: "ENOENT",
    });
  }));
test("reject copying / moving a directory inside itself or descendants", async () =>
  sandbox(async (root) => {
    await create(root, "tree", "folder");
    await create(path.join(root, "tree"), "nested", "folder");
    for (const mode of ["copy", "cut"] as const)
      for (const destination of ["tree", path.join("tree", "nested")])
        await assert.rejects(
          transfer(path.join(root, "tree"), path.join(root, destination), mode),
          /itself/,
        );
    assert.ok((await fs.stat(path.join(root, "tree"))).isDirectory());
  }));
test("EXDEV move copies before removing source; copy failure retains source", async () =>
  sandbox(async (root) => {
    await create(root, "target", "folder");
    await fs.writeFile(path.join(root, "source.txt"), "retain me");
    const originalRename = fs.rename;
    const originalCopy = fs.copyFile;
    const renameMock = mock.method(fs, "rename", async () => {
      throw Object.assign(new Error("Cross device"), { code: "EXDEV" });
    });
    try {
      const copyMock = mock.method(fs, "copyFile", async () => {
        throw Object.assign(new Error("No space"), { code: "ENOSPC" });
      });
      try {
        await assert.rejects(
          transfer(
            path.join(root, "source.txt"),
            path.join(root, "target"),
            "cut",
          ),
          { code: "ENOSPC" },
        );
        assert.equal(
          await fs.readFile(path.join(root, "source.txt"), "utf8"),
          "retain me",
        );
        await assert.rejects(fs.stat(path.join(root, "target", "source.txt")), {
          code: "ENOENT",
        });
      } finally {
        copyMock.mock.restore();
        fs.copyFile = originalCopy;
      }
      await transfer(
        path.join(root, "source.txt"),
        path.join(root, "target"),
        "cut",
      );
      assert.equal(
        await fs.readFile(path.join(root, "target", "source.txt"), "utf8"),
        "retain me",
      );
      await assert.rejects(fs.stat(path.join(root, "source.txt")), {
        code: "ENOENT",
      });
    } finally {
      renameMock.mock.restore();
      fs.rename = originalRename;
    }
  }));
test("recursive case insensitive search, cancellation, hidden filtering", async () =>
  sandbox(async (root) => {
    await create(root, "nested", "folder");
    await fs.writeFile(path.join(root, "nested", "MATCH.txt"), "match");
    await fs.writeFile(path.join(root, ".hidden.txt"), "hidden");
    assert.equal(
      (await search(root, "match", false, true, new AbortController().signal))
        .entries.length,
      0,
    );
    assert.equal(
      (await search(root, "match", true, true, new AbortController().signal))
        .entries.length,
      1,
    );
    assert.equal(
      (await listDirectory(root, false)).entries.some((e) =>
        e.name.startsWith("."),
      ),
      false,
    );
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      (await search(root, "match", true, true, controller.signal)).cancelled,
      true,
    );
  }));

test("Windows Hidden attribute is honored for a name without a dot prefix", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only attribute check");
    return;
  }
  await sandbox(async (root) => {
    const file = path.join(root, "ordinary-name.txt");
    await fs.writeFile(file, "hidden attribute test");
    await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$ErrorActionPreference="Stop"; [IO.File]::SetAttributes($env:OS_EXPLORER_HIDDEN, ([IO.File]::GetAttributes($env:OS_EXPLORER_HIDDEN) -bor [IO.FileAttributes]::Hidden))',
      ],
      {
        env: { ...process.env, OS_EXPLORER_HIDDEN: file },
        windowsHide: true,
        timeout: 15000,
      },
    );
    assert.equal((await listDirectory(root, false)).entries.length, 0);
    assert.equal((await listDirectory(root, true)).entries[0]?.hidden, true);
  });
});
test("failed directory copy rolls back created entries and retains all source data", async () =>
  sandbox(async (root) => {
    await create(root, "source", "folder");
    await create(root, "target", "folder");
    await fs.writeFile(path.join(root, "source", "a.txt"), "first");
    await fs.writeFile(path.join(root, "source", "b.txt"), "second");
    const original = fs.copyFile;
    let calls = 0;
    const mocked = mock.method(
      fs,
      "copyFile",
      async (...args: Parameters<typeof fs.copyFile>) => {
        if (++calls === 2)
          throw Object.assign(new Error("Full disk"), { code: "ENOSPC" });
        return original(...args);
      },
    );
    try {
      await assert.rejects(
        transfer(path.join(root, "source"), path.join(root, "target"), "copy"),
        { code: "ENOSPC" },
      );
    } finally {
      mocked.mock.restore();
    }
    assert.equal(
      await fs.readFile(path.join(root, "source", "a.txt"), "utf8"),
      "first",
    );
    assert.equal(
      await fs.readFile(path.join(root, "source", "b.txt"), "utf8"),
      "second",
    );
    await assert.rejects(fs.stat(path.join(root, "target", "source")), {
      code: "ENOENT",
    });
  }));
test("directory junction loops are not traversed or copied", async (t) =>
  sandbox(async (root) => {
    await create(root, "tree", "folder");
    await fs.writeFile(path.join(root, "tree", "match.txt"), "x");
    try {
      await fs.symlink(
        path.join(root, "tree"),
        path.join(root, "tree", "loop"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (e) {
      t.skip(`Symlinks unavailable: ${String(e)}`);
      return;
    }
    const results = await search(
      root,
      "match",
      true,
      true,
      new AbortController().signal,
    );
    assert.equal(results.entries.length, 1);
    assert.equal(results.limited, false);
    await create(root, "target", "folder");
    await assert.rejects(
      transfer(path.join(root, "tree"), path.join(root, "target"), "copy"),
      /symbolic links or junctions/,
    );
    await assert.rejects(
      transfer(
        path.join(root, "tree", "loop"),
        path.join(root, "target"),
        "copy",
      ),
      /symbolic links or junctions/,
    );
    await assert.rejects(
      transfer(
        path.join(root, "tree"),
        path.join(root, "tree", "loop"),
        "copy",
      ),
      /itself/,
    );
  }));
test("plain text preview is bounded and does not execute source", async () =>
  sandbox(async (root) => {
    const file = path.join(root, "example.html");
    await fs.writeFile(file, "<script>alert(1)</script>");
    assert.deepEqual(await preview(file), {
      kind: "text",
      content: "<script>alert(1)</script>",
    });
    await fs.writeFile(path.join(root, "binary.txt"), Buffer.from([1, 0, 4]));
    await assert.rejects(preview(path.join(root, "binary.txt")), /binary/);
    await fs.writeFile(
      path.join(root, "large.txt"),
      Buffer.alloc(512 * 1024 + 1, 65),
    );
    await assert.rejects(preview(path.join(root, "large.txt")), /up to/);
    await fs.writeFile(path.join(root, "bad.png"), "not an image");
    await assert.rejects(
      preview(path.join(root, "bad.png")),
      /supported image/,
    );
    await fs.writeFile(path.join(root, "other.exe"), "x");
    await assert.rejects(
      preview(path.join(root, "other.exe")),
      /not available/,
    );
  }));
test("sorting respects numeric names, sizes, dates, direction and folder grouping", () => {
  const entry = (
    name: string,
    directory: boolean,
    size: number,
    modified: number,
    type = "File",
  ): Entry => ({
    name,
    directory,
    size,
    modified,
    type,
    path: name,
    link: false,
    hidden: false,
  });
  const entries = [
    entry("file10", false, 10, 1),
    entry("folder", true, 0, 0, "Folder"),
    entry("file2", false, 2, 3),
  ];
  assert.deepEqual(
    sortEntries(entries, "name", true).map((e) => e.name),
    ["folder", "file2", "file10"],
  );
  assert.deepEqual(
    sortEntries(entries, "size", false).map((e) => e.size),
    [0, 10, 2],
  );
  assert.deepEqual(
    sortEntries(entries, "modified", true).map((e) => e.modified),
    [0, 1, 3],
  );
  assert.equal(sortEntries(entries, "type", false)[0].directory, true);
});
test("watch emits real filesystem changes and releases previous watcher", async () =>
  sandbox(async (root) => {
    const watcher = new DirectoryWatcher();
    try {
      const changed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("watch timeout")),
          5000,
        );
        watcher.start(root, (event) => {
          if (event.error) reject(new Error(event.error));
          else {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await fs.writeFile(path.join(root, "new.txt"), "x");
      // A list refresh must preserve the existing listener and debounced change.
      watcher.start(root, () => assert.fail("Existing watcher was replaced"));
      await changed;
      await create(root, "other", "folder");
      watcher.start(path.join(root, "other"), () => {});
    } finally {
      watcher.close();
    }
  }));
test("permission denial when supported by host", async (t) =>
  sandbox(async (root) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      t.skip(
        "Windows ACL modification is intentionally excluded; run on an unprivileged POSIX host to exercise mode denial.",
      );
      return;
    }
    const restricted = path.join(root, "restricted");
    await fs.mkdir(restricted);
    await fs.chmod(restricted, 0);
    try {
      await assert.rejects(fs.access(restricted, constants.R_OK), {
        code: "EACCES",
      });
    } finally {
      await fs.chmod(restricted, 0o700);
    }
  }));
