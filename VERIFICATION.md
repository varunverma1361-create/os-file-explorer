# Verification report

Verified on 28 October 2026 on Windows 11 x64 (build 26200), using Node.js 24.21.0 and the lockfile-installed dependencies, including Electron 42.11.18.

## Automated service checks

`npm test`: **13 tests: 12 passed, 0 failed, 1 skipped**.

The skipped test changes POSIX permission bits to provoke access denial. It is intentionally skipped on Windows; no Windows user ACLs were changed. Windows junction creation and the actual Windows Hidden attribute test ran successfully outside the execution sandbox. All writes and cleanup occurred in generated test directories.

Covered behaviors:

- Real directory listing, metadata, empty folders, spaces in paths, nonexistent paths, and file-versus-directory errors.
- Exclusive file/folder creation, invalid Windows names, device namespaces, alternate streams, and full absolute-path validation.
- Rename, name conflicts, file copy, nested folder copy, same-device moves, and controlled cleanup.
- Copying a directory into itself/descendants, including canonical aliases through junctions, is rejected.
- Directory junction loops are not followed during searches and are rejected during transfers.
- Case-insensitive recursive search, nonrecursive search, cancellation, dot-name filtering, and the actual Windows Hidden attribute on a non-dot filename.
- Plain-text HTML previews, rejected binary data, oversized files, bad image signatures and unsupported extensions.
- Sorting by name, type, size, and modification time, including numeric names and folder grouping.
- Native watcher notification and watcher replacement.
- Injected `EXDEV` verifies cross-device fallback while all copy/delete work still uses real temporary files.
- Injected `ENOSPC` verifies source retention and rollback of partially created destination trees.

## TypeScript and builds

- `npm run typecheck`: passed.
- `npm run build`: passed (TypeScript, Vite renderer, bundled Electron main/preload).
- `npm run dist`: produces the unsigned Windows x64 portable application in `release/`.
- The packaged `release/win-unpacked/OS File Explorer.exe` passed the complete smoke workflow, loading its renderer and preload from `resources/app.asar` with exit code 0.
- The final portable `release/OS File Explorer 1.0.0.exe` was also launched hidden with `--smoke` and returned exit code 0. Its size is 102,268,399 bytes. The portable wrapper does not forward the child application's console output; detailed smoke assertions were separately observed from the packaged executable above.

## Electron integration

Production and development smoke workflows run against a real sandboxed BrowserWindow and use the real preload/IPC bridge. They verify:

- React renders and Node `require` is unavailable in the renderer.
- Entering an address through the React address form navigates to a real generated directory.
- New → New Folder → Create creates a real folder on disk through the UI.
- IPC listing, file/folder creation, rename, copy, move, metadata, text preview, recursive search and invalid-name rejection.
- `fs.watch` emits a real change notification through preload.
- After a burst of create/rename/copy/move/trash operations, the visible React list settles to the actual final directory contents. Refreshing the same directory preserves pending debounced watcher events.
- `shell.trashItem` removes a controlled non-empty folder from its original location using the Windows Recycle Bin. There is no permanent-delete fallback.
- A screenshot is captured and inspected for layout. The two listed folders in the screenshot are real temporary test folders; they are cleaned up after the smoke run.

Expected validation errors are logged by the main process during the smoke test; those are assertions of rejected invalid operations, not test failures.

## Remaining manual checks / limitations

- Default-application association opening is implemented with `shell.openPath()` and its returned error is handled. The automated smoke test does not launch external editors/viewers. Demonstrate this on the evaluation computer with a disposable `.txt`, PDF or image file.
- Actual physical cross-drive transfers, disconnected drives, UNC shares, unusual redirected-folder policies, locked files, low-disk conditions and ACL-denied operations were not exercised on real affected volumes. Cross-device and low-disk failure branches have automated injected-error coverage.
- Properties access checks are advisory and do not enumerate Windows ACLs.
- The executable uses Electron's default application icon and is unsigned.
- Transfer operations are not transactional against concurrent external filesystem changes. Read the concurrency and metadata-preservation limitations in README.md.
- The optional text editor is omitted. All essential file management features are implemented.
