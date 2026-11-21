// Export a world as a dataset the importer reads (a git-ready folder or a .zip): the world note, its locations, their
// maps (with stamp hashes), your own stamps and derived textures those maps use, images attached to the notes, and
// optionally the data store notes they link to, one level deep (never chapters, characters, plans or novel notes).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DS, linkTarget } from "./vault.js";
import { parseMapSvg, renderMapSvg, allObjects } from "../public/map-core.js";
import { stampObjects, textureHash } from "./assets.js";
import { writeZip } from "./zip.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const NOVELS_FACET = `${DS}/Taxonomy/Novels/`;

export class WorldExport {
    constructor(vault, store, worlds, assets) { Object.assign(this, { vault, store, worlds, assets }); }

    /** A note the "linked notes" option may take: a data store note (any collection, taxonomy too), not a novel */
    linkable(p) {
        return !!p && p.endsWith(".md") && this.vault.notes.has(p) && !!this.store.collectionOf(p) && !p.startsWith(NOVELS_FACET);
    }

    /** What an export holds: {world, notes, maps, linked, attachments, stamps, textures} (vault paths) */
    plan(worldPath, { linked = false } = {}) {
        const w = this.vault.notes.get(worldPath);
        if (!w) throw fail(404, "World not found");
        const locations = this.worlds.locations(worldPath).map((l) => l.path);
        const own = [worldPath, ...locations];
        const notes = new Set(own);
        const extra = new Set();
        if (linked) for (const p of own) for (const raw of this.vault.notes.get(p)?.links ?? []) {
            const t = this.vault.resolve(linkTarget(`[[${raw}]]`));
            if (this.linkable(t) && !notes.has(t)) extra.add(t);
        }
        for (const p of extra) notes.add(p);
        // images and other files the notes link or embed (inside the vault)
        const attachments = new Set();
        for (const p of notes) for (const raw of this.vault.notes.get(p)?.links ?? []) {
            const t = this.vault.resolve(linkTarget(`[[${raw}]]`));
            if (t && !t.endsWith(".md") && this.vault.files.has(t)) attachments.add(t);
        }
        const maps = locations.map((p) => this.worlds.mapPath(this.vault.notes.get(p))).filter((f) => this.vault.files.has(f));
        for (const m of maps) attachments.delete(m);
        return { world: worldPath, title: w.fm.title || w.name, description: w.fm.description ?? "", notes: [...notes], locations, linked: [...extra], attachments: [...attachments], maps };
    }

    /** Short summary for the export dialog */
    async preview(worldPath, opts) {
        const p = this.plan(worldPath, opts);
        const { files, manifest } = await this.build(worldPath, opts, p);
        const byCollection = {};
        for (const n of p.linked) { const c = this.store.collectionOf(n); byCollection[c] = (byCollection[c] ?? 0) + 1; }
        return {
            title: p.title, locations: p.locations.length, maps: p.maps.length, attachments: p.attachments.length,
            linked: p.linked.length, linkedByCollection: byCollection, files: files.size,
            stamps: { own: manifest.assets.stamps.filter((s) => !s.builtin).length, builtin: manifest.assets.stamps.filter((s) => s.builtin).length },
            textures: Object.keys(manifest.assets.textures).length,
        };
    }

    /** {files: Map(dataset path -> Buffer), manifest} */
    async build(worldPath, opts = {}, plan = this.plan(worldPath, opts)) {
        const files = new Map();
        const put = async (rel) => { try { files.set(`vault/${rel}`, await fsp.readFile(this.vault.abs(rel))); } catch { /* gone */ } };
        for (const n of plan.notes) await put(n);
        for (const a of plan.attachments) await put(a);
        const stamps = new Map(), textures = {};
        for (const m of plan.maps) {
            const text = await fsp.readFile(this.vault.abs(m), "utf8");
            const doc = parseMapSvg(text);
            if (!doc) { files.set(`vault/${m}`, Buffer.from(text)); continue; }
            // the map as saved now: hashes recorded (older maps had none), its own stamps' images embedded as before
            const { doc: ready, fallbacks } = this.worlds.prepareDoc(this.assets.resolve(structuredClone(doc), text).doc);
            const svg = renderMapSvg(ready, await this.worlds.svgContext(ready.layers.flatMap((l) => allObjects(l.objects)), fallbacks));
            files.set(`vault/${m}`, Buffer.from(svg));
            for (const o of stampObjects(ready)) {
                if (!o.hash || stamps.has(o.hash)) continue;
                const s = this.assets.stampOfSrc(o.src);
                const info = ready.assets?.stamps?.[o.hash] ?? {};
                stamps.set(o.hash, { hash: o.hash, name: s?.name ?? info.name ?? null, src: o.src, builtin: !!(s?.builtin ?? info.builtin), ...(s?.file ? { path: s.file } : {}) });
                if (s?.file) await put(s.file);
            }
            for (const [id, def] of Object.entries(ready.textures ?? {})) textures[id] = { hash: ready.assets.textures[id], def };
        }
        const manifest = {
            name: plan.title, description: plan.description, kind: "world", root: "vault",
            id: `world:${path.posix.basename(plan.world, ".md")}`, world: plan.world, exported: new Date().toISOString(),
            linkedNotes: opts.linked ? "one level" : "none",
            assets: { stamps: [...stamps.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))), textures },
        };
        return { files, manifest };
    }

    async zip(worldPath, opts) {
        const { files, manifest } = await this.build(worldPath, opts);
        const entries = [{ name: "world-builder.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) }, { name: "README.md", data: Buffer.from(readme(manifest)) }];
        for (const [name, data] of [...files].sort(([a], [b]) => a.localeCompare(b))) entries.push({ name, data });
        return { data: writeZip(entries), filename: `${manifest.name.replace(/[\\/:*?"<>|]/g, "")}.zip`, manifest };
    }

    /** A stamp and texture pack: chosen stamp files at their vault paths, chosen derived textures in the manifest */
    async packZip({ stamps = [], textures = [], name = "Map assets" }) {
        const lib = this.worlds.textures().textures;
        const entries = [];
        const listed = [];
        for (const f of stamps) {
            if (!this.vault.files.has(f)) continue;
            const data = await fsp.readFile(this.vault.abs(f));
            entries.push({ name: `vault/${f}`, data });
            listed.push({ hash: this.assets.fileHash(f), name: path.posix.basename(f).replace(/\.[^.]+$/, ""), path: f });
        }
        const tex = Object.fromEntries(textures.filter((id) => lib[id]).map((id) => [id, { hash: textureHash(lib[id]), def: lib[id] }]));
        const manifest = { name, kind: "assets", root: "vault", id: `assets:${name}`, exported: new Date().toISOString(), assets: { stamps: listed, textures: tex } };
        entries.unshift({ name: "world-builder.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) });
        return { data: writeZip(entries), filename: `${name.replace(/[\\/:*?"<>|]/g, "")}.zip` };
    }

    /**
     * Write into a folder (e.g. a git repository to push). An empty or new folder is filled; a folder holding an earlier
     * export of the same world has its vault/ replaced and keeps everything else (.git, your README edits).
     */
    async folder(worldPath, opts, dir) {
        const target = path.resolve(String(dir ?? "").replace(/^~(?=\/|$)/, process.env.HOME ?? ""));
        if (!dir || !path.isAbsolute(target)) throw fail(400, "Give the folder as a full path");
        if (target === this.vault.root || target.startsWith(this.vault.root + path.sep) || this.vault.root.startsWith(target + path.sep)) throw fail(400, "Choose a folder outside the vault");
        const { files, manifest } = await this.build(worldPath, opts);
        let existing = null;
        if (fs.existsSync(target)) {
            const entries = fs.readdirSync(target).filter((e) => e !== ".git");
            try { existing = JSON.parse(fs.readFileSync(path.join(target, "world-builder.json"), "utf8")); } catch { /* none */ }
            if (entries.length && existing?.id !== manifest.id) throw fail(409, `${target} is not empty and holds no earlier export of this world`);
        }
        await fsp.mkdir(target, { recursive: true });
        await fsp.rm(path.join(target, "vault"), { recursive: true, force: true });
        for (const [rel, data] of files) {
            const abs = path.join(target, ...rel.split("/"));
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            await fsp.writeFile(abs, data);
        }
        await fsp.writeFile(path.join(target, "world-builder.json"), JSON.stringify(manifest, null, 2) + "\n");
        if (!fs.existsSync(path.join(target, "README.md"))) await fsp.writeFile(path.join(target, "README.md"), readme(manifest));
        return { folder: target, files: files.size + 1, updated: !!existing, git: fs.existsSync(path.join(target, ".git")) };
    }
}

const readme = (m) => `# ${m.name}

${m.description ? `${m.description}\n\n` : ""}A world exported from [Novel Craft](https://github.com/TheRealWolfick/world-builder): the world, its locations and maps${m.linkedNotes === "one level" ? ", and the notes they link to" : ""}.

## Importing

In Novel Craft open **Tools → Import data** and paste this repository's URL (or drop this folder's .zip). Stamps and textures you already have are reused, not copied again.
`;
