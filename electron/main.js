// World Builder as a desktop app: runs the server in this process on a free local port and shows it in a window
// without browser controls. Start with `npm run app` (system Electron) or the installed `world-builder` command.
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
app.setName("world-builder");
app.setDesktopName?.("world-builder.desktop");

// one window: starting it again focuses the running one
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let origin = "";
const stateFile = () => path.join(app.getPath("userData"), "window.json");
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; } };
function saveState() {
    if (!win || win.isDestroyed()) return;
    const s = { ...(win.isMaximized() || win.isFullScreen() ? readState() : win.getBounds()), maximized: win.isMaximized() };
    try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(s)); } catch { /* not important */ }
}

function createWindow(url) {
    const s = readState();
    win = new BrowserWindow({
        x: s.x, y: s.y, width: s.width ?? 1600, height: s.height ?? 1000, minWidth: 700, minHeight: 500,
        title: "World Builder", backgroundColor: "#17161a", autoHideMenuBar: true, show: false,
        icon: path.join(HERE, "icon.svg"),
        // hidden (screenshots): rendered off screen, so frames are still painted
        webPreferences: { preload: path.join(HERE, "preload.cjs"), contextIsolation: true, sandbox: true, spellcheck: true, ...(process.env.WB_HIDDEN ? { offscreen: true } : {}) },
    });
    if (s.maximized) win.maximize();
    // WB_HIDDEN: no window on screen (scripts/screenshots.mjs drives it through the debugging port)
    if (!process.env.WB_HIDDEN) win.once("ready-to-show", () => win.show());
    win.on("close", saveState);
    win.on("closed", () => { win = null; });
    // the page asks before leaving with unsaved edits (beforeunload); Electron needs the question asked here
    win.webContents.on("will-prevent-unload", (e) => {
        const choice = dialog.showMessageBoxSync(win, { type: "question", buttons: ["Leave", "Stay"], defaultId: 1, cancelId: 1, title: "Unsaved changes", message: "Discard unsaved changes?" });
        if (choice === 0) e.preventDefault();
    });
    // links to other sites open in the normal browser; the app's own pages (PDFs, images) open in a window of their own
    win.webContents.setWindowOpenHandler(({ url: to }) => {
        if (to.startsWith(origin)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
        if (/^https?:|^mailto:/.test(to)) shell.openExternal(to);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, to) => { if (!to.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(to)) shell.openExternal(to); } });
    win.loadURL(url);
}

// window.prompt() is not built into Electron: the preload asks here and waits for a small dialog window
ipcMain.on("wb-prompt", (event, message, value) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const box = new BrowserWindow({
        parent, modal: true, width: 460, height: 190, resizable: false, minimizable: false, maximizable: false,
        title: "World Builder", autoHideMenuBar: true, show: false, backgroundColor: "#1f1e23",
        webPreferences: { contextIsolation: true, sandbox: true, javascript: true },
    });
    let answered = false;
    const answer = (v) => { if (answered) return; answered = true; event.returnValue = v; if (!box.isDestroyed()) box.close(); };
    // the dialog reports its answer through its title (no Node access needed)
    box.webContents.on("page-title-updated", (_e, title) => { if (title.startsWith("WB_RESULT:")) answer(JSON.parse(title.slice(10))); });
    box.on("closed", () => answer(null));
    box.once("ready-to-show", () => box.show());
    box.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(promptPage(String(message ?? ""), String(value ?? "")))}`);
});

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const promptPage = (message, value) => `<!doctype html><html><head><meta charset="utf-8"><title>World Builder</title><style>
    :root { color-scheme: light dark; --bg: #ffffff; --text: #23211d; --line: #e2dfd8; --accent: #6a4fc4; }
    @media (prefers-color-scheme: dark) { :root { --bg: #1f1e23; --text: #e8e6e3; --line: #34323a; --accent: #b195f5; } }
    body { margin: 0; padding: 18px 20px; background: var(--bg); color: var(--text); font: 14px system-ui, sans-serif; }
    p { margin: 0 0 10px; } input { width: 100%; box-sizing: border-box; padding: 7px 9px; font: inherit; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); }
    input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 30%, transparent); border-color: var(--accent); }
    .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    button { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; cursor: pointer; }
    button.ok { background: var(--accent); border-color: var(--accent); color: var(--bg); }
</style></head><body><p>${esc(message)}</p><input id="v" value="${esc(value)}" autofocus>
<div class="row"><button id="c">Cancel</button><button class="ok" id="o">OK</button></div>
<script>
    const v = document.getElementById("v"), done = (x) => { document.title = "WB_RESULT:" + JSON.stringify(x); };
    v.select();
    document.getElementById("o").onclick = () => done(v.value);
    document.getElementById("c").onclick = () => done(null);
    addEventListener("keydown", (e) => { if (e.key === "Enter") done(v.value); if (e.key === "Escape") done(null); });
</script></body></html>`;

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
    // a hidden menu: its shortcuts still work (reload, zoom, full screen, developer tools); text editing keys stay with the page
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" },
            { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomIn", accelerator: "CommandOrControl+=", visible: false }, { role: "zoomOut" },
            { type: "separator" }, { role: "togglefullscreen" }, { role: "quit" }] },
    ]));
    try {
        const { start } = await import("../server.js");
        // a fixed port: the page keeps its preferences (theme, where you were) per address, so it must stay the same
        const { port } = await start({ port: Number(process.env.WB_PORT) || 47321, host: "127.0.0.1", fallback: true });
        origin = `http://127.0.0.1:${port}`;
        createWindow(`${origin}/`);
    } catch (e) {
        dialog.showErrorBox("World Builder could not start", String(e?.stack ?? e));
        app.quit();
    }
});
