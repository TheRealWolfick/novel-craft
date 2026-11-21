// Run a built package's own files and check nothing the app needs was left out of it: every module the browser loads
// (the app's and the /vendor ones: the import map, xterm) is served, the docs have their pages and images.
// Usage: node scripts/check-package.mjs <Arch package .pkg.tar.* | the app folder of an unpacked build>
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pkg = path.resolve(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pkg-"));
const unpacked = fs.statSync(pkg).isDirectory();
if (!unpacked) execFileSync("tar", ["-xf", pkg, "-C", dir]);
const app = unpacked ? pkg : path.join(dir, "usr/lib/world-builder");
const port = 4500 + Math.floor(Math.random() * 400);
const conf = path.join(dir, "conf");
fs.mkdirSync(conf);
const server = spawn(process.execPath, [path.join(app, "server.js"), "--port", String(port)], { env: { ...process.env, XDG_CONFIG_HOME: conf, BOOKS_VAULT: "" }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
try {
    for (let i = 0; i < 40; i++) { await wait(250); try { await fetch(`${base}/api/settings`); break; } catch { /* starting */ } }
    // every module the front end imports, and the page itself
    const mods = new Set(["", "app.js", "style.css"]);
    for (const f of fs.readdirSync(path.join(app, "public"))) if (f.endsWith(".js")) for (const m of fs.readFileSync(path.join(app, "public", f), "utf8").matchAll(/from "\.\/([\w-]+\.js)"/g)) mods.add(m[1]);
    // the import map's /vendor modules (served from node_modules)
    for (const f of fs.readdirSync(path.join(app, "public")).filter((f) => /\.(html|js)$/.test(f))) for (const m of fs.readFileSync(path.join(app, "public", f), "utf8").matchAll(/"(\/vendor\/[^"]+)"/g)) mods.add(m[1].slice(1));
    for (const m of mods) { const r = await fetch(`${base}/${m}`); if (r.status !== 200) problems.push(`/${m} answers ${r.status}`); }
    const docs = await (await fetch(`${base}/api/docs`)).json();
    if (!docs.pages?.length) problems.push("the docs have no pages");
    for (const p of docs.pages ?? []) {
        const page = await (await fetch(`${base}/api/docs/page?id=${p.id}`)).json();
        for (const img of page.html?.matchAll(/src="(\/docs\/img\/[^"]+)"/g) ?? []) { const r = await fetch(base + img[1]); if (r.status !== 200) problems.push(`${p.id}: ${img[1]} answers ${r.status}`); }
    }
    console.log(problems.length ? `Package check FAILED:\n  ${problems.join("\n  ")}` : `Package check ok: ${mods.size} files served, ${docs.pages.length} docs pages`);
} finally {
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(problems.length ? 1 : 0);
