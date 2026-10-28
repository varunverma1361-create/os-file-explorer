import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  Home,
  Folder,
  File,
  FileText,
  Image,
  Link,
  HardDrive,
  Monitor,
  Download,
  Copy,
  Scissors,
  ClipboardPaste,
  Pencil,
  Trash2,
  Plus,
  Search,
  X,
  Eye,
  Info,
  ChevronRight,
  Loader2,
  FolderOpen,
} from "lucide-react";
import {
  formatSize,
  sortEntries,
  type API,
  type Entry,
  type Listing,
  type Places,
  type Preview,
  type Properties,
  type Result,
  type SortKey,
} from "../shared/types";
declare global {
  interface Window {
    explorer: API;
  }
}
const api = window.explorer;
async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
type DialogState =
  | { kind: "new"; fileKind: "folder" | "text" | "file" }
  | { kind: "rename"; item: Entry }
  | { kind: "delete"; item: Entry }
  | { kind: "properties"; data: Properties }
  | { kind: "preview"; data: Preview; name: string };
const date = (value: number) => new Date(value).toLocaleString();
function Button({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function ItemIcon({ item }: { item: Entry }) {
  const Icon = item.directory
    ? Folder
    : /\.(png|jpe?g|webp)$/i.test(item.name)
      ? Image
      : /\.(txt|md|json|[jt]s|html|css)$/i.test(item.name)
        ? FileText
        : File;
  return (
    <span className="relative inline-flex shrink-0">
      <Icon
        size={19}
        className={
          item.directory ? "text-amber-500 fill-amber-100" : "text-slate-400"
        }
      />
      {item.link && (
        <Link
          size={10}
          className="absolute -bottom-1 -right-1 text-blue-700 bg-white"
        />
      )}
    </span>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'input,button,textarea,[tabindex="0"]',
        ) ?? [],
      ).filter((x) => !x.hasAttribute("disabled"));
    (
      el?.querySelector<HTMLElement>("input,textarea") ?? focusable()[0]
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    el?.addEventListener("keydown", key);
    return () => {
      el?.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <Button label="Close dialog" onClick={onClose}>
            <X size={18} />
          </Button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
export default function App() {
  const [places, setPlaces] = useState<Places>();
  const [listing, setListing] = useState<Listing>();
  const [address, setAddress] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [position, setPosition] = useState(-1);
  const historyRef = useRef({ paths: [] as string[], position: -1 });
  const [selected, setSelected] = useState<string>();
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clipboard, setClipboard] = useState<{
    path: string;
    mode: "copy" | "cut";
  }>();
  const [dialog, setDialog] = useState<DialogState>();
  const [name, setName] = useState("");
  const [newMenu, setNewMenu] = useState(false);
  const [context, setContext] = useState<{
    x: number;
    y: number;
    item?: Entry;
  }>();
  const [sort, setSort] = useState<SortKey>("name");
  const [ascending, setAscending] = useState(true);
  const [query, setQuery] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Entry[]>();
  const [scroll, setScroll] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const current = useRef("");
  const generation = useRef(0);
  const navigating = useRef(false);
  const pendingTarget = useRef("");
  const refreshPending = useRef(false);
  const searchId = useRef<string | undefined>(undefined);
  const closeDialog = useCallback(() => {
    if (!busy) setDialog(undefined);
  }, [busy]);
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const cancelSearch = useCallback(() => {
    if (searchId.current) void api.cancelSearch(searchId.current);
    searchId.current = undefined;
    setSearching(false);
  }, []);
  const load = useCallback(
    async (
      target: string,
      mode: "push" | "refresh" | number = "push",
    ): Promise<void> => {
      const ticket = ++generation.current;
      navigating.current = true;
      pendingTarget.current = target;
      refreshPending.current = false;
      cancelSearch();
      setResults(undefined);
      setNotice("");
      setLoading(true);
      setError("");
      try {
        const value = await unwrap(api.list(target, hiddenRef.current));
        if (ticket !== generation.current) return;
        current.current = value.path;
        setListing(value);
        setAddress(value.path);
        setSelected(undefined);
        setScroll(0);
        if (listRef.current) listRef.current.scrollTop = 0;
        if (mode !== "refresh") {
          const h = historyRef.current;
          if (typeof mode === "number") h.position = mode;
          else if (h.paths[h.position] !== value.path) {
            h.paths = h.paths.slice(0, h.position + 1);
            h.paths.push(value.path);
            h.position = h.paths.length - 1;
          }
          setHistory([...h.paths]);
          setPosition(h.position);
        }
        try {
          await unwrap(api.watch(value.path));
        } catch (e) {
          if (ticket === generation.current) setNotice(String(e));
        }
      } catch (e) {
        if (ticket === generation.current) fail(e);
      } finally {
        if (ticket === generation.current) {
          navigating.current = false;
          setLoading(false);
          if (refreshPending.current) {
            refreshPending.current = false;
            void load(current.current, "refresh");
          }
        }
      }
    },
    [cancelSearch, fail],
  );
  useEffect(() => {
    if (!api) {
      setError(
        "Start this application through Electron with npm run dev or npm start.",
      );
      return;
    }
    void unwrap(api.places())
      .then((value) => {
        setPlaces(value);
        return load(value.home);
      })
      .catch(fail);
    return () => {
      generation.current++;
      cancelSearch();
    };
  }, [load, fail, cancelSearch]);
  useEffect(() => {
    if (!api) return;
    return api.onChange((event) => {
      if (event.path !== current.current) return;
      // An event from the previous directory must not cancel a pending navigation.
      if (navigating.current) {
        if (event.path === pendingTarget.current) refreshPending.current = true;
        return;
      }
      if (event.error) setNotice(event.error);
      else {
        void load(event.path, "refresh");
      }
    });
  }, [load]);
  const items = useMemo(
    () => sortEntries(results ?? listing?.entries ?? [], sort, ascending),
    [results, listing, sort, ascending],
  );
  const selectedItem = items.find((item) => item.path === selected);
  const operate = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setDialog(undefined);
      if (current.current) await load(current.current, "refresh");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const open = async (item: Entry) => {
    setContext(undefined);
    if (item.directory) await load(item.path);
    else {
      try {
        await unwrap(api.open(item.path));
      } catch (e) {
        fail(e);
      }
    }
  };
  const copy = (mode: "copy" | "cut", item = selectedItem) => {
    if (!item) return;
    setClipboard({ path: item.path, mode });
    setContext(undefined);
  };
  const paste = () => {
    if (!clipboard || !listing) return;
    void operate(async () => {
      await unwrap(api.transfer(clipboard.path, listing.path, clipboard.mode));
      if (clipboard.mode === "cut") setClipboard(undefined);
    });
  };
  const renameItem = (item = selectedItem) => {
    if (item) {
      setName(item.name);
      setDialog({ kind: "rename", item });
    }
    setContext(undefined);
  };
  const deleteItem = (item = selectedItem) => {
    if (item) setDialog({ kind: "delete", item });
    setContext(undefined);
  };
  const inspect = async (
    kind: "properties" | "preview",
    item = selectedItem,
  ) => {
    if (!item) return;
    setContext(undefined);
    try {
      if (kind === "properties")
        setDialog({ kind, data: await unwrap(api.properties(item.path)) });
      else
        setDialog({
          kind,
          data: await unwrap(api.preview(item.path)),
          name: item.name,
        });
    } catch (e) {
      fail(e);
    }
  };
  const goHistory = (delta: number) => {
    const h = historyRef.current;
    const index = h.position + delta;
    if (index >= 0 && index < h.paths.length) void load(h.paths[index], index);
  };
  const refresh = () => {
    if (current.current) void load(current.current, "refresh");
  };
  const runSearch = async () => {
    if (!listing || !query.trim()) return;
    cancelSearch();
    const id = crypto.randomUUID();
    searchId.current = id;
    setSearching(true);
    setResults([]);
    setSelected(undefined);
    setError("");
    try {
      const value = await unwrap(
        api.search(listing.path, query, recursive, hidden, id),
      );
      if (searchId.current !== id) return;
      setResults(value.entries);
      setScroll(0);
      if (listRef.current) listRef.current.scrollTop = 0;
      setNotice(
        `${value.entries.length} matches${value.cancelled ? " · Cancelled" : ""}${value.limited ? " · Limit reached (2,000 matches / 50,000 entries / 30 seconds)" : ""}${value.skipped ? ` · ${value.skipped} directories or entries skipped` : ""}`,
      );
    } catch (e) {
      if (searchId.current === id) fail(e);
    } finally {
      if (searchId.current === id) {
        searchId.current = undefined;
        setSearching(false);
      }
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        dialog ||
        busy ||
        (e.target instanceof HTMLElement &&
          e.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        return;
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goHistory(-1);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goHistory(1);
      } else if (e.altKey && e.key === "ArrowUp" && listing) {
        e.preventDefault();
        void load(listing.parent);
      } else if (
        e.ctrlKey &&
        ["c", "x", "v", "r"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        if (e.key.toLowerCase() === "c") copy("copy");
        if (e.key.toLowerCase() === "x") copy("cut");
        if (e.key.toLowerCase() === "v") paste();
        if (e.key.toLowerCase() === "r") refresh();
      } else if (e.key === "F2") {
        e.preventDefault();
        renameItem();
      } else if (e.key === "Delete") {
        e.preventDefault();
        deleteItem();
      } else if (e.key === "Escape") {
        setContext(undefined);
        setNewMenu(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const close = () => {
      setContext(undefined);
      setNewMenu(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  const crumbs = useMemo(() => {
    if (!listing) return [];
    const p = listing.path;
    const sep = p.includes("\\") ? "\\" : "/";
    const parts = p.split(sep).filter(Boolean);
    if (p.startsWith("\\\\"))
      return parts.slice(1).map((part, i) => ({
        label: part,
        path: "\\\\" + parts.slice(0, i + 2).join("\\"),
      }));
    if (sep === "/")
      return [
        { label: "/", path: "/" },
        ...parts.map((part, i) => ({
          label: part,
          path: "/" + parts.slice(0, i + 1).join("/"),
        })),
      ];
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : ""),
    }));
  }, [listing]);
  const visibleStart = Math.max(0, Math.floor(scroll / 36) - 8);
  const visible = items.slice(visibleStart, visibleStart + 60);
  const contextItem = context?.item;
  return (
    <div className="app-shell" onContextMenu={(e) => e.preventDefault()}>
      <header className="titlebar">
        <div className="flex items-center gap-2">
          <FolderOpen size={20} className="text-blue-600" />
          <strong>OS File Explorer</strong>
          <span className="ml-3 text-xs text-slate-400">
            OPERATING SYSTEMS PROJECT
          </span>
        </div>
        <span className="text-xs text-slate-500">Local filesystem</span>
      </header>
      <nav className="navigation">
        <Button
          label="Back (Alt+Left)"
          disabled={position <= 0 || loading || busy}
          onClick={() => goHistory(-1)}
        >
          <ArrowLeft size={18} />
        </Button>
        <Button
          label="Forward (Alt+Right)"
          disabled={position >= history.length - 1 || loading || busy}
          onClick={() => goHistory(1)}
        >
          <ArrowRight size={18} />
        </Button>
        <Button
          label="Parent folder (Alt+Up)"
          disabled={!listing || listing.parent === listing.path || busy}
          onClick={() => listing && void load(listing.parent)}
        >
          <ArrowUp size={18} />
        </Button>
        <Button
          label="Refresh (Ctrl+R)"
          disabled={busy || !listing}
          onClick={refresh}
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
        </Button>
        <Button
          label="Home"
          disabled={!places || busy}
          onClick={() => places && void load(places.home)}
        >
          <Home size={18} />
        </Button>
        <form
          className="flex flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void load(address);
          }}
        >
          <input
            aria-label="Address"
            className="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
          />
        </form>
      </nav>
      <div className="toolbar">
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <Button
            label="New"
            disabled={!listing || busy || loading}
            onClick={() => setNewMenu(!newMenu)}
          >
            <Plus size={17} />
            <span>New</span>
          </Button>
          {newMenu && (
            <div
              className="menu top-10 left-0"
              onClick={(e) => e.stopPropagation()}
            >
              {(["folder", "text", "file"] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => {
                    setName(
                      kind === "text"
                        ? "New Text File.txt"
                        : kind === "folder"
                          ? "New Folder"
                          : "New File",
                    );
                    setDialog({ kind: "new", fileKind: kind });
                    setNewMenu(false);
                  }}
                >
                  {kind === "folder"
                    ? "New Folder"
                    : kind === "text"
                      ? "New Text File"
                      : "New Empty File"}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="divider" />
        <Button
          label="Cut (Ctrl+X)"
          disabled={!selectedItem || busy}
          onClick={() => copy("cut")}
        >
          <Scissors size={17} />
        </Button>
        <Button
          label="Copy (Ctrl+C)"
          disabled={!selectedItem || busy}
          onClick={() => copy("copy")}
        >
          <Copy size={17} />
        </Button>
        <Button
          label="Paste (Ctrl+V)"
          disabled={!clipboard || !listing || busy}
          onClick={paste}
        >
          <ClipboardPaste size={17} />
        </Button>
        <Button
          label="Rename (F2)"
          disabled={!selectedItem || busy}
          onClick={() => renameItem()}
        >
          <Pencil size={17} />
        </Button>
        <Button
          label="Move to Recycle Bin (Delete)"
          disabled={!selectedItem || busy}
          onClick={() => deleteItem()}
        >
          <Trash2 size={17} />
        </Button>
        <span className="divider" />
        <Button
          label="Preview"
          disabled={!selectedItem || selectedItem.directory || busy}
          onClick={() => void inspect("preview")}
        >
          <Eye size={17} />
          <span>Preview</span>
        </Button>
        <Button
          label="Properties"
          disabled={!selectedItem || busy}
          onClick={() => void inspect("properties")}
        >
          <Info size={17} />
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex gap-2 items-center text-xs text-slate-600">
            <input
              type="checkbox"
              checked={hidden}
              disabled={busy}
              onChange={(e) => {
                setHidden(e.target.checked);
                hiddenRef.current = e.target.checked;
                refresh();
              }}
            />
            Show hidden files
          </label>
          <select
            aria-label="Sort by"
            className="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="name">Name</option>
            <option value="type">Type</option>
            <option value="size">Size</option>
            <option value="modified">Date modified</option>
          </select>
          <Button
            label={ascending ? "Sort descending" : "Sort ascending"}
            onClick={() => setAscending(!ascending)}
          >
            {ascending ? "↑" : "↓"}
          </Button>
        </div>
      </div>
      <div className="workspace">
        <aside className="sidebar">
          <p className="section-label">QUICK ACCESS</p>
          {places?.folders.map((place) => {
            const Icon =
              place.name === "Home"
                ? Home
                : place.name === "Desktop"
                  ? Monitor
                  : place.name === "Downloads"
                    ? Download
                    : FileText;
            return (
              <button
                disabled={busy}
                className={
                  listing?.path === place.path ? "place active" : "place"
                }
                key={place.name}
                onClick={() => void load(place.path)}
              >
                <Icon size={17} />
                {place.name}
              </button>
            );
          })}
          <p className="section-label mt-8">THIS PC / DRIVES</p>
          {places?.drives.map((drive) => (
            <button
              className="place"
              key={drive}
              disabled={busy}
              onClick={() => void load(drive)}
            >
              <HardDrive size={17} />
              {drive}
            </button>
          ))}
          <div className="sidebar-note">
            <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full mr-2" />
            OS-backed file operations
          </div>
        </aside>
        <main className="main-pane">
          <div className="content-heading">
            <div className="breadcrumbs">
              {crumbs.map((crumb, i) => (
                <span key={crumb.path} className="inline-flex items-center">
                  <button disabled={busy} onClick={() => void load(crumb.path)}>
                    {crumb.label}
                  </button>
                  {i < crumbs.length - 1 && <ChevronRight size={13} />}
                </span>
              ))}
            </div>
            <form
              className="search-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
            >
              <Search size={16} className="text-slate-400" />
              <input
                aria-label="Search filenames"
                placeholder="Search this folder"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                disabled={searching || busy || !query.trim()}
              >
                Search
              </button>
            </form>
          </div>
          <div className="flex px-5 pb-3 items-center gap-4 text-xs text-slate-500">
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              Include subfolders
            </label>
            {searching && (
              <button
                className="text-blue-600"
                onClick={() => {
                  if (searchId.current) void api.cancelSearch(searchId.current);
                }}
              >
                Cancel search
              </button>
            )}
            {results !== undefined && (
              <button
                className="text-blue-600"
                onClick={() => {
                  cancelSearch();
                  setResults(undefined);
                  setNotice("");
                }}
              >
                Clear search
              </button>
            )}
            {clipboard && (
              <span className="ml-auto">
                {clipboard.mode === "cut" ? "Cut" : "Copied"}:{" "}
                {clipboard.path.split(/[\\/]/).at(-1)}
              </span>
            )}
          </div>
          {error && (
            <div role="alert" className="message error">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {Boolean(notice || listing?.warnings.length) && (
            <div className="message warning">
              {notice || listing?.warnings.slice(0, 3).join(" · ")}
            </div>
          )}
          <div className="table-header row-grid" role="row">
            {(["name", "type", "size", "modified"] as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => {
                  if (sort === key) setAscending(!ascending);
                  else {
                    setSort(key);
                    setAscending(true);
                  }
                }}
              >
                {key === "modified"
                  ? "Date modified"
                  : key[0].toUpperCase() + key.slice(1)}{" "}
                {sort === key ? (ascending ? "↑" : "↓") : ""}
              </button>
            ))}
          </div>
          <div
            className="file-list"
            data-testid="file-list"
            ref={listRef}
            role="listbox"
            aria-label="Files and folders"
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelected(undefined);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContext({
                x: Math.min(e.clientX, window.innerWidth - 215),
                y: Math.min(e.clientY, window.innerHeight - 285),
              });
            }}
          >
            {(loading || searching) && (
              <div className="loading-line">
                <Loader2 size={16} className="animate-spin" />
                {loading ? "Reading directory…" : "Searching filesystem…"}
              </div>
            )}
            {!loading && !searching && items.length === 0 && (
              <div className="empty">
                <FolderOpen size={42} strokeWidth={1} />
                <h3>
                  {results !== undefined
                    ? "No matching items"
                    : "This folder is empty"}
                </h3>
                <p>
                  {results !== undefined
                    ? "Try a different filename or include subfolders."
                    : "Use New to create a file or folder here."}
                </p>
              </div>
            )}
            <div style={{ height: visibleStart * 36 }} />
            {visible.map((item) => (
              <div
                key={item.path}
                role="option"
                tabIndex={0}
                aria-selected={selected === item.path}
                className={`file-row row-grid ${selected === item.path ? "selected" : ""} ${clipboard?.mode === "cut" && clipboard.path === item.path ? "opacity-50" : ""}`}
                onClick={() => setSelected(item.path)}
                onFocus={() => setSelected(item.path)}
                onDoubleClick={() => {
                  if (!busy) void open(item);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void open(item);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(item.path);
                  setContext({
                    x: Math.min(e.clientX, window.innerWidth - 215),
                    y: Math.min(e.clientY, window.innerHeight - 285),
                    item,
                  });
                }}
              >
                <span
                  className="flex gap-2 items-center min-w-0"
                  title={item.path}
                >
                  <ItemIcon item={item} />
                  <span className="truncate">
                    {item.name}
                    {results !== undefined && (
                      <small className="text-slate-400 ml-3">{item.path}</small>
                    )}
                  </span>
                </span>
                <span className="truncate text-slate-500">{item.type}</span>
                <span className="text-slate-500 tabular-nums">
                  {item.directory ? "—" : formatSize(item.size)}
                </span>
                <span className="text-slate-500 text-xs">
                  {date(item.modified)}
                </span>
              </div>
            ))}
            <div
              style={{
                height:
                  Math.max(0, items.length - visibleStart - visible.length) *
                  36,
              }}
            />
          </div>
        </main>
      </div>
      <footer className="statusbar">
        <span>
          {items.length.toLocaleString()}{" "}
          {results !== undefined ? "matches" : "items"}
        </span>
        <span>
          {selectedItem ? "1 selected" : "0 selected"}
          {selectedItem && !selectedItem.directory
            ? ` · ${formatSize(selectedItem.size)}`
            : ""}
        </span>
        <span className="ml-auto flex gap-2 items-center">
          {busy ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Working…
            </>
          ) : loading ? (
            "Loading…"
          ) : (
            "Ready"
          )}
        </span>
      </footer>
      {context && (
        <div
          className="menu fixed"
          style={{ left: context.x, top: context.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextItem && (
            <>
              <button disabled={busy} onClick={() => void open(contextItem)}>
                Open
              </button>
              <button disabled={busy} onClick={() => copy("copy", contextItem)}>
                Copy <kbd>Ctrl+C</kbd>
              </button>
              <button disabled={busy} onClick={() => copy("cut", contextItem)}>
                Cut <kbd>Ctrl+X</kbd>
              </button>
              <button disabled={busy} onClick={() => renameItem(contextItem)}>
                Rename <kbd>F2</kbd>
              </button>
              <button disabled={busy} onClick={() => deleteItem(contextItem)}>
                Recycle Bin <kbd>Delete</kbd>
              </button>
              <button
                disabled={busy || contextItem.directory}
                onClick={() => void inspect("preview", contextItem)}
              >
                Preview
              </button>
              <button
                disabled={busy}
                onClick={() => void inspect("properties", contextItem)}
              >
                Properties
              </button>
            </>
          )}
          <button
            disabled={!clipboard || busy}
            onClick={() => {
              setContext(undefined);
              paste();
            }}
          >
            Paste <kbd>Ctrl+V</kbd>
          </button>
        </div>
      )}
      {dialog && (
        <Dialog
          title={
            dialog.kind === "new"
              ? `New ${dialog.fileKind === "folder" ? "Folder" : dialog.fileKind === "text" ? "Text File" : "Empty File"}`
              : dialog.kind === "rename"
                ? "Rename item"
                : dialog.kind === "delete"
                  ? "Move to Recycle Bin?"
                  : dialog.kind === "properties"
                    ? "Properties"
                    : dialog.name
          }
          onClose={closeDialog}
        >
          {(dialog.kind === "new" || dialog.kind === "rename") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void operate(() =>
                  dialog.kind === "new"
                    ? unwrap(api.create(listing!.path, name, dialog.fileKind))
                    : unwrap(api.rename(dialog.item.path, name)),
                );
              }}
            >
              <label className="block text-sm mb-2" htmlFor="item-name">
                Name
              </label>
              <input
                id="item-name"
                className="dialog-input"
                autoFocus
                value={name}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
              <p className="text-xs text-slate-500 mt-3">
                Existing items will not be overwritten.
              </p>
              {error && (
                <p role="alert" className="text-red-700 text-sm mt-3">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button type="button" onClick={closeDialog} disabled={busy}>
                  Cancel
                </button>
                <button className="primary" disabled={busy || !name.trim()}>
                  {busy
                    ? "Working…"
                    : dialog.kind === "new"
                      ? "Create"
                      : "Rename"}
                </button>
              </div>
            </form>
          )}
          {dialog.kind === "delete" && (
            <>
              <p className="text-sm">
                Move <strong>{dialog.item.name}</strong>
                {dialog.item.directory ? " and its contents" : ""} to the
                Recycle Bin?
              </p>
              <p className="text-xs text-slate-500 mt-3 break-all">
                {dialog.item.path}
              </p>
              {error && (
                <p role="alert" className="text-red-700 text-sm mt-3">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button onClick={closeDialog} disabled={busy}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void operate(() => unwrap(api.trash(dialog.item.path)))
                  }
                >
                  {busy ? "Working…" : "Move to Recycle Bin"}
                </button>
              </div>
            </>
          )}
          {dialog.kind === "properties" && (
            <dl className="properties">
              {Object.entries({
                Name: dialog.data.name,
                "Absolute path": dialog.data.path,
                Type: dialog.data.type,
                Size: dialog.data.directory
                  ? "— (recursive folder size not calculated)"
                  : `${dialog.data.size.toLocaleString()} bytes (${formatSize(dialog.data.size)})`,
                Created: date(dialog.data.created),
                Modified: date(dialog.data.modified),
                Accessed: date(dialog.data.accessed),
                Directory: dialog.data.directory ? "Yes" : "No",
                "Symbolic link / junction": dialog.data.link
                  ? "Yes (timestamps and size describe the link)"
                  : "No",
                "Read access check": dialog.data.readable ? "Passed" : "Failed",
                "Write access check": dialog.data.writable
                  ? "Passed"
                  : "Failed",
                "Permissions note": dialog.data.permissions,
              }).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {dialog.kind === "preview" &&
            (dialog.data.kind === "text" ? (
              <pre className="text-preview">
                {dialog.data.content || "(Empty file)"}
              </pre>
            ) : (
              <img
                className="image-preview"
                src={dialog.data.content}
                alt={dialog.name}
              />
            ))}
        </Dialog>
      )}
    </div>
  );
}
