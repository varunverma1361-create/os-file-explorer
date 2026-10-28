import { watch, type FSWatcher } from "node:fs";
export class DirectoryWatcher {
  private directory?: string;
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  close() {
    this.directory = undefined;
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.timer);
  }
  start(
    directory: string,
    notify: (value: { path: string; error?: string }) => void,
  ) {
    // Keep pending debounced events when refreshing the directory already watched.
    if (this.watcher && this.directory === directory) return;
    this.close();
    this.watcher = watch(directory, () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => notify({ path: directory }), 250);
    });
    this.directory = directory;
    this.watcher.on("error", (e) => {
      this.close();
      notify({
        path: directory,
        error: `Live updates unavailable: ${e.message}. Use Refresh.`,
      });
    });
  }
}
