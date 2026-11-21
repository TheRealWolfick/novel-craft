// Screenshots for the docs and the README, always of the demo vault (scripts/demo-vault.js), never a real one.
// Runs the desktop app hidden on a throwaway copy of the demo vault and captures each shot in docs/shots.json in both
// themes: docs/img/<name>.png (light) and docs/img/<name>.dark.png (dark). The docs show the one for the app's theme,
// the README the one for the reader's (<picture>).
//
//   node scripts/screenshots.mjs [--only name,name] [--keep]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.join(ROOT, "docs", "img");
const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const shots = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "shots.json"), "utf8")).filter((s) => !only || only.has(s.name));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wb-shots-"));
const vault = path.join(tmp, "demo");
execFileSync(process.execPath, [path.join(HERE, "demo-vault.js"), vault], { stdio: "inherit" });
fs.mkdirSync(path.join(tmp, "conf"), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const PORT = 9400 + Math.floor(Math.random() * 400);
const electron = fs.readdirSync("/usr/bin").filter((f) => /^electron\d*$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const app = spawn(`/usr/bin/${electron}`, ["--ozone-platform-hint=auto", ROOT, `--remote-debugging-port=${PORT}`, "--vault", vault], {
    env: { ...process.env, WB_HIDDEN: "1", XDG_CONFIG_HOME: path.join(tmp, "conf") }, stdio: "ignore",
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 60 && !page; i++) {
    await wait(500);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === "page" && p.url.startsWith("http://127.0.0.1")); } catch { /* not yet */ }
}
if (!page) { app.kill(); throw new Error("The app did not start"); }
const log = process.env.SHOTS_DEBUG ? (...a) => console.log("[shots]", ...a) : () => {};
log("page", page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
await new Promise((r) => (ws.onopen = r));
log("connected");
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expr) => { const r = await call("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "script failed"); return r.result?.result?.value; };
// helpers available to each shot's "do" script
const HELPERS = `const w = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const btn = (t, root = document) => [...root.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith(t));
const type = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };`;

for (const s of shots) for (const theme of s.themes ?? ["light", "dark"]) {
    const [width, height] = s.size ?? [1440, 900];
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: s.scale ?? 1, mobile: false });
    log("shot", s.name, theme);
    // every shot starts from a fresh page in its theme, so nothing (an open drawer, the writer) carries over
    await run(`localStorage.setItem("theme", JSON.stringify("${theme}")); location.hash = "#/";`);
    await call("Page.reload", { ignoreCache: true });
    await wait(2000);
    await run(`${HELPERS} location.hash = ${JSON.stringify(s.hash ?? "#/")}; await w(${s.wait ?? 1400}); ${s.do ?? ""}; await w(${s.after ?? 500});`);
    const clip = s.clip ? await run(`const r = document.querySelector(${JSON.stringify(s.clip)})?.getBoundingClientRect(); return r && { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16, scale: 1 };`) : null;
    const shot = await call("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
    const file = `${s.name}${theme === "dark" ? ".dark" : ""}.png`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.result.data, "base64"));
    console.log(`  ${file}`);
    await run(`${HELPERS} ${s.undo ?? ""}; document.querySelector(".drawer-backdrop.on")?.click(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));`).catch(() => {});
}
ws.close();
await new Promise((r) => { app.once("exit", r); app.kill(); setTimeout(r, 5000); });
if (!args.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
console.log(`${shots.length} shots in docs/img, light and dark`);
