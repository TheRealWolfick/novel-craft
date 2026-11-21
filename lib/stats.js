// Character and creature stats: per-novel stat templates (config.md `stat-templates`), values over chapters from
// state ledgers, typed checks, sheet sync and stats panels. Field rules live in public/stats-core.js.
import { linkLabel, DS } from "./vault.js";
import { createNote, patchNote, sanitizeName, uniqueName } from "./write.js";
import { asCallout, renderTemplate } from "./template.js";
import {
    normalizeTemplates, serializeTemplate, checkTemplate, checkValue, fromText, computeValues, displayValue, panelData, defaultPanel, builtinPanel, fieldNamed, namesField, isDerived, isChange, applyChange, facetChoice, stateFrom, replayLine, valuesFromState, sourceOf, optionOf, UNLINKED,
} from "../public/stats-core.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

export class Stats {
    constructor(vault, novels, store) { this.vault = vault; this.novels = novels; this.store = store; }

    templates(novel) {
        return this.withFacets(normalizeTemplates(novel.config["stat-templates"]));
    }

    /**
     * Choice fields with a taxonomy facet get its values as options (class order, then name; `depth` top = values
     * without a parent, bottom = values without sub-levels) and the values' own numbers as `noteThresholds`
     * (a value without one starts where its first sub-level does).
     */
    withFacets(templates) {
        for (const t of Object.values(templates)) for (const f of t.fields) if (f.type === "choice" && f.facet) Object.assign(f, this.facetValues(f.facet, f.depth));
        return templates;
    }
    facetValues(facet, depth = "all") {
        return facetChoice(this.vault.inFolder(`${DS}/Taxonomy/${facet}`), depth, (l) => this.vault.resolve(String(l)));
    }

    defaultTemplate(novel) {
        return Object.values(this.templates(novel)).find((t) => t.default) ?? null;
    }

    creaturesFolder(novel) {
        return `${novel.folder}/${novel.config["creatures-folder"] ?? "Creatures"}`;
    }

    /** Characters (sheets) and creature stat notes of a novel, with their template name */
    holders(novel) {
        const def = this.defaultTemplate(novel)?.name ?? null;
        const chars = this.novels.characters(novel).map((n) => ({ kind: "character", path: n.path, name: n.name, template: n.fm["stat-template"] || def, assigned: !!n.fm["stat-template"] }));
        const creatures = this.vault.inFolder(this.creaturesFolder(novel)).filter((n) => n.fm.type === "creature-stats").map((n) => ({
            kind: "creature", path: n.path, name: n.name, template: n.fm["stat-template"] || null, assigned: !!n.fm["stat-template"],
            creature: n.fm.creature ?? null, creaturePath: n.fm.creature ? this.vault.resolve(n.fm.creature) : null,
        }));
        return [...chars, ...creatures];
    }

    holder(novel, owner) {
        const p = this.vault.resolve(owner);
        return this.holders(novel).find((h) => h.path === p || h.name.toLowerCase() === String(owner).toLowerCase()) ?? null;
    }

    /**
     * {key: {value, chapter, entry}} set by the owner's state ledgers (lines without a "with" target), up to `at`.
     * Lines are replayed in story order (`replayLine`), whatever name they use for a field: a change (`[add:: 50]`)
     * adds to the value before it (starting from `base`, the sheet's value), setting a level that follows a number
     * moves the number to the level's lowest value, and `[link:: off]` / `[link:: on]` unlink and link a level.
     * Also gives the levels unlinked at `at` and their values.
     */
    ledgerValues(novel, owner, template, at = Infinity, base = {}) {
        const types = this.novels.ledgerTypes(novel);
        const out = {}, managed = new Set();
        const st = stateFrom(template, base);
        const entries = this.novels.ownerLedgers(novel, owner).filter((l) => types[l.type]?.behaviour === "state").flatMap((l) => l.entries)
            .sort((a, b) => a.chapter - b.chapter || a.seq - b.seq);
        for (const e of entries) for (const line of e.lines) {
            const f = line.set && !line.with && fieldNamed(template, line.set);
            if (!f) continue;
            managed.add(f.key);
            const src = sourceOf(template, f);
            if (src && String(line.value ?? "").trim()) managed.add(src.key);
            if (e.chapter > at) continue;
            for (const k of replayLine(template, st, line)) out[k] = { chapter: e.chapter, entry: e.key };
        }
        const typed = valuesFromState(template, st);
        for (const k of Object.keys(out)) out[k].value = typed[k];
        return { values: out, managed, unlinked: Object.keys(st.unlinked), manual: st.manual };
    }

    /**
     * Stat values of a holder at a chapter. A field a ledger ever sets takes its value from the ledger (empty before
     * its first entry, unless it has a prefill source); other fields read the sheet, then the prefill source field.
     */
    valuesAt(novel, holder, template, at = Infinity) {
        const note = this.vault.notes.get(holder.path);
        const fm = note?.fm ?? {};
        // what the sheet (or its prefill source) says: the start for ledger changes
        const base = {}, baseOrigin = {};
        for (const f of template.fields) {
            if (isDerived(f)) continue;
            if (fm[f.key] != null && fm[f.key] !== "") { base[f.key] = fromText(f, fm[f.key]); baseOrigin[f.key] = { from: "sheet" }; }
            else if (f.source && fm[f.source] != null && fm[f.source] !== "") { base[f.key] = fromText(f, fm[f.source]); baseOrigin[f.key] = { from: "source", field: f.source }; }
        }
        const led = holder.kind === "creature" ? { values: {}, managed: new Set(), unlinked: [], manual: {} } : this.ledgerValues(novel, holder.name, template, at, base);
        const managed = led.managed;
        const values = {}, origin = {};
        for (const f of template.fields) {
            if (isDerived(f)) continue;
            if (led.values[f.key]) { values[f.key] = led.values[f.key].value; origin[f.key] = { from: "ledger", chapter: led.values[f.key].chapter, entry: led.values[f.key].entry }; continue; }
            if (!managed.has(f.key) && baseOrigin[f.key]?.from === "sheet") { values[f.key] = base[f.key]; origin[f.key] = baseOrigin[f.key]; continue; }
            if (f.source && fm[f.source] != null && fm[f.source] !== "") { values[f.key] = fromText(f, fm[f.source]); origin[f.key] = { from: "source", field: f.source }; continue; }
            values[f.key] = fromText(f, null);
        }
        // levels unlinked from their number keep the level they were given
        if (led.unlinked.length) {
            values[UNLINKED] = led.unlinked;
            for (const k of led.unlinked) { values[k] = led.manual[k] ?? ""; origin[k] = { from: "ledger", unlinked: true, ...(led.values[k] ? { chapter: led.values[k].chapter, entry: led.values[k].entry } : {}) }; }
        }
        return { values: computeValues(template, values), origin, managed: [...managed] };
    }

    describeLink(link) {
        const p = this.vault.resolve(link);
        const n = p && this.vault.notes.get(p);
        return n ? { title: String(n.fm.title || n.name), description: String(n.fm.description ?? "") } : null;
    }

    resolveForCheck = (v) => { const p = this.vault.resolve(v); return p ? { path: p, collection: this.store.collectionOf(p) } : null; };

    problems(template, values) {
        const out = [];
        for (const f of template.fields) {
            if (isDerived(f)) continue;
            const msg = checkValue(f, values[f.key], { resolve: this.resolveForCheck });
            if (msg) out.push(msg);
        }
        return out;
    }

    panel(novel, holder, template, values, chapter) {
        const data = panelData(template, values, { ownerName: holder.name, chapter, describe: (l) => this.describeLink(l) });
        const text = template.panel?.trim() ? renderTemplate(template.panel, data) : builtinPanel(template, data);
        return asCallout(text);
    }

    /** Everything a stats view needs; `template` may be an unsaved template object (editor preview) */
    view(novel, owner, { at, template: draft } = {}) {
        const holder = this.holder(novel, owner);
        if (!holder) throw fail(404, `${owner} has no stats in ${novel.name}`);
        const template = draft ? this.withFacets(normalizeTemplates({ [draft.name || "Draft"]: draft }))[draft.name || "Draft"] : this.templates(novel)[holder.template];
        if (!template) return { holder, template: null, templates: Object.keys(this.templates(novel)) };
        const chapter = at ?? (holder.kind === "creature" ? null : this.novels.latestChapter(novel));
        const { values, origin, managed } = this.valuesAt(novel, holder, template, chapter ?? Infinity);
        return {
            holder, template, chapter, values, origin, managed,
            display: Object.fromEntries(template.fields.map((f) => [f.key, displayValue(template, f, values)])),
            problems: this.problems(template, values),
            panel: this.panel(novel, holder, template, values, chapter),
            templates: Object.keys(this.templates(novel)),
        };
    }

    // ------------------------------------------------------------ checks before writes

    /** Problems in state-ledger lines for an owner with a template (empty if none, or no template) */
    checkLines(novel, owner, typeName, lines) {
        const type = this.novels.ledgerTypes(novel)[typeName];
        if (type?.behaviour !== "state") return [];
        const holder = this.holder(novel, owner);
        const template = holder && this.templates(novel)[holder.template];
        if (!template) return [];
        const out = [];
        for (const l of lines ?? []) {
            if (!l.set || l.with) continue;
            const f = fieldNamed(template, l.set);
            if (!f) continue;
            // a level that follows a number: set it (the number moves to the level's lowest value) or link / unlink it
            if (f.type === "choice" && f.from) {
                if (String(l.value ?? "").trim() && !optionOf(f, l.value)) out.push(`${f.label} must be one of: ${f.options.join(", ")}`);
                if (String(l.link ?? "").trim() && !/^(on|off|yes|no|true|false|linked|unlinked)$/i.test(String(l.link).trim())) out.push(`${f.label}: link must be on or off`);
                if (!String(l.value ?? "").trim() && !String(l.link ?? "").trim()) out.push(`${f.label}: give a level or link: on / off`);
                continue;
            }
            if (isChange(l)) {
                const n = l.add != null && l.add !== "" ? Number(l.add) : Number(String(l.value).replace(/^\s*\+\s*/, ""));
                if (!["number", "resource"].includes(f.type)) out.push(`${f.label} isn't a number, so it can't change by an amount`);
                else if (!Number.isFinite(n)) out.push(`${f.label}: "${l.add ?? l.value}" is not an amount`);
                continue;
            }
            const msg = checkValue(f, fromText(f, l.value), { resolve: this.resolveForCheck });
            if (msg) out.push(msg);
        }
        return out;
    }

    /** Problems in a frontmatter edit of a character sheet or creature note */
    checkPatch(path, set) {
        const novel = this.novels.get(path.split("/")[0]);
        if (!novel) return [];
        const holder = this.holders(novel).find((h) => h.path === path);
        if (!holder) return [];
        const name = set["stat-template"] ?? holder.template;
        if (set["stat-template"] && !this.templates(novel)[name]) return [`No stat template "${name}" in ${novel.name}`];
        const template = this.templates(novel)[name];
        if (!template) return [];
        const out = [];
        for (const f of template.fields) {
            if (!(f.key in set)) continue;
            const msg = isDerived(f) ? null : checkValue(f, fromText(f, set[f.key]), { resolve: this.resolveForCheck });
            if (msg) out.push(msg);
        }
        return out;
    }

    /** Sheet sync hook: template fields get their latest typed value (whatever name the ledger used), plus computed fields */
    sheetValues(novel, owner, set) {
        const holder = this.holder(novel, owner);
        const template = holder && this.templates(novel)[holder.template];
        if (!template) return set;
        const out = { ...set };
        // ledgers may name a field by a short name ("level" for character/level): never write those as extra keys
        for (const k of Object.keys(out)) { const f = fieldNamed(template, k); if (f && f.key !== k) delete out[k]; }
        const { values, managed } = this.valuesAt(novel, holder, template);
        for (const f of template.fields) {
            if (isDerived(f)) { if (values[f.key] !== "") out[f.key] = values[f.key]; }
            else if (managed.includes(f.key)) out[f.key] = values[f.key];
        }
        return out;
    }

    // ------------------------------------------------------------ writing

    /** Save all templates of a novel; `renames` {old: new} updates sheets and creature notes that use them */
    async saveTemplates(novel, templates, { baseMtime, renames = {} } = {}) {
        const normalized = this.withFacets(normalizeTemplates(Object.fromEntries(templates.map((t) => [t.name, t]))));
        if (Object.keys(normalized).length !== templates.length) throw fail(400, "Template names must be unique");
        const errors = Object.values(normalized).flatMap((t) => checkTemplate(t).map((e) => `${t.name}: ${e}`));
        if (Object.values(normalized).filter((t) => t.default).length > 1) errors.push("Only one template can be the default");
        if (templates.some((t) => !String(t.name ?? "").trim())) errors.push("Every template needs a name");
        if (errors.length) throw fail(400, errors.join("\n"));
        const value = Object.fromEntries(Object.values(normalized).map((t) => [t.name, serializeTemplate(t)]));
        await patchNote(this.vault, novel.configPath, { set: { "stat-templates": value }, baseMtime });
        const fresh = this.novels.get(novel.folder);
        for (const h of this.holders(fresh)) {
            const n = this.vault.notes.get(h.path);
            const cur = n?.fm["stat-template"];
            if (cur && renames[cur] && renames[cur] !== cur) await patchNote(this.vault, h.path, { set: { "stat-template": renames[cur] } });
        }
        return { templates: Object.keys(value) };
    }

    /** Give a data store creature base stats in a novel: <novel>/Creatures/<Creature> (<Novel>).md */
    async createCreature(novel, creature, templateName) {
        const p = this.vault.resolve(creature);
        if (!p) throw fail(404, `No creature ${creature}`);
        if (!this.templates(novel)[templateName]) throw fail(400, `No stat template "${templateName}" in ${novel.name}`);
        const existing = this.holders(novel).find((h) => h.kind === "creature" && h.creaturePath === p);
        if (existing) throw fail(409, `${linkLabel(creature)} already has stats in ${novel.name}`);
        const base = sanitizeName(`${this.vault.notes.get(p)?.name ?? linkLabel(creature)} (${novel.name})`);
        const rel = `${this.creaturesFolder(novel)}/${uniqueName(this.vault, base, "Stats")}.md`;
        await createNote(this.vault, rel, {
            type: "creature-stats", creature: `[[${this.vault.notes.get(p)?.name ?? linkLabel(creature)}]]`, novel: novel.name,
            "stat-template": templateName, "created-date": new Date().toISOString().slice(0, 10),
        });
        return rel;
    }

    /** For note pages: stats info of a character sheet or creature stat note */
    describeNote(p) {
        const novel = this.novels.get(p.split("/")[0]);
        if (!novel) return null;
        const holder = this.holders(novel).find((h) => h.path === p);
        if (!holder) return null;
        const templates = this.templates(novel);
        const template = templates[holder.template] ?? null;
        const out = { novel: novel.folder, holder, templates: Object.keys(templates), template };
        if (template) {
            const v = this.valuesAt(novel, holder, template);
            Object.assign(out, { values: v.values, origin: v.origin, managed: v.managed, problems: this.problems(template, v.values) });
        }
        return out;
    }

    /** Novels' creature stats for a data store creature note */
    creatureUses(p) {
        const out = [];
        for (const novel of this.novels.list()) for (const h of this.holders(novel)) if (h.kind === "creature" && h.creaturePath === p) out.push({ novel: novel.folder, novelName: novel.name, path: h.path, template: h.template });
        return out;
    }

    /** Quality check: holders whose current values break their template */
    qa() {
        const out = [];
        for (const novel of this.novels.list()) {
            const templates = this.templates(novel);
            for (const h of this.holders(novel)) {
                if (h.assigned && !templates[h.template]) { out.push({ novel: novel.folder, path: h.path, name: h.name, message: `Unknown stat template "${h.template}"` }); continue; }
                const t = templates[h.template];
                if (!t) continue;
                for (const m of this.problems(t, this.valuesAt(novel, h, t).values)) out.push({ novel: novel.folder, path: h.path, name: h.name, message: m });
            }
        }
        return out;
    }
}
