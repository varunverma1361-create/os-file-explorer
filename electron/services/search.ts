import fs from "node:fs/promises";
import path from "node:path";
import { absolute, entry, hiddenNames } from "./fileSystem";
import type { SearchResult } from "../../shared/types";

export async function search(
  raw: string,
  query: string,
  recursive: boolean,
  showHidden: boolean,
  signal: AbortSignal,
): Promise<SearchResult> {
  const root = absolute(raw);
  if (!(await fs.stat(root)).isDirectory())
    throw new Error("Search requires a directory.");
  const result: SearchResult = {
    entries: [],
    skipped: 0,
    limited: false,
    cancelled: false,
  };
  const queue = [root];
  const started = Date.now();
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    if (signal.aborted) {
      result.cancelled = true;
      break;
    }
    if (visited >= 50000 || Date.now() - started > 30000) {
      result.limited = true;
      break;
    }
    let names: string[];
    let hidden = new Set<string>();
    try {
      names = await fs.readdir(queue[i]);
      if (!showHidden) hidden = await hiddenNames(queue[i]);
    } catch {
      result.skipped++;
      continue;
    }
    for (const name of names) {
      if (signal.aborted) {
        result.cancelled = true;
        break;
      }
      if (
        ++visited > 50000 ||
        result.entries.length >= 2000 ||
        Date.now() - started > 30000
      ) {
        result.limited = true;
        break;
      }
      if (!showHidden && (name.startsWith(".") || hidden.has(name))) continue;
      try {
        const item = await entry(
          path.join(queue[i], name),
          hidden.has(name) || name.startsWith("."),
        );
        if (name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          result.entries.push(item);
        if (recursive && item.directory && !item.link) queue.push(item.path);
      } catch {
        result.skipped++;
      }
    }
    if (result.limited || result.cancelled) break;
  }
  return result;
}
