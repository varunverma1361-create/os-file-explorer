import { app, BrowserWindow, protocol, net, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerIPC } from "./ipcHandlers";
import { runSmoke } from "./smoke";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window: BrowserWindow | null = null;
const smoke = process.argv.includes("--smoke");
if (smoke)
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), "os-explorer-smoke-profile"),
  );
async function createWindow() {
  const development =
    !app.isPackaged &&
    process.env.ELECTRON_RENDERER_URL === "http://127.0.0.1:5173";
  const url = development
    ? "http://127.0.0.1:5173/"
    : "app://explorer/index.html";
  window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 860,
    minHeight: 580,
    show: !smoke,
    backgroundColor: "#ffffff",
    title: "OS File Explorer",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (target !== url) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  registerIPC(window, url);
  await window.loadURL(url);
  if (smoke) {
    try {
      await runSmoke(window);
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
  }
  window.on("closed", () => {
    window = null;
  });
}
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle("app", (request) => {
      const url = new URL(request.url);
      const root = path.resolve(__dirname, "../dist");
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      const relative = path.relative(root, file);
      if (
        url.host !== "explorer" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative)
      )
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
