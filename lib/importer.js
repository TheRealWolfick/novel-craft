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
import { uniqueName } from "./write.js";
import { readZip } from "./zip.js";
import { hashOf, textureHash, stampObjects } from "./assets.js";
import { parseMapSvg, renderMapSvg, allObjects } from "../public/map-core.js";

const MANIFEST = "world-builder.json";
const MAX_DOWNLOAD = 150 * 1024 * 1024;
const SESSION_TTL = 60 * 60 * 1000;
const TEXT = /\.(md|json|txt|canvas|base|css|js|csv|svg|ya?ml)$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
export const RECORD_NOTE = "90. Templater/Imports.md";
const sha = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
/** One key per dataset, so a later import of the same one finds what the earlier one did */
const sourceKey = (src) => (src.kind === "upload" ? `upload:${src.name}` : src.kind === "dir" ? `dir:${src.path}` : `github:${src.owner}/${src.repo}`.toLowerCase() + (src.ref ? `@${src.ref}` : "") + (src.subdir ? `/${src.subdir}` : ""));

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
const sourceLabel = (src) => (src.kind === "upload" ? src.name : src.kind === "dir" ? src.path : `github.com/${src.owner}/${src.repo}${src.ref ? ` (${src.ref})` : ""}${src.subdir ? ` / ${src.subdir}` : ""}`);

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
    constructor(vault, store, worlds = null, assets = null) {
        this.worlds = worlds;
        this.assets = assets;
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

    // ------------------------------------------------------------ the import record

    /** {sources: {<key>: {source, name, at, files: {<dataset path>: {path, hash}}, choices: {<dataset path>: "mine"|"renamed"}}}} */
    readRecord() {
        const n = this.vault.notes.get(RECORD_NOTE);
        const m = n?.body.match(/```json\n([\s\S]*?)```/);
        try { return m ? JSON.parse(m[1]) : { sources: {} }; } catch { return { sources: {} }; }
    }
    async writeRecord(rec) {
        const text = `---\ntype: config\n---\nWhat Novel Craft imported from each dataset (Tools → Import data): the vault path and content hash of every file\nas imported, and the choices made for name clashes. Importing the same dataset again uses it to tell updates from your\nown edits. Edited by the app; leave it be.\n\n\`\`\`json\n${JSON.stringify(rec, null, 1)}\n\`\`\`\n`;
        const abs = this.vault.abs(RECORD_NOTE);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(`${abs}.tmp`, text);
        await fsp.rename(`${abs}.tmp`, abs);
        await this.vault.loadFile(RECORD_NOTE);
    }
    /** A renamed note in the vault: the record follows it */
    async renamed(from, to) {
        const rec = this.readRecord();
        let hit = false;
        for (const src of Object.values(rec.sources ?? {})) for (const f of Object.values(src.files ?? {})) if (f.path === from) { f.path = to; hit = true; }
        if (hit) await this.writeRecord(rec);
    }

    // ------------------------------------------------------------ check and apply

    /** Every [[link]] target in a text */
    static links(text) { return [...String(text).matchAll(/!?\[\[([^\]|#\n]+)[^\]\n]*\]\]/g)].map((m) => m[1].trim()); }

    /** Rewrite [[old]] links to renamed notes; a link without an alias keeps showing the old name */
    static relink(text, renames) {
        if (!renames.size) return text;
        return text.replace(/(!?)\[\[([^\]|#\n]+)((?:#[^\]|\n]*)?)(\|[^\]\n]*)?\]\]/g, (whole, bang, target, head, alias) => {
            const to = renames.get(target.trim().toLowerCase());
            if (!to) return whole;
            return `${bang}[[${to}${head ?? ""}${alias ?? (bang ? "" : `|${target.trim()}`)}]]`;
        });
    }

    async check(input) {
        const src = parseSource(input);
        return this.analyze(await this.download(src), src);
    }

    /** A dataset uploaded as a .zip or .tar.gz (a world export, or a repository downloaded as an archive) */
    async checkUpload(buf, filename) {
        let entries;
        if (buf[0] === 0x50 && buf[1] === 0x4b) entries = readZip(buf);
        else if (buf[0] === 0x1f && buf[1] === 0x8b) entries = untar(zlib.gunzipSync(buf));
        else throw fail(400, "Upload a .zip or .tar.gz file");
        // an archive of one folder (GitHub's "Download ZIP"): its files sit one level down
        const tops = new Set(entries.map((e) => e.name.split("/")[0]));
        const strip = tops.size === 1 && entries.every((e) => e.name.includes("/")) && !entries.some((e) => e.name === MANIFEST);
        const all = new Map(entries.map((e) => [strip ? e.name.split("/").slice(1).join("/") : e.name, e.data]));
        return this.analyze(all, { kind: "upload", name: String(filename || "upload").replace(/^.*[\\/]/, ""), subdir: "" });
    }

    async analyze(all, src) {
        const { files: raw, manifest } = this.datasetFiles(all, src);
        // one record per dataset however it arrives (git, folder, zip) when it names itself
        const key = manifest.id ? `dataset:${manifest.id}` : sourceKey(src);
        if (!raw.size) throw fail(400, "Nothing to import: the repository has no files at vault paths");
        const prev = this.readRecord().sources?.[key] ?? { files: {}, choices: {} };
        const datasetNames = new Set([...raw.keys()].filter((p) => p.endsWith(".md")).map((p) => path.posix.basename(p, ".md").toLowerCase()));
        // names renamed by earlier imports: links in the incoming files follow them
        const renames = new Map();
        for (const [p, f] of Object.entries(prev.files ?? {})) if (prev.choices?.[p] === "renamed" && p.endsWith(".md")) renames.set(path.posix.basename(p, ".md").toLowerCase(), path.posix.basename(f.path, ".md"));
        const files = new Map();
        for (const [p, data] of raw) files.set(p, TEXT.test(p) ? Buffer.from(Importer.relink(data.toString("utf8"), renames)) : data);
        // maps: stamps you already have are used from your library (no copies), stamp files that duplicate yours are left out
        const assetPlan = this.assets ? await this.planAssets(files, manifest) : null;
        if (assetPlan) for (const [p, text] of assetPlan.mapsReady) files.set(p, Buffer.from(text));
        const list = [];
        for (const [p, data] of files) {
            const was = prev.files?.[p];
            const target = was?.path ?? p;
            let current = null;
            try { current = await fsp.readFile(this.vault.abs(target)); } catch { /* not there */ }
            const same = current ? sameContent(current, data, p) : null;
            let status;
            if (assetPlan?.deduped.has(p)) status = "library";               // a stamp you already have elsewhere
            else if (same) status = "same";
            else if (!current) status = was ? "removed" : "new";
            else if (was && sha(current) === was.hash) status = "update";      // untouched here since the last import, changed in the dataset
            else if (was && sha(data) === was.hash) status = "local";          // changed here, unchanged in the dataset: keep yours
            else status = "conflict";
            const entry = { path: p, target, status, equivalent: same === "equivalent", size: data.length, currentSize: current?.length ?? null, text: TEXT.test(p) };
            // a new note whose name another note already has (Obsidian resolves [[links]] by name, vault wide)
            if (status === "new" && p.endsWith(".md")) {
                const name = path.posix.basename(p, ".md");
                if (prev.choices?.[p] === "mine") { entry.status = "kept"; entry.clash = (this.vault.byName.get(name.toLowerCase()) ?? [])[0] ?? null; }
                else if (this.vault.nameTaken(name)) {
                    entry.clash = (this.vault.byName.get(name.toLowerCase()) ?? [])[0] ?? true;
                    entry.renameTo = uniqueName(this.vault, name, path.posix.basename(path.posix.dirname(p)) || "Imported", datasetNames);
                }
            }
            list.push(entry);
        }
        // links in the incoming notes that point nowhere (neither the dataset nor the vault)
        const unresolved = new Map();
        for (const [p, data] of files) {
            if (!p.endsWith(".md")) continue;
            for (const t of Importer.links(data.toString("utf8"))) {
                const name = t.split("/").pop().replace(/\.md$/, "").toLowerCase();
                if (datasetNames.has(name) || this.vault.resolve(t) || [...raw.keys()].some((k) => path.posix.basename(k).toLowerCase() === t.toLowerCase())) continue;
                if (!unresolved.has(t)) unresolved.set(t, new Set());
                unresolved.get(t).add(p);
            }
        }
        list.sort((a, b) => a.path.localeCompare(b.path));
        const id = crypto.randomBytes(8).toString("hex");
        this.prune();
        this.sessions.set(id, { id, at: Date.now(), key, source: sourceLabel(src), name: manifest.name ?? null, files, list, prev, renames });
        if (assetPlan) Object.assign(this.sessions.get(id), { assetPlan });
        const counts = { new: 0, same: 0, update: 0, local: 0, conflict: 0, removed: 0, kept: 0, clash: 0, library: 0 };
        for (const f of list) { counts[f.status]++; if (f.clash && f.status === "new") counts.clash++; }
        return {
            id, source: sourceLabel(src), name: manifest.name ?? null, description: manifest.description ?? null, imported: prev.at ?? null, counts, files: list,
            unresolved: [...unresolved].map(([target, from]) => ({ target, from: [...from] })).sort((a, b) => a.target.localeCompare(b.target)),
            kind: manifest.kind ?? null,
            assets: assetPlan && {
                maps: assetPlan.maps.length, reused: assetPlan.reused, deduped: [...assetPlan.deduped],
                missingBuiltin: assetPlan.missingBuiltin, embedded: assetPlan.embedded.map(({ data, ...e }) => e), textures: assetPlan.textures,
            },
        };
    }

    // ------------------------------------------------------------ map assets (stamps and textures)

    /** Stamp images embedded in a map's SVG, by the src they stand for: {src -> data URI} */
    static embedded(text, doc) {
        const out = new Map();
        for (const info of Object.values(doc?.assets?.stamps ?? {})) {
            const m = info.symbol && String(text).match(new RegExp(`<symbol id="${info.symbol}"[^>]*><image href="(data:[^"]+)"`));
            if (m) out.set(info.src, m[1]);
        }
        return out;
    }

    /**
     * A map with stamp srcs replaced (`src`), texture ids renamed (`rename`) or their definitions replaced (`replace`),
     * drawn again; images the vault can't provide come from the map's own embedded copies. Unchanged: the same text.
     */
    async transformMap(text, { src = new Map(), rename = new Map(), replace = {} } = {}) {
        const doc = parseMapSvg(text);
        if (!doc) return text;
        const embedded = Importer.embedded(text, doc);
        let changed = false;
        for (const o of stampObjects(doc)) if (src.has(o.src)) { if (embedded.has(o.src)) embedded.set(src.get(o.src), embedded.get(o.src)); o.src = src.get(o.src); changed = true; }
        if (rename.size) {
            const walk = (v) => (typeof v === "string" ? (rename.get(v) ?? v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
            const t = doc.textures ?? {};
            Object.assign(doc, walk({ ...doc, textures: undefined }));
            doc.textures = Object.fromEntries(Object.entries(t).map(([k, def]) => [rename.get(k) ?? k, def]));
            changed = true;
        }
        for (const [id, def] of Object.entries(replace)) if (doc.textures?.[id]) { doc.textures[id] = def; changed = true; }
        if (!changed) return text;
        const { doc: ready, fallbacks } = this.worlds.prepareDoc(doc);
        for (const [k, v] of embedded) if (!fallbacks.has(k)) fallbacks.set(k, v);
        return renderMapSvg(ready, await this.worlds.svgContext(ready.layers.flatMap((l) => allObjects(l.objects)), fallbacks));
    }

    /** What the dataset's maps need from the library, and the maps with the stamps you already have used in place */
    async planAssets(files, manifest) {
        const maps = [...files.keys()].filter((p) => p.endsWith(".svg") && files.get(p).includes('id="books-meta-map"'));
        const srcMap = new Map(), deduped = new Set(), missingBuiltin = new Map(), embedded = new Map(), textures = new Map();
        let reused = 0;
        const lib = this.worlds.textures().textures;
        for (const m of maps) {
            const text = files.get(m).toString("utf8");
            const doc = parseMapSvg(text);
            if (!doc) continue;
            const pics = Importer.embedded(text, doc);
            for (const o of stampObjects(doc)) {
                if (!o.src || o.src.startsWith("data:")) continue;
                const rel = o.src.startsWith("/files/") ? decodeURIComponent(o.src.slice(7)) : null;
                const hash = o.hash ?? (rel && files.has(rel) ? hashOf(files.get(rel)) : this.assets.builtins().bySrc.get(o.src)?.hash);
                if (!hash) continue;
                const mine = this.assets.findStamp(hash);
                const info = doc.assets?.stamps?.[hash] ?? {};
                if (mine) {
                    if (mine.src !== o.src && !srcMap.has(o.src)) { srcMap.set(o.src, mine.src); reused++; }
                    if (rel && files.has(rel) && mine.file !== rel) deduped.add(rel);
                } else if (rel && files.has(rel)) { /* comes with the dataset */ }
                else if (o.src.startsWith("/stamps/")) missingBuiltin.set(hash, { hash, name: info.name ?? path.posix.basename(o.src), src: o.src });
                else if (pics.has(o.src)) {
                    const e = embedded.get(hash) ?? { hash, name: info.name ?? path.posix.basename(o.src).replace(/\.[^.]+$/, ""), src: o.src, data: pics.get(o.src), maps: [] };
                    if (!e.maps.includes(m)) e.maps.push(m);
                    embedded.set(hash, e);
                }
            }
            for (const [id, def] of Object.entries(doc.textures ?? {})) {
                const h = textureHash(def);
                const t = textures.get(id) ?? { id, hash: h, def, maps: [], status: !lib[id] ? "new" : textureHash(lib[id]) === h ? "same" : "conflict", name: def.name ?? id };
                if (t.status === "conflict") { let n = 2; while (lib[`${id}-${n}`]) n++; t.newId = `${id}-${n}`; }
                t.maps.push(m);
                textures.set(id, t);
            }
        }
        for (const [id, t] of Object.entries(manifest.assets?.textures ?? {})) if (!textures.has(id) && t?.def) textures.set(id, { id, hash: textureHash(t.def), def: t.def, maps: [], status: !lib[id] ? "new" : textureHash(lib[id]) === textureHash(t.def) ? "same" : "conflict", name: t.def.name ?? id });
        // stamp files (a pack, or a world's own stamps) whose image you already have under another name
        for (const [p, data] of files) {
            if (!p.startsWith(`${DS}/_Attachments/Map Stamps/`) || deduped.has(p)) continue;
            const mine = this.assets.findStamp(hashOf(data));
            if (mine && mine.file !== p) deduped.add(p);
        }
        const mapsReady = new Map();
        for (const m of maps) if (srcMap.size) mapsReady.set(m, await this.transformMap(files.get(m).toString("utf8"), { src: srcMap }));
        return { maps, srcMap, deduped, reused, missingBuiltin: [...missingBuiltin.values()], embedded: [...embedded.values()], textures: [...textures.values()], mapsReady };
    }

    prune() { for (const [k, s] of this.sessions) if (Date.now() - s.at > SESSION_TTL) this.sessions.delete(k); }
    session(id) { const s = this.sessions.get(id); if (!s) throw fail(404, "This import has expired: check the URL again"); return s; }

    /** Current and incoming text of a file (first lines), for the side-by-side preview */
    async preview(id, p) {
        const s = this.session(id);
        const data = s.files.get(p);
        const f = s.list.find((x) => x.path === p);
        if (!data || !f) throw fail(404, "Not in this import");
        if (!TEXT.test(p)) return { binary: true };
        const cut = (t) => t.split("\n").slice(0, 400).join("\n");
        let current = "";
        try { current = await fsp.readFile(this.vault.abs(f.target), "utf8"); } catch { /* none */ }
        return { current: cut(current), incoming: cut(data.toString("utf8")) };
    }

    /**
     * Write the import. `overwrite`: conflicts (and removed files) to write; `skip`: updates and new files not to write;
     * `clashes`: {path: "mine" | "rename"} for new notes whose name is taken (default "mine": links go to your note).
     */
    async apply(id, { overwrite = [], skip = [], clashes = {}, extractStamps = true, textures: textureChoice = {} } = {}) {
        const s = this.session(id);
        const over = new Set(overwrite), skipped = new Set(skip);
        const written = { added: 0, overwritten: 0, renamed: 0, skipped: 0, folders: 0 };
        const rec = this.readRecord();
        rec.sources ??= {};
        const mine = { source: s.source, name: s.name, at: new Date().toISOString(), files: { ...(s.prev.files ?? {}) }, choices: { ...(s.prev.choices ?? {}) } };
        // notes imported under a new name: links in everything written now follow them
        const renames = new Map(s.renames);
        for (const f of s.list) if (f.status === "new" && f.clash && clashes[f.path] === "rename") renames.set(path.posix.basename(f.path, ".md").toLowerCase(), f.renameTo);
        const put = async (rel, data) => {
            const abs = this.vault.abs(rel);
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
            await fsp.writeFile(tmp, data);
            await fsp.rename(tmp, abs);
            await this.vault.loadFile(rel);
        };
        // map assets first: stamps that exist only inside the maps go to your library, textures as chosen
        const mapEdits = { src: new Map(), rename: new Map(), replace: {} };
        const plan = s.assetPlan;
        if (plan) {
            for (const e of extractStamps ? plan.embedded : []) {
                const m = /^data:image\/([\w+.-]+);base64,(.*)$/.exec(e.data);
                if (!m) continue;
                const ext = { "svg+xml": "svg", jpeg: "jpg" }[m[1]] ?? m[1];
                const folder = `${DS}/_Attachments/Map Stamps/Imported`;
                let name = `${String(e.name).replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "stamp"}.${ext}`;
                for (let i = 2; this.vault.files.has(`${folder}/${name}`); i++) name = `${name.replace(/( \d+)?\.[^.]+$/, "")} ${i}.${ext}`;
                await put(`${folder}/${name}`, Buffer.from(m[2], "base64"));
                mapEdits.src.set(e.src, `/files/${`${folder}/${name}`.split("/").map(encodeURIComponent).join("/")}`);
                written.stamps = (written.stamps ?? 0) + 1;
            }
            const lib = { ...this.worlds.textures().textures };
            let libChanged = false;
            for (const t of plan.textures) {
                const choice = textureChoice[t.id] ?? (t.status === "conflict" ? "rename" : "add");
                if (t.status === "new" && choice !== "skip") { lib[t.id] = t.def; libChanged = true; }
                if (t.status !== "conflict") continue;
                if (choice === "overwrite") { lib[t.id] = t.def; libChanged = true; }
                else if (choice === "mine") mapEdits.replace[t.id] = lib[t.id];
                else { lib[t.newId] = { ...t.def, name: `${t.def.name ?? t.id} (imported)` }; mapEdits.rename.set(t.id, t.newId); libChanged = true; }
            }
            if (libChanged) { await this.worlds.saveTextures(lib); written.textures = Object.keys(lib).length; }
        }
        const needsMapEdit = mapEdits.src.size || mapEdits.rename.size || Object.keys(mapEdits.replace).length;
        // stamp files and notes before maps, so maps drawn again can read the stamps
        const order = [...s.list].sort((a, b) => (a.path.endsWith(".svg") && plan?.maps.includes(a.path) ? 1 : 0) - (b.path.endsWith(".svg") && plan?.maps.includes(b.path) ? 1 : 0));
        for (const f of order) {
            let data = s.files.get(f.path);
            if (needsMapEdit && plan?.maps.includes(f.path)) data = Buffer.from(await this.transformMap(data.toString("utf8"), mapEdits));
            if (f.text && renames.size > s.renames.size) data = Buffer.from(Importer.relink(data.toString("utf8"), renames));
            let target = f.target;
            let write = false;
            if (f.status === "same") { mine.files[f.path] = { path: target, hash: sha(data) }; continue; }
            if (f.status === "kept" || f.status === "local" || f.status === "library") { written.skipped++; continue; }
            if (f.status === "new" && f.clash) {
                if (clashes[f.path] === "rename") { target = `${path.posix.dirname(f.path)}/${f.renameTo}.md`; mine.choices[f.path] = "renamed"; write = true; written.renamed++; }
                else { mine.choices[f.path] = "mine"; written.skipped++; continue; }
            } else if (f.status === "new" || f.status === "update") write = !skipped.has(f.path);
            else if (f.status === "conflict" || f.status === "removed") write = over.has(f.path);
            if (!write) { written.skipped++; continue; }
            await put(target, data);
            mine.files[f.path] = { path: target, hash: sha(data) };
            if (!(f.status === "new" && f.clash)) written[f.status === "new" ? "added" : "overwritten"]++;
        }
        this.vault.rebuildNames();
        rec.sources[s.key] = mine;
        await this.writeRecord(rec);
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
