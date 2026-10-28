import { contextBridge, ipcRenderer } from "electron";
import type { API } from "../shared/types";
const api: API = {
  places: () => ipcRenderer.invoke("fs:places"),
  list: (p, h) => ipcRenderer.invoke("fs:list", p, h),
  create: (p, n, k) => ipcRenderer.invoke("fs:create", p, n, k),
  rename: (p, n) => ipcRenderer.invoke("fs:rename", p, n),
  transfer: (s, d, m) => ipcRenderer.invoke("fs:transfer", s, d, m),
  trash: (p) => ipcRenderer.invoke("fs:trash", p),
  open: (p) => ipcRenderer.invoke("fs:open", p),
  properties: (p) => ipcRenderer.invoke("fs:properties", p),
  preview: (p) => ipcRenderer.invoke("fs:preview", p),
  search: (p, q, r, h, id) => ipcRenderer.invoke("fs:search", p, q, r, h, id),
  cancelSearch: (id) => ipcRenderer.invoke("fs:cancelSearch", id),
  watch: (p) => ipcRenderer.invoke("fs:watch", p),
  onChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { path: string; error?: string },
    ) => callback(value);
    ipcRenderer.on("fs:changed", listener);
    return () => ipcRenderer.removeListener("fs:changed", listener);
  },
};
contextBridge.exposeInMainWorld("explorer", api);
