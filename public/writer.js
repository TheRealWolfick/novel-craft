// Chapter writer: a drawer on the left with a chapter note's frontmatter fields on top and its text below, edited
// as blocks (paragraphs, headings, lists, quotes and callouts…) like the plan outline editor, saved as markdown.
import { h } from "preact";
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";
import { parseBlocks, serializeBlocks, blockMarkdown, newBlock, defaultSep, isList, isProse, wordCount, toggleWrap, IMAGE_ONLY, inlineHtml } from "./blocks.js";
import { api, useApi, qs, toast, store, markDirty, confirmDiscard, Loading, openInDrawer, fieldInput, useNovelLinks, Html } from "./app.js";

const html = htm.bind(h);
const chapterHref = (folder, n) => `#/chapter/${encodeURIComponent(folder)}/${n}`;

// ------------------------------------------------------------------ writer drawer state

// {folder, n, open}: the chapter in the writer; collapsed it is a tab on the left edge and stays mounted
let writer = { folder: null, n: null, open: false };
const writerListeners = new Set();
const setWriter = (w) => { writer = w; writerListeners.forEach((f) => f(w)); };
export function useWriter() {
    const [w, set] = useState(writer);
    useEffect(() => { writerListeners.add(set); return () => writerListeners.delete(set); }, []);
    return w;
}
export function collapseWriter() { if (writer.open) setWriter({ ...writer, open: false }); }
export function expandWriter() { if (writer.folder && !writer.open) setWriter({ ...writer, open: true }); }
/** Write a chapter: its text on the left, its plan and ledger entries in the drawer on the right */
export function openWriter(folder, n, { withPlan = true } = {}) {
    const same = writer.folder === folder && Number(writer.n) === Number(n);
    if (!same && writer.folder && !confirmDiscard("writer")) return;
    setWriter({ folder, n: Number(n), open: true });
    if (withPlan) openInDrawer(chapterHref(folder, n));
}

/** Ctrl+[ : open or close the writer (on a chapter page with no chapter in the writer yet, that chapter) */
export function toggleWriter() {
    if (writer.folder) return setWriter({ ...writer, open: !writer.open });
    const m = /^#\/chapter\/([^/]+)\/([\d.]+)/.exec(location.hash);
    if (m) return openWriter(decodeURIComponent(m[1]), Number(m[2]), { withPlan: false });
    toast("No chapter in the writer yet: open a chapter and press ✎ Write");
}

export function WriterDrawer({ index }) {
    const w = useWriter();
    if (!w.folder) return null;
    return html`<div class=${`writer-wrap ${w.open ? "open" : "collapsed"}`}>
        <button class="writer-tab" title=${`Open the writer: chapter ${w.n} (Ctrl+[)`} onClick=${expandWriter} tabIndex=${w.open ? -1 : 0}><span>✎ Chapter ${w.n}</span></button>
        <aside class="writer" inert=${!w.open} aria-label="Chapter writer">
            <${ChapterWriter} key=${`${w.folder}:${w.n}`} folder=${w.folder} n=${w.n} index=${index} />
        </aside>
    </div>`;
}

// ------------------------------------------------------------------ chapter writer

const READONLY = new Set(["type", "created date", "created-date"]);
const LIST_KEYS = new Set(["characters-mentioned", "cssclasses", "tags", "aliases"]);
const sameVal = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
const coerceNum = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

function ChapterWriter({ folder, n, index }) {
    const { data, error } = useApi(`/api/write?${qs({ novel: folder, n })}`);
    const novelLinks = useNovelLinks(folder);
    const [fmEdits, setFmEdits] = useState({});
    const [draft, setDraft] = useState(null); // edited body, null = untouched
    const [baseMtime, setBaseMtime] = useState(null);
    const [saved, setSaved] = useState({ mtime: 0, fm: {}, body: null });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [preview, setPreview] = useState(false);
    const [showFields, setShowFieldsState] = useState(store.get("writerFields", true));
    const setShowFields = (v) => { setShowFieldsState(v); store.set("writerFields", v); };
    const startWords = useRef(null);
    const bodyRef = useRef();
    const findRef = useRef();
    const find = useFind(bodyRef);
    const c = data?.chapter;
    const fresh = !c || c.mtime >= saved.mtime;
    const fm = !c ? {} : fresh ? c.fm : { ...c.fm, ...saved.fm };
    const body = !c ? "" : fresh ? c.body : saved.body ?? c.body;
    const mtime = Math.max(c?.mtime ?? 0, saved.mtime);
    const text = draft ?? body;
    const changedKeys = Object.keys(fmEdits).filter((k) => !sameVal(fmEdits[k], fm[k]));
    const bodyChanged = draft != null && draft !== body;
    const dirty = changedKeys.length > 0 || bodyChanged;
    const words = useMemo(() => wordCount(text), [text]);
    if (c && startWords.current == null) startWords.current = wordCount(c.body);
    const dirtyKey = `write:${folder}:${n}`;
    useEffect(() => markDirty("writer", dirtyKey, dirty), [dirty]);
    useEffect(() => () => markDirty("writer", dirtyKey, false), []);
    const touch = () => { if (baseMtime == null) setBaseMtime(mtime); };
    const editField = (k, v) => { touch(); setFmEdits((s) => ({ ...s, [k]: v })); };
    const editBody = (md) => { touch(); setDraft(md); };
    const reset = () => { setFmEdits({}); setDraft(null); setBaseMtime(null); setErr(""); };
    const save = async () => {
        if (!dirty || busy || !c) return;
        setBusy(true); setErr("");
        try {
            const set = Object.fromEntries(changedKeys.map((k) => [k, coerceNum(fmEdits[k])]));
            const r = await api.send("PATCH", "/api/note", { path: c.path, set, body: bodyChanged ? draft : undefined, baseMtime: baseMtime ?? mtime });
            setSaved({ mtime: r.mtime, fm: { ...(fresh ? {} : saved.fm), ...set }, body: bodyChanged ? draft : fresh ? null : saved.body });
            reset();
            toast("Chapter saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const go = (m) => { if (m != null) openWriter(folder, m); };
    const onKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "f" && c) { e.preventDefault(); findRef.current?.focus(); findRef.current?.select(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
        if ((e.ctrlKey || e.metaKey) && e.key === "e" && c) { e.preventDefault(); setPreview(!preview); }
    };
    if (!data) return html`<div class="writer-body"><${Loading} error=${error} /></div>`;
    const title = (changedKeys.includes("chapter title") ? fmEdits["chapter title"] : fm["chapter title"]) || c?.title || data.workingTitle;
    return html`<div class="writer-inner" onKeyDown=${onKeyDown}>
        <header class="writer-head">
            ${c && html`<${FindBar} find=${find} inputRef=${findRef} />`}
            <div class="writer-title">
                <div class="muted">${data.novel}</div>
                <b>Chapter ${data.n}${title ? `: ${title}` : ""}</b>
            </div>
            <div class="row">
                <button class="small" disabled=${data.prev == null} title="Previous chapter" onClick=${() => go(data.prev)}>←</button>
                <button class="small" title="Next chapter" onClick=${() => go(data.next ?? data.n + 1)}>→</button>
                ${c && html`<span class="muted writer-words" title="Words in this chapter (comments and markup don't count)">${words.toLocaleString()} words${words !== startWords.current ? html` <span class=${words > startWords.current ? "up" : "down"}>${words > startWords.current ? "+" : "−"}${Math.abs(words - startWords.current)}</span>` : ""}</span>`}
                ${c && html`<button class=${`small ${preview ? "on" : ""}`} aria-pressed=${preview} title="Preview (Ctrl+E)" onClick=${() => setPreview(!preview)}>Preview</button>`}
                ${c && html`<button class="primary small" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save"}</button>`}
                <button class="small" title="Collapse the writer (Ctrl+[)" onClick=${collapseWriter}>«</button>
            </div>
        </header>
        <div class="writer-body" ref=${bodyRef}>
            ${!c ? html`<${NewChapter} data=${data} folder=${folder} />` : html`
                <section class=${`writer-fields ${showFields ? "open" : ""}`}>
                    <button class="writer-fields-head" aria-expanded=${showFields} onClick=${() => setShowFields(!showFields)}>
                        <span class="caret" aria-hidden="true">▸</span> Details <span class="muted">${fieldSummary(fm)}</span>
                        ${changedKeys.length > 0 && html`<span class="badge">${changedKeys.length} changed</span>`}</button>
                    ${showFields && html`<div class="writer-fieldlist">${Object.keys(fm).map((k) => html`<div class=${`wf ${changedKeys.includes(k) ? "changed" : ""}`} key=${k}>
                        <label>${k}</label>
                        ${READONLY.has(k) ? html`<div class="ro muted">${String(fm[k] ?? "")}</div>` : chapterField(k, k in fmEdits ? fmEdits[k] : fm[k], fm[k], (v) => editField(k, v), index, novelLinks)}
                    </div>`)}</div>`}
                </section>
                ${preview ? html`<${Preview} md=${text} /> ` : html`<${BlockEditor} value=${text} onChange=${editBody} breaks=${data.breaks ?? []} />`}
            `}
        </div>
        ${c && html`<footer class="writer-foot">
            ${err && html`<div class="error writer-error">${err}${/changed since/.test(err) ? html` <button class="small" onClick=${reset}>Load the saved version (discards your changes)</button>` : ""}</div>`}
            <div class=${`savebar ${dirty ? "dirty" : ""}`}>
                <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save changes"}</button>
                ${dirty && html`<button onClick=${reset}>Discard</button><span class="muted">Ctrl+S</span>`}
                <span class="muted grow" style="text-align:right">${c.path.split("/").pop()}</span>
            </div>
        </footer>`}
    </div>`;
}

// ------------------------------------------------------------------ find in the chapter

const canHighlight = () => typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight === "function";

/** Ranges of every match of `q` (ignoring case) in the chapter's shown text: formatted blocks, callouts, the preview */
function findRanges(root, q) {
    const out = [];
    const needle = q.toLowerCase();
    if (!root || !needle) return out;
    for (const el of root.querySelectorAll(".be-text, .be-render, .writer-preview")) {
        const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
        const nodes = [];
        let text = "";
        for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, text.length]); text += n.data; }
        const low = text.toLowerCase();
        // the text node holding position p (an end position may sit at the very end of a node)
        const at = (p, end) => { for (const [n, o] of nodes) if (p < o + n.data.length || (end && p === o + n.data.length)) return [n, p - o]; return null; };
        for (let i = low.indexOf(needle); i > -1; i = low.indexOf(needle, i + needle.length)) {
            const a = at(i, false), b = at(i + needle.length, true);
            if (!a || !b) continue;
            const r = document.createRange();
            r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
            out.push(r);
        }
    }
    return out;
}

/**
 * Find in the writer: highlights matches with the CSS Custom Highlight API (the text itself is untouched) and keeps
 * them current as the chapter re-renders. The block being edited is a text box, so searching closes it first.
 */
function useFind(rootRef) {
    const [q, setQ] = useState("");
    const [cur, setCur] = useState(0);
    const [count, setCount] = useState(0);
    const ranges = useRef([]);
    const [, setTick] = useState(0);
    // the editor re-renders on its own (opening a block, callouts arriving): find again after DOM changes
    useEffect(() => {
        if (!q || typeof MutationObserver !== "function" || !rootRef.current) return;
        let frame = 0;
        const mo = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setTick((t) => t + 1)); });
        mo.observe(rootRef.current, { childList: true, subtree: true, characterData: true });
        return () => { mo.disconnect(); cancelAnimationFrame(frame); };
    }, [q, !!rootRef.current]);
    useLayoutEffect(() => {
        ranges.current = q ? findRanges(rootRef.current, q) : [];
        const n = ranges.current.length;
        if (n !== count) setCount(n);
        if (!canHighlight()) return;
        const i = Math.min(cur, n - 1);
        CSS.highlights.set("writer-find", new Highlight(...ranges.current.filter((_, k) => k !== i)));
        CSS.highlights.set("writer-find-current", new Highlight(...(i >= 0 ? [ranges.current[i]] : [])));
    });
    useEffect(() => () => { if (canHighlight()) { CSS.highlights.delete("writer-find"); CSS.highlights.delete("writer-find-current"); } }, []);
    const show = (i) => {
        const r = ranges.current[i];
        const box = rootRef.current;
        if (!r || !box || typeof r.getBoundingClientRect !== "function") return;
        const rect = r.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (rect.top < b.top + 60 || rect.bottom > b.bottom - 20) box.scrollTop += rect.top - b.top - b.height / 3;
    };
    const go = (by) => {
        const n = ranges.current.length;
        if (!n) return;
        const i = ((Math.min(cur, n - 1) + by) % n + n) % n;
        setCur(i);
        show(i);
    };
    return { q, setQ: (v) => { setQ(v); setCur(0); }, cur: Math.min(cur, Math.max(0, count - 1)), count, next: () => go(1), prev: () => go(-1), show: () => show(Math.min(cur, count - 1)) };
}

function FindBar({ find, inputRef }) {
    useEffect(() => { if (find.q) find.show(); }, [find.q, find.count > 0]);
    return html`<div class="writer-find" role="search">
        <input ref=${inputRef} type="search" placeholder="Find in chapter…" aria-label="Find in chapter" value=${find.q}
            onInput=${(e) => find.setQ(e.target.value)}
            onKeyDown=${(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? find.prev() : find.next(); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); find.setQ(""); }
            }} />
        <span class="muted find-count">${find.q ? (find.count ? `${find.cur + 1} / ${find.count}` : "0") : ""}</span>
        <button class="small" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled=${!find.count} onClick=${find.prev}>↑</button>
        <button class="small" title="Next match (Enter)" aria-label="Next match" disabled=${!find.count} onClick=${find.next}>↓</button>
    </div>`;
}

function fieldSummary(fm) {
    const chars = [].concat(fm["characters-mentioned"] ?? []).filter(Boolean).length;
    return [fm.arc, chars ? `${chars} character${chars === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

function chapterField(k, value, original, onChange, index, novelLinks) {
    const def = LIST_KEYS.has(k) || Array.isArray(original) ? [] : typeof original === "boolean" ? false : "";
    const target = k === "characters-mentioned" ? "@characters" : [].concat(original ?? []).some((v) => typeof v === "string" && /^\[\[.+\]\]$/.test(v.trim())) ? "" : undefined;
    const options = k === "characters-mentioned" ? novelLinks?.["@characters"] ?? [] : undefined;
    return fieldInput({ key: k, def, target, value: def === "" && value == null ? "" : value, onChange, index, options });
}

/** A chapter without a note yet: make one like the Templater Chapter template does */
function NewChapter({ data, folder }) {
    const [title, setTitle] = useState(data.workingTitle);
    const [busy, setBusy] = useState(false);
    const create = async () => {
        setBusy(true);
        try { await api.send("POST", "/api/write/chapter", { novel: folder, n: data.n, title: title.trim() }); toast(`Chapter ${data.n} created`); }
        catch (e) { toast(e.message); }
        setBusy(false);
    };
    return html`<div class="panel writer-new">
        <h2 style="margin-top:0">Chapter ${data.n} has no note yet</h2>
        <p class="muted">Create the chapter note to start writing. It is named like the Templater Chapter template names it.</p>
        <label class="row">Title <input class="grow" value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="Chapter title (optional)"
            onKeyDown=${(e) => { if (e.key === "Enter") create(); }} /></label>
        <div class="row" style="margin-top:12px"><button class="primary" disabled=${busy} onClick=${create}>Create chapter ${data.n}</button></div>
    </div>`;
}

function Preview({ md }) {
    const [out, setOut] = useState(null);
    useEffect(() => {
        let live = true;
        const t = setTimeout(() => api.send("POST", "/api/render", { markdown: md }).then((r) => live && setOut(r.html)).catch((e) => live && setOut(`<p class="error">${e.message}</p>`)), 120);
        return () => { live = false; clearTimeout(t); };
    }, [md]);
    return out == null ? html`<${Loading} />` : html`<div data-drawer><${Html} html=${out} class="md writer-preview" /></div>`;
}

// ------------------------------------------------------------------ block editor

const KIND_BUTTONS = [
    ["p", "¶", "Paragraph"], ["h1", "H1", "Heading 1"], ["h2", "H2", "Heading 2"], ["h3", "H3", "Heading 3"],
    ["ul", "•", "Bullet list"], ["ol", "1.", "Numbered list"], ["task", "☐", "Task"], ["quote", "❝", "Quote"],
    ["callout", "[!]", "Callout"], ["code", "</>", "Code block"], ["hr", "—", "Divider"],
];
const WRAPS = [["**", "**", "B", "Bold (Ctrl+B)"], ["*", "*", "I", "Italic (Ctrl+I)"], ["~~", "~~", "S", "Strikethrough (Ctrl+Shift+X)"], ["==", "==", "H", "Highlight (Ctrl+Shift+H)"],
    ["[[", "]]", "[[ ]]", "Link to a note (Ctrl+K)"], ["%% ", " %%", "%%", "Comment, not shown in Obsidian's reading view (Ctrl+/)"]];
// keyboard shortcuts for inline markup: key (with Shift: upper case) -> [left, right]
const WRAP_KEYS = { b: ["**", "**"], i: ["*", "*"], k: ["[[", "]]"], X: ["~~", "~~"], H: ["==", "=="], "/": ["%% ", " %%"] };
// rendered HTML of blocks shown as they look (callouts, quotes, image lines), shared across editors
const rendered = new Map();
const rendering = new Set();
/** blocks shown rendered until clicked: quotes and callouts, and paragraphs that are only an image (scene breaks) */
const showsRendered = (b) => b.kind === "quote" || (b.kind === "p" && IMAGE_ONLY.test(b.text));
/** prose shown formatted (bold, italic…) except while its text is being edited */
const showsLive = (b) => isProse(b) && !showsRendered(b);

/** Source offset of the text under a click in a live-preview block (its spans carry data-s), or null */
function sourceOffsetAt(x, y) {
    let node = null, off = 0;
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); node = p?.offsetNode; off = p?.offset ?? 0; }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; off = r?.startOffset ?? 0; }
    if (!node || node.nodeType !== 3) return null;
    const span = node.parentElement?.closest("[data-s]");
    return span ? Number(span.dataset.s) + off : null;
}
const HISTORY = 200;

/**
 * Chapter text editor. One textarea per block; Enter starts the next paragraph (or list item), Shift+Enter breaks the
 * line inside it, Backspace at the start turns a heading/list/quote back into a paragraph or joins the one above,
 * Tab / Shift+Tab indent list items, Alt+↑↓ moves a block. Typing "# ", "- ", "1. ", "> " or "- [ ] " at the start of
 * a paragraph turns it into that block; "---" + Enter makes a divider. Ctrl+Z / Ctrl+Shift+Z undo and redo.
 */
export function BlockEditor({ value, onChange, breaks = [] }) {
    const [doc, setDoc] = useState(() => withBlock(parseBlocks(value)));
    const [editing, setEditing] = useState(null); // id of the block whose text is being edited (the others show formatted)
    const [, setRenderTick] = useState(0);
    const [breakImg, setBreakImgState] = useState(() => store.get("sceneBreak", ""));
    const setBreakImg = (v) => { setBreakImgState(v); store.set("sceneBreak", v); };
    const sceneBreak = breaks.includes(breakImg) ? breakImg : breaks[0] ?? "pb-straight-fadeout.png";
    const emitted = useRef(value ?? "");
    const refs = useRef(new Map());
    const focus = useRef(null);
    const cur = useRef({ i: 0, start: 0, end: 0 });
    const heights = useRef(new WeakMap()); // textarea -> text its height was fitted for
    const box = useRef();
    const hist = useRef({ undo: [], redo: [], at: 0 });
    useEffect(() => {
        if ((value ?? "") === emitted.current) return;
        emitted.current = value ?? "";
        hist.current = { undo: [], redo: [], at: 0 };
        setDoc(withBlock(parseBlocks(value)));
    }, [value]);
    const blocks = doc.blocks;
    // fit textareas whose text changed (all of them when the width changes)
    useLayoutEffect(() => {
        const els = [];
        for (const b of blocks) {
            const el = refs.current.get(b.id);
            if (el && heights.current.get(el) !== b.text) { heights.current.set(el, b.text); els.push(el); }
        }
        fit(els);
        if (focus.current) {
            const { i, pos, end } = focus.current;
            const b = blocks[Math.max(0, Math.min(i, blocks.length - 1))];
            const el = refs.current.get(b?.id);
            // a rendered block opens for editing first; the focus follows on the next render
            if (!el && b && (showsRendered(b) || showsLive(b)) && editing !== b.id) return setEditing(b.id);
            focus.current = null;
            if (el) {
                el.focus({ preventScroll: true });
                const a = Math.min(pos ?? el.value.length, el.value.length);
                el.setSelectionRange(a, Math.min(end ?? a, el.value.length));
                el.scrollIntoView?.({ block: "nearest" });
            }
        }
    });
    // fetch the HTML of rendered blocks not seen yet
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    useEffect(() => {
        blocks.forEach((b, i) => {
            if (!showsRendered(b) || editing === b.id) return;
            const md = blockMarkdown(b, blocks, i);
            if (rendered.has(md) || rendering.has(md)) return;
            rendering.add(md);
            api.send("POST", "/api/render", { markdown: md }).then((r) => { rendered.set(md, r.html); })
                .catch((e) => rendered.set(md, `<p class="error">${e.message}</p>`))
                .finally(() => { rendering.delete(md); if (mounted.current) setRenderTick((t) => t + 1); });
        });
    });
    useEffect(() => {
        if (typeof ResizeObserver !== "function" || !box.current) return;
        let w = 0;
        const ro = new ResizeObserver(([e]) => { const nw = Math.round(e.contentRect.width); if (nw !== w) { w = nw; fit([...refs.current.values()]); } });
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);

    const emit = (next) => {
        const md = serializeBlocks({ ...doc, blocks: next });
        if (md !== emitted.current) { emitted.current = md; onChange(md); }
    };
    /** typing groups into one undo step per pause; anything else is a step of its own */
    const commit = (next, f, typing = false) => {
        const hs = hist.current, now = Date.now();
        if (!typing || now - hs.at > 900) { hs.undo.push(blocks); if (hs.undo.length > HISTORY) hs.undo.shift(); hs.redo = []; }
        hs.at = typing ? now : 0;
        if (f) focus.current = f;
        next = keepApart(blocks, next);
        setDoc({ ...doc, blocks: next });
        emit(next);
    };
    const restore = (from, to) => {
        const hs = hist.current;
        if (!hs[from].length) return;
        hs[to].push(blocks);
        const next = hs[from].pop();
        hs.at = 0;
        focus.current = { i: Math.min(cur.current.i, next.length - 1) };
        setDoc({ ...doc, blocks: next });
        emit(next);
    };
    const replace = (i, b, f) => commit(blocks.map((x, k) => (k === i ? b : x)), f);
    const splice = (i, del, add, f) => { const next = [...blocks]; next.splice(i, del, ...add); commit(next.length ? next : [newBlock()], f); };

    // ---- block kinds
    const setKind = (i, kind) => {
        const b = blocks[i];
        if (!b) return;
        const plain = b.kind === "code" ? b.text.replace(/^\s*(```|~~~).*\n?|\n?\s*(```|~~~)\s*$/g, "") : b.kind === "quote" ? b.text.replace(/^\[![\w-]+\][+-]?\s?/, "") : b.text;
        if (kind === "hr") {
            const add = [{ ...newBlock("hr"), sep: "\n\n" }];
            if (i === blocks.length - 1) add.push({ ...newBlock("p"), sep: b.sep });
            return splice(i + 1, 0, add, { i: i + 2, pos: 0 });
        }
        const pos = cur.current.i === i ? cur.current.start : plain.length;
        const keep = (extra) => replace(i, { ...b, ...extra }, { i, pos: Math.min(pos, (extra.text ?? b.text).length) });
        if (/^h[1-6]$/.test(kind)) return keep({ kind: "h", level: Number(kind[1]), text: plain.replace(/\n/g, " ") });
        if (kind === "callout") return keep({ kind: "quote", level: 0, text: b.kind === "quote" && /^\[!/.test(b.text) ? b.text : `[!note] ${plain}` });
        if (kind === "code") return keep({ kind: "code", level: 0, text: b.kind === "code" ? b.text : `\`\`\`\n${plain}\n\`\`\`` });
        if (kind === "task") return keep({ kind: "task", level: isList(b) ? b.level : 0, checked: false, text: plain });
        return keep({ kind, level: isList(b) && (kind === "ul" || kind === "ol") ? b.level : 0, checked: undefined, text: plain });
    };
    const wrap = (i, left, right) => {
        const b = blocks[i];
        if (!b || b.kind === "hr") return;
        const el = refs.current.get(b.id);
        const s = el ? el.selectionStart : cur.current.start, e = el ? el.selectionEnd : cur.current.end;
        const r = toggleWrap(b.text, s, e, left, right);
        replace(i, { ...b, text: r.text }, { i, pos: r.s, end: r.e });
    };
    /** a centred scene break line (an image paragraph) after block i; an empty paragraph becomes the break */
    const insertBreak = (i) => {
        const b = blocks[i];
        const br = { ...newBlock("p", `![[${sceneBreak}]]`), sep: "\n\n" };
        const after = { ...newBlock("p"), sep: b ? b.sep : "\n" };
        if (b && b.kind === "p" && !b.text.trim()) return splice(i, 1, [br, after], { i: i + 1, pos: 0 });
        const next = blocks[i + 1];
        if (next && next.kind === "p" && !next.text.trim()) return splice(i + 1, 0, [br], { i: i + 2, pos: 0 });
        return splice(i + 1, 0, [br, after], { i: i + 2, pos: 0 });
    };

    // ---- typing
    const onInput = (i) => (e) => {
        const b = blocks[i], el = e.target;
        let t = el.value;
        if (b.kind === "h") t = t.replace(/\n/g, " ");
        // markdown shortcuts at the start of a paragraph
        if (b.kind === "p" && !t.includes("\n") && el.selectionStart <= 8) {
            const at = el.selectionStart;
            let m;
            const turn = (extra, cut) => commit(blocks.map((x, k) => (k === i ? { ...x, ...extra, text: t.slice(cut) } : x)), { i, pos: Math.max(0, at - cut) });
            if ((m = /^(#{1,6}) /.exec(t)) && at === m[0].length) return turn({ kind: "h", level: m[1].length }, m[0].length);
            if ((m = /^[-*+] \[([ xX])\] /.exec(t)) && at === m[0].length) return turn({ kind: "task", level: 0, checked: m[1] !== " " }, m[0].length);
            if ((m = /^([-*+]) /.exec(t)) && at === 2 && !/^[-*+] \[/.test(t)) return turn({ kind: "ul", level: 0, marker: m[1] }, 2);
            if ((m = /^(\d{1,3})([.)]) /.exec(t)) && at === m[0].length) return turn({ kind: "ol", level: 0, marker: `${m[1]}${m[2]}` }, m[0].length);
            if ((m = /^> /.exec(t)) && at === 2) return turn({ kind: "quote", level: 0 }, 2);
        }
        commit(blocks.map((x, k) => (k === i ? { ...x, text: t } : x)), null, true);
    };

    const onKeyDown = (i) => (e) => {
        const b = blocks[i], el = e.target;
        const start = el.selectionStart, end = el.selectionEnd, len = el.value.length;
        const mod = e.ctrlKey || e.metaKey;
        if (e.isComposing) return;
        if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
            e.preventDefault();
            return e.key === "y" || e.shiftKey ? restore("redo", "undo") : restore("undo", "redo");
        }
        const wk = mod && !e.altKey ? WRAP_KEYS[e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase()] : null;
        if (wk && b.kind !== "hr" && b.kind !== "code" && b.kind !== "raw") { e.preventDefault(); return wrap(i, wk[0], wk[1]); }
        if (mod && e.shiftKey && e.key === "Enter") { e.preventDefault(); return insertBreak(i); }
        if (e.key === "Escape" && (showsRendered(b) || showsLive(b))) { e.preventDefault(); el.blur(); return; }
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const j = e.key === "ArrowUp" ? i - 1 : i + 1;
            if (j < 0 || j >= blocks.length) return;
            // the separators stay in place, so lists keep their single line breaks
            const next = [...blocks];
            next[i] = { ...blocks[j], sep: blocks[i].sep };
            next[j] = { ...blocks[i], sep: blocks[j].sep };
            return commit(next, { i: j, pos: start });
        }
        // moving between blocks when the caret can't go further inside this one
        if (!mod && !e.shiftKey && !e.altKey) {
            if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && start === 0 && end === 0 && i > 0) { e.preventDefault(); focus.current = { i: i - 1 }; return setDoc({ ...doc }); }
            if ((e.key === "ArrowDown" || e.key === "ArrowRight") && start === len && end === len && i < blocks.length - 1) { e.preventDefault(); focus.current = { i: i + 1, pos: 0 }; return setDoc({ ...doc }); }
        }
        if (b.kind === "hr") {
            if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); return splice(i, 1, [], { i: e.key === "Backspace" ? i - 1 : i }); }
            if (e.key === "Enter") { e.preventDefault(); return splice(i + 1, 0, [{ ...newBlock("p"), sep: blocks[i].sep }], { i: i + 1, pos: 0 }); }
            if (e.key.length === 1 && !mod) e.preventDefault();
            return;
        }
        if (e.key === "Tab") {
            if (b.kind === "code" || b.kind === "raw") {
                e.preventDefault();
                return replace(i, { ...b, text: b.text.slice(0, start) + "\t" + b.text.slice(end) }, { i, pos: start + 1 });
            }
            e.preventDefault();
            if (!isList(b)) return;
            if (e.shiftKey) { if (b.level > 0) replace(i, { ...b, level: b.level - 1 }, { i, pos: start }); }
            else if (isList(blocks[i - 1]) && blocks[i - 1].level >= b.level) replace(i, { ...b, level: b.level + 1 }, { i, pos: start });
            return;
        }
        if (e.key === "Enter" && !mod) {
            // quotes and callouts keep their lines together; Enter on an empty last line leaves them
            if (b.kind === "quote") {
                if (e.shiftKey || start !== len || !b.text.endsWith("\n")) return;
                e.preventDefault();
                return splice(i, 1, [{ ...b, text: b.text.replace(/\n$/, ""), sep: "\n\n" }, { ...newBlock("p"), sep: b.sep }], { i: i + 1, pos: 0 });
            }
            if (!isProse(b)) return;
            if (e.shiftKey) { if (b.kind === "h") e.preventDefault(); return; }
            e.preventDefault();
            if (b.kind === "p" && /^ {0,3}([-*_])( *\1){2,} *$/.test(b.text)) {
                return splice(i, 1, [{ ...newBlock("hr"), raw: b.text.trim(), sep: "\n\n" }, { ...newBlock("p"), sep: b.sep }], { i: i + 1, pos: 0 });
            }
            if (isList(b) && !b.text) {
                if (b.level > 0) return replace(i, { ...b, level: b.level - 1 }, { i, pos: 0 });
                return replace(i, { ...b, kind: "p", level: 0, checked: undefined, sep: blocks[i + 1] && isList(blocks[i + 1]) ? "\n\n" : b.sep }, { i, pos: 0 });
            }
            const second = isList(b) ? { ...newBlock(b.kind), level: b.level, marker: b.kind === "ol" ? undefined : b.marker, checked: b.kind === "task" ? false : undefined }
                : newBlock("p");
            second.text = b.text.slice(end);
            second.sep = b.sep;
            const first = { ...b, text: b.text.slice(0, start) };
            first.sep = defaultSep(first, second);
            return splice(i, 1, [first, second], { i: i + 1, pos: 0 });
        }
        if (e.key === "Backspace" && start === 0 && end === 0) {
            if (isList(b) && b.level > 0) { e.preventDefault(); return replace(i, { ...b, level: b.level - 1 }, { i, pos: 0 }); }
            if (b.kind === "h" || isList(b) || (b.kind === "quote" && !b.text)) {
                e.preventDefault();
                return replace(i, { ...b, kind: "p", level: 0, checked: undefined, sep: isList(b) && isList(blocks[i + 1]) ? "\n\n" : b.sep }, { i, pos: 0 });
            }
            if (b.kind !== "p" || i === 0) return;
            const prev = blocks[i - 1];
            e.preventDefault();
            if (prev.kind === "hr") return splice(i - 1, 1, [], { i: i - 1, pos: 0 });
            if (!isProse(prev) && prev.kind !== "quote") { focus.current = { i: i - 1 }; return setDoc({ ...doc }); }
            return splice(i - 1, 2, [{ ...prev, text: prev.text + b.text, sep: b.sep }], { i: i - 1, pos: prev.text.length });
        }
        if (e.key === "Delete" && start === len && end === len && i < blocks.length - 1 && (isProse(b) || b.kind === "quote")) {
            const next = blocks[i + 1];
            if (next.kind === "hr") { e.preventDefault(); return splice(i + 1, 1, [], { i, pos: start }); }
            if (!isProse(next)) return;
            e.preventDefault();
            return splice(i, 2, [{ ...b, text: b.text + next.text, sep: next.sep }], { i, pos: start });
        }
    };

    const onPaste = (i) => (e) => {
        const b = blocks[i];
        const pasted = e.clipboardData?.getData("text/plain") ?? "";
        if (!pasted.includes("\n") || !isProse(b)) return;
        const parts = parseBlocks(pasted.replace(/\s+$/, "")).blocks;
        if (parts.length < 2) return;
        e.preventDefault();
        const el = e.target;
        const before = b.text.slice(0, el.selectionStart), after = b.text.slice(el.selectionEnd);
        const add = [];
        if (before) add.push({ ...b, text: before });
        add.push(...parts);
        if (after) add.push(isList(b) ? { ...newBlock(b.kind), level: b.level, text: after } : { ...newBlock("p"), text: after });
        // pasted blocks keep the line breaks they had between them
        const own = new Set(parts.slice(0, -1));
        for (let k = 0; k < add.length - 1; k++) if (!own.has(add[k]) || !add[k].sep.includes("\n")) add[k] = { ...add[k], sep: defaultSep(add[k], add[k + 1]) };
        add[add.length - 1] = { ...add[add.length - 1], sep: b.sep };
        const lastPasted = i + (before ? 1 : 0) + parts.length - 1;
        splice(i, 1, add, { i: lastPasted, pos: parts.at(-1).text.length });
    };

    const track = (i) => (e) => { cur.current = { i, start: e.target.selectionStart, end: e.target.selectionEnd }; };
    const tool = (f) => (e) => { e.preventDefault(); f(cur.current.i); };
    const curBlock = blocks[cur.current.i];
    const kindOf = (b) => (!b ? "" : b.kind === "h" ? `h${b.level}` : b.kind === "quote" && /^\[!/.test(b.text) ? "callout" : b.kind);
    const numbers = olNumbers(blocks);
    return html`<div class="block-editor" ref=${box}>
        <div class="be-toolbar" role="toolbar" aria-label="Formatting">
            <span class="be-group">${KIND_BUTTONS.map(([k, label, tip]) => html`<button class=${`small ${kindOf(curBlock) === k ? "on" : ""}`} title=${tip} aria-label=${tip}
                onMouseDown=${tool((i) => setKind(i, k))}>${label}</button>`)}</span>
            <span class="be-group">${WRAPS.map(([l, r, label, tip]) => html`<button class="small" title=${tip} aria-label=${tip} onMouseDown=${tool((i) => wrap(i, l, r))}>${label}</button>`)}</span>
            <span class="be-group">
                <button class="small" title="Insert a centred scene break line (Ctrl+Shift+Enter)" onMouseDown=${tool((i) => insertBreak(i))}>✱ Break</button>
                ${breaks.length > 1 && html`<select class="be-break-pick" value=${sceneBreak} title="Scene break image" aria-label="Scene break image" onChange=${(e) => setBreakImg(e.target.value)}>
                    ${breaks.map((x) => html`<option value=${x}>${x.replace(/^pb-|\.\w+$/g, "")}</option>`)}</select>`}
            </span>
            <span class="be-group">
                <button class="small" title="Undo (Ctrl+Z)" aria-label="Undo" disabled=${!hist.current.undo.length} onMouseDown=${tool(() => restore("undo", "redo"))}>↶</button>
                <button class="small" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled=${!hist.current.redo.length} onMouseDown=${tool(() => restore("redo", "undo"))}>↷</button>
            </span>
        </div>
        <div class="be-page">
            ${blocks.map((b, i) => showsRendered(b) && editing !== b.id ? html`<div key=${b.id} class=${`be-row be-rendered ${b.kind === "p" ? "be-image" : "be-quote-view"}`}>
                <div class="be-render md" tabIndex="0" role="button" aria-label=${b.kind === "p" ? "Image line: Enter to edit" : "Callout: Enter to edit"} title="Click to edit"
                    onClick=${(e) => {
                        const a = e.target.closest?.("a[href]");
                        if (a) { e.preventDefault(); if (a.getAttribute("href").startsWith("#/")) openInDrawer(a.getAttribute("href")); return; }
                        focus.current = { i, pos: 0 }; setEditing(b.id);
                    }}
                    onKeyDown=${(e) => {
                        if (e.key === "Enter") { e.preventDefault(); focus.current = { i, pos: 0 }; setEditing(b.id); }
                        else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && i > 0) { e.preventDefault(); focus.current = { i: i - 1 }; setDoc({ ...doc }); }
                        else if ((e.key === "ArrowDown" || e.key === "ArrowRight") && i < blocks.length - 1) { e.preventDefault(); focus.current = { i: i + 1, pos: 0 }; setDoc({ ...doc }); }
                        else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); splice(i, 1, [], { i: Math.max(0, e.key === "Backspace" ? i - 1 : i) }); }
                    }}
                    dangerouslySetInnerHTML=${{ __html: rendered.get(blockMarkdown(b, blocks, i)) ?? `<p class="muted">${b.kind === "p" ? "Image" : "Callout"}…</p>` }} />
            </div>` : showsLive(b) && editing !== b.id ? html`<div key=${b.id} class=${`be-row be-${b.kind} be-live ${b.kind === "h" ? `be-h${b.level}` : ""} ${b.sep.length > 1 || !isList(b) ? "" : "tight"}`}
                style=${`--level:${b.level ?? 0}`}>
                ${gutter(b, numbers[i], () => replace(i, { ...b, checked: !b.checked }, { i }))}
                <div class="be-text" lang="en" onClick=${(e) => {
                    // selecting text (to copy it) doesn't open the block; Ctrl+click on a link opens the note in the drawer
                    if (window.getSelection?.()?.isCollapsed === false) return;
                    const link = e.target.closest?.(".be-link[title]");
                    if (link && (e.ctrlKey || e.metaKey)) { const n = link.getAttribute("title"); openInDrawer(`#/note/${encodeURIComponent(n)}`); return; }
                    const pos = sourceOffsetAt(e.clientX, e.clientY);
                    focus.current = { i, pos: pos ?? b.text.length };
                    setEditing(b.id);
                }} dangerouslySetInnerHTML=${{ __html: inlineHtml(b.text) || `<span class="be-empty">${i === 0 && blocks.length === 1 ? "Start writing…" : "\u200b"}</span>` }} />
            </div>` : html`<div key=${b.id} class=${`be-row be-${b.kind} ${b.kind === "h" ? `be-h${b.level}` : ""} ${b.kind === "quote" && /^\[!/.test(b.text) ? "be-callout" : ""} ${b.sep.length > 1 || !isList(b) ? "" : "tight"}`}
                style=${`--level:${b.level ?? 0}`}>
                ${gutter(b, numbers[i], () => replace(i, { ...b, checked: !b.checked }, { i }))}
                <textarea ref=${(el) => { if (el) refs.current.set(b.id, el); else refs.current.delete(b.id); }} rows="1"
                    value=${b.kind === "hr" ? "" : b.text} readOnly=${b.kind === "hr"} spellcheck=${b.kind !== "code" && b.kind !== "raw"}
                    placeholder=${blocks.length === 1 && i === 0 ? "Start writing…" : b.kind === "h" ? "Heading" : ""}
                    aria-label=${b.kind === "hr" ? "Divider" : undefined}
                    onInput=${onInput(i)} onKeyDown=${onKeyDown(i)} onPaste=${onPaste(i)}
                    onFocus=${(e) => { track(i)(e); if (editing !== b.id) setEditing(b.id); }} onSelect=${track(i)} onKeyUp=${track(i)} onMouseUp=${track(i)}
                    onBlur=${() => { if (editing === b.id) setEditing(null); }} />
            </div>`)}
        </div>
        <div class="plan-hint muted">Enter: new paragraph · Shift+Enter: line break · "# ", "- ", "1. ", "> " at the start: heading, list, quote · Tab: indent list · Alt+↑↓: move · Ctrl+B / I / K: bold, italic, link · Ctrl+Shift+Enter: scene break · click text to edit it, Escape to show it formatted · Ctrl+click a link to open it</div>
    </div>`;
}

/**
 * Blocks that are new or newly next to each other get a blank line between them where a single line break would
 * make markdown read them as one (a paragraph after a list item or quote continues it; "---" under a paragraph makes it
 * a heading). Untouched neighbours keep their separators.
 */
function keepApart(prev, next) {
    const at = new Map(prev.map((b, k) => [b, k]));
    const risky = (a, b) => (b.kind === "p" && !["h", "hr", "code"].includes(a.kind)) || (a.kind === "p" && (b.kind === "hr" || b.kind === "ol" || b.kind === "raw"))
        || (a.kind === "quote" && b.kind !== "quote" && b.kind !== "h") || (isList(a) && !isList(b) && b.kind !== "h" && b.kind !== "hr") || (a.kind === "quote" && b.kind === "quote");
    let out = next;
    for (let k = 0; k < next.length - 1; k++) {
        const a = next[k], b = next[k + 1];
        if (at.has(a) && at.has(b) && at.get(b) === at.get(a) + 1) continue;
        if (/\n[ \t]*\n/.test(a.sep) || !risky(a, b)) continue;
        if (out === next) out = [...next];
        out[k] = { ...a, sep: "\n\n" };
    }
    return out;
}

// an empty document still has one paragraph to type in
const withBlock = (d) => (d.blocks.length ? d : { ...d, blocks: [{ ...newBlock("p"), sep: d.lead ? "" : "\n" }] });

function gutter(b, num, toggle) {
    if (b.kind === "ul") return html`<span class="be-mark" aria-hidden="true">•</span>`;
    if (b.kind === "ol") return html`<span class="be-mark num" aria-hidden="true">${num}.</span>`;
    if (b.kind === "task") return html`<input type="checkbox" class="be-mark" checked=${!!b.checked} onChange=${toggle} aria-label="Done" />`;
    if (b.kind === "h") return html`<span class="be-mark h" aria-hidden="true">H${b.level}</span>`;
    return null;
}

// numbers shown beside numbered items (what serialising would write)
function olNumbers(blocks) {
    const out = [];
    blocks.forEach((b, i) => { if (b.kind === "ol") out[i] = parseInt(blockMarkdown(b, blocks, i).trim(), 10); });
    return out;
}

/** Fit textareas to their text, keeping scrolled ancestors where they were */
function fit(els) {
    if (!els.length) return;
    const scrolled = [];
    for (let n = els[0].parentElement; n; n = n.parentElement) if (n.scrollTop) scrolled.push([n, n.scrollTop]);
    for (const el of els) el.style.height = "auto";
    for (const el of els) el.style.height = `${el.scrollHeight + 2}px`;
    for (const [n, top] of scrolled) n.scrollTop = top;
}
