// Claude Code in the AI tab: a terminal (xterm.js, loaded when first shown) attached to the `claude` the server runs in
// its workspace (lib/claude-code.js). Output arrives as server-sent events, keys go back in order. While it runs, the
// page tells the server what is on screen, for Claude Code's current_view tool.
import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";
import { api, toast, openInDrawer } from "./app.js";
import { screenView, ago } from "./ai.js";

const html = htm.bind(h);
let xtermLoaded = null;
function loadXterm() {
    if (!xtermLoaded) {
        if (!document.querySelector("link[data-xterm]")) {
            const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/vendor/xterm.css" });
            link.setAttribute("data-xterm", "");
            document.head.append(link);
        }
        xtermLoaded = Promise.all([import("/vendor/xterm.mjs"), import("/vendor/addon-fit.mjs")]);
    }
    return xtermLoaded;
}
// Claude Code's own commands, one click away: it answers them in the terminal (your plan's usage comes from
// Claude Code itself; World Builder never reads your sign-in)
const COMMANDS = [["/usage", "Usage", "Your plan's usage limits and how much is left (/usage)"], ["/context", "Context", "How full this conversation's context is (/context)"],
    ["/compact", "Compact", "Summarise the conversation so far to free up context (/compact)"], ["/model", "Model", "Choose the model (/model)"], ["/effort", "Effort", "How hard it thinks (/effort)"]];
/**
 * What Claude Code shows, read from its rows ({text, bg}: text without trailing spaces, bg = the first visible character
 * has a background colour), so the overlay can dress it up:
 * - bubbles: your sent messages, rows starting "❯ " on a background (the prompt you type into has none);
 * - prompt: a question with choices (permission prompts, questions, its menus): a footer like "Enter to confirm · Esc
 *   to cancel", the choice marked "❯", the other choices at the same indent (deeper rows are their descriptions), the
 *   question between a rule (──── or ▔▔▔▔) and the choices, anything between the choices and the footer as notes;
 * - cover: where its own input area starts (the rule above the bottom "❯" row), when there is no prompt;
 * - menu: a screen that Escape closes ("Esc to cancel / close…" in its last rows);
 * - links: [[Note]] / [[Note|label]] in Claude Code's text (row, column, length in cells), drawn as links over it.
 */
const RULE = /^[\s│]*[─━═▔▁]{8,}[\s│]*$/;
export function readScreen(rows, { msgBg = null } = {}) {
    const n = rows.length;
    const out = { bubbles: [], prompt: null, cover: null, menu: false, links: [] };
    for (let r = Math.max(0, n - 10); r < n; r++) if (/\bEsc to (cancel|close|exit|go back|dismiss)\b/i.test(rows[r].text)) out.menu = true;
    const plain = (t) => t.replace(/[│┃]/g, " ");
    const indent = (t) => plain(t).search(/\S/);
    let footer = -1;
    for (let r = n - 1; r >= Math.max(0, n - 14) && footer < 0; r--) if (/\bEnter to \w|↑\s*\/?\s*↓|\bto navigate\b/i.test(rows[r].text)) footer = r;
    if (footer >= 0) {
        let cur = -1, col = -1;
        for (let r = footer - 1; r >= Math.max(0, footer - 40) && cur < 0; r--) {
            const m = /^([\s│┃]*)❯/.exec(rows[r].text);
            // the marked choice: indented (your sent messages start at the first column), highlighted or not
            if (m && (m[1].length > 0 || !rows[r].bg)) { cur = r; col = m[1].length + 2; }
        }
        if (cur >= 0) {
            const inside = (r) => r >= 0 && r < footer && rows[r].text.trim() && (r === cur || (indent(rows[r].text) >= col && !/❯/.test(rows[r].text.slice(0, col))));
            let a = cur, b = cur;
            while (inside(a - 1)) a--;
            while (inside(b + 1)) b++;
            const options = [];
            let curIndex = 0;
            for (let r = a; r <= b; r++) {
                const t = plain(rows[r].text).replace("❯", " ");
                if (r !== cur && indent(t) > col && options.length) { options.at(-1).desc = `${options.at(-1).desc} ${t.trim()}`.trim(); continue; }
                const body = t.slice(col).trim().replace(/^[▸›•]\s+/, "").replace(/^(\d+)\.\s+/, "");
                const [label, ...rest] = body.split(/\s{2,}/);
                if (r === cur) curIndex = options.length;
                options.push({ label: label.trim(), desc: rest.join("  ").trim(), row: r });
            }
            // the question: from the boundary above down to the choices, in paragraphs. The boundary is the rule Claude
            // Code draws above its menu, even a scrap of one sharing a row while it redraws, or anything that is plainly
            // conversation or status (a sent message "❯ …" at the first column, a reply "⎿ …", the effort line)
            const boundary = (t) => /[─━═▔▁]{3,}/.test(t) || /^❯/.test(t) || /^\s*⎿/.test(t) || /^\s*[◐◑◒◓○●]\s.*·\s*\/effort/.test(t);
            let top = a - 1;
            while (top > 0 && !boundary(rows[top].text) && a - top < 30) top--;
            const start = boundary(rows[top]?.text ?? "") ? top + 1 : Math.max(0, top);
            const paras = [];
            let para = [];
            for (let r = start; r < a; r++) {
                const t = plain(rows[r].text).trim();
                if (!t || RULE.test(t)) { if (para.length) paras.push(para.join(" ")); para = []; } else para.push(t);
            }
            if (para.length) paras.push(para.join(" "));
            const notes = [];
            for (let r = b + 1; r < footer; r++) { const t = plain(rows[r].text).trim(); if (t) notes.push(t); }
            out.prompt = { top: Math.max(0, top), question: paras, options, cur: curIndex, notes, footer: plain(rows[footer].text).trim() };
        }
    }
    if (!out.prompt) {
        for (let r = n - 1; r >= Math.max(0, n - 12); r--) {
            if (/^[\s│┃]*❯/.test(rows[r].text) && !rows[r].bg) { out.cover = r > 0 && RULE.test(rows[r - 1].text) ? r - 1 : r; break; }
        }
    }
    const end = out.prompt ? out.prompt.top : out.cover ?? n;
    // the background your messages have (from one on screen now, else the one seen before), for a message whose
    // first rows have scrolled off the top: its remaining rows at the top are the rest of it (cut: true)
    out.msgBg = rows.find((x) => x.text.startsWith("❯ ") && x.bg && x.bgColor != null)?.bgColor ?? msgBg;
    // a message goes on in rows of its own colour that Claude Code wrapped it into: indented two spaces under its text
    // (or blank), never a tool call or result (⏺ / ● / ⎿), whose expanded rows can be shaded too
    const goesOn = (row, color) => row.bg && row.bgColor === color && !row.text.startsWith("❯ ") && (row.text === "" || row.text.startsWith("  ")) && !/^\s*[⏺●⎿]/.test(row.text);
    const bubble = (r, lines, extra) => {
        while (lines.length > 1 && !lines.at(-1).trim()) lines.pop();
        out.bubbles.push({ r, n: lines.length, lines, ...extra });
    };
    let r0 = 0;
    if (out.msgBg != null && end > 0 && goesOn(rows[0], out.msgBg) && rows[0].text.trim()) {
        const lines = [];
        while (r0 < end && goesOn(rows[r0], out.msgBg)) lines.push(rows[r0++].text);
        bubble(0, lines, { cut: true });
    }
    for (let r = r0; r < end; r++) {
        if (!rows[r].text.startsWith("❯ ") || !rows[r].bg) continue;
        const lines = [rows[r].text.slice(2)];
        let k = 1;
        while (r + k < end && goesOn(rows[r + k], rows[r].bgColor)) { lines.push(rows[r + k].text); k++; }
        bubble(r, lines);
        r += k - 1;
    }
    const inBubble = (r) => out.bubbles.some((b) => r >= b.r && r < b.r + b.n);
    for (let r = 0; r < end; r++) {
        // one character per cell: rows with wide characters (CJK, emoji) would put the link in the wrong place
        if (inBubble(r) || /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u.test(rows[r].text)) continue;
        for (const m of rows[r].text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) out.links.push({ r, c: m.index, len: m[0].length, target: m[1].trim(), label: (m[2] ?? m[1]).trim() });
    }
    return out;
}

/**
 * The layer over the terminal: bubbles on your messages, a cover over Claude Code's own input area (you type in the box
 * below instead), and questions as a card with the choices as buttons. Claude Code runs full screen and redraws as it
 * likes, so after every redraw (next animation frame) the visible rows are read again (readScreen).
 * on: {sent() -> your messages, choose(i, prompt), answer(i), cancel(), state({menu, prompt})}
 */
const norm = (x) => x.replace(/\s+/g, " ").trim();
const TYPED = /^(type something|other|something else)\b/i;
function overlay(t, on) {
    const screen = t.element?.querySelector(".xterm-screen");
    if (!screen) return;
    const layer = Object.assign(document.createElement("div"), { className: "term-bubbles" });
    screen.append(layer);
    // the mouse over the card and the cover stays there: Claude Code follows the mouse (hovering would move its
    // selection and redraw under the card), and the terminal would take the focus or start a selection
    // Scrolling stays only on what scrolls itself (a card); over links and the cover it goes on to the conversation.
    const keepMouse = (node, { scrolls = false } = {}) => {
        for (const ev of ["mousedown", "mouseup", "mousemove", "click", "dblclick", ...(scrolls ? ["wheel"] : []), "contextmenu"]) node.addEventListener(ev, (e) => {
            e.stopPropagation();
            if (ev === "mousedown" && e.target.closest("button")) e.preventDefault();
        });
    };
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    let last = "", msgBg = null;
    // bubbles are kept across redraws while they stay the same, so text selected in one survives Claude Code redrawing
    let kept = new Map();
    const draw = () => {
        const buf = t.buffer.active;
        const rowH = screen.offsetHeight / t.rows;
        const rows = [];
        for (let r = 0; r < t.rows; r++) {
            const line = buf.getLine(buf.viewportY + r);
            const text = (line?.translateToString(true) ?? "").replace(/\s+$/, "");
            const c = line?.getCell(Math.max(0, text.search(/\S/)));
            const bg = !!c && !c.isBgDefault();
            rows.push({ text, bg, bgColor: bg ? c.getBgColor() : null });
        }
        const sc = readScreen(rows, { msgBg });
        msgBg = sc.msgBg;
        on.state({ menu: sc.menu && !sc.prompt, prompt: sc.prompt });
        const key = `${rowH}|${JSON.stringify(sc)}`;
        if (key === last) return;
        last = key;
        const keep = new Map(), fresh = [];
        const parts = sc.bubbles.map((b) => {
            // rows Claude Code wrapped are one paragraph; a message sent from the box shows as typed (its line breaks)
            const joined = norm(b.lines.join(" "));
            const text = on.sent().find((m) => norm(m) === joined) ?? joined;
            const id = `${rowH}|${b.r}|${b.n}|${b.cut ? 1 : 0}|${text}`;
            if (kept.has(id)) { keep.set(id, kept.get(id)); return kept.get(id); }
            const row = el("div", "term-bubble-row");
            Object.assign(row.style, { top: `${b.r * rowH}px`, height: `${b.n * rowH}px` });
            const bubble = el("div", `term-bubble${b.cut ? " cut" : ""}`, text);
            // one line of text per terminal row at most, so it never spills onto Claude Code's answer; a little more
            // room above and below, reaching into the blank row Claude Code leaves around a message (not above a cut one)
            const pad = Math.round(rowH * 0.22);
            Object.assign(bubble.style, { lineHeight: `${rowH}px`, fontSize: `${Math.min(14, Math.round(rowH * 0.78))}px`, padding: `${pad}px 16px`,
                marginTop: b.cut ? "0" : `${-pad}px`, maxHeight: `${b.n * rowH + pad * (b.cut ? 1 : 2)}px` });
            // the bubble's own text can be selected and copied (the terminal would select the hidden text below it)
            keepMouse(bubble);
            row.append(bubble);
            keep.set(id, row);
            fresh.push(bubble);
            return row;
        });
        // [[links]] as links: from a row's first link to its end the row is drawn again with each link as the note's
        // name (or label) in the accent colour, so the text closes up where the brackets were; clicking opens the note
        const cellW = screen.offsetWidth / t.cols;
        const byRow = new Map();
        for (const l of sc.links) { if (!byRow.has(l.r)) byRow.set(l.r, []); byRow.get(l.r).push(l); }
        for (const [r, ls] of byRow) {
            const text = rows[r].text, c0 = ls[0].c;
            const line = el("div", "term-linkrow");
            Object.assign(line.style, { left: `${c0 * cellW}px`, top: `${r * rowH}px`, width: `${(text.length - c0) * cellW}px`, height: `${rowH}px`, lineHeight: `${rowH}px` });
            keepMouse(line);
            let at = c0;
            for (const l of ls) {
                if (l.c > at) line.append(document.createTextNode(text.slice(at, l.c)));
                const a = el("a", "term-link", l.label);
                a.title = `Open ${l.target}`;
                a.href = "#";
                a.addEventListener("click", (e) => { e.preventDefault(); on.link(l.target); });
                line.append(a);
                at = l.c + l.len;
            }
            if (at < text.length) line.append(document.createTextNode(text.slice(at)));
            parts.push(line);
        }
        if (sc.cover != null) {
            const cover = el("div", "term-cover");
            cover.style.top = `${sc.cover * rowH}px`;
            keepMouse(cover);
            parts.push(cover);
        }
        const p = sc.prompt;
        if (p) {
            const card = el("div", "term-card");
            // at least the rows of Claude Code's own menu, more (upwards, to the whole terminal) when the card needs it
            card.style.minHeight = `${(t.rows - p.top) * rowH}px`;
            keepMouse(card, { scrolls: true });
            for (const q of p.question) card.append(el("p", p.question.length > 1 && q === p.question.at(-1) ? "term-q strong" : "term-q", q));
            const list = el("div", "term-choices");
            p.options.forEach((o, i) => {
                const typed = TYPED.test(o.label);
                const btn = el("button", `term-choice ${i === p.cur ? "current" : ""} ${typed ? "typed" : ""}`);
                btn.append(el("span", "term-choice-label", typed ? `${o.label} (write it in the box below)` : o.label));
                if (o.desc) btn.append(el("span", "term-choice-desc", o.desc));
                btn.addEventListener("click", () => (typed ? on.answer(i) : on.choose(i, p)));
                list.append(btn);
            });
            card.append(list);
            for (const nt of p.notes) card.append(el("p", "term-note", nt));
            const foot = el("div", "term-card-foot");
            foot.append(el("span", "muted small", "↑ ↓ move · Enter chooses · or click a choice"));
            const cancel = el("button", "small", "Cancel");
            cancel.title = "Esc";
            cancel.addEventListener("click", () => on.cancel());
            foot.append(cancel);
            card.append(foot);
            parts.push(card);
        }
        kept = keep;
        // replaceChildren would remove and re-add kept bubbles too, losing a selection in them: only change what changed
        const want = new Set(parts);
        for (const n of [...layer.children]) if (!want.has(n)) n.remove();
        parts.forEach((n, i) => { if (layer.children[i] !== n) layer.insertBefore(n, layer.children[i] ?? null); });
        for (const b of fresh) fit(b);
    };
    // the bubble's font is wider than the terminal's cells and the bubble narrower than the row, so a long message
    // can need more lines than Claude Code's rows: then the bubble may grow to the row's width, and if it still
    // doesn't fit, its text gets smaller (font and line height together) until the whole message shows
    const fit = (b) => {
        const over = () => b.scrollHeight > b.clientHeight + 1;
        if (!over()) return;
        b.style.maxWidth = "100%";
        let size = parseFloat(b.style.fontSize), lh = parseFloat(b.style.lineHeight);
        for (let i = 0; i < 12 && over() && size > 8; i++) {
            size *= 0.92; lh *= 0.92;
            Object.assign(b.style, { fontSize: `${size}px`, lineHeight: `${lh}px` });
        }
    };
    let queued = false;
    const soon = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
    t.onWriteParsed(soon);
    t.onScroll(soon);
    t.onResize(soon);
    t.onRender(soon);
}

/** A clicked [[link]] or path: the note in the drawer's viewer */
async function openLink(target) {
    try {
        const { path } = await api.get(`/api/resolve?link=${encodeURIComponent(target)}`);
        if (path) openInDrawer(`#/note/${path}`); else toast(`No note "${target}" yet`);
    } catch (e) { toast(e.message); }
}
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const themeNow = () => ({ background: cssVar("--panel", "#1f1e23"), foreground: cssVar("--text", "#e6e3ea"), cursor: cssVar("--accent", "#b07cf0"), selectionBackground: `${cssVar("--accent", "#b07cf0")}55` });

// The terminal, its stream and what was sent live as long as the app (not the tab): switching tabs, opening a note or a
// re-render puts the same terminal back, so the conversation only changes with New, History, End or closing the app.
const T = { term: null, fit: null, inner: null, es: null, id: null, received: 0, sent: [], autoTried: false, starting: false, ui: {}, queue: { pending: "", busy: false } };
async function flushKeys() {
    const qd = T.queue;
    if (qd.busy || !qd.pending) return;
    qd.busy = true;
    const data = qd.pending; qd.pending = "";
    try { await api.send("POST", "/api/terminal/input", { data }); } catch { /* the stream shows it ended */ }
    qd.busy = false;
    flushKeys();
}
/** Keys go to the server one batch at a time, in order */
const typeKeys = (d) => { T.queue.pending += d; flushKeys(); };

/** The stream of Claude Code's output; on a dropped connection it reconnects for just what it missed */
function connect() {
    const t = T.term;
    const es = new EventSource(`/api/terminal/stream${T.id ? `?id=${T.id}&from=${T.received}` : ""}`);
    T.es = es;
    es.addEventListener("hello", (e) => {
        const s = JSON.parse(e.data);
        if (!s.resume) t.reset();
        T.id = s.id; T.received = s.from;
        T.ui.setRunning?.(s.running); T.ui.setExit?.(s.exit);
    });
    es.addEventListener("start", (e) => { T.id = JSON.parse(e.data).id; T.received = 0; t.reset(); });
    es.onmessage = (e) => {
        const bin = atob(e.data); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        T.received += bytes.length;
        t.write(bytes);
    };
    es.addEventListener("exit", (e) => {
        if (T.starting) return;
        T.ui.setRunning?.(false); T.ui.setExit?.(JSON.parse(e.data));
        api.get("/api/terminal/status").then((st) => T.ui.setStatus?.(st)).catch(() => { });   // the conversation just ended joins the list
    });
    es.onerror = () => { es.close(); if (T.es === es) setTimeout(connect, 1000); };
}

/** Make the terminal once (into a container that later mounts of the tab move into their place) */
async function makeTerminal(host) {
    if (T.term) return T.term;
    const [{ Terminal }, { FitAddon }] = await loadXterm();
    if (T.term) return T.term;
    T.inner = Object.assign(document.createElement("div"), { className: "term-inner" });
    host.append(T.inner);
    const t = new Terminal({ fontFamily: cssVar("--mono", "monospace"), fontSize: 13.5, lineHeight: 1.3, cursorBlink: false, cursorStyle: "bar", cursorInactiveStyle: "none", scrollback: 8000, allowProposedApi: false, theme: themeNow(), macOptionIsMeta: true, rightClickSelectsWord: false });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(T.inner);
    T.term = t; T.fit = f;
    try { f.fit(); } catch { /* hidden */ }
    t.onData(typeKeys);
    // copy and paste like anywhere else: Ctrl+C copies the selection (with nothing selected it still stops Claude
    // Code), Ctrl+V pastes; Ctrl+Shift+C / V too
    t.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown" || !e.ctrlKey || e.altKey || e.metaKey) return true;
        // text selected in a bubble (the page's own selection, inside the terminal)
        const pageSel = window.getSelection();
        if (e.code === "KeyC" && pageSel && !pageSel.isCollapsed && T.inner.contains(pageSel.anchorNode)) { navigator.clipboard?.writeText(pageSel.toString()); return false; }
        if (e.code === "KeyC" && (e.shiftKey || t.hasSelection())) { const sel = t.getSelection(); if (sel) { navigator.clipboard?.writeText(sel); t.clearSelection(); } return false; }
        if (e.code === "KeyV") { navigator.clipboard?.readText().then((txt) => txt && t.paste(txt)); return false; }
        return true;
    });
    overlay(t, {
        sent: () => T.sent,
        state: (st) => T.ui.state?.(st),
        choose: (i, p) => { const d = i - p.cur; typeKeys((d > 0 ? "\x1b[B" : "\x1b[A").repeat(Math.abs(d)) + "\r"); T.ui.focus?.(); },
        answer: (i) => T.ui.answer?.(i),
        cancel: () => { typeKeys("\x1b"); T.ui.focus?.(); },
        link: (target) => openLink(target),
    });
    // vault paths (…/Note.md) in Claude Code's answers open the note in the viewer ([[links]] are drawn as links by the overlay)
    t.registerLinkProvider({
        provideLinks(y, done) {
            const line = t.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
            const links = [];
            for (const m of line.matchAll(/(?:\d+\. [^/\n[\]]+|80\. Global Data Store)(?:\/[^/\n[\]]+)+\.md/g)) {
                links.push({ text: m[0], range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } }, decorations: { underline: true, pointerCursor: true }, activate: () => openLink(m[0]) });
            }
            done(links.length ? links : undefined);
        },
    });
    // follow the app's light / dark theme
    new MutationObserver(() => { t.options.theme = themeNow(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    connect();
    return t;
}

export function ClaudeTerminal({ active }) {
    const host = useRef(null);
    // the text box floats over the bottom of the terminal (so the terminal keeps its size as the box grows); its
    // height goes to --term-box-h, which keeps question cards above it
    const wrap = useRef(null);
    const inputBar = useRef(null);
    const box = useRef(null);                         // the text box under the terminal
    const [menu, setMenu] = useState(false);          // one of Claude Code's screens that Escape closes is showing
    const [prompt, setPrompt] = useState(null);       // a question from Claude Code with choices (shown as a card)
    const promptRef = useRef(null);
    const [answering, setAnswering] = useState(null); // the "Type something" choice the box's text goes to
    const [text, setText] = useState("");
    const term = { get current() { return T.term; } };
    const fit = { get current() { return T.fit; } };
    const [status, setStatus] = useState(null);       // {claude, running, exit}
    const [running, setRunning] = useState(false);
    const [exit, setExit] = useState(null);
    const [error, setError] = useState(null);
    const [ready, setReady] = useState(!!T.term);
    useEffect(() => {
        const bar = inputBar.current;
        if (!bar || !wrap.current) return;
        const set = () => wrap.current?.style.setProperty("--term-box-h", `${bar.offsetHeight}px`);
        set();
        const ro = new ResizeObserver(set);
        ro.observe(bar);
        return () => ro.disconnect();
    }, [running]);
    const [history, setHistory] = useState(null);     // the History list, while open
    const [session, setSession] = useState(null);     // the conversation running ("last", an id, or null for a new one)
    useEffect(() => { api.get("/api/terminal/status").then((s) => { setStatus(s); setRunning(s.running); setExit(s.exit); setSession(s.session); }).catch((e) => setError(e.message)); }, []);
    const type = typeKeys;
    const sent = { get current() { return T.sent; }, set current(v) { T.sent = v; } };
    // what the app-level terminal tells this tab
    T.ui = {
        setRunning, setExit, setStatus,
        state: ({ menu: m, prompt: p }) => {
            setMenu((was) => (was === m ? was : m));
            promptRef.current = p;
            setPrompt((was) => (!!was === !!p ? was : p));
            if (!p) setAnswering(null);
        },
        answer: (i) => { setAnswering(i); box.current?.focus(); },
        focus: () => box.current?.focus(),
    };

    // put the terminal here (made the first time, moved here after that)
    useEffect(() => {
        if (!status?.claude || !host.current) return;
        let gone = false, ro = null, timer = null;
        makeTerminal(host.current).then((t) => {
            if (gone) return;
            if (T.inner.parentElement !== host.current) host.current.append(T.inner);
            const resize = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (!host.current?.offsetWidth) return;
                    try { T.fit.fit(); } catch { return; }
                    t.refresh(0, t.rows - 1);
                    api.send("POST", "/api/terminal/resize", { cols: t.cols, rows: t.rows }).catch(() => { });
                }, 120);
            };
            ro = new ResizeObserver(resize);
            ro.observe(host.current);
            resize();
            setReady(true);
        }).catch((e) => setError(`The terminal couldn't load: ${e.message}`));
        return () => { gone = true; ro?.disconnect(); clearTimeout(timer); };   // the terminal itself stays
    }, [status?.claude]);

    // shown again: fit to the pane and take the keyboard
    useEffect(() => {
        if (!active || !term.current) return;
        requestAnimationFrame(() => { try { fit.current.fit(); } catch { /* hidden */ } (box.current ?? term.current)?.focus(); });
    }, [active, ready, running]);

    // while it runs, the server knows what World Builder shows (Claude Code's current_view tool)
    useEffect(() => {
        if (!running) return;
        let last = "";
        const send = () => { const v = JSON.stringify(screenView()); if (v !== last) { last = v; api.send("POST", "/api/ai/view", { view: JSON.parse(v) }).catch(() => { }); } };
        send();
        const iv = setInterval(send, 1500);
        return () => clearInterval(iv);
    }, [running]);

    // resume: false (a new conversation), "last", or a conversation id; a running one is ended first
    const start = async (resume) => {
        setError(null); setHistory(null);
        T.starting = true;
        try {
            const t = term.current;
            try { fit.current?.fit(); } catch { /* hidden */ }
            await api.send("POST", "/api/terminal/start", { cols: t?.cols ?? 100, rows: t?.rows ?? 30, resume, restart: running });
            setRunning(true); setExit(null); setSession(resume || null);
            t?.focus();
        } catch (e) { setError(e.message); }
        setTimeout(() => { T.starting = false; }, 300);
    };
    const stop = () => api.send("POST", "/api/terminal/stop").catch((e) => setError(e.message));
    // the text box: an ordinary text field (select, delete, undo…) whose message goes into Claude Code as one paste,
    // so line breaks stay in it, followed by Enter; an empty Enter presses Enter in the terminal (menus, confirmations)
    const sendText = (value = text) => {
        const msg = value.replace(/\s+$/, "");
        const p = promptRef.current;
        // the answer to a question's "Type something" choice: move to that choice, write it there, confirm
        const typedChoice = p && msg ? (answering ?? p.options.findIndex((o) => /^(type something|other|something else)\b/i.test(o.label))) : -1;
        if (p && msg && typedChoice >= 0) {
            const d = typedChoice - p.cur;
            type((d > 0 ? "\x1b[B" : "\x1b[A").repeat(Math.abs(d)));
            setTimeout(() => type(`${msg}\r`), 150);
            setAnswering(null); setText(""); box.current?.focus();
            return;
        }
        if (msg) sent.current = [...sent.current.slice(-50), msg];
        type(msg ? `\x1b[200~${msg}\x1b[201~\r` : "\r");
        setText("");
        box.current?.focus();
    };
    const onBoxKey = (e) => {
        // Shift+Enter (or Ctrl+Enter) sends the whole message at once; Enter is a new line, or with an empty box
        // presses Enter in Claude Code
        if (e.key === "Enter" && !e.isComposing && (e.shiftKey || e.ctrlKey || !text.trim())) { e.preventDefault(); sendText(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); type("\x1b"); }   // stops Claude Code / closes its menus
        else if (!text && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.key) && !e.shiftKey) {
            // with an empty box these steer Claude Code's menus and choices
            e.preventDefault(); type({ ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowLeft: "\x1b[D", ArrowRight: "\x1b[C", Tab: "\t" }[e.key]);
        }
    };

    // a Claude Code command typed for the user (Claude Code shows the answer itself, in the terminal)
    const run = (cmd) => { setHistory(null); type(`${cmd}\r`); term.current?.focus(); };
    const openHistory = async () => {
        if (history) return setHistory(null);
        try { setHistory((await api.get("/api/terminal/sessions")).sessions); } catch (e) { setError(e.message); }
    };
    // after a restart of the app the last conversation carries on by itself
    useEffect(() => {
        if (!ready || !active || running || exit || T.autoTried || !status?.sessions?.length) return;
        T.autoTried = true;
        start("last");
    }, [ready, active, running, exit, status]);

    if (error && !status) return html`<div class="drawer-body"><p class="error">${error}</p></div>`;
    if (!status) return html`<div class="drawer-body"><p class="muted">Loading…</p></div>`;
    if (!status.claude) return html`<div class="drawer-body ai-pane"><div class="ai-setup">
        <h3>Claude Code isn't installed</h3>
        <p class="muted">The AI tab runs Claude Code, signed in with your own Claude subscription. Install it (see <a href="https://code.claude.com/docs" target="_blank" rel="noopener">Anthropic's Claude Code docs</a>), sign in once by running <code>claude</code> in a terminal, then come back here.</p>
        <p class="muted small">Or use the API chat instead: Settings → AI assistant.</p>
        <a class="button" href="#/settings?s=ai" data-page>Open Settings</a></div></div>`;
    return html`<div class="ai-term">
        <div class="ai-head">
            <span class="muted small">Claude Code · your subscription${running ? "" : exit ? " · ended" : ""}</span>
            <span class="grow" />
            ${running && html`<span class="term-commands">${COMMANDS.map(([cmd, label, tip]) => html`<button class="small" key=${cmd} title=${tip} onClick=${() => run(cmd)}>${label}</button>`)}</span>`}
            <button class=${`small ${history ? "on" : ""}`} title="Earlier conversations" onClick=${openHistory}>History</button>
            <button class="small" title="Start a new conversation" onClick=${() => start(false)}>New</button>
            ${running && html`<button class="small" title="End this Claude Code session" onClick=${stop}>End</button>`}
        </div>
        ${history && html`<div class="term-history">
            ${!history.length ? html`<p class="muted small">No earlier conversations yet.</p>` : history.map((h) => html`<button key=${h.id} class=${`term-session ${session === h.id || (session === "last" && h === history[0]) ? "current" : ""}`} onClick=${() => start(h.id)}>
                <span class="term-session-title">${h.title}</span>
                <span class="muted small">${ago(h.updated)} · ${h.messages} messages${h.prompt && h.prompt !== h.title ? ` · ${h.prompt.slice(0, 90)}` : ""}</span>
            </button>`)}
        </div>`}
        <div class="term-wrap" ref=${wrap}>
            <div class="term-host" ref=${host} />
            ${running && menu && html`<button class="term-close" title="Close this screen (Escape)" onClick=${() => { type("\x1b"); setMenu(false); box.current?.focus(); }}>✕ Close</button>`}
            ${running && html`<div class="ai-input term-input" ref=${inputBar}>
                <textarea ref=${box} rows="1" placeholder=${answering != null ? "Write your answer… (Shift+Enter sends it)" : prompt ? "Answer above, or write something here… (Enter chooses · ↑↓ move · Esc cancels)" : "Message Claude Code… (Shift+Enter sends · Enter: new line · Esc stops it)"} value=${text}
                    onInput=${(e) => setText(e.target.value)} onKeyDown=${onBoxKey} />
                <button class="primary" onClick=${() => sendText()} title="Send (Shift+Enter)">Send</button>
            </div>`}
        </div>
        ${!running && html`<div class="term-start">
            <p>${exit ? "Claude Code has ended." : "Start Claude Code to talk about your novels and worlds."}</p>
            <div class="row">${status.sessions?.length ? html`<button class="primary" onClick=${() => start("last")}>Continue “${status.sessions[0].title}”</button><button onClick=${() => start(false)}>New conversation</button><button onClick=${openHistory}>Earlier conversations…</button>`
                : html`<button class="primary" onClick=${() => start(false)}>Start Claude Code</button>`}</div>
            <p class="muted small">It runs your own <code>claude</code>, signed in with your subscription, connected to World Builder's tools. It reads only your novels and the data store, can't touch the vault's files or run commands, and every change it makes opens here for your review first. The first time, it asks whether to trust its workspace folder. Type <code>/world-builder</code> for ready-made prompts. Copy and paste: Ctrl+Shift+C / Ctrl+Shift+V.</p>
            ${error && html`<p class="error small">${error}</p>`}
        </div>`}
    </div>`;
}
