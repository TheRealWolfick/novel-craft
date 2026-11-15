// Lookup: search note names, titles, frontmatter and text across the vault (data store, taxonomy, chapters,
// characters, plans, ledgers, other notes). Every word of the query must appear somewhere in a note.

const SKIP = /^(\.|90\. Templater\/)|\/\./;
const KINDS = ["data", "taxonomy", "chapter", "character", "plan", "ledger", "other"];

// lower-cased text per note object (notes are replaced when their file changes, so the cache follows)
const lowered = new WeakMap();
function textOf(n) {
    let t = lowered.get(n);
    if (!t) {
        t = { name: n.name.toLowerCase(), title: String(n.fm.title ?? n.fm["chapter title"] ?? "").toLowerCase(), fm: flatten(n.fm).toLowerCase(), body: n.body.toLowerCase() };
        lowered.set(n, t);
    }
    return t;
}
function flatten(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(flatten).join(" ");
    if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k} ${flatten(x)}`).join(" ");
    return String(v);
}

/** A short excerpt around the first match, on word boundaries, without markdown noise */
function snippet(text, lower, words, width = 90) {
    let at = -1, len = 0;
    for (const w of words) { const i = lower.indexOf(w); if (i > -1 && (at < 0 || i < at)) { at = i; len = w.length; } }
    if (at < 0) return "";
    let a = Math.max(0, at - width), b = Math.min(text.length, at + len + width);
    if (a > 0) a = text.indexOf(" ", a) + 1 || a;
    if (b < text.length) b = text.lastIndexOf(" ", b) > at + len ? text.lastIndexOf(" ", b) : b;
    const clean = text.slice(a, b).replace(/%%[\s\S]*?%%/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_>#`]+/g, "").replace(/\s+/g, " ").trim();
    return `${a > 0 ? "…" : ""}${clean}${b < text.length ? "…" : ""}`;
}
const count = (s, w) => { let c = 0; for (let i = s.indexOf(w); i > -1 && c < 99; i = s.indexOf(w, i + w.length)) c++; return c; };

export class Search {
    constructor(vault, novels, store) { this.vault = vault; this.novels = novels; this.store = store; }

    /** What a note is, for grouping and links */
    classify(n, novelList) {
        const novel = novelList.find((x) => n.path.startsWith(`${x.folder}/`));
        if (novel) {
            const base = { novel: novel.folder, novelName: novel.name };
            if (n.path.startsWith(`${novel.chaptersFolder}/`)) {
                const num = Number(n.fm.chapter ?? /^(\d+(?:\.\d+)?)/.exec(n.name)?.[1]);
                return { ...base, kind: "chapter", chapter: Number.isFinite(num) ? num : null };
            }
            if (n.path.startsWith(`${novel.ledgersFolder}/`) || n.fm.type === "ledger") return { ...base, kind: "ledger" };
            if (n.path.startsWith(`${novel.charactersFolder}/`)) return { ...base, kind: "character" };
            if (["volume", "chapter-plan", "plot"].includes(n.fm.type)) return { ...base, kind: "plan", planType: n.fm.type };
            return { ...base, kind: "other" };
        }
        const collection = this.store.collectionOf(n.path);
        if (collection) return { kind: collection.startsWith("Taxonomy/") ? "taxonomy" : "data", collection };
        return { kind: "other" };
    }

    /**
     * @param {{q: string, novel?: string, kind?: string, limit?: number}} opts  novel: only that novel's notes among
     *   notes inside novel folders (data store notes always count)
     */
    run({ q, novel, kind, limit = 80 }) {
        const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return { results: [], counts: {}, total: 0 };
        const phrase = words.join(" ");
        const novelList = this.novels.list();
        const hits = [];
        for (const n of this.vault.notes.values()) {
            if (SKIP.test(n.path)) continue;
            const t = textOf(n);
            if (!words.every((w) => t.name.includes(w) || t.title.includes(w) || t.fm.includes(w) || t.body.includes(w))) continue;
            const info = this.classify(n, novelList);
            if (novel && info.novel && info.novel !== novel) continue;
            let score = 0;
            if (t.name === phrase || t.title === phrase) score += 100;
            else if (t.name.startsWith(phrase) || t.title.startsWith(phrase)) score += 60;
            else if (t.name.includes(phrase) || t.title.includes(phrase)) score += 40;
            else if (words.every((w) => t.name.includes(w) || t.title.includes(w))) score += 30;
            if (t.fm.includes(phrase)) score += 12;
            const inBody = words.every((w) => t.body.includes(w));
            const matches = inBody ? count(t.body, words[0]) : 0;
            if (inBody) score += 4 + Math.min(matches, 12) + (t.body.includes(phrase) ? 6 : 0);
            if (novel && info.novel === novel) score += 3;
            hits.push({ n, t, info, score, inBody, matches });
        }
        const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
        for (const h of hits) counts[h.info.kind]++;
        const shown = (kind ? hits.filter((h) => h.info.kind === kind) : hits).sort((a, b) => b.score - a.score || a.n.name.localeCompare(b.n.name));
        return {
            total: hits.length, counts,
            results: shown.slice(0, limit).map(({ n, t, info, inBody, matches }) => {
                const byName = words.every((w) => t.name.includes(w) || t.title.includes(w));
                return {
                    path: n.path, name: n.name, title: n.fm.title || n.fm["chapter title"] || "", ...info,
                    matches, where: inBody ? "text" : byName ? "name" : "fields",
                    snippet: inBody ? snippet(n.body, t.body, words) : byName ? String(n.fm.description ?? "").slice(0, 180) : snippet(flatten(n.fm), t.fm, words),
                };
            }),
        };
    }
}
