// The assistant's tools: read-only views of the user's novels, worlds and data store, each returning a compact text
// result with a size cap, so the model asks for what it needs instead of reading whole folders. Only novel folders and
// the data store are reachable (never .obsidian, .git, .trash, Templater notes or anything else in the vault).
import { DS, linkLabel } from "./vault.js";
import { parseSections } from "../public/sections.js";
import { foldRelations } from "./ledger.js";

const MAX_RESULT = 24000;      // characters per tool result
const PAGE = 14000;            // characters per chapter page
const fail = (message) => Object.assign(new Error(message), { toolError: true });

/** Frontmatter as short "key: value" lines, empty values left out, links shown by name */
function fieldLines(fm, skip = []) {
    const plain = (v) => (Array.isArray(v) ? v.map(plain).filter(Boolean).join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "").trim());
    return Object.entries(fm ?? {}).filter(([k]) => !skip.includes(k)).map(([k, v]) => [k, plain(v)]).filter(([, v]) => v !== "" && v !== "[]").map(([k, v]) => `${k}: ${v.length > 600 ? `${v.slice(0, 600)}…` : v}`);
}
const words = (s) => (String(s).match(/\S+/g) ?? []).length;
const cap = (s) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}\n…[cut at ${MAX_RESULT} characters: ask for less, or page through it]` : s);

/** A collection's fields as [key, default] pairs (the schema stores them as pairs, older ones as an object) */
const fieldsOf = (spec) => (Array.isArray(spec?.fields) ? spec.fields : Object.entries(spec?.fields ?? {}));
const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });

export class AiTools {
    /** @param ctx () => {vault, novels, store, plans, worlds, search} (the services of the open vault) */
    constructor(ctx) { this.ctx = ctx; }

    // ------------------------------------------------------------ scope

    /** May the assistant read this note? Novel folders and the data store only */
    inScope(p) {
        const { vault, novels } = this.ctx();
        if (!p || !vault.notes.has(p) || /(^|\/)\./.test(p)) return false;
        if (p.startsWith(`${DS}/`)) return !p.startsWith(`${DS}/_Attachments/`);
        return novels.list().some((n) => p.startsWith(`${n.folder}/`));
    }
    /** A note by vault path or [[name]], refused outside the scope */
    note(ref) {
        const { vault } = this.ctx();
        const raw = String(ref ?? "").trim().replace(/^\[\[|\]\]$/g, "");
        const p = vault.notes.has(raw) ? raw : vault.notes.has(`${raw}.md`) ? `${raw}.md` : vault.resolve(`[[${raw}]]`);
        if (!p || !vault.notes.has(p)) throw fail(`No note "${raw}". Use search to find its name.`);
        if (!this.inScope(p)) throw fail(`"${raw}" is outside the novels and the data store, which are all you can read.`);
        return vault.notes.get(p);
    }
    novel(ref) {
        const { novels } = this.ctx();
        const list = novels.list();
        const q = String(ref ?? "").toLowerCase().trim();
        const n = list.find((x) => x.folder.toLowerCase() === q) ?? list.find((x) => x.name.toLowerCase() === q) ?? list.find((x) => x.name.toLowerCase().includes(q));
        if (!n) throw fail(`No novel "${ref}". Novels: ${list.map((x) => x.name).join(", ")}`);
        return n;
    }

    /** The vault's outline for the system prompt (names only, so it rarely changes) */
    outline() {
        const { novels, store, worlds } = this.ctx();
        const cols = Object.keys(store.schema().collections ?? {});
        const lines = ["Novels (folder: name):", ...novels.list().map((n) => `- ${n.folder}`)];
        lines.push("", `Data store collections (in "${DS}/"): ${cols.filter((c) => !c.startsWith("Taxonomy/")).join(", ")}`);
        lines.push(`Taxonomy facets: ${cols.filter((c) => c.startsWith("Taxonomy/")).map((c) => c.slice(9)).join(", ")}`);
        lines.push(`Worlds: ${worlds.list().worlds.map((w) => w.title).join(", ") || "none"}`);
        return lines.join("\n");
    }

    // ------------------------------------------------------------ definitions

    definitions() {
        const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
        return [
            { name: "search", description: "Full-text search across the novels and the data store: note names, titles, fields and text (every word must appear). Returns paths, kinds (data, taxonomy, chapter, character, plan, ledger) and short snippets. Start here for any name, term or event you don't have a path for. Cheap.",
                input_schema: obj({ query: str("Words to find; exact names work best"), kind: { type: "string", enum: ["data", "taxonomy", "chapter", "character", "plan", "ledger", "other"], description: "Only this kind" }, novel: str("Only notes of this novel (data store notes are always included)"), limit: int("Results, default 15, at most 40") }, ["query"]) },
            { name: "novel_overview", description: "A novel at a glance: volumes with chapter ranges, every chapter (number, title, written or planned, word count, first line of its plan), characters and plots. Use it before reading chapters. Moderate size.",
                input_schema: obj({ novel: str("Novel name or folder") }, ["novel"]) },
            { name: "read_chapter", description: "A chapter's text, a page at a time (about 2,500 words per page), and/or its plan. Expensive for long chapters: read the plan or the overview first when that answers the question.",
                input_schema: obj({ novel: str("Novel name or folder"), chapter: { type: "number", description: "Chapter number (fractional ones exist, e.g. 48.5)" }, what: { type: "string", enum: ["text", "plan", "both"], description: "Default text" }, page: int("Page of the text, from 1") }, ["novel", "chapter"]) },
            { name: "read_note", description: "A note's fields and text: a data store entry, character sheet, plan, plot, location, taxonomy value. Long texts come back as their section titles; ask for sections by title to read them.",
                input_schema: obj({ note: str("Vault path, or the note's name"), sections: { type: "array", items: { type: "string" }, description: "Section titles to read (\"\" = the text before the first heading)" } }, ["note"]) },
            { name: "query_collection", description: "Rows of a data store collection (Items, Materials, Recipes, Abilities, Races, Creatures, Power Systems, Power Levels, Worlds, Locations, Factions, or Taxonomy/<Facet>) with chosen fields, filtered by field values or text. Use it for lists and comparisons instead of reading notes one by one.",
                input_schema: obj({ collection: str("Collection folder name"), where: { type: "object", description: "field: value pairs; a row matches when the field contains the value (links match by name)", additionalProperties: { type: "string" } }, text: str("Words that must appear in the name, fields or text"), fields: { type: "array", items: { type: "string" }, description: "Fields to show (default: title, description and the collection's main fields)" }, limit: int("Rows, default 30, at most 100"), offset: int("Rows to skip") }, ["collection"]) },
            { name: "schema", description: "The fields of a data store collection (with defaults and which collection each link field points at), or the list of collections.",
                input_schema: obj({ collection: str("Collection folder name; leave out for the list") }) },
            { name: "ledger_entries", description: "The entries of an owner's ledgers in full: key, chapter, title, fields, every line in the form propose_changes takes, and log text. Use it before changing or deleting an entry (propose_changes ledger_entry with `entry`, or delete_ledger_entry), so you change what is there.",
                input_schema: obj({ novel: str("Novel folder or name"), owner: str("The ledger's owner (a character or other note)"), ledger: str("Only this ledger type, e.g. Stats; leave out for all"),
                    from: { type: "number", description: "First chapter (default: all)" }, to: { type: "number", description: "Last chapter (default: all)" } }, ["novel", "owner"]) },
            { name: "character_state", description: "What a character (or any ledger owner) holds and what their tracked values are at a chapter, from their ledgers (inventory, stats, relationships, journal), with the entries that changed things.",
                input_schema: obj({ novel: str("Novel name or folder"), owner: str("Owner's name, e.g. a character"), chapter: { type: "number", description: "At the end of this chapter (default: the latest)" } }, ["novel", "owner"]) },
            { name: "world_tree", description: "A world's locations as an indented outline (scale, parent), or the list of worlds.",
                input_schema: obj({ world: str("World name; leave out for the list"), under: str("Only this location and what is inside it") }) },
            { name: "taxonomy", description: "The values of a taxonomy facet (categories such as Rarity, Item Categories, Genres) with their parents and rank.",
                input_schema: obj({ facet: str("Facet name, e.g. Rarity") }, ["facet"]) },
            { name: "propose_changes", description: "Propose changes for the user to review: new data store entries or characters, field changes, text edits in chapters or notes, and ledger entries (new ones, or an existing entry replaced whole). Nothing is written until they approve it in the review panel (each change or all); their decision comes with their next message. Use it whenever they ask you to create, fill in, rewrite or fix something, instead of giving text to paste. Group related changes in one proposal. For text edits quote the exact current text (find it with read_chapter / read_note first, markdown included); keep each edit to the passage that changes. Ledger entries: check character_state (holdings at the chapter) and ledger_entries (the entries as they are) first; a new entry has no key, changing one gives its key as \"entry\" (with only what changes: lines replace all the lines), delete_ledger_entry {novel, owner, ledger, entry} removes one (its mirrored transfers go with it); stock lines are {action: add|remove|move|transfer-out, item, qty, unit?, store?, to-store? (move), to? (transfer-out: the receiver), condition?, rarity?, mods?}, state lines {set: field, value} or {set: field, add: amount} to change a number by an amount, e.g. a reward of qi +50 (Stats; a level that follows a number, like a stage worked out from qi, can be set with {set: level, value: the level}, which moves the number to the level's lowest value when it is outside it; {set: level, link: \"off\"} unlinks the level from its number (qi beyond the stage, a special constitution, a deficiency) so both move on their own, {set: level, link: \"on\"} links it again), relationship lines {set: \"relation\", with: the character or faction, value: friendly|neutral|hostile, note: a short reason or how things stand now} (one line per person; a later entry changes the standing or the note, so write only what changes in that chapter), log ledgers take the text instead of lines; items, owners and taxonomy values are note names (they become links), anything else stays text (a misc item). Transfers write the receiver's entry by themselves.",
                input_schema: obj({ title: str("A short title for the proposal, e.g. \"Tighten the opening of chapter 3\""), changes: { type: "array", description: "The changes, in order", items: { type: "object", properties: {
                    action: { type: "string", enum: ["create_note", "edit_fields", "edit_text", "add_text", "ledger_entry", "delete_ledger_entry"], description: "create_note: a new data store entry or character; edit_fields: set or remove frontmatter fields; edit_text: replace a passage; add_text: add text after a passage or at the end; ledger_entry: a new entry in an owner's ledger, or one replaced" },
                    collection: str("create_note: the data store collection, or Characters"), novel: str("create_note in Characters, ledger_entry: the novel"), name: str("create_note: the note's name"),
                    owner: str("ledger_entry: whose ledger (a character or other note)"), ledger: str("ledger_entry: the ledger type, e.g. Inventory, Stats, Relationships, Journal"), chapter: { type: "number", description: "ledger_entry: the chapter it happens in" },
                    title: str("ledger_entry: the entry's title, e.g. \"Looted the cultist\""), lines: { type: "array", items: { type: "object" }, description: "ledger_entry: the entry's lines (see the tool description). Relationships ledger: {set: \"relation\", with, value: friendly|neutral|hostile, note}" },
                    entry: str("ledger_entry: the key of an existing entry to change (e.g. \"13.2\"; what you leave out of chapter, title, lines and text stays as it is), leave out for a new entry; delete_ledger_entry: the key of the entry to delete"),
                    fields: { type: "object", description: "create_note: frontmatter fields (links as \"[[Name]]\", lists as arrays)" },
                    note: str("edit_*/add_text: the note's path or name"), set: { type: "object", description: "edit_fields: field: new value" }, unset: { type: "array", items: { type: "string" }, description: "edit_fields: fields to remove" },
                    find: str("edit_text: the exact current text, occurring once in the note"), replace: str("edit_text: what replaces it"),
                    after: str("add_text: the exact passage to add after (leave out for the end)"), text: str("create_note: the note's text (markdown); add_text: the text to add; ledger_entry: a log entry's text"),
                }, required: ["action"] } } }, ["changes"]) },
            { name: "current_view", description: "What the user has on screen right now: the page, what the side drawer and the chapter writer show, and the text they have selected. Use it when they say \"this\", \"here\" or \"the selection\".",
                input_schema: obj({}) },
        ];
    }

    // ------------------------------------------------------------ running

    /** {text, summary} for the tool call; errors become {error} */
    run(name, input, { view } = {}) {
        try {
            const fn = this[`t_${name}`];
            if (!fn) throw fail(`Unknown tool ${name}`);
            const out = fn.call(this, input ?? {}, { view });
            return { text: cap(out.text), summary: out.summary };
        } catch (e) {
            if (!e.toolError) console.error(e);
            return { error: e.toolError ? e.message : `The tool failed: ${e.message}` };
        }
    }

    t_search({ query, kind, novel, limit = 15 }) {
        const { search } = this.ctx();
        const folder = novel ? this.novel(novel).folder : undefined;
        const r = search.run({ q: query, kind, novel: folder, limit: 200 });
        const hits = r.results.filter((h) => this.inScope(h.path)).slice(0, Math.min(40, Math.max(1, limit)));
        const lines = hits.map((h) => `- ${h.path} [${h.kind}${h.chapter != null ? ` ${h.chapter}` : ""}${h.novelName ? `, ${h.novelName}` : ""}]${h.title ? ` "${h.title}"` : ""}${h.matches > 1 ? ` (${h.matches} matches)` : ""}${h.snippet ? `\n  ${h.snippet}` : ""}`);
        return { text: hits.length ? `${hits.length} of ${r.total} results\n${lines.join("\n")}` : "No results. Try fewer or different words, or a name's other spelling.", summary: `Searched "${query}" · ${hits.length} results` };
    }

    t_novel_overview({ novel }) {
        const { plans, novels, vault } = this.ctx();
        const n = this.novel(novel);
        const o = plans.overview(n);
        const out = [`# ${n.name} (${n.folder})`];
        if (o.volumes.length) out.push("", "Volumes:", ...o.volumes.map((v) => `- ${v.label}: chapters ${v.start ?? "?"}–${v.end ?? "?"}${v.fm.plot ? `, plot ${linkLabel(String(v.fm.plot))}` : ""}${v.fm.description ? ` · ${String(v.fm.description).slice(0, 200)}` : ""}`));
        out.push("", "Chapters (number. title [written, words | planned]: plan's first line):");
        for (const c of o.chapters) {
            if (c.draft) continue;
            const body = c.notePath ? vault.notes.get(c.notePath)?.body ?? "" : "";
            const first = c.plan.split("\n").map((l) => l.replace(/^[\t -]*-?\s*/, "").trim()).find(Boolean) ?? "";
            out.push(`- ${c.number}. ${c.title || "(untitled)"} [${c.written ? `written, ${words(body)} words` : c.notePath ? "empty note" : "planned"}]${first ? `: ${first.slice(0, 160)}` : ""}`);
        }
        out.push("", `Characters: ${o.characters.map((c) => c.name).join(", ") || "none"}`);
        if (o.plots.length) out.push("", "Plots:", ...o.plots.map((p) => `- ${p.title}${p.rating ? ` (${p.rating.title})` : ""}`));
        out.push("", `Latest chapter: ${novels.latestChapter(n)}`);
        return { text: out.join("\n"), summary: `Read the overview of ${n.name}` };
    }

    t_read_chapter({ novel, chapter, what = "text", page = 1 }) {
        const { plans, vault } = this.ctx();
        const n = this.novel(novel);
        const c = plans.chapters(n).find((x) => x.number === Number(chapter));
        if (!c) throw fail(`${n.name} has no chapter ${chapter} (no note and no plan).`);
        const out = [`# Chapter ${c.number}: ${c.title || "(untitled)"}`];
        if (what !== "text") out.push("", "## Plan", c.plan.trim() || "(no plan)");
        let summary = `Read chapter ${c.number}${what === "plan" ? " (plan)" : ""}`;
        if (what !== "plan") {
            const body = c.notePath ? (vault.notes.get(c.notePath)?.body ?? "").trim() : "";
            if (!body) out.push("", "(no text written yet)");
            else {
                const pages = [];
                let cur = "";
                for (const para of body.split(/\n{2,}/)) { if (cur && cur.length + para.length > PAGE) { pages.push(cur); cur = ""; } cur += (cur ? "\n\n" : "") + para; }
                if (cur) pages.push(cur);
                const p = Math.min(Math.max(1, page), pages.length);
                out.push("", `## Text (page ${p} of ${pages.length}, ${words(body)} words in all)`, pages[p - 1]);
                if (pages.length > 1) summary += ` · page ${p} of ${pages.length}`;
            }
        }
        return { text: out.join("\n"), summary };
    }

    t_read_note({ note, sections }) {
        const n = this.note(note);
        const out = [`# ${n.fm.title || n.name} (${n.path})`, ...fieldLines(n.fm)];
        const body = n.body.trim();
        if (body) {
            const parsed = parseSections(n.body);
            const parts = [{ title: "", text: parsed.pre ?? "" }, ...(parsed.sections ?? []).map((s) => ({ title: s.title, text: s.text }))];
            const want = sections?.length ? new Set(sections.map((s) => s.toLowerCase().trim())) : null;
            if (!want && body.length <= 8000) out.push("", body);
            else {
                const titles = parts.filter((p) => p.title).map((p) => p.title);
                for (const p of parts) if ((want ? want.has(p.title.toLowerCase()) : p.title === "") && p.text.trim()) out.push("", p.title ? `## ${p.title}` : "", p.text.trim());
                if (titles.length) out.push("", `Sections: ${titles.join(" · ")}`);
            }
        }
        return { text: out.join("\n"), summary: `Read ${n.fm.title || n.name}${sections?.length ? ` (${sections.join(", ")})` : ""}` };
    }

    t_query_collection({ collection, where = {}, text, fields, limit = 30, offset = 0 }) {
        const { vault, store } = this.ctx();
        const schema = store.schema().collections ?? {};
        const col = Object.keys(schema).find((c) => c.toLowerCase() === String(collection).toLowerCase().trim());
        if (!col) throw fail(`No collection "${collection}". Collections: ${Object.keys(schema).join(", ")}`);
        const spec = schema[col];
        const plain = (v) => (Array.isArray(v) ? v.map(plain).join(", ") : linkLabel(String(v ?? "")));
        const tw = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const rows = vault.inFolder(`${DS}/${col}`).filter((n) => {
            for (const [k, v] of Object.entries(where)) if (!plain(n.fm[k]).toLowerCase().includes(String(v).toLowerCase().replace(/^\[\[|\]\]$/g, ""))) return false;
            if (tw.length) { const hay = `${n.name} ${JSON.stringify(n.fm)} ${n.body}`.toLowerCase(); if (!tw.every((w) => hay.includes(w))) return false; }
            return true;
        }).sort((a, b) => String(a.fm.title || a.name).localeCompare(String(b.fm.title || b.name)));
        const keys = fields?.length ? fields : ["description", ...fieldsOf(spec).map(([k]) => k).filter((k) => !["title", "description", "images", "created", "genre", "novels", "type", "aliases", "status"].includes(k)).slice(0, 5)];
        const n = Math.min(100, Math.max(1, limit));
        const shown = rows.slice(offset, offset + n);
        const lines = shown.map((r) => `- ${r.fm.title || r.name}${r.fm.title && r.fm.title !== r.name ? ` [[${r.name}]]` : ""}: ${keys.map((k) => [k, plain(r.fm[k])]).filter(([, v]) => v).map(([k, v]) => `${k}=${v.length > 200 ? `${v.slice(0, 200)}…` : v}`).join("; ")}`);
        return { text: `${rows.length} rows in ${col}${rows.length > shown.length ? `, showing ${offset + 1}–${offset + shown.length}` : ""}\n${lines.join("\n")}`, summary: `Listed ${col} · ${rows.length} rows` };
    }

    t_schema({ collection }) {
        const { store } = this.ctx();
        const schema = store.schema().collections ?? {};
        if (!collection) return { text: Object.entries(schema).map(([c, s]) => `- ${c}${s.label ? ` (${s.label})` : ""}`).join("\n"), summary: "Read the collection list" };
        const col = Object.keys(schema).find((c) => c.toLowerCase() === String(collection).toLowerCase().trim());
        if (!col) throw fail(`No collection "${collection}"`);
        const s = schema[col];
        const lines = fieldsOf(s).map(([k, def]) => `- ${k}${s.links?.[k] ? ` → links to ${[].concat(s.links[k]).join(" or ")}` : ""}${def !== "" && def != null && !(Array.isArray(def) && !def.length) ? ` (default ${JSON.stringify(def)})` : ""}`);
        return { text: `${col}${s.label ? ` (${s.label})` : ""} fields:\n${lines.join("\n")}`, summary: `Read the ${col} fields` };
    }

    t_ledger_entries({ novel, owner, ledger, from, to }) {
        const { novels } = this.ctx();
        const n = this.novel(novel);
        const name = String(owner ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
        let ledgers = novels.ownerLedgers(n, name);
        if (ledger) ledgers = ledgers.filter((l) => l.type.toLowerCase() === String(ledger).toLowerCase().trim());
        if (!ledgers.length) throw fail(`${name} has no ${ledger ? `${ledger} ` : ""}ledger in ${n.name}. Ledger types: ${Object.keys(novels.ledgerTypes(n)).join(", ")}`);
        const lo = from != null ? Number(from) : -Infinity, hi = to != null ? Number(to) : Infinity;
        const out = [`# ${name}'s ledgers (${n.name})`];
        let count = 0;
        for (const l of ledgers) {
            const entries = l.entries.filter((e) => e.chapter >= lo && e.chapter <= hi);
            out.push("", `## ${l.type} (${entries.length} of ${l.entries.length} entries)`);
            for (const e of entries) {
                count++;
                const fields = Object.entries(e.fields).filter(([k]) => !["id", "ref"].includes(k));
                out.push(`### ${e.key} · chapter ${e.chapter}${e.title ? ` · ${e.title}` : ""}${e.fields["mirror-of"] ? " (mirrored transfer: change the giving entry)" : ""}`);
                if (fields.length) out.push(`fields: ${fields.map(([k, v]) => `${k}=${v}`).join(", ")}`);
                for (const ln of e.lines) out.push(`- ${JSON.stringify(ln)}`);
                if (e.body?.trim()) out.push(e.body.trim().slice(0, 1500));
            }
        }
        return { text: out.join("\n"), summary: `Read ${count} ledger entr${count === 1 ? "y" : "ies"} of ${name}` };
    }

    t_character_state({ novel, owner, chapter }) {
        const { novels, vault } = this.ctx();
        const n = this.novel(novel);
        const name = String(owner).replace(/^\[\[|\]\]$/g, "");
        const ledgers = novels.ownerLedgers(n, name);
        const sheet = vault.resolve(`[[${name}]]`);
        if (!ledgers.length && !sheet) throw fail(`No ledgers or note for "${name}" in ${n.name}.`);
        const at = chapter != null ? Number(chapter) : novels.latestChapter(n);
        const out = [`# ${name} at the end of chapter ${at} (${n.name})`];
        if (sheet && this.inScope(sheet)) out.push(...fieldLines(vault.notes.get(sheet).fm, ["inventory"]).slice(0, 30));
        for (const l of ledgers) {
            const c = novels.compute(n, l, { at });
            out.push("", `## ${l.type} (${c.behaviour})`);
            if (c.behaviour === "stock") out.push(...(c.stacks.length ? c.stacks.map((s) => `- ${s.qtyText} ${s.itemName}${s.store.toLowerCase() !== "inventory" ? ` @ ${s.store}` : ""}${s.condition ? `, ${s.condition}` : ""}${s.rarity ? `, ${s.rarity}` : ""}${s.mods?.length ? `, mods: ${s.mods.join("; ")}` : ""}`) : ["(holds nothing)"]));
            if (c.behaviour === "state") {
                const rel = foldRelations(l.entries, { until: at }), plain = c.values.filter((v) => !v.with);
                if (plain.length || !rel.length) out.push(...(plain.length ? plain.map((v) => `- ${v.field}: ${v.value} (since ch. ${v.chapter})`) : ["(nothing set)"]));
                if (rel.length) out.push("Relationships (standing: note, last changed):", ...rel.map((r) => `- ${r.withName}: ${r.status || "no standing"}${r.note ? ` · ${r.note}` : ""} (ch. ${r.chapter})`));
            }
            const recent = l.entries.filter((e) => e.chapter <= at).slice(-8);
            if (recent.length) out.push("Latest entries (key: title):", ...recent.map((e) => `- ${e.key}${e.fields["mirror-of"] ? " (mirrored transfer)" : ""}: ${e.title}${c.behaviour === "log" && e.body ? ` · ${e.body.trim().slice(0, 300)}` : ""}`));
        }
        return { text: out.join("\n"), summary: `Read ${name}'s ledgers at chapter ${at}` };
    }

    t_world_tree({ world, under }) {
        const { worlds } = this.ctx();
        const list = worlds.list().worlds;
        if (!world) return { text: list.map((w) => `- ${w.title}: ${w.count} locations${w.novels.length ? `, for ${w.novels.map((x) => x.name).join(", ")}` : ""}${w.description ? ` · ${String(w.description).slice(0, 200)}` : ""}`).join("\n") || "No worlds yet.", summary: "Listed the worlds" };
        const w = list.find((x) => x.title.toLowerCase() === String(world).toLowerCase() || x.name.toLowerCase() === String(world).toLowerCase());
        if (!w) throw fail(`No world "${world}". Worlds: ${list.map((x) => x.title).join(", ")}`);
        const locs = worlds.locations(w.path);
        const kids = new Map();
        for (const l of locs) { const k = l.parent ?? "-"; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(l); }
        for (const v of kids.values()) v.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
        const out = [];
        const walk = (key, depth) => { for (const l of kids.get(key) ?? []) { out.push(`${"  ".repeat(depth)}- ${l.title}${l.scale ? ` (${l.scale})` : ""}${l.description ? `: ${String(l.description).slice(0, 120)}` : ""}`); walk(l.path, depth + 1); } };
        const start = under ? locs.find((l) => l.title.toLowerCase() === String(under).toLowerCase() || l.name.toLowerCase() === String(under).toLowerCase()) : null;
        if (under && !start) throw fail(`No location "${under}" in ${w.title}`);
        if (start) { out.push(`- ${start.title}${start.scale ? ` (${start.scale})` : ""}`); walk(start.path, 1); } else walk("-", 0);
        return { text: `# ${w.title}: ${locs.length} locations\n${out.join("\n")}`, summary: `Read the ${w.title} outline` };
    }

    t_taxonomy({ facet }) {
        const { vault, store } = this.ctx();
        const cols = Object.keys(store.schema().collections ?? {}).filter((c) => c.startsWith("Taxonomy/"));
        const col = cols.find((c) => c.slice(9).toLowerCase() === String(facet).toLowerCase().trim());
        if (!col) throw fail(`No facet "${facet}". Facets: ${cols.map((c) => c.slice(9)).join(", ")}`);
        const vals = vault.inFolder(`${DS}/${col}`).sort((a, b) => (Number(a.fm.class) || 0) - (Number(b.fm.class) || 0) || a.name.localeCompare(b.name));
        return { text: `${col.slice(9)} (${vals.length} values${vals.some((v) => v.fm.ordered) ? ", ranked by class" : ""}):\n${vals.map((v) => `- ${v.name}${v.fm.title && v.fm.title !== v.name ? ` "${v.fm.title}"` : ""}${v.fm.parent ? ` (under ${linkLabel(String(v.fm.parent))})` : ""}${v.fm.class != null && v.fm.class !== "" ? ` class ${v.fm.class}` : ""}${v.fm.description ? `: ${String(v.fm.description).slice(0, 140)}` : ""}`).join("\n")}`, summary: `Read the ${col.slice(9)} values` };
    }

    t_current_view(_, { view }) {
        if (!view) return { text: "Nothing is known about the screen.", summary: "Looked at the screen" };
        const lines = [`Page: ${view.page ?? "?"}`];
        if (view.drawer) lines.push(`Side drawer shows: ${view.drawer}`);
        if (view.writer) lines.push(`Chapter writer: ${view.writer}`);
        if (view.selection) lines.push("", "Selected text:", view.selection);
        return { text: lines.join("\n"), summary: "Looked at what's on screen" };
    }
}

/** Is this input acceptable for this tool's schema? (types and required fields; inputs may arrive truncated) */
export function checkInput(schema, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return "input is not an object";
    for (const k of schema.required ?? []) if (input[k] == null || input[k] === "") return `missing ${k}`;
    for (const [k, v] of Object.entries(input)) {
        const s = schema.properties?.[k];
        if (!s) return `unknown field ${k}`;
        const ok = s.type === "string" ? typeof v === "string" : s.type === "integer" ? Number.isInteger(v) : s.type === "number" ? typeof v === "number" : s.type === "array" ? Array.isArray(v) : s.type === "object" ? v && typeof v === "object" && !Array.isArray(v) : true;
        if (!ok) return `${k} should be ${s.type}`;
        if (s.enum && !s.enum.includes(v)) return `${k} should be one of ${s.enum.join(", ")}`;
    }
    return null;
}
