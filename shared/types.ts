export interface Entry {
  name: string;
  path: string;
  directory: boolean;
  link: boolean;
  size: number;
  modified: number;
  type: string;
  hidden: boolean;
  error?: string;
}
export interface Listing {
  path: string;
  parent: string;
  entries: Entry[];
  warnings: string[];
}
export interface Places {
  home: string;
  folders: { name: string; path: string }[];
  drives: string[];
}
export interface Properties extends Entry {
  created: number;
  accessed: number;
  readable: boolean;
  writable: boolean;
  permissions: string;
}
export interface SearchResult {
  entries: Entry[];
  skipped: number;
  limited: boolean;
  cancelled: boolean;
}
export type Preview = { kind: "text" | "image"; content: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface API {
  places(): Promise<Result<Places>>;
  list(path: string, hidden: boolean): Promise<Result<Listing>>;
  create(
    parent: string,
    name: string,
    kind: "folder" | "text" | "file",
  ): Promise<Result<void>>;
  rename(path: string, name: string): Promise<Result<void>>;
  transfer(
    source: string,
    destination: string,
    mode: "copy" | "cut",
  ): Promise<Result<void>>;
  trash(path: string): Promise<Result<void>>;
  open(path: string): Promise<Result<void>>;
  properties(path: string): Promise<Result<Properties>>;
  preview(path: string): Promise<Result<Preview>>;
  search(
    path: string,
    query: string,
    recursive: boolean,
    hidden: boolean,
    id: string,
  ): Promise<Result<SearchResult>>;
  cancelSearch(id: string): Promise<Result<void>>;
  watch(path: string): Promise<Result<void>>;
  onChange(
    callback: (event: { path: string; error?: string }) => void,
  ): () => void;
}
export type SortKey = "name" | "type" | "size" | "modified";
export function sortEntries(
  entries: Entry[],
  key: SortKey,
  ascending: boolean,
): Entry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      (ascending ? 1 : -1) *
        (typeof a[key] === "number"
          ? Number(a[key]) - Number(b[key])
          : String(a[key]).localeCompare(String(b[key]), undefined, {
              numeric: true,
              sensitivity: "base",
            })) ||
      a.name.localeCompare(b.name),
  );
}
export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  const unit = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB"][unit]}`;
}
