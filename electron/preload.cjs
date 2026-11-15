// Electron has no window.prompt(); the app uses it for short names (new volume, plot, callout type…). This puts a
// prompt() into the page that asks the main process, which shows a small dialog and answers when it closes.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__wbPrompt", (message, value) => ipcRenderer.sendSync("wb-prompt", message, value));
contextBridge.executeInMainWorld({
    func: () => { window.prompt = (message, value) => window.__wbPrompt(String(message ?? ""), value == null ? "" : String(value)); },
});
