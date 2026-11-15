// Import a dataset (notes, templates, attachments laid out at their vault paths) from a GitHub repository URL or a
// folder on this computer. `check` downloads it and compares every file with the vault: new, identical (skipped
// without asking) or conflicting (the user picks overwrite or skip); `apply` writes the new files and the chosen
// overwrites, then makes the folder of every collection in the schema.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { DS, splitNote, parseFm } from "./vault.js";

const MANIFEST = "world-builder.json";
const MAX_DOWNLOAD = 150 * 1024 * 1024;
const SESSION_TTL = 60 * 60 * 1000;
const TEXT = /\.(md|json|txt|canvas|base|css|js|csv|svg|ya?ml)$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });

/** "https://github.com/o/r", ".../tree/<ref>/<dir>", "github.com/o/r.git", "git@github.com:o/r.git", "o/r", or a local folder */
export function parseSource(input) {
    const s = String(input ?? "").trim();
    if (!s) throw fail(400, "Paste a GitHub repository URL");
    if (/^(\/|~\/|\.{1,2}\/|file:)/.test(s)) return { kind: "dir", path: path.resolve(s.replace(/^file:\/\//, "").replace(/^~(?=\/)/, process.env.HOME ?? "")) };
    const m = /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+?))?)?\/?$/i.exec(s)
        ?? /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(s)
        ?? /^([\w.-]+)\/([\w.-]+)$/.exec(s);
    if (!m) throw fail(400, "Not a GitHub repository URL (https://github.com/<owner>/<repo>)");
    return { kind: "github", owner: m[1], repo: m[2], ref: m[3] ?? null, subdir: m[4] ? decodeURIComponent(m[4]) : "" };
}
const sourceLabel = (src) => (src.kind === "dir" ? src.path : `github.com/${src.owner}/${src.repo}${src.ref ? ` (${src.ref})` : ""}${src.subdir ? ` / ${src.subdir}` : ""}`);

/** A tar archive -> [{name, data}] (ustar, GNU long names, pax paths) */
export function untar(buf) {
    const out = [];
    let i = 0, longName = null, pax = null;
    const field = (h, a, b) => h.subarray(a, b).toString("utf8").replace(/\0[\s\S]*$/, "");
    while (i + 512 <= buf.length) {
        const h = buf.subarray(i, i + 512);
        if (h.every((b) => b === 0)) break;
        let name = field(h, 0, 100);
        const size = parseInt(field(h, 124, 136).trim() || "0", 8);
        const type = h[156] ? String.fromCharCode(h[156]) : "0";
        const prefix = field(h, 257, 263).startsWith("ustar") ? field(h, 345, 500) : "";
        if (prefix) name = `${prefix}/${name}`;
        const data = buf.subarray(i + 512, i + 512 + size);
        i += 512 + Math.ceil(size / 512) * 512;
        if (type === "L") { longName = data.toString("utf8").replace(/\0[\s\S]*$/, ""); continue; }
        if (type === "x") { pax = {}; for (const rec of data.toString("utf8").split("\n")) { const m = /^\d+ ([^=]+)=([\s\S]*)$/.exec(rec); if (m) pax[m[1]] = m[2]; } continue; }
        if (type === "g") continue;
        if (pax?.path) name = pax.path;
        if (longName) name = longName;
        pax = null; longName = null;
        if (type === "0" || type === "7") out.push({ name, data: Buffer.from(data) });
    }
    return out;
}

// notes count as the same when only these differ: when they were made, and empty values written differently
const DATE_KEYS = new Set(["created-date", "created date", "created", "modified", "modified-date"]);
const emptyValue = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
function noteKey(buf) {
    const { fmText, body } = splitNote(buf.toString("utf8").replace(/\r\n/g, "\n"));
    const { fm, error } = parseFm(fmText);
    if (error) return null;
    const keep = Object.keys(fm).filter((k) => !DATE_KEYS.has(k) && !emptyValue(fm[k])).sort();
    return JSON.stringify([keep.map((k) => [k, fm[k]]), body.replace(/\s+$/, "")]);
}
/** Byte for byte the same, or a note with the same fields and text (ignoring created dates and empty fields) */
function sameContent(a, b, p) {
    if (a.equals(b)) return "exact";
    if (!p.endsWith(".md")) return null;
    const x = noteKey(a);
    return x != null && x === noteKey(b) ? "equivalent" : null;
}

/** Only plain relative paths that stay inside the vault and avoid Obsidian's and git's own folders */
function safePath(p) {
    const n = path.posix.normalize(String(p).replace(/\\/g, "/")).replace(/^\.\//, "");
    if (!n || n.startsWith("/") || n.split("/").some((seg) => seg === ".." || seg.startsWith("."))) return null;
    return n;
}

export class Importer {
    constructor(vault, store) {
        this.vault = vault;
        this.store = store;
        this.sessions = new Map();
    }

    /** Every file of the source as {path relative to the repository: Buffer} */
    async download(src) {
        if (src.kind === "dir") {
            const files = new Map();
            const walk = async (dir) => {
                for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
                    if (e.name.startsWith(".") || e.name === "node_modules") continue;
                    const abs = path.join(dir, e.name);
                    if (e.isDirectory()) await walk(abs);
                    else if (e.isFile()) files.set(path.relative(src.path, abs).split(path.sep).join("/"), await fsp.readFile(abs));
                }
            };
            if (!fs.existsSync(src.path) || !fs.statSync(src.path).isDirectory()) throw fail(400, `Not a folder: ${src.path}`);
            await walk(src.path);
            return files;
        }
        // GitHub: the repository as a tarball (default branch unless a ref was given), no account needed for public repositories
        const url = `https://api.github.com/repos/${src.owner}/${src.repo}/tarball${src.ref ? `/${encodeURIComponent(src.ref)}` : ""}`;
        let r;
        try { r = await fetch(url, { headers: { "user-agent": "world-builder-importer", accept: "application/vnd.github+json" }, redirect: "follow" }); }
        catch (e) { throw fail(502, `Could not reach GitHub: ${e.cause?.code ?? e.message}`); }
        if (r.status === 404) throw fail(404, `GitHub has no public repository ${src.owner}/${src.repo}${src.ref ? ` with a branch or tag ${src.ref}` : ""}`);
        if (r.status === 403 || r.status === 429) throw fail(429, "GitHub refused the download (rate limit). Try again in a while.");
        if (!r.ok) throw fail(502, `GitHub answered ${r.status} ${r.statusText}`);
        const len = Number(r.headers.get("content-length") ?? 0);
        if (len > MAX_DOWNLOAD) throw fail(413, "That repository is too large to import (over 150 MB)");
        const gz = Buffer.from(await r.arrayBuffer());
        if (gz.length > MAX_DOWNLOAD) throw fail(413, "That repository is too large to import (over 150 MB)");
        const files = new Map();
        for (const f of untar(zlib.gunzipSync(gz))) files.set(f.name.split("/").slice(1).join("/"), f.data); // drop "<owner>-<repo>-<sha>/"
        return files;
    }

    /** The files to import, at their vault paths, after the manifest's root (or `vault/`) and the URL's sub folder */
    datasetFiles(all, src) {
        let base = src.subdir ? `${src.subdir.replace(/\/+$/, "")}/` : "";
        const at = (p) => all.get(`${base}${p}`);
        let manifest = {};
        if (at(MANIFEST)) { try { manifest = JSON.parse(at(MANIFEST).toString("utf8")); } catch { throw fail(400, `${MANIFEST} is not valid JSON`); } }
        const hasVault = [...all.keys()].some((k) => k.startsWith(`${base}vault/`));
        const root = manifest.root != null ? String(manifest.root).replace(/^\.?\/*|\/+$/g, "") : hasVault ? "vault" : "";
        if (root) base += `${root}/`;
        const files = new Map();
        for (const [k, data] of all) {
            if (!k.startsWith(base)) continue;
            const rel = k.slice(base.length);
            // without a root folder the repository's own files are not part of the data
            if (!root && !rel.includes("/") && (/^(readme|license|licence|changelog|contributing)(\.|$)/i.test(rel) || rel === MANIFEST)) continue;
            const p = safePath(rel);
            if (p) files.set(p, data);
        }
        return { files, manifest };
    }

    async check(input) {
        const src = parseSource(input);
        const { files, manifest } = this.datasetFiles(await this.download(src), src);
        if (!files.size) throw fail(400, "Nothing to import: the repository has no files at vault paths");
        const list = [];
        for (const [p, data] of files) {
            const abs = this.vault.abs(p);
            let current = null;
            try { current = await fsp.readFile(abs); } catch { /* new file */ }
            const same = current ? sameContent(current, data, p) : null;
            const status = !current ? "new" : same ? "same" : "conflict";
            // a new note whose name another note already has (Obsidian resolves [[links]] by name, vault wide)
            const name = p.endsWith(".md") ? path.posix.basename(p, ".md") : null;
            const clash = status === "new" && name && this.vault.nameTaken(name) ? (this.vault.byName.get(name.toLowerCase()) ?? [])[0] ?? true : null;
            list.push({ path: p, status, equivalent: same === "equivalent", size: data.length, currentSize: current?.length ?? null, clash, text: TEXT.test(p) });
        }
        list.sort((a, b) => a.path.localeCompare(b.path));
        const id = crypto.randomBytes(8).toString("hex");
        this.prune();
        this.sessions.set(id, { id, at: Date.now(), source: sourceLabel(src), files, list });
        const counts = { new: 0, same: 0, conflict: 0, clash: 0 };
        for (const f of list) { counts[f.status]++; if (f.clash) counts.clash++; }
        return { id, source: sourceLabel(src), name: manifest.name ?? null, description: manifest.description ?? null, counts, files: list };
    }

    prune() { for (const [k, s] of this.sessions) if (Date.now() - s.at > SESSION_TTL) this.sessions.delete(k); }
    session(id) { const s = this.sessions.get(id); if (!s) throw fail(404, "This import has expired: check the URL again"); return s; }

    /** Current and incoming text of a conflicting file (first lines), for the side-by-side preview */
    async preview(id, p) {
        const s = this.session(id);
        const data = s.files.get(p);
        if (!data) throw fail(404, "Not in this import");
        if (!TEXT.test(p)) return { binary: true };
        const cut = (t) => t.split("\n").slice(0, 400).join("\n");
        let current = "";
        try { current = await fsp.readFile(this.vault.abs(p), "utf8"); } catch { /* none */ }
        return { current: cut(current), incoming: cut(data.toString("utf8")) };
    }

    /** Write new files and the conflicts chosen in `overwrite`; identical files were never going to be written */
    async apply(id, { overwrite = [], skipClashes = true } = {}) {
        const s = this.session(id);
        const over = new Set(overwrite);
        const written = { added: 0, overwritten: 0, skipped: 0, folders: 0 };
        for (const f of s.list) {
            if (f.status === "same") continue;
            if ((f.status === "conflict" && !over.has(f.path)) || (f.status === "new" && f.clash && skipClashes)) { written.skipped++; continue; }
            const abs = this.vault.abs(f.path);
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
            await fsp.writeFile(tmp, s.files.get(f.path));
            await fsp.rename(tmp, abs);
            await this.vault.loadFile(f.path);
            written[f.status === "new" ? "added" : "overwritten"]++;
        }
        this.vault.rebuildNames();
        // every collection in the schema gets its folder (git keeps no empty folders)
        let collections = {};
        try { collections = this.store.schema().collections ?? {}; } catch { /* no schema */ }
        for (const c of [...Object.keys(collections).map((x) => `${DS}/${x}`), `${DS}/_Attachments`]) {
            const abs = this.vault.abs(c);
            if (Object.keys(collections).length && !fs.existsSync(abs)) { await fsp.mkdir(abs, { recursive: true }); written.folders++; }
        }
        this.sessions.delete(id);
        return { ...written, source: s.source };
    }
}
