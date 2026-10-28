import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Entry, Listing, Properties, Preview } from "../../shared/types";

const exec = promisify(execFile);
export function absolute(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 32000 ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  )
    throw new Error("Enter a valid absolute filesystem path.");
  const normalized = path.normalize(value);
  // Normalize slash variants before rejecting device namespaces and streams.
  if (
    process.platform === "win32" &&
    (/^\\\\[?.]\\/.test(normalized) || normalized.slice(2).includes(":"))
  )
    throw new Error(
      "Device paths and alternate data streams are not supported.",
    );
  if (
    process.platform === "win32" &&
    !/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+(?:\\|$))/i.test(normalized)
  )
    throw new Error("Use a full drive path (C:\\folder) or UNC share path.");
  return normalized;
}
export function filename(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 255 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new Error(
      "Invalid Windows name. Avoid reserved names, special characters, and trailing dots or spaces.",
    );
  return value;
}
export function errorMessage(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  const messages: Record<string, string> = {
    ENOENT: "The file or directory no longer exists.",
    EACCES: "Access denied. You do not have permission to access this item.",
    EPERM: "Operation not permitted. The item may be protected or in use.",
    EBUSY: "The item is in use by another application.",
    EEXIST: "An item with this name already exists. Choose another name.",
    ENOTDIR: "The path is not a directory.",
    ENOSPC: "There is not enough free disk space.",
    ENAMETOOLONG: "The name or path is too long.",
    ELOOP: "A symbolic link loop was detected.",
    EXDEV: "The items are on different devices.",
  };
  return messages[e.code ?? ""] ?? e.message ?? String(error);
}
// Fixed PowerShell program; user paths travel as environment data, never executable code.
export async function hiddenNames(directory: string): Promise<Set<string>> {
  if (process.platform !== "win32") return new Set();
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '$ErrorActionPreference="Stop"; $d=Get-Item -LiteralPath $env:OS_EXPLORER_DIR -Force; $names=@($d.EnumerateFileSystemInfos() | Where-Object {($_.Attributes -band [IO.FileAttributes]::Hidden) -ne 0} | ForEach-Object {$_.Name}); ConvertTo-Json -InputObject $names -Compress',
    ],
    {
      env: { ...process.env, OS_EXPLORER_DIR: directory },
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return new Set(
    JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]") as string[],
  );
}
export async function entry(file: string, hidden = false): Promise<Entry> {
  const info = await fs.lstat(file);
  let directory = info.isDirectory();
  if (info.isSymbolicLink()) {
    try {
      directory = (await fs.stat(file)).isDirectory();
    } catch {
      /* Broken links remain visible. */
    }
  }
  const extension = path.extname(file).slice(1).toUpperCase();
  return {
    name: path.basename(file),
    path: file,
    directory,
    link: info.isSymbolicLink(),
    size: info.size,
    modified: info.mtimeMs,
    type: info.isSymbolicLink()
      ? directory
        ? "Folder link"
        : "Symbolic link"
      : directory
        ? "Folder"
        : extension
          ? `${extension} file`
          : "File",
    hidden,
  };
}
export async function listDirectory(
  raw: string,
  showHidden: boolean,
): Promise<Listing> {
  const directory = absolute(raw);
  if (!(await fs.stat(directory)).isDirectory())
    throw Object.assign(new Error(), { code: "ENOTDIR" });
  const names = await fs.readdir(directory);
  const warnings: string[] = [];
  let hidden = new Set<string>();
  try {
    hidden = await hiddenNames(directory);
  } catch (e) {
    warnings.push(
      `Windows hidden attributes unavailable; only dot-prefixed items are hidden. ${errorMessage(e)}`,
    );
  }
  const entries: Entry[] = [];
  // Bounded batches avoid creating thousands of simultaneous metadata requests.
  for (let i = 0; i < names.length; i += 64) {
    await Promise.all(
      names.slice(i, i + 64).map(async (name) => {
        const isHidden = name.startsWith(".") || hidden.has(name);
        if (!showHidden && isHidden) return;
        try {
          entries.push(await entry(path.join(directory, name), isHidden));
        } catch (e) {
          // An entry disappearing between readdir and lstat is a normal race.
          if ((e as NodeJS.ErrnoException).code !== "ENOENT")
            warnings.push(`${name}: ${errorMessage(e)}`);
        }
      }),
    );
  }
  return {
    path: directory,
    parent: path.dirname(directory),
    entries,
    warnings,
  };
}
export async function properties(raw: string): Promise<Properties> {
  const file = absolute(raw);
  const item = await entry(file);
  const info = await fs.lstat(file);
  const access = async (mode: number) =>
    fs.access(file, mode).then(
      () => true,
      () => false,
    );
  return {
    ...item,
    created: info.birthtimeMs,
    accessed: info.atimeMs,
    readable: await access(constants.R_OK),
    writable: await access(constants.W_OK),
    permissions:
      process.platform === "win32"
        ? "Node access checks only; not a Windows ACL evaluation. Access can change before an operation."
        : `POSIX mode ${(info.mode & 0o777).toString(8)}; access checks are advisory.`,
  };
}
const textExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".ts",
  ".html",
  ".css",
]);
const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export async function preview(raw: string): Promise<Preview> {
  const file = absolute(raw);
  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext) && !imageTypes[ext])
    throw new Error(
      "Preview is not available for this file type. Open it in its default application.",
    );
  const handle = await fs.open(file, "r");
  try {
    const info = await handle.stat();
    const limit = imageTypes[ext] ? 5 * 1024 * 1024 : 512 * 1024;
    if (!info.isFile() || info.size > limit)
      throw new Error(
        `Preview supports regular files up to ${imageTypes[ext] ? "5 MB" : "512 KB"}.`,
      );
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const r = await handle.read(buffer, length, buffer.length - length, null);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    if (length > limit)
      throw new Error("The file grew beyond the preview size limit.");
    const bytes = buffer.subarray(0, length);
    if (imageTypes[ext]) {
      const valid =
        ext === ".png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : ext === ".webp"
            ? bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP"
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!valid)
        throw new Error("The file does not contain a supported image.");
      return {
        kind: "image",
        content: `data:${imageTypes[ext]};base64,${bytes.toString("base64")}`,
      };
    }
    if (bytes.includes(0))
      throw new Error(
        "This file contains binary data and cannot be previewed as text.",
      );
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Text preview supports UTF-8 files only.");
    }
    if (/[\x01-\x08\x0e-\x1f]/.test(content))
      throw new Error("This file contains binary control characters.");
    return { kind: "text", content };
  } finally {
    await handle.close();
  }
}
