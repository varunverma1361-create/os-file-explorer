# OS File Explorer

A Windows desktop file manager for a B.Tech Computer Science Operating Systems mini-project. This is a working Electron application: every listing and operation uses the computer's actual filesystem. There is no simulated file data, server, database, account, or external application API.

## Requirements and installation

- Windows 10/11, an ordinary user account, and Node.js 22.12+ or Node.js 24 LTS with npm.
- Internet access during installation to download npm dependencies and the Electron runtime. The installed application works offline.
- Do not run the app as administrator. It uses your existing OS permissions.

The built portable executable includes Electron and its runtime; Node.js/npm are needed only when installing or building from source.

Open a terminal in this folder:

```powershell
npm install
npm run dev
```

Development starts Vite on `http://127.0.0.1:5173` and launches Electron. Renderer changes support React refresh; restart development after changes to Electron/preload code. Opening the Vite page in an ordinary browser does not grant filesystem functionality.

If your Node version manager says no active version is configured, activate an installed Node version first, or install Node.js LTS. Check `node --version` and `npm --version` before installing.

## Build and run

```powershell
npm run typecheck
npm test
npm run build
npm start
npm run smoke
npm run dist
```

- `build` checks TypeScript and produces `dist/` (renderer) and `dist-electron/` (main/preload).
- `start` opens those production assets in Electron. Build first.
- `smoke` launches a hidden real desktop window, verifies React navigation and folder creation, exercises the preload API, and checks Recycle Bin deletion using temporary files. It saves `desktop-preview.png`. It does not open a user's files or launch their associated applications. The controlled deleted test folder remains recoverable in the Recycle Bin.
- `dist` builds an unsigned Windows x64 portable executable in `release/`. Code signing is deliberately not configured. Packaging may download Electron and electron-builder tools on first use.

`package-lock.json` records the dependency versions. Use `npm ci` for subsequent reproducible installations. Some recent npm versions require approval of dependency install scripts; review prompts for Electron and esbuild if installation requests this. Electron can also fetch its runtime on first launch.

## Features and usage

- Browse real absolute paths, including spaces, Unicode, drive roots, and accessible UNC paths. The app starts at `os.homedir()`.
- Back, forward, up, home, refresh, editable address bar, and clickable breadcrumbs.
- Actual Home, Desktop, Documents, Downloads locations from Electron's OS-aware `app.getPath()`; unavailable standard folders are omitted. Accessible drive letters appear under This PC / Drives.
- Virtualized compact list showing name, type, size, and last modification time. Folders stay before files in all four ascending/descending sorts. Folder sizes display `—`.
- Select with a click; open with a double-click or Enter. Files use the registered Windows default application. Folder links can be opened manually and are marked with a link icon.
- New Folder, New Text File, and New Empty File. Text files start empty; the default suggested name ends in `.txt`. Names are checked for Windows reserved characters, device names, and trailing dots/spaces. Existing files are never intentionally replaced.
- Rename from the toolbar, context menu, or F2. Exact unchanged names are a no-op. Case-only renames are rejected as a conflict on typical Windows filesystems; use a temporary distinct name.
- Single-item internal Copy / Cut / Paste supports regular files and complete directory trees. Cut is cleared only after a successful move. Conflicts produce an error. There is no global Explorer clipboard integration.
- Confirmed deletion uses the Recycle Bin exclusively, including non-empty folders. If Windows cannot trash an item, the operation fails visibly with no permanent-delete fallback.
- Read-only Properties shows actual metadata, timestamps, symbolic-link status, and advisory access checks.
- Search by name, optionally including descendants. Matching paths are displayed beside names. Search is case insensitive, cancellable, and bounded to 2,000 matches, 50,000 inspected entries, or approximately 30 seconds. Inaccessible entries are counted as skipped.
- Hidden files are hidden by default. Windows Hidden attributes are read using a fixed PowerShell program; dot-prefixed items are also considered hidden. Toggle Show hidden files to include them.
- Text previews for UTF-8 `.txt`, `.md`, `.json`, `.js`, `.ts`, `.html`, `.css` (512 KB maximum). HTML and JavaScript are rendered as escaped plain text, never executed. Binary/control data and malformed UTF-8 are rejected.
- PNG, JPEG, WebP image previews (5 MB maximum). Magic signatures are checked. Previews are bounded reads sent through IPC as text or data URLs, with no unrestricted local-file URLs exposed to React.
- Debounced live updates through `fs.watch()`, with the old watcher removed when navigating. Manual refresh remains available.
- Human-readable filesystem errors and busy/loading indicators.

Search refreshes are explicit: press Search after changing a term or recursion option. Navigation, manual refresh, filesystem events, hidden-file changes, and completed mutations return to the normal directory listing to avoid showing stale search results. Cancellation keeps partial search results.

### Keyboard shortcuts

| Shortcut                 | Action                               |
| ------------------------ | ------------------------------------ |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / Cut / Paste                   |
| Delete                   | Confirm Recycle Bin deletion         |
| F2                       | Rename                               |
| Alt+Left / Alt+Right     | Back / Forward                       |
| Alt+Up                   | Parent directory                     |
| Ctrl+R                   | Refresh directory                    |
| Enter on a focused item  | Open                                 |
| Escape                   | Close an idle dialog or context menu |

File shortcuts are disabled while typing in inputs, while a modal is open, or during mutations. Tab can focus controls and rows. Selection is intentionally limited to one item.

## Technologies and architecture

- **Electron** provides the desktop window, isolated preload bridge, OS known folders, default application opening, and Recycle Bin.
- **React** owns the UI, dialogs, navigation history, selection, sorting, and internal clipboard.
- **TypeScript** shares an explicit `API` contract and filesystem data types across the renderer/preload/main boundary.
- **Vite** builds the renderer and serves it during development.
- **Tailwind CSS** supplies layout/style utilities; a small stylesheet handles file-manager-specific components. **Lucide React** provides icons.
- **Node.js** provides asynchronous filesystem, path, OS, and monitoring APIs. esbuild bundles the main process and the sandbox-compatible CommonJS preload. electron-builder creates the portable Windows application.

```text
os-file-explorer/
├── electron/
│   ├── main.ts                 # Window, app protocol, security, lifecycle
│   ├── preload.ts              # Narrow typed contextBridge API
│   ├── ipcHandlers.ts          # Sender and argument validation, OS APIs
│   ├── smoke.ts                # Real Electron / UI integration checks
│   └── services/
│       ├── fileSystem.ts       # Listing, validation, metadata, preview
│       ├── fileOperations.ts   # Exclusive creation, rename, copy, move
│       ├── search.ts           # Bounded asynchronous traversal
│       └── fileWatcher.ts      # Debounced watcher and cleanup
├── src/
│   ├── App.tsx                 # Interface, dialogs and state
│   ├── main.tsx
│   └── index.css
├── shared/types.ts             # IPC contract, sorting, size formatting
├── tests/filesystem.test.ts    # Controlled filesystem service tests
├── scripts/                    # Development, build and smoke launchers
├── index.html
├── vite.config.ts
├── tailwind.config.cjs
├── postcss.config.cjs
├── tsconfig.json
├── package.json
├── package-lock.json
└── README.md
```

### Security and data safety

The renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and default web security. It receives selected methods through `contextBridge`; neither `require` nor raw `ipcRenderer` is exposed. Main-process handlers validate both the sender window/main frame and its exact local application URL, then validate every operation's arguments. IPC returns success only after the underlying promise succeeds. Expected OS errors are translated into readable messages; unexpected errors are also logged by the main process.

Production content is served using a restricted `app://explorer` protocol, with checks preventing arbitrary filesystem reads through protocol requests. New windows, webviews, external navigation, and browser permissions are denied. Production CSP permits application scripts only. Development permits Vite's inline React refresh preamble; this allowance is absent from the production HTML.

Absolute paths are allowed outside the home folder. Device namespaces, NUL bytes, and Windows alternate data streams are rejected. No operation requests elevation or bypasses permissions. The hidden-attribute helper uses `execFile()` with a fixed PowerShell program; paths are passed as environment data rather than interpolated into executable text.

Mutations from this application are serialized. Creation uses exclusive flags; copies use `COPYFILE_EXCL`, and destination folders use non-recursive `mkdir`. Rename/move check for existing destinations. Canonical source and destination-parent paths prevent transfers into the source's descendants, including destination aliases through junctions. Entire transfer trees are checked for symbolic links/junctions, which are rejected rather than followed. Recursive search never queues links. Manually opening a folder link is supported.

Same-device moves use `rename`. On `EXDEV`, the app performs an exclusive copy and removes the source only after the full copy succeeds. A failed copy retains the source and attempts to remove only destination entries created by that transfer. If cleanup fails, the error identifies the partial destination. If source removal after a cross-device copy fails, the error explains that both locations need inspection; the clipboard is retained.

## OS concepts demonstrated

| Concept                        | Demonstration                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Filesystem management          | Creating, listing, renaming, copying, moving and recycling actual filesystem entries                    |
| Directory hierarchy            | Absolute paths, parent relationships, breadcrumbs, drive roots and navigation history                   |
| File I/O                       | Exclusive creation and bounded file-handle reads; OS-mediated opening in associated applications        |
| Metadata and attributes        | `stat`/`lstat` sizes, timestamps, directory/link status, Windows Hidden attribute                       |
| Permissions and access control | Advisory access checks plus actual operation errors under the user's existing permissions               |
| Traversal                      | Asynchronous recursive name search, bounded work queues, inaccessible-entry handling and loop avoidance |
| System APIs                    | Node and Electron call platform services rather than maintaining a fake file tree                       |
| Monitoring                     | `fs.watch()` notifications trigger a debounced reload; watchers are cleaned up on navigation/exit       |

### Important APIs

| Feature                        | Node.js / Electron API                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Directory contents             | `fs.promises.readdir()`                                             |
| Metadata / link identification | `fs.promises.stat()` / `lstat()`                                    |
| Folder creation                | `fs.promises.mkdir()`                                               |
| File creation                  | `fs.promises.open(path, 'wx')`                                      |
| Rename / same-device move      | `fs.promises.rename()`                                              |
| Recursive copy                 | `readdir()`, `mkdir()`, `copyFile(COPYFILE_EXCL)`                   |
| Cross-device move              | Exclusive copy, then `fs.promises.rm()` on the source after success |
| Failed-copy cleanup            | `unlink()` / `rmdir()` on created entries                           |
| User deletion                  | Electron `shell.trashItem()`                                        |
| Default application opening    | Electron `shell.openPath()`                                         |
| Preview reads                  | FileHandle `stat()`, `read()`, `close()`                            |
| Search                         | Asynchronous `readdir()` / `lstat()`, `AbortSignal`                 |
| Directory updates              | Node `fs.watch()`                                                   |
| User home / known folders      | `os.homedir()` / Electron `app.getPath()`                           |
| Path resolution / alias checks | Node `path`, `fs.promises.realpath()`                               |
| Advisory access                | `fs.promises.access()`                                              |
| Windows hidden attributes      | Fixed `powershell.exe` program reading `.NET FileAttributes.Hidden` |
| React ↔ main communication     | `contextBridge`, `ipcRenderer.invoke()`, `ipcMain.handle()`         |

### How This Project Interacts With the Operating System

**User interacts with React UI → React calls preload API → Electron IPC → Main process → Node.js filesystem API → Operating system → Actual filesystem.**

For example, Create Folder submits a name to the preload's `create` method. IPC sends it to the trusted main-process handler. The handler validates the path/name and calls the filesystem service, which awaits `fs.mkdir()`. Node delegates the request to the OS under the current user's permissions. React refreshes only after success. The resulting folder is visible in Windows Explorer and persists after the app closes.

A frontend-only simulation would modify a JavaScript array in browser memory. This application reads and changes actual directories and uses native OS services for opening and recycling. Node APIs are wrappers around platform functionality and are not necessarily one-to-one mappings to individual system calls.

For the viva, demonstrate creating a folder and text file, showing them in Windows Explorer, renaming, copying into a second folder, cutting back, searching recursively, viewing Properties, previewing a small UTF-8 file, and recycling the demonstration folder. Create the demonstration files in a dedicated disposable directory.

## Testing

`npm test` uses Node's built-in test runner through tsx. Tests create isolated `tests/.tmp/os-explorer-test-*` directories and clean them up. Coverage includes real listings/metadata, nonexistent paths, empty directories, spaces in names, exclusive creation, reserved names, rename conflicts, file/directory copies, moves, nested searches, cancellation, hidden filtering, bounded previews, sorting, watcher delivery, descendant prevention, and junction loops. Cross-device behavior is exercised by injecting `EXDEV` into `rename`; all subsequent copies and cleanup operate on real temporary files. Copy-failure testing injects `ENOSPC` to verify source retention. A POSIX permission-denial check skips on Windows because changing user ACLs is outside this project's scope.

`npm run smoke` separately verifies the real Electron window, React navigation, UI-created folder, isolated bridge, main-process IPC, creation, rename, copying, moving, previews, metadata, search, live watching and Recycle Bin. It only touches generated temporary items. See `VERIFICATION.md` for results from this environment and unverified scenarios.

## Known limitations

- Windows ACLs are not POSIX mode bits. Properties shows advisory Node read/write access probes, **not** a complete ACL evaluation, effective-access calculation, or permission editor. A successful check cannot guarantee that a later operation succeeds. Creation and access timestamps follow filesystem/Windows policies; access timestamps may be delayed or disabled.
- Dot names are hidden by convention in addition to the Windows Hidden attribute. Hidden detection requires Windows PowerShell. If unavailable, listing shows a warning and falls back to dot names. Searches skip directories whose attributes cannot be read when hidden items are excluded and report the skipped count. Enable Show hidden files to bypass the attribute helper during searches.
- Known folder resolution uses Electron's OS-aware paths; unavailable paths are omitted. Unusual policy/redirect setups should be checked on the target machine. Drive discovery probes A–Z at startup; disconnected/network drives can respond slowly. No network-share discovery is implemented.
- `fs.watch()` can coalesce/miss notifications or fail on some filesystems and network paths. A visible error and manual Refresh remain available. It monitors immediate directory contents, not an entire recursive tree.
- Transfers intentionally reject symbolic links/junctions anywhere inside a tree and special files. This avoids copying outside the intended tree and recursive loops. Folder previews do not compute recursive sizes. Link Properties reports `lstat` size/timestamps; access checks follow the target.
- Filesystem changes by other programs during a transfer cannot be made transactional with these APIs. Destination existence checks followed by `rename()` are not an atomic no-replace primitive; a concurrently created destination may race the check. Avoid concurrently modifying the same source/destination. Cross-drive moves have a copy/delete interval, and a failure while deleting the source may leave a partially removed source plus the complete destination. The app reports the failure. Copies transfer contents rather than preserving every ACL, alternate stream or timestamp.
- Very large trees are limited to 100,000 entries for transfer preflight. Listing uses batches of 64 metadata requests and virtualizes rows, but still holds immediate-directory metadata in memory. Transfer operations show a busy indicator, cannot currently be cancelled, and do not provide byte-level progress. No filesystem operation can protect against actively malicious concurrent replacement of path components without lower-level platform-specific handles.
- Search limits are approximate between awaited filesystem calls; an unresponsive OS call or hidden-attribute subprocess can delay cancellation. Search matches names, not contents, and does not perform indexing.
- Preview accepts only the listed extensions/encodings and size limits. It does not execute HTML, offer media playback, edit files, or expose arbitrary local URLs. The optional text editor is intentionally omitted; use Open to edit in the associated application.
- The app is single-window/single-selection, with no multi-tab, drag/drop, permanent-delete command or system clipboard integration. It is intended as a clear mini-project implementation, not a full replacement for Windows Explorer.
- The portable build is unsigned. Test default-app associations and real cross-drive behavior on the demonstration computer. Electron and dependencies should be updated and retested periodically.

## Reference documentation

- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-builder CLI](https://www.electron.build/docs/cli/)
