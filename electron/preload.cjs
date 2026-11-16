// Electron has no window.prompt(); the app uses it for short names (new volume, plot, callout type…). This puts a
// prompt() into the page that asks the main process, which shows a small dialog and answers when it closes.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

// the Settings page's interface size zooms the whole window (like Ctrl+= does)
contextBridge.exposeInMainWorld("__wbZoom", (factor) => { const f = Number(factor); if (f >= 0.5 && f <= 2) webFrame.setZoomFactor(f); });

contextBridge.exposeInMainWorld("__wbPrompt", (message, value) => ipcRenderer.sendSync("wb-prompt", message, value));
contextBridge.executeInMainWorld({
    func: () => { window.prompt = (message, value) => window.__wbPrompt(String(message ?? ""), value == null ? "" : String(value)); },
});
