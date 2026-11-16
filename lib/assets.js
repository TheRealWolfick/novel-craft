// Map assets by content: every stamp image and every derived texture has a hash, so a map can name what it uses
// independently of where the file lives. Built-in stamps (public/stamps) and textures (map-core.js) are the base set
// shipped with the app; your own stamps live in the vault (_Attachments/Map Stamps), derived textures in Map Textures.md.
//
// A saved map carries `hash` on each stamp object and `doc.assets = {stamps: {<hash>: {src, name, symbol}},
// textures: {<id>: <hash>}}`; `symbol` is the id of the stamp's image embedded in the SVG, so a stamp the vault lacks
// can still be drawn (and taken into the library) from the map itself.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { allObjects } from "../public/map-core.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
export const hashOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v ?? null));
/** A derived texture's hash: its definition without its display name */
export const textureHash = (def) => { const { name, ...rest } = def ?? {}; return hashOf(canonical(rest)); };
/** Every stamp object of a map document, layer by layer (the order the SVG's symbols are made in) */
export const stampObjects = (doc) => (doc?.layers ?? []).flatMap((l) => allObjects(l.objects ?? [])).filter((o) => o.type === "stamp");

export class Assets {
    constructor(vault, worlds) {
        this.vault = vault;
        this.worlds = worlds;
        this.builtin = null;          // {byHash: Map, bySrc: Map}
        this.fileHashes = new Map();  // vault path -> {mtime, hash}
    }

    /** The built-in stamps, hashed once per run */
    builtins() {
        if (this.builtin) return this.builtin;
        const byHash = new Map(), bySrc = new Map();
        let manifest = { stamps: [] };
        try { manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, "stamps", "manifest.json"), "utf8")); } catch { /* none */ }
        for (const s of manifest.stamps ?? []) {
            let buf;
            try { buf = fs.readFileSync(path.join(PUBLIC, "stamps", s.file)); } catch { continue; }
            const h = hashOf(buf), src = `/stamps/${s.file}`;
            const entry = { hash: h, src, name: s.name, set: s.group, builtin: true };
            if (!byHash.has(h)) byHash.set(h, entry);
            bySrc.set(src, entry);
        }
        return (this.builtin = { byHash, bySrc });
    }

    /** Hash of a vault file (cached by modification time) */
    fileHash(rel) {
        let st;
        try { st = fs.statSync(this.vault.abs(rel)); } catch { return null; }
        const hit = this.fileHashes.get(rel);
        if (hit?.mtime === st.mtimeMs) return hit.hash;
        const h = hashOf(fs.readFileSync(this.vault.abs(rel)));
        this.fileHashes.set(rel, { mtime: st.mtimeMs, hash: h });
        return h;
    }

    /** Your own stamps with their hashes */
    ownStamps() { return this.worlds.vaultStamps().map((s) => ({ ...s, hash: this.fileHash(s.file), builtin: false })); }

    /** The stamp with this hash in the library (built-in first, then yours), or null */
    findStamp(hash) {
        if (!hash) return null;
        return this.builtins().byHash.get(hash) ?? this.ownStamps().find((s) => s.hash === hash) ?? null;
    }

    /** {hash, name, file?} of a stamp src as it is now, or null (generated door and window images need no library) */
    stampOfSrc(src) {
        if (!src || src.startsWith("data:")) return null;
        if (src.startsWith("/stamps/")) return this.builtins().bySrc.get(src) ?? null;
        if (src.startsWith("/files/")) {
            const rel = decodeURIComponent(src.slice(7));
            const h = this.fileHash(rel);
            return h ? { hash: h, src, name: path.posix.basename(rel).replace(/\.[^.]+$/, ""), file: rel, builtin: false } : null;
        }
        return null;
    }

    /** Before saving: hashes on stamp objects and the doc's asset table (symbol ids follow the SVG's order of first use) */
    annotate(doc) {
        const out = structuredClone(doc);
        const stamps = {}, order = [];
        for (const o of stampObjects(out)) {
            if (!order.includes(o.src)) order.push(o.src);
            const s = this.stampOfSrc(o.src);
            if (s) { o.hash = s.hash; stamps[s.hash] = { src: o.src, name: s.name, symbol: `s${order.indexOf(o.src)}`, ...(s.builtin ? { builtin: true } : {}) }; }
        }
        const textures = Object.fromEntries(Object.entries(out.textures ?? {}).map(([id, def]) => [id, textureHash(def)]));
        out.assets = { stamps, textures };
        return out;
    }

    /**
     * After reading: stamps whose file is gone are found again by hash; those the library doesn't have are drawn from
     * the image embedded in the map's SVG. Returns {doc, missing: [{hash, name, builtin}]}
     */
    resolve(doc, svgText) {
        if (!doc) return { doc, missing: [] };
        const missing = new Map();
        const embedded = (sym) => { const m = sym && String(svgText ?? "").match(new RegExp(`<symbol id="${sym}"[^>]*><image href="(data:[^"]+)"`)); return m?.[1] ?? null; };
        for (const o of stampObjects(doc)) {
            if (!o.src || o.src.startsWith("data:")) continue;
            if (this.stampOfSrc(o.src)) continue;               // still where it was
            const found = this.findStamp(o.hash);
            if (found) { o.src = found.src; continue; }        // moved or renamed: found by its content
            const info = doc.assets?.stamps?.[o.hash] ?? {};
            const data = embedded(info.symbol);
            if (data) { o.missingSrc = o.src; o.src = data; }  // not in this library: keep drawing the map's own copy
            if (o.hash) missing.set(o.hash, { hash: o.hash, name: info.name ?? path.posix.basename(o.missingSrc ?? o.src), builtin: !!info.builtin, embedded: !!data });
        }
        return { doc, missing: [...missing.values()] };
    }

    /** Which map files use each stamp hash and texture id */
    async usage() {
        const stamps = new Map(), textures = new Map();
        const add = (map, k, v) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(v); };
        for (const f of this.vault.files) {
            if (!f.endsWith(".svg")) continue;
            let text;
            try { text = await fsp.readFile(this.vault.abs(f), "utf8"); } catch { continue; }
            if (!text.includes('id="books-meta-map"') && !text.includes('id="books-meta-blueprint"')) continue;
            const m = text.match(/<metadata id="books-meta-(?:map|blueprint)"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
            let doc;
            try { doc = JSON.parse(m[1].replace(/]]]]><!\[CDATA\[>/g, "]]>")); } catch { continue; }
            const objs = doc.layers ? stampObjects(doc) : allObjects(doc.objects ?? []).filter((o) => o.type === "stamp");
            for (const o of objs) { const h = o.hash ?? this.stampOfSrc(o.src)?.hash; if (h) add(stamps, h, f); }
            for (const id of Object.keys(doc.textures ?? {})) add(textures, id, f);
        }
        return { stamps, textures };
    }
}
