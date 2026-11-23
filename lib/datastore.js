// Data store: schema, collections, entry pages, creation, image attachments, QA.
import fsp from "node:fs/promises";
import path from "node:path";
import { DS, SCHEMA_NOTE, isLink, linkLabel, linkTarget } from "./vault.js";
import { createNote, patchNote, sanitizeName, trashNote, uniqueName } from "./write.js";
import { renderMarkdown, fileUrl } from "./render.js";

export const ATTACHMENTS = `${DS}/_Attachments`;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const MAX_IMAGE = 15 * 1024 * 1024;

// Facets the app itself or the vault's Templater scripts read by name, whatever the schema says: never deleted
const REQUIRED_FACETS = {
    "Taxonomy/Novels": "the list of novels",
    "Taxonomy/Rarity": "item rarity in ledgers and the Templater scripts",
    "Taxonomy/Item Condition": "item condition in ledgers and the Templater scripts",
    "Taxonomy/Energy Sources": "the Templater scripts",
    "Taxonomy/Rating": "plot grades",
    "Taxonomy/Location Scales": "the World builder",
    "Taxonomy/Item Categories": "new items",
    "Taxonomy/Material Categories": "new materials",
    "Taxonomy/Recipe Categories": "the recipe creator",
    "Taxonomy/Engineering Disciplines": "the recipe creator",
};

export class DataStore {
    constructor(vault, novels, blueprints) { this.vault = vault; this.novels = novels; this.blueprints = blueprints; this._sv = -1; }

    schema() {
        if (this._sv === this.vault.version) return this._schema;
        const n = this.vault.notes.get(SCHEMA_NOTE);
        const json = n?.body.match(/```json\n([\s\S]*?)\n```/)?.[1];
        this._schema = json ? JSON.parse(json) : { collections: {} };
        this._sv = this.vault.version;
        return this._schema;
    }

    collectionOf(p) {
        if (!p.startsWith(`${DS}/`)) return null;
        const folder = path.posix.dirname(p.slice(DS.length + 1));
        return this.schema().collections[folder] ? folder : null;
    }

    /** Everything the browser needs to list and filter the data store, without bodies */
    index() {
        const schema = this.schema();
        const notes = [];
        for (const n of this.vault.notes.values()) {
            const collection = this.collectionOf(n.path);
            if (!collection) continue;
            notes.push({ path: n.path, name: n.name, collection, fm: n.fm, cover: this.cover(n), mtime: n.mtime });
        }
        const counts = {};
        for (const n of notes) counts[n.collection] = (counts[n.collection] ?? 0) + 1;
        return { schema, notes, counts, novels: this.novels.list().map(({ folder, name, number, config }) => ({ folder, name, number, accent: config.accent ?? null })),
            requiredFacets: Object.fromEntries(Object.keys(schema.collections).filter((c) => c.startsWith("Taxonomy/")).map((c) => [c, this.facetRequired(c)]).filter(([, why]) => why.length)) };
    }

    cover(n) {
        const first = [].concat(n.fm.images ?? [])[0];
        const p = first ? this.vault.resolve(first) : null;
        return p ? fileUrl(p) : null;
    }

    /** Resolve every link-looking value in frontmatter so the browser can draw chips */
    resolveFm(fm) {
        const out = {};
        const visit = (v) => {
            if (Array.isArray(v)) v.forEach(visit);
            else if (isLink(v)) { const p = this.vault.resolve(v); out[v] = p ? { path: p, label: linkLabel(v), image: !p.endsWith(".md") } : null; }
        };
        Object.values(fm).forEach(visit);
        return out;
    }

    page(p) {
        const n = this.vault.notes.get(p);
        if (!n) return null;
        const groups = {};
        for (const b of this.vault.backlinks(p)) {
            const c = this.collectionOf(b) ?? b.split("/")[0];
            (groups[c] ??= []).push({ path: b, name: this.vault.notes.get(b)?.name ?? path.posix.basename(b) });
        }
        // notes this one links to (frontmatter and body), grouped like backlinks; images and attachments are left out
        const outlinks = {};
        const seen = new Set([p]);
        for (const l of n.links) {
            if (!linkTarget(l)) continue;
            const r = this.vault.resolve(l);
            if (r ? seen.has(r) || !r.endsWith(".md") : seen.has(`?${l}`)) continue;
            seen.add(r ?? `?${l}`);
            const c = r ? this.collectionOf(r) ?? r.split("/")[0] : "Unresolved";
            (outlinks[c] ??= []).push(r ? { path: r, name: this.vault.notes.get(r)?.name ?? path.posix.basename(r) } : { path: null, name: linkLabel(`[[${l}]]`) });
        }
        const collection = this.collectionOf(p);
        const out = {
            path: p, name: n.name, collection, fm: n.fm, fmError: n.fmError, body: n.body, mtime: n.mtime,
            html: renderMarkdown(n.body, this.vault), links: this.resolveFm(n.fm), backlinks: groups, outlinks,
            images: [].concat(n.fm.images ?? []).map((i) => this.vault.resolve(i)).filter(Boolean).map(fileUrl),
        };
        if (collection === "Items") {
            if (this.blueprints.recipeFor(p)) out.blueprint = this.blueprints.tree(p);
            out.whereUsed = this.blueprints.whereUsed(p);
            out.heldBy = this.heldBy(p);
        }
        if (collection === "Materials") out.whereUsed = [];
        // materials and recipes are held in inventories like items
        if (collection === "Materials" || collection === "Recipes") out.heldBy = this.heldBy(p);
        if (collection === "Recipes" && n.fm.item) {
            const item = this.vault.resolve(n.fm.item);
            if (item) out.blueprint = this.blueprints.tree(item);
        }
        return out;
    }

    /** Who holds this item, per novel, at each novel's latest chapter */
    heldBy(p) {
        const out = [];
        for (const novel of this.novels.list()) {
            for (const l of this.novels.ledgers(novel)) {
                const c = this.novels.compute(novel, l);
                if (c.behaviour !== "stock") continue;
                for (const s of c.stacks) if (s.itemPath === p && s.qty > 0) out.push({ novel: novel.folder, owner: l.owner, ledger: l.type, store: s.store, qtyText: s.qtyText });
            }
        }
        return out;
    }

    // ------------------------------------------------------------ writing

    /** Create a data store note from the schema; returns its path. Name is made unique vault-wide. */
    async create(collection, name, fm = {}, body = "") {
        const col = this.schema().collections[collection];
        if (!col) throw Object.assign(new Error(`Unknown collection ${collection}`), { status: 400 });
        const clean = sanitizeName(name);
        if (!clean) throw Object.assign(new Error("Name required"), { status: 400 });
        const final = uniqueName(this.vault, clean, col.label);
        const out = {};
        for (const [k, def] of col.fields) out[k] = Array.isArray(def) ? [...def] : def;
        Object.assign(out, fm);
        if (!out.title) out.title = clean;
        if (!out["created-date"]) out["created-date"] = new Date().toISOString().slice(0, 10);
        const rel = `${DS}/${collection}/${final}.md`;
        await createNote(this.vault, rel, out, body);
        return rel;
    }

    // ------------------------------------------------------------ taxonomy: new facets, values from a list

    /**
     * A new taxonomy facet: an entry in the schema (`Taxonomy/<name>`, fields like the other ranked facets) and its
     * folder. `levels`: the values are levels of something, each with a number (`threshold`) and the power system
     * they belong to (`power-system`), which stat templates can use. Returns the collection.
     */
    async createFacet(name, { levels = false, ordered = true } = {}) {
        const label = sanitizeName(name);
        if (!label) throw Object.assign(new Error("Give the taxonomy a name"), { status: 400 });
        const schema = this.schema();
        const collection = `Taxonomy/${label}`;
        if (Object.keys(schema.collections).some((c) => c.toLowerCase() === collection.toLowerCase())) throw Object.assign(new Error(`There is already a taxonomy called ${label}`), { status: 409 });
        const fields = [["title", ""], ["aliases", []], ["type", label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")], ["facet", label], ["parent", ""]];
        if (ordered) fields.push(["ordered", true], ["class", ""]);
        if (levels) fields.push(["threshold", ""], ["power-system", []]);   // a list: one set of levels can serve several power systems
        fields.push(["description", ""], ["created-date", ""], ["tags", []]);
        const entry = { label, fields, links: { parent: collection, ...(levels ? { "power-system": "Power Systems" } : {}) } };
        // after the other taxonomy facets, keeping the order of everything else
        const keys = Object.keys(schema.collections);
        const at = keys.reduce((last, k, i) => (k.startsWith("Taxonomy/") ? i : last), keys.length - 1) + 1;
        const collections = Object.fromEntries([...keys.slice(0, at).map((k) => [k, schema.collections[k]]), [collection, entry], ...keys.slice(at).map((k) => [k, schema.collections[k]])]);
        const note = this.vault.notes.get(SCHEMA_NOTE);
        const json = note?.body.match(/```json\n([\s\S]*?)\n```/)?.[1];
        if (!json) throw Object.assign(new Error("The vault has no data store schema"), { status: 400 });
        await patchNote(this.vault, SCHEMA_NOTE, { body: note.body.replace(json, () => JSON.stringify({ ...JSON.parse(json), collections }, null, 1)) });
        await fsp.mkdir(this.vault.abs(`${DS}/${collection}`), { recursive: true });
        return collection;
    }

    /**
     * Notes for a list of values (from parseLevels: {name, title, parent, threshold}), in order: `class` continues
     * after the facet's highest, parents are linked by the names they get, `power-system` set when given (`powerSystems`:
     * a list, or `powerSystem`: one name; one system is written as a link, several as a list of links).
     */
    async addFacetValues(collection, values, { powerSystem = "", powerSystems = null } = {}) {
        if (!collection?.startsWith("Taxonomy/") || !this.schema().collections[collection]) throw Object.assign(new Error(`Unknown taxonomy ${collection}`), { status: 400 });
        const fieldsOf = new Set(this.schema().collections[collection].fields.map(([k]) => k));
        let cls = Math.max(0, ...this.vault.inFolder(`${DS}/${collection}`).map((n) => Number(n.fm.class)).filter(Number.isFinite));
        const systemValue = this.systemsValue(powerSystems ?? (powerSystem ? [powerSystem] : []));
        const made = new Map(), out = [];
        for (const v of values ?? []) {
            const name = sanitizeName(v.name);
            if (!name) continue;
            const fm = { title: String(v.title || name) };
            if (v.parent) {
                const existing = this.vault.resolve(`[[${v.parent}]]`);
                const p = made.get(v.parent) ?? (existing ? this.vault.notes.get(existing).name : null);
                if (p) fm.parent = `[[${p}]]`;
            }
            if (fieldsOf.has("class") || fieldsOf.has("ordered")) { fm.ordered = true; fm.class = ++cls; }
            if (v.threshold != null && v.threshold !== "" && Number.isFinite(Number(v.threshold))) fm.threshold = Number(v.threshold);
            if (systemValue) fm["power-system"] = systemValue;
            const rel = await this.create(collection, name, fm);
            made.set(v.name, rel.split("/").pop().replace(/\.md$/, ""));
            out.push(rel);
        }
        return out;
    }

    /** Power system names -> the `power-system` value (one link, a list of links, or null); unknown names refused */
    systemsValue(names) {
        const links = [...new Set([].concat(names ?? []).map((v) => String(v ?? "").trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim()).filter(Boolean))].map((n) => {
            const p = this.vault.resolve(`[[${n}]]`);
            if (!p) throw Object.assign(new Error(`No note called ${n}`), { status: 400 });
            return `[[${this.vault.notes.get(p).name}]]`;
        });
        return !links.length ? null : links.length === 1 ? links[0] : links;
    }

    /** The power systems a facet's values belong to (names, in order of first use) */
    facetSystems(collection) {
        const names = [];
        for (const n of this.vault.inFolder(`${DS}/${collection}`)) for (const v of [].concat(n.fm["power-system"] ?? [])) {
            const name = linkLabel(String(v));
            if (name && !names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name);
        }
        return names;
    }

    /**
     * Point every value of a facet at these power systems (a cultivation and its demonic offshoot can share one set of
     * levels; each power system names its own, nothing is inherited). Only notes whose value changes are written.
     */
    async setFacetSystems(collection, systems) {
        if (!collection?.startsWith("Taxonomy/") || !this.schema().collections[collection]) throw Object.assign(new Error(`Unknown taxonomy ${collection}`), { status: 400 });
        const value = this.systemsValue(systems);
        if (value) await this.makeLevels(collection);
        const same = (a, b) => JSON.stringify([].concat(a ?? []).map(String)) === JSON.stringify([].concat(b ?? []).map(String));
        const changed = [];
        for (const n of this.vault.inFolder(`${DS}/${collection}`)) {
            if (same(n.fm["power-system"] ?? null, value)) continue;
            await patchNote(this.vault, n.path, value ? { set: { "power-system": value } } : { unset: ["power-system"] });
            changed.push(n.path);
        }
        return changed;
    }

    /**
     * Link one power system to a facet's values, or unlink it (`linked: false`), keeping every other system they name;
     * with `from`, the system leaves that facet in the same step (changing which levels a system uses). Returns the
     * notes written.
     */
    async linkFacetSystem(collection, system, { linked = true, from = null } = {}) {
        const name = this.systemsValue([system]);
        if (!name) throw Object.assign(new Error("Name the power system"), { status: 400 });
        const key = linkLabel(name).toLowerCase();
        const without = (c) => this.facetSystems(c).filter((x) => x.toLowerCase() !== key);
        const changed = [];
        if (from && from !== collection) changed.push(...await this.setFacetSystems(from, without(from)));
        changed.push(...await this.setFacetSystems(collection, linked ? [...without(collection), linkLabel(name)] : without(collection)));
        return changed;
    }

    /**
     * A facet made without "levels" becomes one when a power system uses it: its schema entry gets `threshold` and
     * `power-system` (before `description`, like a new levels facet) and the link to Power Systems. Nothing when it has them.
     */
    async makeLevels(collection) {
        const entry = this.schema().collections[collection];
        const has = new Set(entry.fields.map(([k]) => k));
        if (has.has("threshold") && has.has("power-system") && entry.links?.["power-system"]) return false;
        const note = this.vault.notes.get(SCHEMA_NOTE);
        const json = note?.body.match(/```json\n([\s\S]*?)\n```/)?.[1];
        if (!json) throw Object.assign(new Error("The vault has no data store schema"), { status: 400 });
        const parsed = JSON.parse(json);
        const e = parsed.collections[collection];
        const add = [...(has.has("threshold") ? [] : [["threshold", ""]]), ...(has.has("power-system") ? [] : [["power-system", []]])];
        const at = e.fields.findIndex(([k]) => k === "description");
        e.fields.splice(at < 0 ? e.fields.length : at, 0, ...add);
        e.links = { ...(e.links ?? {}), "power-system": "Power Systems" };
        await patchNote(this.vault, SCHEMA_NOTE, { body: note.body.replace(json, () => JSON.stringify(parsed, null, 1)) });
        return true;
    }

    /** Why a facet is required (so it can't be deleted; its values can): the app or Templater reads it, or a schema field links to it */
    facetRequired(collection) {
        const schema = this.schema();
        const why = REQUIRED_FACETS[collection] ? [REQUIRED_FACETS[collection]] : [];
        const fieldsOf = (label, links) => {
            const fields = Object.entries(links ?? {}).filter(([, t]) => [].concat(t).includes(collection)).map(([f]) => f);
            if (fields.length) why.push(`${label} (${fields.join(", ")})`);
        };
        for (const [k, c] of Object.entries(schema.collections)) if (k !== collection) fieldsOf(k.replace(/^Taxonomy\//, ""), c.links);
        fieldsOf("Characters", schema.characters?.links);
        for (const [k, c] of Object.entries(schema.plans ?? {})) fieldsOf(`${k[0].toUpperCase()}${k.slice(1)}`, c?.links);
        return why;
    }

    /** Stat templates whose choice fields take a facet's values: "<Novel>: <Template> (<field>)" */
    facetTemplates(collection) {
        const name = collection.slice(9).toLowerCase(), out = [];
        for (const n of this.novels.list()) for (const [t, def] of Object.entries(n.config["stat-templates"] ?? {})) {
            const fields = [].concat(def?.fields ?? []).filter((f) => String(f?.facet ?? "").trim().toLowerCase() === name).map((f) => f.label || f.key);
            if (fields.length) out.push(`${n.name}: ${t} (${fields.join(", ")})`);
        }
        return out;
    }

    /**
     * What removing a facet would do: its values (to the vault's .trash), notes that link to them (left unresolved), the
     * power systems using it; and what stops it: `required` (facetRequired) or stat templates using it (`templates`)
     */
    facetRemoval(collection) {
        const col = Object.keys(this.schema().collections).find((k) => k.toLowerCase() === String(collection ?? "").toLowerCase());
        if (!col?.startsWith("Taxonomy/")) throw Object.assign(new Error(`No taxonomy ${collection}`), { status: 400 });
        const values = this.vault.inFolder(`${DS}/${col}`);
        const inside = new Set(values.map((n) => n.path));
        const linkedFrom = [...new Set(values.flatMap((n) => this.vault.backlinks(n.path)).filter((p) => !inside.has(p)))]
            .map((p) => ({ path: p, name: this.vault.notes.get(p)?.name ?? p }));
        const required = this.facetRequired(col), templates = this.facetTemplates(col), label = col.slice(9);
        const blocked = required.length ? `${label} is required: it is used by ${required.join("; ")}. Its values can be deleted one by one`
            : templates.length ? `${label} is used by stat templates: ${templates.join("; ")}. Change those fields first` : null;
        return { collection: col, values: values.map((n) => ({ path: n.path, name: n.name, title: String(n.fm.title || n.name) })), linkedFrom, systems: this.facetSystems(col), required, templates, blocked };
    }

    /** Remove a facet: its value notes go to the vault's .trash, its schema entry and (empty) folder go */
    async removeFacet(collection) {
        const r = this.facetRemoval(collection);
        if (r.blocked) throw Object.assign(new Error(r.blocked), { status: 409 });
        // the schema is read before anything moves, so a schema that can't be changed leaves the values where they are
        const note = this.vault.notes.get(SCHEMA_NOTE);
        const json = note?.body.match(/```json\n([\s\S]*?)\n```/)?.[1];
        if (!json) throw Object.assign(new Error("The vault has no data store schema"), { status: 400 });
        const parsed = JSON.parse(json);
        delete parsed.collections[r.collection];
        for (const v of r.values) await trashNote(this.vault, v.path);
        await patchNote(this.vault, SCHEMA_NOTE, { body: note.body.replace(json, () => JSON.stringify(parsed, null, 1)) });
        try { await fsp.rmdir(this.vault.abs(`${DS}/${r.collection}`)); } catch { /* not empty (other files): left as it is */ }
        return { collection: r.collection, trashed: r.values.map((v) => v.path) };
    }

    // ------------------------------------------------------------ recipes (blueprints)

    /**
     * Create the recipe (blueprint) for an item, in the same shape as Templater's createBlueprint: a Recipes note
     * "<item> (Blueprint)" whose frontmatter lists the item, components, materials and disciplines, and whose body holds
     * the component::/count:: and material::/quantity::/unit:: fields the build tree and the crafting scripts read.
     * The item gets `recipe: "[[<recipe>]]"`. Returns {path, name}.
     * fm: {description, cat, tier, disciplines, "power-system"}; components [{item, count}]; materials [{material, qty, unit}]
     */
    async createRecipe({ item, fm = {}, components = [], materials = [], assembly = "" }) {
        const itemNote = this.vault.notes.get(item);
        if (!itemNote || this.collectionOf(item) !== "Items") throw Object.assign(new Error("Not an item"), { status: 400 });
        const existing = this.blueprints.recipeFor(item);
        if (existing) throw Object.assign(new Error(`${itemNote.name} already has a recipe: ${existing.note.name}`), { status: 409 });
        const link = (v) => (v ? `[[${linkLabel(v)}]]` : "");
        const comps = components.filter((c) => c?.item).map((c) => ({ item: link(c.item), count: Math.max(1, Math.round(Number(c.count) || 1)) }));
        const mats = materials.filter((m) => m?.material).map((m) => ({ material: link(m.material), qty: Number(m.qty) || 0, unit: m.unit || "g" }));
        const list = (v) => [...new Set([].concat(v ?? []).filter(Boolean).map(link))];
        const front = {
            title: `${itemNote.name} blueprint`,
            cat: list(fm.cat ?? (this.vault.resolve("[[tech blueprint]]") ? "[[tech blueprint]]" : [])),
            item: `[[${itemNote.name}]]`,
            tier: fm.tier === "" || fm.tier == null ? "" : Number(fm.tier),
            components: [...new Set(comps.map((c) => c.item))],
            materials: [...new Set(mats.map((m) => m.material))],
            disciplines: list(fm.disciplines),
            "power-system": list(fm["power-system"] ?? itemNote.fm["power-system"]),
            // like the Templater script: the recipe belongs where its item does
            genre: list(itemNote.fm.genre),
            novels: list(itemNote.fm.novels),
            description: String(fm.description ?? "").trim(),
        };
        let body = "";
        if (comps.length) body += `## Components\n${comps.map((c) => `component:: ${c.item}\ncount:: ${c.count}\n`).join("\n")}\n`;
        if (mats.length) body += `## Materials Required\n${mats.map((m) => `material:: ${m.material}\nquantity:: ${m.qty}\nunit:: ${m.unit}\n`).join("\n")}\n`;
        if (String(assembly).trim()) body += `## Assembly\n${String(assembly).trim()}\n`;
        const p = await this.create("Recipes", `${itemNote.name} (Blueprint)`, front, body);
        const name = path.posix.basename(p, ".md");
        await patchNote(this.vault, item, { set: { recipe: `[[${name}]]` } });
        return { path: p, name };
    }

    /**
     * Recipes like the one being made for `item`, for keeping costs in balance: scored by shared item categories,
     * power system and closeness of tier. [{path, name, item, itemName, tier, score, why, disciplines, bill, parts,
     * grams (total weight of materials), components (count)}], best first
     */
    compareRecipes(item, limit = 12) {
        const it = this.vault.notes.get(item);
        if (!it) throw Object.assign(new Error("Item not found"), { status: 404 });
        const labels = (v) => new Set([].concat(v ?? []).filter(Boolean).map((x) => linkLabel(x).toLowerCase()));
        const cats = labels([].concat(it.fm.cat ?? [], it.fm.subcat ?? [])), ps = labels(it.fm["power-system"]), tier = Number(it.fm.tier) || null;
        const out = [];
        for (const [ip, r] of this.blueprints.index().recipes) {
            if (ip === item) continue;
            const other = this.vault.notes.get(ip);
            if (!other) continue;
            const why = [];
            let score = 0;
            const shared = [...labels([].concat(other.fm.cat ?? [], other.fm.subcat ?? []))].filter((c) => cats.has(c));
            if (shared.length) { score += 3 * shared.length; why.push(shared.join(", ")); }
            const sharedPs = [...labels(other.fm["power-system"])].filter((c) => ps.has(c));
            if (sharedPs.length) { score += 2; why.push(sharedPs.join(", ")); }
            const t = Number(other.fm.tier ?? r.note.fm.tier) || null;
            if (tier && t) { const d = Math.abs(t - tier); if (d === 0) { score += 2; why.push(`tier ${t}`); } else if (d === 1) { score += 1; why.push(`tier ${t}`); } }
            if (score <= 0) continue;
            const tree = this.blueprints.tree(ip);
            out.push({
                path: r.note.path, name: r.note.name, item: ip, itemName: other.fm.title || other.name, tier: t, score, why,
                disciplines: tree.disciplines, bill: tree.bill, parts: tree.parts, components: r.components.reduce((n, c) => n + c.count, 0),
                grams: tree.bill.filter((b) => b.unit === "g").reduce((n, b) => n + b.qty, 0),
            });
        }
        return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
    }

    /** Save an uploaded image next to the data store and link it from the note */
    async attachImage(notePath, filename, buffer) {
        const n = this.vault.notes.get(notePath);
        if (!n) throw Object.assign(new Error("Note not found"), { status: 404 });
        const ext = path.extname(filename).slice(1).toLowerCase();
        if (!IMAGE_TYPES[ext]) throw Object.assign(new Error(`Unsupported image type .${ext}`), { status: 400 });
        if (buffer.length > MAX_IMAGE) throw Object.assign(new Error("Image larger than 15 MB"), { status: 413 });
        const collection = this.collectionOf(notePath);
        const novel = this.novels.list().find((x) => notePath.startsWith(`${x.folder}/`));
        const folder = collection ? `${ATTACHMENTS}/${collection}` : novel ? `${novel.folder}/_Attachments/${path.posix.basename(path.posix.dirname(notePath))}` : `${ATTACHMENTS}/Other`;
        let i = 1, file;
        do { file = `${n.name} ${i++}.${ext}`; } while (this.vault.fileByName.has(file.toLowerCase()));
        const rel = `${folder}/${file}`;
        await fsp.mkdir(this.vault.abs(folder), { recursive: true });
        await fsp.writeFile(this.vault.abs(rel), buffer);
        this.vault.files.add(rel);
        this.vault.rebuildNames();

        // body: embed under "## Images"
        const lines = n.body.split("\n");
        const h = lines.findIndex((l) => /^##\s+Images\s*$/.test(l));
        if (h === -1) {
            const body = `${n.body.replace(/\s*$/, "")}${n.body.trim() ? "\n\n" : ""}## Images\n![[${file}]]\n`;
            await patchNote(this.vault, notePath, { body, set: { images: [...[].concat(n.fm.images ?? []), `[[${file}]]`] } });
        } else {
            let end = h + 1;
            while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
            while (end > h + 1 && !lines[end - 1].trim()) end--;
            lines.splice(end, 0, `![[${file}]]`);
            await patchNote(this.vault, notePath, { body: lines.join("\n"), set: { images: [...[].concat(n.fm.images ?? []), `[[${file}]]`] } });
        }
        return { path: rel, url: fileUrl(rel) };
    }

    // ------------------------------------------------------------ QA

    qa() {
        const schema = this.schema();
        const unresolved = [], fmErrors = [], untitled = [];
        for (const n of this.vault.notes.values()) {
            if (n.fmError) fmErrors.push({ path: n.path, error: n.fmError });
            const col = this.collectionOf(n.path);
            if (!col) continue;
            if (/^Untitled( \d+)?$/.test(n.name)) untitled.push({ path: n.path });
            for (const key of Object.keys(schema.collections[col].links ?? {})) {
                for (const v of [].concat(n.fm[key] ?? [])) if (isLink(v) && !this.vault.resolve(v)) unresolved.push({ path: n.path, field: key, value: v });
            }
        }
        const collisions = [];
        for (const [name, paths] of this.vault.byName) if (paths.length > 1 && paths.some((p) => p.startsWith(`${DS}/`))) collisions.push({ name, paths });
        const ledgers = [], misc = [];
        for (const novel of this.novels.list()) {
            const all = this.novels.ledgers(novel);
            const ins = new Set(all.flatMap((l) => l.entries.flatMap((e) => e.lines.filter((x) => x.action === "transfer-in").map((x) => x.ref))));
            for (const l of all) {
                const c = this.novels.compute(novel, l);
                for (const w of c.warnings) ledgers.push({ novel: novel.folder, ledger: l.path, ...w });
                for (const e of l.entries) for (const x of e.lines) {
                    if (x.action === "transfer-out" && x.ref && !ins.has(x.ref)) ledgers.push({ novel: novel.folder, ledger: l.path, entry: e.key, message: `Transfer to ${linkLabel(x.to)} has no matching transfer-in` });
                    if (x.item && !/\[\[/.test(x.item)) misc.push({ novel: novel.folder, ledger: l.path, entry: e.key, item: x.item });
                    else if (x.item && !this.vault.resolve(x.item)) ledgers.push({ novel: novel.folder, ledger: l.path, entry: e.key, message: `Unresolved item ${x.item}` });
                }
            }
        }
        return { unresolved, fmErrors, untitled, collisions, ledgers, misc };
    }

    /** Create a data note for a misc item and relink every ledger line that mentions it */
    async promoteMisc(novelFolder, itemText, collection, fm) {
        const rel = await this.create(collection, itemText, fm);
        const name = path.posix.basename(rel, ".md");
        const novel = this.novels.get(novelFolder);
        let changed = 0;
        for (const l of this.novels.ledgers(novel)) {
            let touched = false;
            for (const e of l.entries) for (const x of e.lines) {
                if (x.item && !/\[\[/.test(x.item) && x.item.trim().toLowerCase() === itemText.trim().toLowerCase()) { x.item = `[[${name}]]`; e.raw = undefined; touched = true; changed++; }
            }
            if (touched) await this.novels.writeLedger(l, l.entries);
        }
        return { path: rel, changed };
    }
}

