import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { absolute, filename } from "./fileSystem";

export async function absent(destination: string) {
  try {
    await fs.lstat(destination);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  throw Object.assign(new Error(), { code: "EEXIST" });
}
function protectRoot(file: string) {
  if (path.dirname(file) === file)
    throw new Error("Drive roots cannot be modified.");
}
export async function create(
  parent: string,
  name: string,
  kind: "folder" | "file" | "text",
) {
  const destination = path.join(absolute(parent), filename(name));
  if (kind === "folder") await fs.mkdir(destination);
  else {
    const handle = await fs.open(destination, "wx");
    await handle.close();
  }
}
export async function rename(raw: string, name: string) {
  const source = absolute(raw);
  protectRoot(source);
  const destination = path.join(path.dirname(source), filename(name));
  if (source === destination) return;
  await absent(destination);
  await fs.rename(source, destination);
}
async function assertNoLinks(root: string) {
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > 100000)
      throw new Error("Transfer exceeds the 100,000 item safety limit.");
    const current = queue[i];
    const info = await fs.lstat(current);
    if (info.isSymbolicLink())
      throw new Error(
        "Transfers containing symbolic links or junctions are not supported.",
      );
    if (info.isDirectory())
      for (const child of await fs.readdir(current))
        queue.push(path.join(current, child));
    else if (!info.isFile())
      throw new Error("Only regular files and directories can be transferred.");
  }
}
function descendant(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
async function copyExclusive(
  source: string,
  destination: string,
  created: string[],
) {
  const info = await fs.lstat(source);
  if (info.isSymbolicLink())
    throw new Error(
      "A symbolic link or junction appeared during the transfer.",
    );
  if (info.isDirectory()) {
    await fs.mkdir(destination);
    created.push(destination);
    for (const name of await fs.readdir(source))
      await copyExclusive(
        path.join(source, name),
        path.join(destination, name),
        created,
      );
  } else if (info.isFile()) {
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    created.push(destination);
  } else
    throw new Error("Only regular files and directories can be transferred.");
}
export async function transfer(
  raw: string,
  target: string,
  mode: "copy" | "cut",
) {
  const source = absolute(raw);
  const directory = absolute(target);
  protectRoot(source);
  if (!(await fs.stat(directory)).isDirectory())
    throw new Error("Paste destination must be a directory.");
  const destination = path.join(directory, path.basename(source));
  // Canonical paths catch aliases through junctions in the destination's ancestors.
  const sourceReal = await fs.realpath(source);
  const targetReal = await fs.realpath(directory);
  if (descendant(sourceReal, targetReal))
    throw new Error(
      "A folder cannot be copied or moved into itself or a descendant.",
    );
  await absent(destination);
  await assertNoLinks(source);
  if (mode === "cut") {
    try {
      await fs.rename(source, destination);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    }
  }
  const created: string[] = [];
  try {
    await copyExclusive(source, destination, created);
  } catch (e) {
    // Remove only entries created by this operation; never an existing conflicting item.
    const failures: string[] = [];
    for (const file of created.reverse()) {
      try {
        const info = await fs.lstat(file);
        if (info.isDirectory()) await fs.rmdir(file);
        else await fs.unlink(file);
      } catch {
        failures.push(file);
      }
    }
    if (failures.length)
      throw new Error(
        `Copy failed; source retained. Partial destination remains at ${destination}. ${String(e)}`,
      );
    throw e;
  }
  if (mode === "cut") {
    // EXDEV: the complete copy must succeed before the source is removed.
    try {
      await fs.rm(source, { recursive: true });
    } catch (e) {
      throw new Error(
        `Copy completed, but source cleanup failed. Both locations may contain data; inspect them before retrying. ${String(e)}`,
      );
    }
  }
}
export function mutablePath(raw: string) {
  const file = absolute(raw);
  protectRoot(file);
  return file;
}
