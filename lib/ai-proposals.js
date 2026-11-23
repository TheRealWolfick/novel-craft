// Changes the assistant proposes: nothing is written until the user approves it in the review panel (the side drawer's
// viewer, #/proposal/<id>), change by change or all at once. Each change is checked when proposed (the note exists and
// is in scope, the text to replace occurs exactly once, the name is free…) and again when applied, and is written
// through the same functions the app's own editors use (createNote / patchNote; ledger entries through novels.saveEntry,
// like the ledger editor, so sequence numbers, mirrored transfers and character sheets follow).
import crypto from "node:crypto";
import { DS } from "./vault.js";
import { patchNote, sanitizeName, uniqueName } from "./write.js";
import { previewEntry } from "./ledger-preview.js";
import { RELATION_STATUSES } from "./ledger.js";
import { renderMarkdown } from "./render.js";
import { parseLevels } from "../public/levels.js";

const KEEP = 60;
const fail = (message) => Object.assign(new Error(message), { toolError: true });
const plain = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export class Proposals {
    /** @param ctx () => services of the open vault; @param tools AiTools (scope and note lookup) */
    constructor(ctx, tools) { this.ctx = ctx; this.tools = tools; this.all = new Map(); }

    /** A note the assistant may change: in scope, and not a config, ledger or creature-stats note (those have their own editors) */
    editable(ref) {
        const n = this.tools.note(ref);
        if (n.path.endsWith("/config.md") || n.fm.type === "config") throw fail(`${n.name} is a novel's settings note; change it on the novel page`);
        if (n.fm.type === "ledger") throw fail(`${n.name} is a ledger; ledger entries are made in the ledger editor`);
        return n;
    }

    /** Check one change and describe it for the review panel; throws with a message the model can act on */
    prepare(c, reserved) {
        const { vault, store, novels, stats } = this.ctx();
        switch (c.action) {
            case "create_note": {
                const name = sanitizeName(c.name);
                if (!name) throw fail("create_note needs a name");
                const fields = c.fields && typeof c.fields === "object" ? c.fields : {};
                if (String(c.collection).toLowerCase() === "characters") {
                    const novel = this.tools.novel(c.novel ?? "");
                    if (vault.nameTaken(name) || reserved.has(name.toLowerCase())) throw fail(`A note named "${name}" already exists; choose another name or edit that note`);
                    reserved.add(name.toLowerCase());
                    return { action: "create_note", kind: "character", novel: novel.folder, name, path: `${novel.charactersFolder}/${name}.md`, fields, text: String(c.text ?? "") };
                }
                const cols = store.schema().collections ?? {};
                const col = Object.keys(cols).find((k) => k.toLowerCase() === String(c.collection ?? "").toLowerCase().trim());
                // a taxonomy that doesn't exist yet is made with create_facet (a model with an older copy of this tool's
                // description may try create_note first)
                if (!col && /^taxonomy\//i.test(String(c.collection ?? "").trim())) throw fail(`There is no taxonomy "${String(c.collection).trim().slice(9)}" yet. Make it with {action: "create_facet", name: "${String(c.collection).trim().slice(9)}", levels?, values?, power_systems?} (its values can come in the same change), then add notes to it`);
                if (!col) throw fail(`No collection "${c.collection}". Use one of: Characters (with novel), ${Object.keys(cols).join(", ")}. A new taxonomy is made with create_facet`);
                const final = uniqueName(vault, name, cols[col].label ?? col, reserved);
                reserved.add(final.toLowerCase());
                return { action: "create_note", kind: "data", collection: col, name: final, path: `${DS}/${col}/${final}.md`, fields, text: String(c.text ?? ""), renamed: final !== name };
            }
            case "edit_fields": {
                const n = this.editable(c.note);
                const set = c.set && typeof c.set === "object" ? c.set : {};
                const unset = Array.isArray(c.unset) ? c.unset.map(String) : [];
                if (!Object.keys(set).length && !unset.length) throw fail("edit_fields needs set or unset");
                const problems = stats.checkPatch(n.path, set);
                if (problems.length) throw fail(`${n.name}: ${problems.join("; ")}`);
                try { this.ctx().chapters?.checkPatch(n.path, { set, unset }); } catch (e) { throw fail(`${n.name}: ${e.message}`); }
                const rows = [...Object.entries(set).map(([k, v]) => ({ key: k, before: plain(n.fm[k]), after: plain(v) })), ...unset.map((k) => ({ key: k, before: plain(n.fm[k]), after: "", removed: true }))];
                return { action: "edit_fields", path: n.path, name: n.fm.title || n.name, set, unset, rows };
            }
            case "edit_text": {
                const n = this.editable(c.note);
                const find = String(c.find ?? ""), replace = String(c.replace ?? "");
                if (!find) throw fail("edit_text needs the exact text to find");
                const count = n.body.split(find).length - 1;
                if (count !== 1) throw fail(`${n.name}: the text to replace occurs ${count} times; quote a longer passage so it occurs exactly once (copy it exactly, with its markdown)`);
                return { action: "edit_text", path: n.path, name: chapterLabel(n, novels) ?? (n.fm.title || n.name), find, replace, context: around(n.body, find) };
            }
            case "add_text": {
                const n = this.editable(c.note);
                const text = String(c.text ?? "").trim();
                if (!text) throw fail("add_text needs the text to add");
                if (c.after) {
                    const count = n.body.split(String(c.after)).length - 1;
                    if (count !== 1) throw fail(`${n.name}: the passage to add after occurs ${count} times; quote it exactly so it occurs once`);
                }
                return { action: "add_text", path: n.path, name: chapterLabel(n, novels) ?? (n.fm.title || n.name), after: c.after ? String(c.after) : null, text, context: c.after ? around(n.body, String(c.after)) : n.body.trim().slice(-300) };
            }
            case "ledger_entry": return this.ledgerEntry(c);
            case "delete_ledger_entry": return this.deleteLedgerEntry(c);
            case "create_facet": case "add_facet_values": case "set_facet_systems": case "remove_facet": case "link_facet_system": case "unlink_facet_system": return this.facetChange(c, reserved);
            default: throw fail(`Unknown action "${c.action}"`);
        }
    }

    /**
     * Taxonomy facets (categories, ranked lists, levels of a power system): a new facet with its values, values added to
     * one, the power systems a facet's values belong to, or a facet removed (its values to the vault's .trash). Checked
     * like the app's own taxonomy dialog; written with the same DataStore functions.
     */
    facetChange(c, reserved) {
        const { store } = this.ctx();
        const cols = store.schema().collections ?? {};
        const facetOf = (v) => {
            const want = String(v ?? "").trim().replace(/^Taxonomy\//i, "").toLowerCase();
            const col = Object.keys(cols).find((k) => k.startsWith("Taxonomy/") && (k.slice(9).toLowerCase() === want || String(cols[k].label ?? "").toLowerCase() === want));
            if (!col) throw fail(`No taxonomy "${v}". Taxonomies: ${Object.keys(cols).filter((k) => k.startsWith("Taxonomy/")).map((k) => k.slice(9)).join(", ")}`);
            return col;
        };
        const systems = (v) => {
            const list = [].concat(v ?? []).map(String).filter((x) => x.trim());
            try { store.systemsValue(list); } catch (e) { throw fail(`${e.message} (power_systems are Power Systems notes)`); }
            return list.map((x) => x.replace(/^\[\[|\]\]$/g, "").trim());
        };
        // values: a list of {name, title?, parent?, threshold?}, or text in the taxonomy dialog's format (one per line,
        // "Name (A, B)" / "Name (Layer 1 - 9)" sub-levels, indented lines under the one above, "= 100" a number)
        const valuesOf = (v) => {
            const list = typeof v === "string" ? parseLevels(v)
                : (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? { name: x, title: x } : { name: String(x?.name ?? "").trim(), title: String(x?.title ?? x?.name ?? "").trim(), parent: x?.parent ? String(x.parent).trim() : null, threshold: x?.threshold ?? null }));
            const out = list.filter((x) => sanitizeName(x.name));
            for (const x of out) {
                if (x.threshold != null && x.threshold !== "" && !Number.isFinite(Number(x.threshold))) throw fail(`${x.name}: threshold must be a number`);
                if (reserved.has(sanitizeName(x.name).toLowerCase())) throw fail(`${x.name} is in this proposal twice`);
                reserved.add(sanitizeName(x.name).toLowerCase());
            }
            return out;
        };
        if (c.action === "create_facet") {
            const name = sanitizeName(c.name);
            if (!name) throw fail("create_facet needs a name");
            if (Object.keys(cols).some((k) => k.toLowerCase() === `taxonomy/${name}`.toLowerCase())) throw fail(`There is already a taxonomy called ${name}; add values to it with add_facet_values`);
            const powerSystems = systems(c.power_systems);
            const levels = !!c.levels || powerSystems.length > 0;   // levels of a power system: always levels
            const values = valuesOf(c.values_text ?? c.values);
            return { action: "create_facet", name, collection: `Taxonomy/${name}`, levels, ordered: c.ordered !== false, values, powerSystems };
        }
        const collection = facetOf(c.facet);
        if (c.action === "add_facet_values") {
            const values = valuesOf(c.values_text ?? c.values);
            if (!values.length) throw fail("add_facet_values needs values");
            const levels = cols[collection].fields.some(([k]) => k === "threshold");
            const powerSystems = c.power_systems != null ? systems(c.power_systems) : store.facetSystems(collection);
            return { action: "add_facet_values", collection, levels, values, powerSystems, existing: store.vault.inFolder(`${DS}/${collection}`).length };
        }
        if (c.action === "link_facet_system" || c.action === "unlink_facet_system") {
            const [system] = systems(c.power_system);
            if (!system) throw fail(`${c.action} needs power_system`);
            const linked = c.action === "link_facet_system";
            const from = linked && c.instead_of ? facetOf(c.instead_of) : null;
            const before = store.facetSystems(collection);
            const has = before.some((x) => x.toLowerCase() === system.toLowerCase());
            if (linked && has && !from) throw fail(`${collection.slice(9)} already belongs to ${system}`);
            if (!linked && !has) throw fail(`${collection.slice(9)} doesn't belong to ${system}; it belongs to ${before.join(", ") || "no power system"}`);
            const after = linked ? (has ? before : [...before, system]) : before.filter((x) => x.toLowerCase() !== system.toLowerCase());
            return { action: c.action, collection, system, from, before, after, fromBefore: from ? store.facetSystems(from) : null, count: store.vault.inFolder(`${DS}/${collection}`).length };
        }
        if (c.action === "set_facet_systems") {
            const powerSystems = systems(c.power_systems);
            return { action: "set_facet_systems", collection, before: store.facetSystems(collection), powerSystems, count: store.vault.inFolder(`${DS}/${collection}`).length };
        }
        let r;
        try { r = store.facetRemoval(collection); } catch (e) { throw fail(e.message); }
        if (r.blocked) throw fail(`${collection.slice(9)} can't be removed. ${r.blocked}`);
        return { action: "remove_facet", collection, values: r.values.map((v) => v.title), linkedFrom: r.linkedFrom.map((n) => n.name) };
    }

    /**
     * A new ledger entry, or a whole existing one replaced (`replace`: its key, e.g. "13.2"): checked like the ledger
     * editor's save (stat rules), with its callout and what it does to the holdings for the review panel
     */
    ledgerEntry(c) {
        const { vault, novels, stats } = this.ctx();
        const novel = this.tools.novel(c.novel ?? "");
        const types = novels.ledgerTypes(novel);
        const type = Object.keys(types).find((t) => t.toLowerCase() === String(c.ledger ?? "").toLowerCase().trim());
        if (!type) throw fail(`No ledger type "${c.ledger}" in ${novel.name}. Types: ${Object.keys(types).join(", ")}`);
        const behaviour = types[type].behaviour;
        const withTarget = type === "Relationships" || !!types[type]["with-target"];
        const bare = (v) => String(v ?? "").trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
        const ownerRef = bare(c.owner);
        if (!ownerRef) throw fail("ledger_entry needs the owner (a character or other note)");
        const ownerPath = vault.resolve(`[[${ownerRef}]]`);
        const owner = ownerPath ? vault.notes.get(ownerPath).name : ownerRef;
        const ledger = novels.ownerLedgers(novel, owner).find((l) => l.type === type);
        if (!ownerPath && !ledger) throw fail(`No note or ledger for "${ownerRef}"; ledgers belong to a note (make the character first)`);
        let old = null;
        // the entry to change: `entry` (or `replace`, the older name) is its key
        const editKey = c.entry != null && c.entry !== "" ? c.entry : c.replace;
        if (editKey != null && editKey !== "") {
            old = ledger?.entries.find((e) => e.key === String(editKey).trim());
            if (!old) throw fail(`${owner} has no ${type} entry ${editKey}. Entries: ${(ledger?.entries ?? []).map((e) => `${e.key} ${e.title}`).slice(-20).join("; ") || "none"}`);
            if (old.fields["mirror-of"]) throw fail(`Entry ${old.key} mirrors a transfer from another ledger; change the giving entry instead`);
            // an edit: what it doesn't give (chapter, title, lines, text) stays as the entry has it
            if (c.chapter == null || c.chapter === "") c = { ...c, chapter: old.chapter };
            if (c.title == null) c = { ...c, title: old.title };
            if (!Array.isArray(c.lines)) c = { ...c, lines: old.lines };
            if (c.text == null) c = { ...c, text: old.body };
        }
        const chapter = Number(c.chapter);
        if (!Number.isFinite(chapter) || chapter < 0) throw fail("ledger_entry needs the chapter number");
        // a note's name becomes a link; anything else stays text (misc items, store names)
        const link = (v) => { const b = bare(v); if (!b) return ""; const p = vault.resolve(`[[${b}]]`); return p ? `[[${vault.notes.get(p).name}]]` : b; };
        const STOCK = ["add", "remove", "move", "transfer-out"];
        const lines = (Array.isArray(c.lines) ? c.lines : []).map((l, i) => {
            if (!l || typeof l !== "object") throw fail(`Line ${i + 1} is not an object`);
            if (behaviour === "stock") {
                const action = String(l.action ?? "add").toLowerCase();
                if (!STOCK.includes(action)) throw fail(`Line ${i + 1}: action must be one of ${STOCK.join(", ")} (transfer-in lines are written for the receiver by themselves)`);
                if (!bare(l.item)) throw fail(`Line ${i + 1} needs an item`);
                const qty = l.qty == null || l.qty === "" ? 1 : Number(l.qty);
                if (!Number.isFinite(qty) || qty <= 0) throw fail(`Line ${i + 1}: qty must be a positive number`);
                if (action === "transfer-out" && !bare(l.to)) throw fail(`Line ${i + 1}: a transfer-out needs "to" (who receives it)`);
                if (action === "move" && !String(l["to-store"] ?? "").trim()) throw fail(`Line ${i + 1}: a move needs "to-store"`);
                const mods = Array.isArray(l.mods) ? l.mods : l.mods ? String(l.mods).split(";") : [];
                return Object.fromEntries(Object.entries({
                    action, item: link(l.item), qty: String(qty), unit: l.unit ? String(l.unit) : "", condition: link(l.condition), rarity: link(l.rarity),
                    mods: mods.map((m) => (/^\s*\[\[/.test(m) ? link(m) : String(m).trim())).filter(Boolean).join("; "),
                    store: l.store ? String(l.store) : "", "to-store": l["to-store"] ? String(l["to-store"]) : "", to: l.to ? link(l.to) : "", note: l.note ? String(l.note) : "",
                }).filter(([, v]) => v !== ""));
            }
            if (behaviour === "state") {
                if (!String(l.set ?? "").trim()) throw fail(`Line ${i + 1} needs "set" (the field) and "value"`);
                // relationships: a standing (friendly, neutral, hostile) and a short note, never free text as the value
                if (l.with || withTarget) {
                    if (!bare(l.with)) throw fail(`Line ${i + 1}: a relationship line needs "with" (the character or faction)`);
                    const status = String(l.value ?? "").trim().toLowerCase();
                    if (status && !RELATION_STATUSES.includes(status)) throw fail(`Line ${i + 1}: a relationship's value is its standing, one of ${RELATION_STATUSES.join(", ")} (or leave it out to change only the note); put the reason or details in "note"`);
                    if (!status && !String(l.note ?? "").trim()) throw fail(`Line ${i + 1}: give the standing (value) or a note`);
                    return Object.fromEntries(Object.entries({ set: "relation", with: link(l.with), value: status, note: plain(l.note ?? "").replace(/(?<![[\]])[[\]](?![[\]])/g, "") }).filter(([, v]) => v !== ""));
                }
                // {set, add}: change a number by an amount ("+50" as the value means the same)
                if (l.add != null && l.add !== "" && !Number.isFinite(Number(l.add))) throw fail(`Line ${i + 1}: "add" must be a number (negative to lower it)`);
                // link: off / on unlinks or links again a level that follows a number (overflow, a special constitution, a deficiency)
                const linkTo = l.link == null || l.link === "" ? "" : /^(off|no|false|unlinked)$/i.test(String(l.link)) || l.link === false ? "off" : "on";
                return Object.fromEntries(Object.entries({ set: String(l.set).trim(), value: l.add != null && l.add !== "" ? "" : plain(l.value), add: l.add != null && l.add !== "" ? String(Number(l.add)) : "", link: linkTo }).filter(([, v]) => v !== ""));
            }
            throw fail(`${type} is a log ledger: put the entry's text in "text", no lines`);
        });
        const text = String(c.text ?? "").trim();
        if (behaviour === "log" && !text) throw fail(`${type} is a log ledger: the entry needs its text in "text"`);
        if (behaviour !== "log" && !lines.length) throw fail("ledger_entry needs at least one line");
        const problems = stats.checkLines(novel, owner, type, lines);
        if (problems.length) throw fail(problems.join("; "));
        const entry = { chapter, title: sanitizeName(String(c.title ?? "")).replace(/^\d+\.\d+\s*/, ""), lines, body: text, fields: c.callout ? { callout: String(c.callout) } : {} };
        const view = previewEntry(this.ctx(), novel, { owner, type, entry, replaceKey: old?.key });
        // what the holdings gain and lose at this chapter
        const stackKey = (x) => [x.store, x.itemName, x.condition ?? "", x.rarity ?? "", [].concat(x.mods ?? []).join(";"), x.unit ?? ""].join("|");
        const holdings = [];
        if (behaviour === "stock") {
            const before = new Map(view.before.map((x) => [stackKey(x), x])), after = new Map(view.after.map((x) => [stackKey(x), x]));
            for (const k of new Set([...before.keys(), ...after.keys()])) {
                const b = before.get(k), a = after.get(k);
                if (b?.qtyText === a?.qtyText) continue;
                const x = a ?? b;
                holdings.push({ item: x.itemName, store: x.store, before: b?.qtyText ?? "", after: a?.qtyText ?? "" });
            }
        }
        const html = (md) => renderMarkdown(md, vault);
        return {
            action: "ledger_entry", novel: novel.folder, novelName: novel.name, owner, ownerPath, type, behaviour, replaceKey: old?.key ?? null, entry,
            name: `${owner} - ${type}`, callout: view.callout, calloutHtml: html(view.callout), beforeHtml: old ? html(novels.callout(novel, ledger, old)) : null,
            holdings, warnings: (view.warnings ?? []).map((w) => w.message), statsHtml: view.stats?.panel ? html(view.stats.panel) : null,
        };
    }

    /**
     * An existing ledger entry deleted (`entry`: its key, e.g. "13.2"); its mirrored transfers in other ledgers go with
     * it. The review panel shows the entry's callout and what the holdings lose or regain.
     */
    deleteLedgerEntry(c) {
        const { vault, novels } = this.ctx();
        const novel = this.tools.novel(c.novel ?? "");
        const types = novels.ledgerTypes(novel);
        const type = Object.keys(types).find((t) => t.toLowerCase() === String(c.ledger ?? "").toLowerCase().trim());
        if (!type) throw fail(`No ledger type "${c.ledger}" in ${novel.name}. Types: ${Object.keys(types).join(", ")}`);
        const ownerRef = String(c.owner ?? "").trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
        if (!ownerRef) throw fail("delete_ledger_entry needs the owner");
        const ownerPath = vault.resolve(`[[${ownerRef}]]`);
        const owner = ownerPath ? vault.notes.get(ownerPath).name : ownerRef;
        const ledger = novels.ownerLedgers(novel, owner).find((l) => l.type === type);
        const key = String(c.entry ?? c.key ?? c.replace ?? "").trim();
        const e = ledger?.entries.find((x) => x.key === key);
        if (!e) throw fail(`${owner} has no ${type} entry ${key || "(no key given)"}. Entries: ${(ledger?.entries ?? []).map((x) => `${x.key} ${x.title}`).slice(-20).join("; ") || "none"}`);
        if (e.fields["mirror-of"]) throw fail(`Entry ${e.key} mirrors a transfer from another ledger; delete the giving entry instead`);
        const mirrors = e.fields.id ? novels.ledgers(novel).flatMap((l) => l.entries.filter((x) => x.fields["mirror-of"] === e.fields.id).map((x) => `${l.owner} - ${l.type} ${x.key}`)) : [];
        const receivers = e.lines.filter((l) => l.action === "transfer-out" && l.to).map((l) => l.to.replace(/^\[\[|\]\]$/g, ""));
        return {
            action: "delete_ledger_entry", novel: novel.folder, novelName: novel.name, owner, ownerPath, type, key: e.key, entryId: e.fields.id ?? null,
            ledgerPath: ledger.path, name: `${owner} - ${type}`, title: e.title, chapter: e.chapter, mirrors, receivers,
            calloutHtml: renderMarkdown(novels.callout(novel, ledger, e), vault),
        };
    }

    /** The propose_changes tool: all changes valid, or none proposed */
    propose(conversation, { title, changes }) {
        if (!Array.isArray(changes) || !changes.length) throw fail("No changes given");
        const reserved = new Set();
        const out = changes.map((c, i) => {
            try { return { ...this.prepare(c, reserved), i, status: "pending" }; } catch (e) { throw fail(`Change ${i + 1}: ${e.message}`); }
        });
        const p = { id: crypto.randomUUID().slice(0, 8), conversation, title: String(title || "Proposed changes"), created: Date.now(), changes: out, reported: false };
        this.all.set(p.id, p);
        while (this.all.size > KEEP) this.all.delete(this.all.keys().next().value);
        return p;
    }

    get(id) {
        const p = this.all.get(id);
        if (!p) throw Object.assign(new Error("This proposal is gone (proposals are kept until the app restarts)"), { status: 404 });
        return p;
    }

    /** Apply pending changes (`which`: an index, or "all"); each one is checked again first */
    async apply(id, which) {
        const p = this.get(id);
        const { store, novels, plans } = this.ctx();
        for (const c of p.changes) {
            if (c.status !== "pending" || (which !== "all" && c.i !== Number(which))) continue;
            try {
                const vault = this.ctx().vault;
                if (c.action === "ledger_entry") {
                    const novel = novels.get(c.novel);
                    if (!novel) throw new Error("The novel is gone");
                    if (c.replaceKey && !novels.ownerLedgers(novel, c.owner).find((l) => l.type === c.type)?.entries.some((e) => e.key === c.replaceKey)) throw new Error(`Entry ${c.replaceKey} is gone or has moved since this was proposed`);
                    const problems = this.ctx().stats.checkLines(novel, c.owner, c.type, c.entry.lines);
                    if (problems.length) throw new Error(problems.join("; "));
                    const r = await novels.saveEntry(novel, { owner: c.owner, type: c.type, entry: structuredClone(c.entry), replaceKey: c.replaceKey ?? undefined, linked: [] });
                    const receivers = c.entry.lines.filter((l) => l.action === "transfer-out" && l.to).map((l) => l.to.replace(/^\[\[|\]\]$/g, ""));
                    for (const o of [c.owner, ...receivers]) await novels.syncSheet(novel, o);
                    c.key = r.entry?.key;
                    c.path = c.ownerPath ?? r.ledger.path;
                } else if (c.action === "delete_ledger_entry") {
                    const novel = novels.get(c.novel);
                    if (!novel) throw new Error("The novel is gone");
                    const ledger = novels.ownerLedgers(novel, c.owner).find((l) => l.type === c.type);
                    const e = ledger?.entries.find((x) => x.key === c.key);
                    if (!e || (c.entryId && e.fields.id !== c.entryId)) throw new Error(`Entry ${c.key} is gone or has moved since this was proposed`);
                    await novels.deleteEntry(novel, ledger.path, c.key);
                    for (const o of [c.owner, ...(c.receivers ?? [])]) await novels.syncSheet(novel, o);
                    c.path = c.ownerPath ?? ledger.path;
                } else if (c.action === "create_facet") {
                    const col = await store.createFacet(c.name, { levels: c.levels, ordered: c.ordered });
                    const paths = c.values.length ? await store.addFacetValues(col, c.values, { powerSystems: c.powerSystems }) : [];
                    c.path = paths[0] ?? null;
                } else if (c.action === "add_facet_values") {
                    const paths = await store.addFacetValues(c.collection, c.values, { powerSystems: c.powerSystems });
                    c.path = paths[0] ?? null;
                } else if (c.action === "set_facet_systems") {
                    await store.setFacetSystems(c.collection, c.powerSystems);
                } else if (c.action === "link_facet_system" || c.action === "unlink_facet_system") {
                    await store.linkFacetSystem(c.collection, c.system, { linked: c.action === "link_facet_system", from: c.from });
                } else if (c.action === "remove_facet") {
                    await store.removeFacet(c.collection);
                } else if (c.action === "create_note") {
                    if (c.kind === "character") {
                        c.path = await novels.createCharacter(novels.get(c.novel), store.schema(), c.name, c.fields);
                        if (c.text) { const n = vault.notes.get(c.path); await patchNote(vault, c.path, { body: `${c.text.trim()}\n\n${n?.body ?? ""}`.replace(/\n{3,}/g, "\n\n") }); }
                    } else c.path = await store.create(c.collection, c.name, c.fields, c.text ? `${c.text.trim()}\n` : "");
                } else {
                    const n = vault.notes.get(c.path);
                    if (!n) throw new Error("The note is gone");
                    if (c.action === "edit_fields") {
                        const { chapters } = this.ctx();
                        chapters?.checkPatch(c.path, c);
                        const before = chapters?.titleOf(c.path);
                        await patchNote(vault, c.path, { set: c.set, unset: c.unset });
                        if (chapters) c.path = (await chapters.afterPatch(c.path, [...Object.keys(c.set), ...c.unset], before)).path;
                    }
                    else if (c.action === "edit_text") {
                        if (n.body.split(c.find).length - 1 !== 1) throw new Error("The text changed since this was proposed");
                        await patchNote(vault, c.path, { body: n.body.replace(c.find, () => c.replace) });
                    } else if (c.action === "add_text") {
                        let body;
                        if (c.after) {
                            if (n.body.split(c.after).length - 1 !== 1) throw new Error("The passage changed since this was proposed");
                            body = n.body.replace(c.after, () => `${c.after}\n\n${c.text}`);
                        } else body = `${n.body.replace(/\s+$/, "")}\n\n${c.text}\n`;
                        await patchNote(vault, c.path, { body });
                    }
                    await plans.afterPatch(c.path);
                }
                c.status = "applied";
                delete c.error;
            } catch (e) {
                c.status = "failed";
                c.error = e.message;
            }
            p.reported = false;
        }
        return p;
    }

    reject(id, which) {
        const p = this.get(id);
        for (const c of p.changes) if (c.status === "pending" && (which === "all" || c.i === Number(which))) { c.status = "rejected"; p.reported = false; }
        return p;
    }

    /** What the user decided since the model last heard, for the next message of that conversation (one line each) */
    report(conversation) {
        const lines = [];
        for (const p of this.all.values()) {
            if (p.conversation !== conversation || p.reported) continue;
            const by = (s) => p.changes.filter((c) => c.status === s).map((c) => c.i + 1);
            const parts = [["applied", by("applied")], ["rejected", by("rejected")], ["failed", by("failed")], ["still waiting", by("pending")]].filter(([, l]) => l.length).map(([k, l]) => `${k}: ${l.join(", ")}`);
            lines.push(`Review of "${p.title}": ${parts.join("; ")}${p.changes.some((c) => c.error) ? ` (${p.changes.filter((c) => c.error).map((c) => `change ${c.i + 1}: ${c.error}`).join("; ")})` : ""}`);
            if (!p.changes.some((c) => c.status === "pending")) p.reported = true;
        }
        return lines;
    }
}

function chapterLabel(n, novels) {
    const novel = novels.list().find((x) => n.path.startsWith(`${x.chaptersFolder}/`));
    if (!novel) return null;
    const num = n.fm.chapter ?? /^(\d+(?:\.\d+)?)/.exec(n.name)?.[1];
    return `${novel.name}, chapter ${num}`;
}

/** The paragraph(s) around a passage, for showing the change in place */
function around(body, find) {
    const at = body.indexOf(find);
    const s = body.lastIndexOf("\n\n", at);
    const start = s < 0 ? 0 : s + 2;
    let end = body.indexOf("\n\n", at + find.length);
    if (end < 0) end = body.length;
    return { before: body.slice(start, at), after: body.slice(at + find.length, end) };
}
