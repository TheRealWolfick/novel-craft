// Chapter text as editable blocks (paragraphs, headings, list items, quotes and callouts, code, dividers) and back.
// Shared by the chapter writer (browser) and the tests. Untouched blocks are written back exactly as they were read
// (`raw`), and the whitespace after each block (`sep`) is kept, so saving a chapter only changes what was edited.
//
// Block: {id, kind, text, level, sep, raw?, src?}
//   kind  p | h | ul | ol | task | quote | code | hr | raw (tables and anything kept as it is)
//   text  what is edited: a paragraph's lines, a heading or list item without its marker, a quote without "> "
//   level heading level (1-6) or list indent (0 = top)
//   sep   the text between this block and the next ("\n\n" between paragraphs, "\n" between list items)

let nextId = 1;
export const blockId = () => `b${nextId++}`;

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const QUOTE = /^>/;
const LIST = /^([ \t]*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
const TABLE = /^\s*\|/;
const LIST_KINDS = new Set(["ul", "ol", "task"]);
export const isList = (b) => LIST_KINDS.has(b?.kind);
/** kinds whose text is edited as prose (Enter starts a new block) */
export const isProse = (b) => b && ["p", "h", "ul", "ol", "task"].includes(b.kind);

const indentLevel = (s) => { const tabs = (s.match(/\t/g) ?? []).length; return tabs + Math.floor(s.replace(/\t/g, "").length / 2); };
const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line) || TABLE.test(line);

/** Markdown body -> {lead, blocks, eol} */
export function parseBlocks(body) {
    const src = String(body ?? "");
    const eol = src.includes("\r\n") ? "\r\n" : "\n";
    const lines = src.split(/\r?\n/);
    const blocks = [];
    let lead = "";
    // blank lines go after the previous block (or before the first one)
    // (a whitespace-only line is kept as it is)
    const blank = (line) => { if (blocks.length) blocks.at(-1).sep += `\n${line}`; else lead += `${line}\n`; };
    const push = (b, rawLines) => {
        if (blocks.length) blocks.at(-1).sep += "\n"; // the line break that ended the previous block
        const raw = rawLines.join("\n");
        blocks.push({ id: blockId(), level: 0, ...b, sep: "", raw, src: { kind: b.kind, text: b.text, level: b.level ?? 0, checked: b.checked } });
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === lines.length - 1 && line === "") break; // the final newline is the last block's sep
        if (!line.trim()) { blank(line); continue; }
        let m;
        if (FENCE.test(line)) {
            const fence = FENCE.exec(line)[1];
            const out = [line];
            while (i + 1 < lines.length) { out.push(lines[++i]); if (lines[i].trim().startsWith(fence)) break; }
            push({ kind: "code", text: out.join("\n") }, out);
        } else if ((m = HEADING.exec(line))) {
            push({ kind: "h", level: m[1].length, text: m[2] }, [line]);
        } else if (HR.test(line)) {
            push({ kind: "hr", text: "" }, [line]);
        } else if (QUOTE.test(line)) {
            const out = [line];
            while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) out.push(lines[++i]);
            push({ kind: "quote", text: out.map((l) => l.replace(/^> ?/, "")).join("\n") }, out);
        } else if ((m = LIST.exec(line))) {
            const out = [line];
            // indented lines that are not list items continue the item (kept with their indent)
            while (i + 1 < lines.length && lines[i + 1].trim() && /^[ \t]+/.test(lines[i + 1]) && !LIST.test(lines[i + 1])) out.push(lines[++i]);
            const marker = m[2], task = m[3];
            const kind = task ? "task" : /\d/.test(marker) ? "ol" : "ul";
            push({
                kind, level: indentLevel(m[1]), indent: m[1], marker, checked: task ? /x/i.test(task) : undefined,
                text: [m[4], ...out.slice(1)].join("\n"),
            }, out);
        } else if (TABLE.test(line)) {
            const out = [line];
            while (i + 1 < lines.length && TABLE.test(lines[i + 1])) out.push(lines[++i]);
            push({ kind: "raw", text: out.join("\n") }, out);
        } else {
            const out = [line];
            while (i + 1 < lines.length && lines[i + 1].trim() && !startsBlock(lines[i + 1])) out.push(lines[++i]);
            push({ kind: "p", text: out.join("\n") }, out);
        }
    }
    if (src.endsWith("\n") && blocks.length) blocks.at(-1).sep += "\n";
    return { lead, blocks, eol };
}

const unchanged = (b) => b.raw != null && b.src && b.src.kind === b.kind && b.src.text === b.text && b.src.level === (b.level ?? 0) && b.src.checked === b.checked;

/** One block as markdown (without its sep) */
export function blockMarkdown(b, all = [], i = -1) {
    if (unchanged(b)) return b.raw;
    const text = b.text ?? "";
    const indent = b.src?.level === b.level && b.indent != null ? b.indent : "\t".repeat(b.level ?? 0);
    switch (b.kind) {
        case "h": return `${"#".repeat(Math.min(6, Math.max(1, b.level || 1)))} ${text}`;
        case "ul": return `${indent}${b.marker && !/\d/.test(b.marker) ? b.marker : "-"} ${text}`;
        case "task": return `${indent}${b.marker && !/\d/.test(b.marker) ? b.marker : "-"} [${b.checked ? "x" : " "}] ${text}`;
        case "ol": return `${indent}${olNumber(all, i)}${b.marker && /\)$/.test(b.marker) ? ")" : "."} ${text}`;
        case "quote": return text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
        case "hr": return b.raw ?? "---";
        default: return text;
    }
}

/** A numbered item keeps its number; new ones follow the item above at the same level */
function olNumber(all, i) {
    const b = all[i];
    const own = b?.marker && /\d/.test(b.marker) && b.src?.kind === "ol" ? parseInt(b.marker, 10) : null;
    if (own != null) return own;
    for (let j = i - 1; j >= 0; j--) {
        const a = all[j];
        if (!isList(a) || (a.level ?? 0) < (b.level ?? 0)) break;
        if (a.kind === "ol" && a.level === b.level) return olNumber(all, j) + 1;
    }
    return 1;
}

/** {lead, blocks, eol} -> markdown body */
export function serializeBlocks({ lead = "", blocks, eol = "\n" }) {
    const out = lead + blocks.map((b, i) => blockMarkdown(b, blocks, i) + b.sep).join("");
    return eol === "\n" ? out : out.replace(/\r?\n/g, eol);
}

/** The sep a new block gets after `prev` (list items sit on consecutive lines) */
export const defaultSep = (prev, next) => (isList(prev) && isList(next) ? "\n" : "\n\n");

/** A new block of a kind */
export const newBlock = (kind = "p", text = "", extra = {}) => ({ id: blockId(), kind, text, level: kind === "h" ? 2 : 0, sep: "\n\n", ...extra });

/** Words in a chapter body: comments (%% … %%), markup and link brackets don't count */
export function wordCount(md) {
    const s = String(md ?? "").replace(/%%[\s\S]*?%%/g, " ").replace(/^>\s*\[![^\]]*\][+-]?/gm, " ")
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[#>*_~`|[\]-]+/g, " ");
    return (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? []).length;
}

/**
 * Toggle inline markup (`**`, `*`, `~~`, `==`, `[[ ]]`, `%% %%`) on a selection of `t` from s to e, like a word processor:
 * a caret inside a word takes the word; markup just outside or at the ends of the selection is removed; otherwise
 * the selection (without spaces at its ends) is wrapped. `*` and `**` share a character, so runs of stars are counted
 * (`***x***` is bold and italic). Returns {text, s, e}, the new selection.
 */
export function toggleWrap(t, s, e, L, R) {
    const caret = s === e ? s : null;
    const r = wrapRange(t, s, e, L, R);
    if (caret == null || r.word == null) return { text: r.text, s: r.s, e: r.e };
    // a caret stays a caret, moved with the word it is in
    const at = caret + (r.s - r.word);
    return { text: r.text, s: at, e: at };
}

function wrapRange(t, s, e, L, R) {
    let word = null;
    if (s === e) {
        const w = /[\p{L}\p{N}'’_-]/u;
        let a = s, b = e;
        while (a > 0 && w.test(t[a - 1])) a--;
        while (b < t.length && w.test(t[b])) b++;
        if (a < b) { s = a; e = b; word = a; }
    }
    const stars = L === R && /^\*{1,2}$/.test(L);
    const run = (i, dir) => { let n = 0; while (t[dir < 0 ? i - n - 1 : i + n] === "*") n++; return n; };
    const marked = (a, b) => (L.length === 1 ? Math.min(a, b) % 2 === 1 : Math.min(a, b) >= 2);
    const cut = (from, to, text = t) => text.slice(0, from) + text.slice(to);
    // markup around the selection
    if (stars ? marked(run(s, -1), run(e, 1)) : t.slice(s - L.length, s) === L && t.slice(e, e + R.length) === R) {
        const text = cut(s - L.length, s, cut(e, e + R.length));
        return { text, s: s - L.length, e: e - L.length, word };
    }
    // markup at the ends of the selection
    const inner = t.slice(s, e);
    if (inner.length > L.length + R.length && (stars ? marked(run(s, 1), run(e, -1)) : inner.startsWith(L) && inner.endsWith(R))) {
        return { text: t.slice(0, s) + inner.slice(L.length, inner.length - R.length) + t.slice(e), s, e: e - L.length - R.length, word };
    }
    while (s < e && /\s/.test(t[s])) s++;
    while (e > s && /\s/.test(t[e - 1])) e--;
    return { text: t.slice(0, s) + L + t.slice(s, e) + R + t.slice(e), s: s + L.length, e: e + L.length, word: word == null ? null : s };
}

/** A paragraph that is only an image embed (a scene break line, an illustration): shown centred */
export const IMAGE_ONLY = /^\s*!\[\[[^\]\n]+\.(png|jpe?g|gif|webp|svg|avif)(\|[^\]\n]*)?\]\]\s*$|^\s*!\[[^\]\n]*\]\([^)\n]+\)\s*$/i;

// ------------------------------------------------------------------ inline markdown for display (live preview)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PUNCT = /[!-/:-@[-`{-~]/;
const WS = /\s|^$/u;
const PUNCT_U = /[\p{P}\p{S}]/u;
const TAGS = { "*1": "em", "_1": "em", "*2": "strong", "_2": "strong", "~2": "s", "=2": "mark" };

// ------------------------------------------------------------------ speech (dialogue in quotes)

const WORD = /[\p{L}\p{N}]/u;
const QUOTES = { '"': '"', "“": "”", "'": "'", "‘": "’" };
const CLOSERS = { '"': ['"', "”"], "“": ["”", '"'], "'": ["'", "’"], "‘": ["’", "'"] };

/**
 * Where speech in quotes lies in a block's text: [[start, end], …] (end after the closing quote). Only the outermost
 * quote counts (quotes inside it are part of it). An opening quote has no letter or digit before it (or starts the
 * text) and no space after it; a closing one has no letter or digit after it (so the apostrophes in "don't" and
 * "'tis" are ignored). Speech in double quotes that never closes runs to the end of the block (dialogue that goes on
 * in the next paragraph); single quotes need their closing quote. `skip` [[a, b], …] are ranges to ignore (code, comments).
 */
export function speechRanges(text, skip = []) {
    const t = String(text ?? "");
    const out = [];
    const skipped = (i) => skip.some(([a, b]) => i >= a && i < b);
    for (let i = 0; i < t.length; i++) {
        const q = t[i];
        if (!QUOTES[q] || skipped(i)) continue;
        if ((i > 0 && WORD.test(t[i - 1])) || !t[i + 1] || /\s/.test(t[i + 1])) continue;
        let end = -1;
        for (let j = i + 1; j < t.length; j++) {
            if (!CLOSERS[q].includes(t[j]) || skipped(j) || /\s/.test(t[j - 1])) continue;
            if (j + 1 < t.length && WORD.test(t[j + 1])) continue;
            end = j + 1; break;
        }
        if (end < 0) { if (q === '"' || q === "“") { out.push([i, t.length]); break; } continue; }
        out.push([i, end]);
        i = end - 1;
    }
    return out;
}

/** Wraps the speech in each paragraph and list item under `root` in <span class="be-speech"> (for rendered HTML) */
export function markSpeech(root) {
    const doc = root.ownerDocument;
    for (const el of root.querySelectorAll("p, li")) {
        if (el.closest("blockquote, .callout, code, pre") || el.querySelector(".be-speech")) continue;
        const nodes = [];
        const walk = doc.createTreeWalker(el, 4 /* text */, { acceptNode: (n) => (n.parentElement.closest("p, li") === el && !n.parentElement.closest("code") ? 1 : 2) });
        for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n);
        const text = nodes.map((n) => n.data).join("");
        const ranges = speechRanges(text);
        if (!ranges.length) continue;
        let at = 0;
        for (const n of nodes) {
            const from = at, to = at + n.data.length;
            at = to;
            const cuts = ranges.filter(([a, b]) => a < to && b > from).map(([a, b]) => [Math.max(a, from) - from, Math.min(b, to) - from]);
            if (!cuts.length) continue;
            const frag = doc.createDocumentFragment();
            let k = 0;
            for (const [a, b] of cuts) {
                if (a > k) frag.append(n.data.slice(k, a));
                const sp = doc.createElement("span");
                sp.className = "be-speech";
                sp.textContent = n.data.slice(a, b);
                frag.append(sp);
                k = b;
            }
            if (k < n.data.length) frag.append(n.data.slice(k));
            n.replaceWith(frag);
        }
    }
}

/**
 * One block's text as HTML with its formatting shown (bold, italic, strikethrough, highlight, code, links, comments,
 * backslash escapes) and the markup hidden, like Obsidian's live preview. Every piece of visible text is a
 * `<span data-s="N">` where N is its offset in the source, so a click can put the caret at the same place.
 * `raw`: every character of the source stays (markup too), wrapped in the same formatting and speech spans: the
 * coloured copy drawn over a block being edited, which must wrap exactly like the text box under it.
 */
export function inlineHtml(src, { raw = false } = {}) {
    const t = String(src ?? "");
    const toks = [];
    const skip = [];
    const text = (s, at) => { if (s) toks.push({ type: "text", s, at }); };
    let i = 0, buf = "", bufAt = 0;
    const flush = () => { text(buf, bufAt); buf = ""; };
    const add = (ch, at) => { if (!buf) bufAt = at; buf += ch; };
    while (i < t.length) {
        const c = t[i];
        if (c === "\\" && PUNCT.test(t[i + 1] ?? "")) { flush(); if (raw) text(t.slice(i, i + 2), i); else text(t[i + 1], i + 1); i += 2; continue; }
        if (c === "%" && t[i + 1] === "%") {
            const j = t.indexOf("%%", i + 2);
            if (j > -1) { skip.push([i, j + 2]); flush(); toks.push({ type: "html", html: `<span class="be-comment" data-s="${i}">${esc(t.slice(i, j + 2))}</span>` }); i = j + 2; continue; }
        }
        if (c === "`") {
            const j = t.indexOf("`", i + 1);
            if (j > i + 1) { skip.push([i, j + 1]); flush(); if (raw) { toks.push({ type: "src", s: t.slice(i, j + 1), at: i }); i = j + 1; continue; } toks.push({ type: "html", html: `<code><span data-s="${i + 1}">${esc(t.slice(i + 1, j))}</span></code>` }); i = j + 1; continue; }
        }
        if ((c === "[" && t[i + 1] === "[") || (c === "!" && t[i + 1] === "[" && t[i + 2] === "[")) {
            const open = c === "!" ? i + 3 : i + 2;
            const j = t.indexOf("]]", open);
            if (j > -1 && !t.slice(open, j).includes("\n")) {
                flush();
                if (raw) { toks.push({ type: "text", s: t.slice(i, j + 2), at: i }); i = j + 2; continue; }
                const inner = t.slice(open, j), bar = inner.indexOf("|");
                const label = bar > -1 ? inner.slice(bar + 1) : inner.split("#")[0].split("/").pop();
                const at = bar > -1 ? open + bar + 1 : open + inner.lastIndexOf(label);
                toks.push({ type: "html", html: `<span class="be-link${c === "!" ? " embed" : ""}" title="${esc(inner.split("|")[0])}"><span data-s="${at}">${esc(c === "!" ? `🖼 ${label}` : label)}</span></span>` });
                i = j + 2; continue;
            }
        }
        if (c === "[") {
            const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(t.slice(i));
            if (m && raw) { flush(); text(m[0], i); i += m[0].length; continue; }
            if (m) { flush(); toks.push({ type: "html", html: `<span class="be-link" title="${esc(m[2])}"><span data-s="${i + 1}">${esc(m[1])}</span></span>` }); i += m[0].length; continue; }
        }
        if (c === "*" || c === "_" || ((c === "~" || c === "=") && t[i + 1] === c)) {
            let j = i;
            while (t[j] === c) j++;
            const len = j - i;
            if ((c === "~" || c === "=") && len !== 2) { for (let k = i; k < j; k++) add(c, k); i = j; continue; }
            flush();
            const before = t[i - 1] ?? "", after = t[j] ?? "";
            const left = !WS.test(after) && (!PUNCT_U.test(after) || WS.test(before) || PUNCT_U.test(before));
            const right = !WS.test(before) && (!PUNCT_U.test(before) || WS.test(after) || PUNCT_U.test(after));
            const open = c === "_" ? left && (!right || PUNCT_U.test(before)) : left;
            const close = c === "_" ? right && (!left || PUNCT_U.test(after)) : right;
            toks.push({ type: "delim", ch: c, len, orig: len, at: i, open, close, opens: [], closes: [] });
            i = j; continue;
        }
        add(c, i); i++;
    }
    flush();
    // match delimiter runs (CommonMark's "process emphasis", simplified)
    const stack = [];
    for (let k = 0; k < toks.length; k++) {
        const d = toks[k];
        if (d.type !== "delim") continue;
        if (d.close) {
            let found = true;
            while (d.len > 0 && found) {
                found = false;
                for (let s = stack.length - 1; s >= 0; s--) {
                    const o = toks[stack[s]];
                    if (o.ch !== d.ch || o.len <= 0) continue;
                    // a run that can open and close only pairs when the sum is not a multiple of 3 (CommonMark rule)
                    if ((o.close || d.open) && (o.len + d.len) % 3 === 0 && !(o.len % 3 === 0 && d.len % 3 === 0) && d.ch !== "~" && d.ch !== "=") continue;
                    const n = d.ch === "~" || d.ch === "=" ? 2 : o.len >= 2 && d.len >= 2 ? 2 : 1;
                    const tag = TAGS[`${d.ch}${n}`];
                    o.len -= n; d.len -= n;
                    o.opens.unshift(tag); d.closes.push(tag);
                    stack.splice(s + (o.len > 0 ? 1 : 0));
                    found = true;
                    break;
                }
            }
        }
        if (d.len > 0 && d.open) stack.push(k);
    }
    // speech: text pieces inside quotes get the be-speech class (split where speech starts or ends)
    const speech = speechRanges(t, skip);
    const piece = (s, at) => {
        let res = "", k = 0;
        for (const [a, b] of speech) {
            const x = Math.max(a - at, k), y = Math.min(b - at, s.length);
            if (y <= x) continue;
            if (x > k) res += `<span data-s="${at + k}">${esc(s.slice(k, x))}</span>`;
            res += `<span class="be-speech" data-s="${at + x}">${esc(s.slice(x, y))}</span>`;
            k = y;
        }
        return k < s.length ? res + `<span data-s="${at + k}">${esc(s.slice(k))}</span>` : res;
    };
    let out = "";
    for (const k of toks) {
        if (k.type === "text") out += piece(k.s, k.at);
        else if (k.type === "src") out += `<span data-s="${k.at}">${esc(k.s)}</span>`;
        else if (raw) {
            // the source as typed, its markup kept inside the formatting it makes (a closer's stars before the close)
            const chars = piece(k.ch.repeat(k.orig), k.at);
            out += k.closes.length ? chars + k.closes.map((g) => `</${g}>`).join("") + k.opens.map((g) => `<${g}>`).join("")
                : k.opens.map((g) => `<${g}>`).join("") + chars;
        }
        else if (k.type === "html") out += k.html;
        else {
            out += k.closes.map((g) => `</${g}>`).join("");
            // a closer's leftover stars come after the ones it used, an opener's before
            if (k.len > 0) out += piece(k.ch.repeat(k.len), k.closes.length ? k.at + k.orig - k.len : k.at);
            out += k.opens.map((g) => `<${g}>`).join("");
        }
    }
    return out;
}
