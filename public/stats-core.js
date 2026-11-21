// Stat templates: typed fields, validation, text <-> value conversion, formulas and stats panels.
// Shared by the browser (template editor, inputs) and the server (ledger saves, sheet sync, panels).

export const FIELD_TYPES = {
    number: "Number",
    text: "Text",
    longtext: "Long text",
    list: "List of text",
    boolean: "Yes / no",
    choice: "Choice (options or a taxonomy)",
    link: "Link",
    links: "List of links",
    resource: "Current / max",
    computed: "Computed",
};

const slug = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Identifier used in formulas and custom panels: the last part of the key, e.g. "character/level" -> "level" */
export const fieldId = (key) => String(key ?? "").split("/").pop().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
export const defaultKey = (label) => `stats/${slug(label) || "field"}`;
/** Does a ledger line's `set` name this field? Full key, last part of the key, formula name or label, any case */
export const namesField = (f, name) => {
    const n = String(name ?? "").trim().toLowerCase();
    return !!n && [f.key, f.key.split("/").pop(), f.id, f.label].some((x) => String(x).toLowerCase() === n);
};
export const fieldNamed = (template, name) => template.fields.find((f) => namesField(f, name)) ?? null;

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

/** config.md `stat-templates` -> {name: template} with every field filled in */
export function normalizeTemplates(raw) {
    const out = {};
    for (const [name, t] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
        const fields = list(t?.fields).filter((f) => f && typeof f === "object").map((f) => {
            const label = String(f.label ?? "").trim() || String(f.key ?? "").split("/").pop();
            const key = String(f.key ?? "").trim() || defaultKey(label);
            const type = FIELD_TYPES[f.type] ? f.type : "text";
            return {
                key, label, type, id: fieldId(key), section: String(f.section ?? "").trim(),
                integer: !!f.integer, min: num(f.min), max: num(f.max),
                options: list(f.options).map(String).filter(Boolean),
                // choice: options from a taxonomy facet (values are [[links]] to its notes, in class order), and
                // optionally worked out from a number field: each option's lowest value (thresholds {option: min})
                facet: String(f.facet ?? "").trim(),
                // which of the facet's values: all, top (no parent: realms), bottom (no sub-levels: stages)
                depth: ["top", "bottom"].includes(f.depth) ? f.depth : "all",
                // the values' own numbers (their notes' `threshold`), filled in with the options by the server
                noteThresholds: f.noteThresholds && typeof f.noteThresholds === "object" ? f.noteThresholds : {},
                optionTitles: f.optionTitles && typeof f.optionTitles === "object" ? f.optionTitles : {},
                from: String(f.from ?? "").trim(),
                thresholds: Object.fromEntries(Object.entries(f.thresholds && typeof f.thresholds === "object" ? f.thresholds : {})
                    .map(([k, v]) => [String(k), num(v)]).filter(([, v]) => v != null)),
                collection: String(f.collection ?? "").trim(),
                describe: !!f.describe,
                "max-field": String(f["max-field"] ?? "").trim(),
                formula: String(f.formula ?? "").trim(),
                unit: String(f.unit ?? "").trim(),
                // character frontmatter field that supplies the value until a ledger entry sets one
                source: String(f.source ?? "").trim(),
            };
        });
        out[name] = {
            name, description: String(t?.description ?? ""), default: !!t?.default, callout: String(t?.callout || "system"),
            "show-empty": !!t?.["show-empty"], panel: String(t?.panel ?? ""), fields,
            // the built-in panel: "status" (the default: a status window, a table per section, bars for current / max)
            // or "classic" (bold label: value lines)
            layout: t?.layout === "classic" ? "classic" : "status",
        };
    }
    return out;
}

/** Template -> the shape written to config.md (defaults left out so the YAML stays short) */
export function serializeTemplate(t) {
    const out = {};
    if (t.description) out.description = t.description;
    if (t.default) out.default = true;
    if (t.callout && t.callout !== "system") out.callout = t.callout;
    if (t["show-empty"]) out["show-empty"] = true;
    if (t.panel?.trim()) out.panel = t.panel;
    if (t.layout === "classic") out.layout = "classic";
    out.fields = t.fields.map((f) => {
        const o = { key: f.key, label: f.label, type: f.type };
        if (f.section) o.section = f.section;
        if (f.type === "number" || f.type === "resource") {
            if (f.integer) o.integer = true;
            if (f.min != null) o.min = f.min;
            if (f.max != null) o.max = f.max;
        }
        if (f.type === "resource" && f["max-field"]) o["max-field"] = f["max-field"];
        if (f.type === "choice") {
            if (f.facet) { o.facet = f.facet; if (f.depth !== "all") o.depth = f.depth; } else o.options = f.options;
            if (f.from) { o.from = f.from; o.thresholds = Object.fromEntries(Object.entries(f.thresholds ?? {}).filter(([k, v]) => v != null && f.options.includes(k))); }
        }
        if (f.type === "link" || f.type === "links") { if (f.collection) o.collection = f.collection; if (f.describe) o.describe = true; }
        if (f.type === "computed") o.formula = f.formula;
        if (f.unit) o.unit = f.unit;
        if (f.source && f.type !== "computed") o.source = f.source;
        return o;
    });
    return out;
}

/** Problems with a template definition (empty = fine) */
export function checkTemplate(t) {
    const errors = [];
    const ids = new Map(), keys = new Set();
    for (const f of t.fields) {
        if (keys.has(f.key)) errors.push(`Two fields use the key "${f.key}"`);
        keys.add(f.key);
        if (ids.has(f.id)) errors.push(`"${f.label}" and "${ids.get(f.id)}" both have the formula name "${f.id}"; give one a different key`);
        ids.set(f.id, f.label);
        if (f.type === "choice" && !f.options.length) errors.push(f.facet ? `"${f.label}": the taxonomy ${f.facet} has no values` : `"${f.label}" needs at least one option`);
        if (f.type === "choice" && f.from) {
            const src = t.fields.find((x) => x.key === f.from || x.id === f.from);
            if (!src || !["number", "resource", "computed"].includes(src.type)) errors.push(`"${f.label}": "${f.from}" is not a number field of the template`);
            if (!f.options.some((k) => thresholdOf(f, k) != null)) errors.push(`"${f.label}": give at least one option its lowest ${src?.label ?? f.from}`);
        }
        if (f.min != null && f.max != null && f.min > f.max) errors.push(`"${f.label}": min is above max`);
        if (f.type === "computed") {
            if (!f.formula) errors.push(`"${f.label}" needs a formula`);
            else try { for (const ref of parseFormula(f.formula).refs) if (!t.fields.some((x) => x.id === ref)) errors.push(`"${f.label}": unknown field "${ref}" in the formula`); }
            catch (e) { errors.push(`"${f.label}": ${e.message}`); }
        }
        if (f.type === "resource" && f["max-field"] && !t.fields.some((x) => x.key === f["max-field"] || x.id === f["max-field"])) errors.push(`"${f.label}": max field "${f["max-field"]}" is not in the template`);
    }
    return errors;
}

// ------------------------------------------------------------------ values

const isLinkText = (v) => /^\[\[[^\]]+\]\]$/.test(String(v ?? "").trim());
/** A field whose value is worked out, never set: computed, or a choice that follows a number */
export const isDerived = (f) => f.type === "computed" || (f.type === "choice" && !!f.from);
const bareName = (v) => String(v ?? "").trim().replace(/^\[\[|\]\]$/g, "").split("|").pop().trim();
/** The option a choice value means (any case, with or without [[ ]]), or null */
export const optionOf = (f, v) => f.options.find((o) => o.toLowerCase() === bareName(v).toLowerCase()) ?? null;
/**
 * A taxonomy facet's notes ([{path, name, fm}]) as a choice's options: class order, then name; depth "top" = values
 * without a parent (realms), "bottom" = values without sub-levels (stages), else all. noteThresholds: each value's
 * `threshold` (a value without one starts where its first sub-level does). resolve([[link]]) -> path.
 */
export function facetChoice(notes, depth = "all", resolve = () => null) {
    const rank = (n) => { const c = Number(n.fm.class); return n.fm.class !== "" && n.fm.class != null && Number.isFinite(c) ? c : Infinity; };
    const sorted = [...notes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const paths = new Set(sorted.map((n) => n.path));
    const parentOf = (n) => { const p = n.fm.parent && resolve(String(n.fm.parent)); return p && paths.has(p) ? p : null; };
    const hasKids = new Set(sorted.map(parentOf).filter(Boolean));
    const own = (n) => (n.fm.threshold !== "" && n.fm.threshold != null && Number.isFinite(Number(n.fm.threshold)) ? Number(n.fm.threshold) : null);
    const noteThresholds = {};
    for (const n of sorted) {
        const kids = sorted.filter((x) => parentOf(x) === n.path).map(own).filter((v) => v != null);
        const v = own(n) ?? (kids.length ? Math.min(...kids) : null);
        if (v != null) noteThresholds[n.name] = v;
    }
    const shown = sorted.filter((n) => (depth === "top" ? !parentOf(n) : depth === "bottom" ? !hasKids.has(n.path) : true));
    // how each value reads: its title ("Foundation Establishment (Early)") where it has one
    const optionTitles = Object.fromEntries(shown.filter((n) => typeof n.fm.title === "string" && n.fm.title.trim() && n.fm.title !== n.name).map((n) => [n.name, n.fm.title.trim()]));
    return { options: shown.map((n) => n.name), noteThresholds, optionTitles };
}

/** An option's lowest value: the template's own, else the number on the taxonomy note */
export const thresholdOf = (f, o) => f.thresholds?.[o] ?? f.noteThresholds?.[o] ?? null;
/** The option a number falls in: the one with the highest lowest-value at or below it (the later one on a tie) */
export function optionFor(f, n) {
    if (!Number.isFinite(n)) return "";
    let best = null, bestMin = null;
    for (const o of f.options) { const min = thresholdOf(f, o); if (min != null && min <= n && (best == null || min >= bestMin)) { best = o; bestMin = min; } }
    return best == null ? "" : f.facet ? `[[${best}]]` : best;
}
/** A field's option ranges for display: [{option, min, next}] in order of their lowest value */
export function thresholdRows(f) {
    const rows = f.options.filter((o) => thresholdOf(f, o) != null).map((o) => ({ option: o, min: thresholdOf(f, o) })).sort((a, b) => a.min - b.min);
    return rows.map((r, i) => ({ ...r, next: rows[i + 1]?.min ?? null }));
}

/**
 * A ledger line's change applied to the value before it (text): `[add:: 50]` (or a value written "+50") adds to a
 * number, or to a resource's current value ("80/100" + 5 -> "85/100"); anything else is the new value as it stands.
 */
export function applyChange(prev, line) {
    const plus = /^\s*\+\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(line?.value ?? ""));
    const add = line?.add != null && line.add !== "" ? Number(line.add) : plus ? Number(plus[1]) : null;
    if (add == null || !Number.isFinite(add)) return line?.value ?? "";
    const round = (x) => Math.round(x * 1000) / 1000;
    const r = parseResource(prev);
    if (r) return r.max != null ? `${round(r.cur + add)}/${r.max}` : String(round(r.cur + add));
    const n = Number(String(prev ?? "").trim() || 0);
    return String(round((Number.isFinite(n) ? n : 0) + add));
}
// ------------------------------------------------------------------ levels that follow a number: set them, unlink them

/** values[UNLINKED]: keys of choices that follow a number but are unlinked from it at this point */
export const UNLINKED = "@unlinked";
export const sourceOf = (template, f) => (f?.from ? template.fields.find((x) => x.key === f.from || x.id === f.from) ?? null : null);
const LINK_OFF = /^(off|no|false|unlinked|0)$/i, LINK_ON = /^(on|yes|true|linked|1)$/i;
const numOfText = (field, text) => (field?.type === "resource" ? parseResource(text)?.cur ?? NaN : String(text ?? "").trim() === "" ? NaN : Number(text));
/** The range [min, next) an option covers, or null */
export function rangeOf(f, option) {
    const rows = thresholdRows(f), i = rows.findIndex((r) => r.option === option);
    return i < 0 ? null : { min: rows[i].min, next: rows[i].next };
}

/** Replay state from values: {text: {key: ledger text}, unlinked: {key: true}, manual: {key: value}} */
export function stateFrom(template, values = {}) {
    const st = { text: {}, unlinked: {}, manual: {} };
    for (const f of template.fields) {
        if (f.type === "computed") continue;
        if (f.type === "choice" && f.from) { if (list(values[UNLINKED]).includes(f.key)) { st.unlinked[f.key] = true; st.manual[f.key] = values[f.key] ?? ""; } continue; }
        if (values[f.key] != null && values[f.key] !== "") st.text[f.key] = toText(f, values[f.key]);
    }
    return st;
}

/**
 * One Stats line applied to the replay state. Returns the keys it changed (empty when it names no field).
 * - a number: set (`value`), or changed by an amount (`add`, or a value written "+50")
 * - a choice that follows a number: `link: off` unlinks it (it keeps its level while the number moves on: an
 *   overflow, a special constitution, a deficiency), `link: on` links it again. A value sets the level: while
 *   linked, the number moves to the level's lowest value (only when it is outside the level's range); while
 *   unlinked, only the level changes.
 */
export function replayLine(template, st, line) {
    const f = line?.set && !line.with ? fieldNamed(template, line.set) : null;
    if (!f || f.type === "computed") return [];
    if (!(f.type === "choice" && f.from)) { st.text[f.key] = applyChange(st.text[f.key] ?? "", line); return [f.key]; }
    const src = sourceOf(template, f), changed = [f.key];
    const derivedNow = () => (src ? optionFor(f, numOfText(src, st.text[src.key])) : "");
    const link = String(line.link ?? "").trim();
    if (LINK_OFF.test(link) && !st.unlinked[f.key]) { st.unlinked[f.key] = true; st.manual[f.key] = derivedNow(); }
    if (LINK_ON.test(link)) { delete st.unlinked[f.key]; delete st.manual[f.key]; }
    const opt = String(line.value ?? "").trim() ? optionOf(f, line.value) : null;
    if (opt) {
        const v = f.facet ? `[[${opt}]]` : opt;
        if (st.unlinked[f.key]) st.manual[f.key] = v;
        else if (src) {
            const r = rangeOf(f, opt), n = numOfText(src, st.text[src.key]);
            if (r && !(n >= r.min && (r.next == null || n < r.next))) {
                const prev = parseResource(st.text[src.key]);
                st.text[src.key] = src.type === "resource" && prev?.max != null ? `${r.min}/${prev.max}` : String(r.min);
                changed.push(src.key);
            }
        }
    }
    return changed;
}

/** Typed values from the replay state (derived fields filled in by computeValues) */
export function valuesFromState(template, st) {
    const values = {};
    for (const f of template.fields) {
        if (f.type === "computed") continue;
        if (f.type === "choice" && f.from) { if (st.unlinked[f.key]) values[f.key] = st.manual[f.key] ?? ""; continue; }
        values[f.key] = fromText(f, st.text[f.key] ?? null);
    }
    const unlinked = Object.keys(st.unlinked);
    if (unlinked.length) values[UNLINKED] = unlinked;
    return computeValues(template, values);
}

/**
 * How far a level's number is outside the level it has (an unlinked level): {dir: "over"|"under", by, number, min,
 * next, option}, or null when it is linked, in range, or has no number.
 */
export function driftOf(template, f, values) {
    if (!(f.type === "choice" && f.from) || !list(values[UNLINKED]).includes(f.key)) return null;
    const src = sourceOf(template, f), opt = optionOf(f, values[f.key]);
    const n = src ? numeric(src, values[src.key]) : NaN, r = opt ? rangeOf(f, opt) : null;
    if (!r || !Number.isFinite(n)) return null;
    const round = (x) => Math.round(x * 1000) / 1000;
    if (n < r.min) return { dir: "under", by: round(r.min - n), number: n, ...r, option: opt };
    if (r.next != null && n >= r.next) return { dir: "over", by: round(n - (r.next - (Number.isInteger(r.next) ? 1 : 0))), number: n, ...r, option: opt };
    return null;
}

/** Does the line change a value by an amount (rather than set it)? */
export const isChange = (line) => (line?.add != null && line.add !== "") || /^\s*\+\s*-?\d/.test(String(line?.value ?? ""));
/** Split "a, [[b, c]], d" on commas outside [[links]] */
function splitList(text) {
    const out = [];
    let cur = "", depth = 0;
    const s = String(text ?? "");
    for (let i = 0; i < s.length; i++) {
        if (s.startsWith("[[", i)) depth++;
        if (s.startsWith("]]", i)) depth = Math.max(0, depth - 1);
        if (s[i] === "," && !depth) { out.push(cur.trim()); cur = ""; continue; }
        cur += s[i];
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(Boolean);
}
const asLink = (v) => (isLinkText(v) ? String(v).trim() : `[[${String(v).trim()}]]`);

/** Ledger line text (or loosely typed frontmatter) -> a typed value */
export function fromText(field, text) {
    if (text == null) return field.type === "list" || field.type === "links" ? [] : "";
    if (Array.isArray(text)) return field.type === "links" ? text.map(asLink) : field.type === "list" ? text.map(String) : text.join(", ");
    const s = String(text).trim();
    switch (field.type) {
        case "number": return s === "" ? "" : num(s) ?? s;
        case "boolean": return /^(true|yes|y|1)$/i.test(s) ? true : /^(false|no|n|0)$/i.test(s) ? false : s === "" ? "" : s;
        case "list": return splitList(s);
        case "links": return splitList(s).map(asLink);
        case "link": return s === "" ? "" : asLink(s);
        case "choice": return s === "" ? "" : field.facet ? asLink(optionOf(field, s) ?? bareName(s)) : (optionOf(field, s) ?? s);
        case "resource": return s;
        default: return typeof text === "string" ? text : String(text);
    }
}

/** Typed value -> text for a ledger line */
export function toText(field, value) {
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "boolean") return value ? "yes" : "no";
    return value == null ? "" : String(value);
}

/** Resource text "80/100" (or just "80" when the max comes from elsewhere) -> {cur, max} */
export function parseResource(v) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*(-?\d+(?:\.\d+)?))?\s*$/.exec(String(v ?? ""));
    return m ? { cur: Number(m[1]), max: m[2] != null ? Number(m[2]) : null } : null;
}

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

/** Check a typed value against its field. Returns null when fine, else a message */
export function checkValue(field, value, { resolve } = {}) {
    if (empty(value)) return null;
    const label = field.label;
    const range = (n) => {
        if (field.integer && !Number.isInteger(n)) return `${label} must be a whole number`;
        if (field.min != null && n < field.min) return `${label} must be at least ${field.min}`;
        if (field.max != null && n > field.max) return `${label} must be at most ${field.max}`;
        return null;
    };
    switch (field.type) {
        case "number": return typeof value === "number" && Number.isFinite(value) ? range(value) : `${label} must be a number`;
        case "boolean": return typeof value === "boolean" ? null : `${label} must be yes or no`;
        case "choice":
            if (field.from) return `${label} follows ${field.from} and can't be set`;
            return optionOf(field, value) ? null : `${label} must be one of: ${field.options.join(", ")}`;
        case "list": return Array.isArray(value) ? null : `${label} must be a list`;
        case "link": case "links": {
            const vals = field.type === "link" ? [value] : value;
            if (!Array.isArray(vals)) return `${label} must be a list of links`;
            for (const v of vals) {
                if (!isLinkText(v)) return `${label}: "${v}" is not a [[link]]`;
                if (resolve && field.collection) {
                    const r = resolve(v);
                    if (r && r.collection !== field.collection) return `${label}: ${v} is not in ${field.collection}`;
                }
            }
            return null;
        }
        case "resource": {
            const r = parseResource(value);
            if (!r) return `${label} must look like 80/100${field["max-field"] || field.max != null ? " or 80" : ""}`;
            return range(r.cur) ?? (r.max != null && field.integer && !Number.isInteger(r.max) ? `${label} max must be a whole number` : null);
        }
        case "computed": return `${label} is computed and can't be set`;
        default: return null;
    }
}

// ------------------------------------------------------------------ formulas: numbers, field names, + - * / ^ ( ) and min max floor ceil round abs

const FUNCS = { min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, sqrt: Math.sqrt };

export function parseFormula(src) {
    const tokens = String(src).match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\{[^}]+\}|[-+*/^(),]|\S/g) ?? [];
    let i = 0;
    const refs = new Set();
    const peek = () => tokens[i];
    const take = (t) => { if (tokens[i] !== t) throw new Error(`expected "${t}" in the formula`); i++; };
    const primary = () => {
        const t = tokens[i++];
        if (t == null) throw new Error("the formula ends too early");
        if (/^\d/.test(t)) return () => Number(t);
        if (t === "(") { const e = expr(); take(")"); return e; }
        if (t === "-") { const e = power(); return (v) => -e(v); }
        if (t === "+") return power();
        if (t.startsWith("{")) { const id = fieldId(t.slice(1, -1)); refs.add(id); return (v) => v(id); }
        if (/^[A-Za-z_]/.test(t)) {
            if (peek() === "(" && FUNCS[t.toLowerCase()]) {
                i++;
                const args = [];
                if (peek() !== ")") { args.push(expr()); while (peek() === ",") { i++; args.push(expr()); } }
                take(")");
                const fn = FUNCS[t.toLowerCase()];
                return (v) => fn(...args.map((a) => a(v)));
            }
            refs.add(t);
            return (v) => v(t);
        }
        throw new Error(`unexpected "${t}" in the formula`);
    };
    const power = () => { const b = primary(); if (peek() === "^") { i++; const e = power(); return (v) => b(v) ** e(v); } return b; };
    const term = () => {
        let l = power();
        while (peek() === "*" || peek() === "/") { const op = tokens[i++], r = power(), a = l; l = op === "*" ? (v) => a(v) * r(v) : (v) => a(v) / r(v); }
        return l;
    };
    const expr = () => {
        let l = term();
        while (peek() === "+" || peek() === "-") { const op = tokens[i++], r = term(), a = l; l = op === "+" ? (v) => a(v) + r(v) : (v) => a(v) - r(v); }
        return l;
    };
    const fn = expr();
    if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}" in the formula`);
    return { fn, refs: [...refs] };
}

/** A field's value as a number for formulas (lists count their items, yes/no is 1/0, resources use current) */
function numeric(field, value) {
    if (empty(value)) return NaN;
    if (Array.isArray(value)) return value.length;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (field?.type === "resource") return parseResource(value)?.cur ?? NaN;
    return Number(value);
}

/** Fill in computed fields and choices that follow a number (in template order, so later ones can use earlier ones) */
export function computeValues(template, values) {
    const out = { ...values };
    const byId = new Map(template.fields.map((f) => [f.id, f]));
    for (const f of template.fields) {
        if (f.type === "choice" && f.from) {
            // unlinked (an overflow or a deficiency): the level stays as it was set, whatever the number says
            if (list(out[UNLINKED]).includes(f.key)) continue;
            const src = sourceOf(template, f);
            out[f.key] = src ? optionFor(f, numeric(src, out[src.key])) : "";
            continue;
        }
        if (f.type !== "computed") continue;
        try {
            const { fn } = parseFormula(f.formula);
            const r = fn((id) => numeric(byId.get(id), out[byId.get(id)?.key]));
            out[f.key] = Number.isFinite(r) ? Math.round(r * 1000) / 1000 : "";
        } catch { out[f.key] = ""; }
    }
    return out;
}

/** The max of a resource field: its own "/max", a fixed max, or another field */
function resourceMax(template, field, values, r) {
    if (r?.max != null) return r.max;
    if (field["max-field"]) {
        const mf = template.fields.find((x) => x.key === field["max-field"] || x.id === field["max-field"]);
        const v = mf ? numeric(mf, values[mf.key]) : NaN;
        if (Number.isFinite(v)) return v;
    }
    return field.max;
}

/** How a value reads in a panel or table */
export function displayValue(template, field, values) {
    const v = values[field.key];
    if (empty(v)) return "";
    if (field.type === "resource") {
        const r = parseResource(v);
        if (!r) return String(v);
        const max = resourceMax(template, field, values, r);
        return `${r.cur}${max != null ? `/${max}` : ""}${field.unit ? ` ${field.unit}` : ""}`;
    }
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (field.type === "choice") { const o = optionOf(field, v); return (o && field.optionTitles?.[o]) || bareName(v); }
    if (Array.isArray(v)) return v.join(", ");
    return `${v}${field.unit ? ` ${field.unit}` : ""}`;
}

// ------------------------------------------------------------------ panels

/**
 * Data for a stats panel. `describe(link)` returns {title, description} for describe-links fields.
 * Custom panels can use {{ownerName}}, {{chapter}}, {{stat.<id>}}, {{#sections}}{{name}}{{#fields}}{{label}}: {{value}}{{/fields}}{{/sections}}
 * and {{#list.<id>}}{{title}} {{description}}{{/list.<id>}} for link fields.
 */
export function panelData(template, values, { ownerName, chapter, describe = () => null } = {}) {
    const all = computeValues(template, values);
    const stat = {}, lists = {};
    const sections = [];
    for (const f of template.fields) {
        const value = displayValue(template, f, all);
        stat[f.id] = value;
        const links = (f.type === "link" || f.type === "links") ? list(all[f.key]).map((l) => ({ link: l, ...(describe(l) ?? { title: String(l).replace(/^\[\[|\]\]$/g, "").split("|").pop(), description: "" }) })) : [];
        lists[f.id] = links;
        if (!value && !template["show-empty"]) continue;
        let s = sections.find((x) => x.name === f.section);
        if (!s) sections.push(s = { name: f.section, fields: [] });
        const r = f.type === "resource" ? /^(-?[\d.]+)\/(-?[\d.]+)/.exec(value) : null;
        s.fields.push({ id: f.id, key: f.key, label: f.label, value: value || "—", describe: f.describe && links.length > 0, links, type: f.type,
            ratio: r && Number(r[2]) > 0 ? Math.max(0, Math.min(1, Number(r[1]) / Number(r[2]))) : null, drift: driftOf(template, f, all) });
    }
    return { ownerName, chapter, template: template.name, stat, list: lists, sections, values: all };
}

/** "▰▰▰▰▰▰▱▱▱▱" for a ratio */
export const bar = (ratio, n = 10) => "▰".repeat(Math.round(ratio * n)) + "▱".repeat(n - Math.round(ratio * n));

/**
 * The status window layout: the owner as the title, the chapter under it, then one three-column table per section (stat, bar, value)
 * (the section's name as its heading, unsectioned fields under "Overview"), values right-aligned, current / max as a
 * bar, an unlinked level's overflow or underflow after it; described links after the tables as "##### Title" +
 * description. Tables render inside callouts in Obsidian; the "status" callout style makes it look like a game's.
 */
export function statusPanel(data, callout = "status") {
    const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
    const lines = [`[!${callout}] ${data.ownerName ?? ""}`.trimEnd()];
    if (data.chapter != null) lines.push(`Chapter ${data.chapter} · ${data.template}`);
    const ordered = [...data.sections.filter((s) => !s.name), ...data.sections.filter((s) => s.name)];
    const described = [];
    for (const s of ordered) {
        // three columns: the stat, a bar for current / max (else empty), the value
        const rows = [];
        for (const f of s.fields) {
            if (f.describe) { described.push(f); rows.push(`| ${cell(f.label)} | | ${cell(f.links.map((l) => l.title).join(", "))} |`); continue; }
            const extra = f.drift ? ` (${f.drift.dir === "over" ? "overflow +" : "underflow −"}${f.drift.by})` : "";
            rows.push(`| ${cell(f.label)} | ${f.ratio != null ? bar(f.ratio) : ""} | ${cell(f.value)}${extra} |`);
        }
        if (!rows.length) continue;
        lines.push("", `| ${cell(s.name || "Overview")} | | |`, "|:--|--:|--:|", ...rows);
    }
    for (const f of described) {
        lines.push("", `#### ${f.label}`);
        for (const l of f.links) { lines.push(`##### ${l.title}`); lines.push(l.description || "*No description*"); }
    }
    return lines.join("\n");
}

/** A template's built-in panel text */
export const builtinPanel = (template, data) => (template.layout === "status" ? statusPanel(data, template.callout === "system" ? "status" : template.callout) : defaultPanel(data, template.callout));

/** Default panel layout: unsectioned fields first, then "#### Section" blocks; described links as "##### Title" + description */
export function defaultPanel(data, callout = "system") {
    const lines = [`[!${callout}] ${data.ownerName ?? ""}`.trimEnd()];
    const ordered = [...data.sections.filter((s) => !s.name), ...data.sections.filter((s) => s.name)];
    for (const s of ordered) {
        if (s.name) lines.push(`#### ${s.name}`);
        for (const f of s.fields) {
            if (f.describe) {
                if (f.label !== s.name) lines.push(`**${f.label}:**`);
                for (const l of f.links) { lines.push(`##### ${l.title}`); lines.push(l.description || "*No description*"); }
            } else lines.push(`**${f.label}:** ${f.value}`);
        }
    }
    return lines.join("\n");
}
