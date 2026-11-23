// The AI assistant: its drawer tab (a conversation with Claude that streams in, tool steps shown as one-line notes)
// and its Settings panel (sign-in or API key, model, effort). The server runs the conversation (lib/ai.js); this page
// sends one message at a time with a short description of what is on screen.
import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";
import { api, toast, Html, ConfirmButton, openInDrawer, openDrawerTab, useApi } from "./app.js";
import { writerNow, showLeftTab } from "./writer.js";
import { ClaudeTerminal } from "./terminal.js";

const html = htm.bind(h);

/** The robot head used for the topbar button and the drawer tab */
export const BotIcon = ({ size = 18 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3v3" /><circle cx="12" cy="2.6" r="0.9" fill="currentColor" stroke="none" />
    <rect x="4" y="6" width="16" height="12" rx="3.5" /><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <path d="M9.5 15.5h5" /><path d="M2 11v3M22 11v3" /></svg>`;

// ---------------------------------------------------------------- what is on screen

/** A short description of the screen for the assistant: page, drawer page, writer chapter, selected text */
export function screenView() {
    const head = (sel) => document.querySelector(sel)?.textContent?.trim().replace(/\s+/g, " ").slice(0, 140) || null;
    const route = decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "home";
    const title = head(".content h1, main h1, .settings h1");
    const page = `${title ? `"${title}" ` : ""}(${route})`;
    let drawer = null;
    try {
        const d = JSON.parse(localStorage.getItem("drawerState") ?? "null");
        if (d?.open) drawer = d.tab === "viewer" && d.recent?.[0] ? `${decodeURIComponent(d.recent[0].replace(/^#\//, ""))}` : `${d.tab} tab`;
    } catch { /* none */ }
    const w = writerNow();
    const writer = w?.folder && w.open ? `chapter ${w.n} of ${w.folder}` : null;
    const sel = String(globalThis.getSelection?.() ?? "").trim();
    const anchor = globalThis.getSelection?.()?.anchorNode;
    const inAi = anchor && document.querySelector(".ai-pane")?.contains(anchor);
    return { page, drawer, writer, selection: sel && !inAi ? sel.slice(0, 4000) : null };
}

// ---------------------------------------------------------------- chat

// the conversation lives at module level, so it survives the pane being hidden or the route changing
let chat = { id: null, items: [], usage: null };
const chatListeners = new Set();
const setChat = (c) => {
    chat = c; chatListeners.forEach((f) => f(c));
    try { if (c.id) localStorage.setItem("aiConversation", c.id); else localStorage.removeItem("aiConversation"); } catch { /* private window */ }
};
/** Open a saved conversation (its replies rendered as markdown again) */
async function loadConversation(id, provider = null) {
    const c = await api.get(`/api/ai/conversation?id=${encodeURIComponent(id)}`);
    if (provider && c.provider !== provider) return;   // restoring: one with another provider stays in History
    setChat({ id: c.id, items: c.display.map((it) => (it.role === "assistant" ? { ...it, streaming: false } : it)), usage: c.usage });
    chat.items.forEach((it, i) => { if (it.role === "assistant") renderReply(i); });
}
// the conversation open when the app last closed comes back with it
let restored = false;
function restoreConversation(provider) {
    if (restored || chat.id) return;
    restored = true;
    let id = null;
    try { id = localStorage.getItem("aiConversation"); } catch { /* none */ }
    if (id) loadConversation(id, provider).catch(() => { try { localStorage.removeItem("aiConversation"); } catch { /* none */ } });
}

/** The reply's text without its trailing <replies>[…]</replies> line (also while it streams in), and the replies */
export function splitReplies(text) {
    const at = text.indexOf("<replies");
    if (at < 0) return { text, replies: [] };
    let replies = [];
    const m = /<replies>([\s\S]*?)<\/replies>/.exec(text.slice(at));
    if (m) try { replies = JSON.parse(m[1]).filter((r) => typeof r === "string" && r.trim()).slice(0, 4); } catch { /* not finished or not JSON */ }
    return { text: text.slice(0, at).replace(/\s+$/, ""), replies };
}
/** Openers for an empty conversation, from what is on screen */
function starters(v) {
    const ch = v.writer && /^chapter (\S+)/.exec(v.writer)?.[1];
    if (ch) return [`Summarise chapter ${ch}`, `Review chapter ${ch}'s pacing and prose`, `Does chapter ${ch} follow its plan?`];
    const note = v.drawer && !/ tab$/.test(v.drawer) ? v.drawer.split("/").pop().replace(/\.md$/, "") : null;
    if (note && !/^(chapter|c|new|docs|proposal)$/.test(v.drawer.split("/")[0])) return [`Summarise ${note}`, `Where is ${note} mentioned in my chapters?`, `Suggest details to fill in for ${note}`];
    return ["Summarise the latest chapter", "What does the main character carry right now?", "Brainstorm three complications for the next chapter"];
}
const placeholderFor = (v, followUp) => (followUp ? "Reply, or ask a follow-up… (Enter sends)"
    : v.writer ? `Ask about ${v.writer.replace(/ of \d+\.\s*/, " of ")}… (Enter sends)` : "Ask about your novels and worlds… (Enter sends, Shift+Enter: new line)");

/** "5 min ago", "yesterday", "12 Nov" */
export function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 172800) return "yesterday";
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const TOOL_LABELS = { search: "Searching", novel_overview: "Reading the novel overview", read_chapter: "Reading a chapter", read_note: "Reading a note", query_collection: "Listing a collection", schema: "Reading the fields", character_state: "Checking ledgers", world_tree: "Reading the world outline", taxonomy: "Reading taxonomy values", current_view: "Looking at the screen", propose_changes: "Preparing changes for review" };
const money = (n) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M tokens` : n >= 1000 ? `${Math.round(n / 1000)}k tokens` : `${n} tokens`);

// The AI tab can be in both drawers; the conversation is where you used it last (for Claude Code, the copy holding the
// terminal). "Back to the conversation" goes there, not always to the side drawer.
let aiLastPlace = "right";
addEventListener("pointerdown", (e) => { const t = e.target.closest?.(".ai-pane, .ai-term"); if (t) aiLastPlace = t.closest(".writer-wrap") ? "left" : "right"; }, true);
function backToConversation() {
    const leftHas = writerNow().tabs.includes("pane:ai");
    const holder = document.querySelector(".ai-term .term-host:not(.term-mirror-host)");
    const place = holder ? (holder.closest(".writer-wrap") ? "left" : "right") : aiLastPlace;
    if (leftHas && place === "left") showLeftTab("pane:ai"); else openDrawerTab("ai");
}

export function AiPane({ active }) {
    const [c, set] = useState(chat);
    useEffect(() => { chatListeners.add(set); return () => chatListeners.delete(set); }, []);
    const [status, setStatus] = useState(null);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [view, setView] = useState(() => screenView());
    const stopper = useRef(null);
    const list = useRef(null);
    const box = useRef(null);
    const stick = useRef(true);
    useEffect(() => { if (active) api.get("/api/ai/status").then((s) => { setStatus(s); if (s.auth !== "claude-code") restoreConversation(s.provider); }).catch(() => setStatus({ ready: false })); }, [active]);
    const [history, setHistory] = useState(null);
    const openHistory = async () => {
        if (history) return setHistory(null);
        try { setHistory((await api.get("/api/ai/conversations")).conversations); } catch (e) { toast(e.message); }
    };
    const pick = async (id) => { setHistory(null); try { await loadConversation(id); } catch (e) { toast(e.message); } };
    const remove = async (id) => {
        await api.send("DELETE", `/api/ai/conversation?id=${encodeURIComponent(id)}`).catch(() => { });
        if (chat.id === id) setChat({ id: null, items: [], usage: null });
        setHistory((h) => h?.filter((x) => x.id !== id));
    };
    useEffect(() => { if (active) { box.current?.focus(); setView(screenView()); } }, [active]);
    useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [c]);

    const update = (fn) => setChat(fn(chat));
    const send = async (message) => {
        const msg = message.trim();
        if (!msg || busy) return;
        setText("");
        setBusy(true);
        stick.current = true;
        update((s) => ({ ...s, items: [...s.items, { role: "user", text: msg }, { role: "assistant", parts: [], streaming: true }] }));
        // the reply is the last item; parts are text runs and tool notes in the order they came
        const patchReply = (fn) => update((s) => { const items = [...s.items]; items[items.length - 1] = fn({ ...items[items.length - 1] }); return { ...s, items }; });
        const addText = (d) => patchReply((r) => { const parts = [...r.parts]; const last = parts.at(-1); if (last?.kind === "text") parts[parts.length - 1] = { ...last, text: last.text + d }; else parts.push({ kind: "text", text: d }); return { ...r, parts, thinking: false }; });
        const ctrl = new AbortController();
        stopper.current = ctrl;
        try {
            const r = await fetch("/api/ai/chat", { method: "POST", signal: ctrl.signal, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: JSON.stringify({ conversation: chat.id, message: msg, view: screenView() }) });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
            const reader = r.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf("\n")) >= 0) {
                    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
                    if (!line.trim()) continue;
                    const ev = JSON.parse(line);
                    if (ev.t === "start") update((s) => ({ ...s, id: ev.conversation }));
                    else if (ev.t === "text") addText(ev.d);
                    else if (ev.t === "thinking") patchReply((r2) => ({ ...r2, thinking: true }));
                    else if (ev.t === "tool") patchReply((r2) => ({ ...r2, thinking: false, parts: [...r2.parts, { kind: "tool", id: ev.id, name: ev.name, label: TOOL_LABELS[ev.name] ?? ev.name, running: true }] }));
                    else if (ev.t === "tool_done") patchReply((r2) => ({ ...r2, parts: [...r2.parts.map((p) => (p.id === ev.id ? { ...p, running: false, label: ev.summary, error: ev.error } : p)), ...(ev.proposal ? [{ kind: "proposal", ...ev.proposal }] : [])] }));
                    else if (ev.t === "done") update((s) => ({ ...s, usage: ev.usage }));
                    else if (ev.t === "error") { patchReply((r2) => ({ ...r2, error: ev.message })); if (ev.usage) update((s) => ({ ...s, usage: ev.usage })); }
                }
            }
        } catch (e) {
            patchReply((r2) => ({ ...r2, error: ctrl.signal.aborted ? "Stopped" : e.message }));
        } finally {
            stopper.current = null;
            setBusy(false);
            patchReply((r2) => ({ ...r2, streaming: false, thinking: false }));
            renderReply(chat.items.length - 1);
            setView(screenView());
            // changes it proposed open in the viewer for review (the card in the chat opens them again)
            const prop = chat.items.at(-1)?.parts?.find((p) => p.kind === "proposal");
            if (prop) openInDrawer(`#/proposal/${prop.id}`);
        }
    };
    const stop = () => stopper.current?.abort();
    // a new conversation; the old one stays in History
    const fresh = () => {
        setChat({ id: null, items: [], usage: null });
        setHistory(null);
        box.current?.focus();
    };
    const onKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(text); }
        if (e.key === "Escape" && busy) { e.preventDefault(); e.stopPropagation(); stop(); }
    };
    const onScroll = () => { const el = list.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

    if (status?.auth === "claude-code") return html`<${ClaudeTerminal} active=${active} />`;
    if (status && !status.ready) return html`<div class="drawer-body ai-pane"><div class="ai-setup">
        <${BotIcon} size=${40} />
        <h3>Connect the assistant</h3>
        <p class="muted">${status.auth === "openai" ? "Add your OpenAI API key and choose a model in Settings."
            : status.auth === "local" ? "Choose your local model server and a model in Settings."
            : "Sign in with Anthropic, or add an API key (Anthropic or OpenAI), or connect a local model in Settings."} The assistant only reads your novels and data store, and only what it needs for each question.</p>
        <a class="button primary" href="#/settings?s=ai" data-page>Open Settings</a></div></div>`;
    return html`<div class="ai-pane">
        <div class="ai-head">
            <span class="muted small">${status?.modelLabel ?? ""}${status?.provider === "local" ? " · local" : status?.provider === "openai" ? " · OpenAI" : ""}${status?.mock && status?.provider === "anthropic" ? " (test mode)" : ""}</span>
            <span class="grow" />
            ${c.usage && (status?.provider === "anthropic"
                ? html`<span class="muted small" title=${`${c.usage.input.toLocaleString()} tokens in, ${c.usage.cacheRead.toLocaleString()} from the cache, ${c.usage.output.toLocaleString()} out (estimate)`}>${money(c.usage.cost)}</span>`
                : html`<span class="muted small" title=${`${c.usage.input.toLocaleString()} tokens in, ${c.usage.output.toLocaleString()} out`}>${tokens(c.usage.input + c.usage.output)}</span>`)}
            <button class=${`small ${history ? "on" : ""}`} onClick=${openHistory} disabled=${busy} title="Earlier conversations">History</button>
            <button class="small" onClick=${fresh} disabled=${busy || !c.items.length} title="Start a new conversation (this one stays in History)">New</button>
        </div>
        ${history && html`<div class="term-history">
            ${!history.length ? html`<p class="muted small">No saved conversations yet.</p>` : history.map((h) => html`<div key=${h.id} class=${`term-session ${c.id === h.id ? "current" : ""}`} role="button" tabIndex="0" onClick=${() => pick(h.id)} onKeyDown=${(e) => e.key === "Enter" && pick(h.id)}>
                <span class="term-session-title">${h.title}</span>
                <span class="row"><span class="muted small grow">${ago(h.updated)} · ${Math.ceil(h.messages / 2)} question${h.messages > 2 ? "s" : ""} · ${h.provider === "anthropic" ? money(h.cost) : tokens(h.tokens ?? 0)}</span>
                    <span onClick=${(e) => e.stopPropagation()}><${ConfirmButton} class="small" onConfirm=${() => remove(h.id)}>Delete</${ConfirmButton}></span></span>
            </div>`)}
        </div>`}
        <div class="ai-list" ref=${list} onScroll=${onScroll} data-drawer>
            ${!c.items.length && html`<div class="ai-empty muted">
                <p>Ask about your novels and worlds: what happened in a chapter, who holds what, where a place is, ideas for what comes next. Ask it to create or change something and it prepares the changes for you to review first.</p>
            </div>`}
            ${c.items.map((it, i) => (it.role === "user"
                ? html`<div class="ai-msg user" key=${i}>${it.text}</div>`
                : html`<div class="ai-msg bot" key=${i}>
                    ${it.html ? html`<${Html} html=${it.html} />` : it.parts.filter((p) => p.kind !== "proposal").map((p, j) => (p.kind === "tool"
                        ? html`<div class=${`ai-tool ${p.running ? "running" : ""} ${p.error ? "error" : ""}`} key=${j}>${p.running ? "⋯ " : p.error ? "⚠ " : "✓ "}${p.label}</div>`
                        : html`<div class="ai-text" key=${j}>${splitReplies(p.text).text}</div>`))}
                    ${it.parts.filter((p) => p.kind === "proposal").map((p) => html`<button class="ai-proposal" key=${p.id} onClick=${() => openInDrawer(`#/proposal/${p.id}`)}>
                        <span class="ai-proposal-title">${p.title}</span><span class="muted small">${p.count} change${p.count === 1 ? "" : "s"} to review →</span></button>`)}
                    ${it.html && it.parts.some((p) => p.kind === "tool") && html`<details class="ai-steps"><summary>${((n) => `${n} step${n === 1 ? "" : "s"}`)(it.parts.filter((p) => p.kind === "tool").length)}</summary>${it.parts.filter((p) => p.kind === "tool").map((p, j) => html`<div class=${`ai-tool ${p.error ? "error" : ""}`} key=${j}>${p.error ? "⚠ " : "✓ "}${p.label}</div>`)}</details>`}
                    ${it.thinking && html`<div class="ai-tool running">⋯ Thinking</div>`}
                    ${it.streaming && !it.thinking && !it.parts.length && html`<div class="ai-tool running">⋯</div>`}
                    ${it.error && html`<p class="error small">${it.error}</p>`}
                </div>`))}
        </div>
        ${!busy && (() => {
            const last = c.items.at(-1);
            const chips = !c.items.length ? starters(view) : last?.role === "assistant" && !last.error ? splitReplies(last.parts.filter((p) => p.kind === "text").map((p) => p.text).join("")).replies : [];
            return chips.length ? html`<div class="ai-chips">${chips.map((r) => html`<button class="small" key=${r} onClick=${() => send(r)}>${r}</button>`)}</div>` : null;
        })()}
        <div class="ai-input">
            <textarea ref=${box} rows="2" placeholder=${placeholderFor(view, c.items.length > 0)} value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey} />
            ${busy ? html`<button onClick=${stop} title="Stop (Escape)">Stop</button>` : html`<button class="primary" onClick=${() => send(text)} disabled=${!text.trim()}>Send</button>`}
        </div>
    </div>`;
}

/** A finished reply's text as rendered markdown ([[links]] open in the viewer); tool notes fold into "N steps" */
async function renderReply(i) {
    const it = chat.items[i];
    const md = splitReplies(it?.parts?.filter((p) => p.kind === "text").map((p) => p.text).join("\n\n") ?? "").text.trim();
    if (!md) return;
    try {
        const { html: out } = await api.send("POST", "/api/render", { markdown: md });
        const items = [...chat.items];
        if (items[i] === it) { items[i] = { ...it, html: out }; setChat({ ...chat, items }); }
    } catch { /* keep the plain text */ }
}

// ---------------------------------------------------------------- settings

export function AiSettingsPanel() {
    const [s, setS] = useState(null);
    const [key, setKey] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [test, setTest] = useState(null);
    const load = () => api.get("/api/ai/status?probe=1").then(setS).catch((e) => setError(e.message));
    useEffect(() => { load(); }, []);
    // "Open Settings" from the AI tab lands here
    useEffect(() => { if (s && /[?&]s=ai\b/.test(location.hash)) document.getElementById("ai-settings")?.scrollIntoView({ block: "start" }); }, [!!s]);
    // while signing in, check every 2 s until `ant auth login` finishes
    useEffect(() => { if (!s?.signingIn) return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [s?.signingIn]);
    const save = async (patch) => {
        setBusy(true); setError(null);
        try {
            const next = await api.send("POST", "/api/ai/settings", patch);
            setS(next);
            if (patch.apiKey || patch.openaiKey || patch.localKey) { setKey(""); toast("API key saved"); }
            setTest(null);
            if (next.auth === "openai" || next.auth === "local") load();   // the model list comes from the server
        } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const act = async (url) => { setBusy(true); setError(null); try { setS(await api.send("POST", url)); } catch (e) { setError(e.message); } setBusy(false); };
    const runTest = async () => { setTest({ busy: true }); try { setTest(await api.send("POST", "/api/ai/test")); } catch (e) { setTest({ ok: false, error: e.message }); } };
    if (!s) return html`<div class="panel" id="ai-settings"><h3>AI assistant</h3>${error ? html`<p class="error">${error}</p>` : html`<p class="muted">Loading…</p>`}</div>`;
    return html`<div class="panel ai-settings" id="ai-settings">
        <h3><${BotIcon} /> AI assistant</h3>
        <p class="muted">The assistant (Claude, an OpenAI model or a model on your own computer) helps with your novels and worlds in the side drawer's AI tab (the robot button at the top right). It reads only your novel folders and the data store, a little at a time, and every change it proposes opens for your review before anything is written.</p>
        <div class="field"><label>Connect with</label>
            <div class="seg wrap" role="group">
                <button class=${s.auth === "claude-code" ? "on" : ""} disabled=${!s.capabilities.terminal.ok} title=${s.capabilities.terminal.ok ? "" : s.capabilities.terminal.reason} onClick=${() => save({ auth: "claude-code" })}>Claude Code (your subscription)</button>
                <button class=${s.auth === "signin" ? "on" : ""} onClick=${() => save({ auth: "signin" })}>Sign in with Anthropic (API)</button>
                <button class=${s.auth === "key" ? "on" : ""} onClick=${() => save({ auth: "key" })}>Anthropic API key</button>
                <button class=${s.auth === "openai" ? "on" : ""} onClick=${() => save({ auth: "openai" })}>OpenAI API key</button>
                <button class=${s.auth === "local" ? "on" : ""} onClick=${() => save({ auth: "local" })}>Local model</button>
            </div>
            ${!s.capabilities.terminal.ok && html`<p class="muted small">Claude Code isn't available: ${s.capabilities.terminal.reason} ${s.capabilities.terminal.fix ?? ""}</p>`}
        </div>
        ${s.auth === "openai" ? html`<${CompatSettings} s=${s} kind="openai" busy=${busy} save=${save} keyText=${key} setKey=${setKey} />`
        : s.auth === "local" ? html`<${CompatSettings} s=${s} kind="local" busy=${busy} save=${save} keyText=${key} setKey=${setKey} />`
        : s.auth === "claude-code" ? html`<div class="ai-cc">
            ${s.claude ? html`<p>Claude Code found: <code>${s.claude}</code></p>` : html`<p class="error">Claude Code isn't installed (no <code>claude</code> command found). Install it from <a href="https://code.claude.com/docs" target="_blank" rel="noopener">Anthropic's Claude Code docs</a> and sign in once by running <code>claude</code> in a terminal.</p>`}
            <p class="muted small">The AI tab runs your own Claude Code in a terminal, signed in with your own Claude subscription (or however you have set Claude Code up), so its use counts against your plan rather than API billing. Novel Craft only connects it to its tools; your sign-in stays with Claude Code.</p>
            <ul class="muted small ai-rules">
                <li>It runs in its own workspace folder, <code>${s.workspace}</code>, connected to Novel Craft's tools and no other MCP servers.</li>
                <li>Allowed without asking: Novel Craft's tools (search, overviews, chapters, notes, collections, ledgers, worlds, taxonomy, what is on screen, proposing changes).</li>
                <li>Refused: reading or editing the vault's files directly, and shell commands. Changes go through the review panel, where you apply or reject each one.</li>
                <li>Type <code>/world-builder</code> in it for ready-made prompts: summarise or review a chapter, brainstorm, draft an entry, check continuity. Model and effort are Claude Code's own (<code>/model</code>, <code>/effort</code>).</li>
            </ul>
        </div>` : s.auth === "signin" ? html`<div class="ai-signin">
            ${s.ant ? html`
                <p class="muted small">Signs in through Anthropic's <code>ant</code> tool in your browser, then uses that sign-in. Usage is billed to the Anthropic API account you choose.</p>
                ${s.antStatus && html`<pre class="ai-status">${s.antStatus}</pre>`}
                <div class="row">
                    <button class="primary" disabled=${busy || s.signingIn} onClick=${() => act("/api/ai/signin")}>${s.signingIn ? "Waiting for the browser…" : "Sign in with Anthropic"}</button>
                    ${s.antStatus && html`<button disabled=${busy} onClick=${() => act("/api/ai/signout")}>Sign out</button>`}
                </div>
                ${s.loginOutput && html`<pre class="ai-status">${s.loginOutput}</pre>`}`
            : html`<p>Signing in needs Anthropic's <code>ant</code> command-line tool, which isn't installed on this computer. Install it from <a href="https://github.com/anthropics/anthropic-cli/releases" target="_blank" rel="noopener">its releases page</a> (put <code>ant</code> on your PATH), then come back here. Or use an API key instead.</p>`}
        </div>` : html`<div class="ai-key">
            ${s.hasKey ? html`<p>Key saved <code>${s.keyHint}</code> <${ConfirmButton} class="small" onConfirm=${() => save({ removeKey: true })}>Remove</${ConfirmButton}></p>`
                : s.envKey ? html`<p class="muted">Using the key in the <code>ANTHROPIC_API_KEY</code> environment variable.</p>` : null}
            <div class="row">
                <input type="password" autocomplete="off" spellcheck="false" placeholder=${s.hasKey ? "Replace with another key" : "sk-ant-…"} value=${key} onInput=${(e) => setKey(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && key.trim() && save({ apiKey: key })} />
                <button class="primary" disabled=${busy || !key.trim()} onClick=${() => save({ apiKey: key })}>Save key</button>
            </div>
            <p class="muted small">Create a key in the Claude Console (console.anthropic.com → API keys). It is kept on this computer only, in <code>${s.secretsFile}</code> (readable by you alone), and never shown to the page again.</p>
        </div>`}
        ${s.provider === "anthropic" && html`<div class="field"><label>Model</label>
            <div class="seg wrap" role="group">${s.models.map((m) => html`<button class=${s.model === m.id ? "on" : ""} title=${m.note} onClick=${() => save({ model: m.id })}>${m.label}</button>`)}</div>
            <p class="muted small">${s.models.find((m) => m.id === s.model)?.note}</p>
        </div>
        <div class="field"><label>Effort</label>
            <div class="seg" role="group">${s.efforts.map((e) => html`<button class=${s.effort === e ? "on" : ""} onClick=${() => save({ effort: e })}>${e[0].toUpperCase() + e.slice(1)}</button>`)}</div>
            <p class="muted small">How hard Claude thinks before answering. Medium suits most questions; High for reviewing chapters or tricky continuity, at more time and cost.</p>
        </div>`}
        ${s.auth !== "claude-code" && html`<div class="row">
            <button disabled=${!s.ready || test?.busy} onClick=${runTest}>${test?.busy ? "Testing…" : "Test the connection"}</button>
            ${test && !test.busy && (test.ok ? html`<span class="ok">Connected (${test.model})</span>` : html`<span class="error">${test.error}</span>`)}
        </div>`}
        ${error && html`<p class="error">${error}</p>`}
    </div>`;
}

/** Settings for an OpenAI-compatible server: OpenAI (key, model, effort) or a local one (preset or URL, model) */
function CompatSettings({ s, kind, busy, save, keyText, setKey }) {
    const o = kind === "openai" ? s.openai : s.local;
    const custom = kind === "local" && o.preset === "custom";
    const [model, setModel] = useState(o.model ?? "");
    const [url, setUrl] = useState(o.customUrl ?? "");
    useEffect(() => setModel(o.model ?? ""), [o.model]);
    const field = kind === "openai" ? "openaiModel" : "localModel";
    const saveModel = (v = model) => { if (v.trim() !== (o.model ?? "")) save({ [field]: v.trim() }); };
    const models = s.remote?.models ?? [];
    const preset = o.presets?.find((p) => p.id === o.preset);
    return html`<div class="ai-compat">
        ${kind === "openai" ? html`
            <p class="muted small">Uses OpenAI's API with your own key, billed to your OpenAI account. Create a key at platform.openai.com → API keys.</p>
            ${o.hasKey ? html`<p>Key saved <code>${o.keyHint}</code> <${ConfirmButton} class="small" onConfirm=${() => save({ removeOpenaiKey: true })}>Remove</${ConfirmButton}></p>`
                : o.envKey ? html`<p class="muted">Using the key in the <code>OPENAI_API_KEY</code> environment variable.</p>` : null}
            <div class="row">
                <input type="password" autocomplete="off" spellcheck="false" placeholder=${o.hasKey ? "Replace with another key" : "sk-…"} value=${keyText} onInput=${(e) => setKey(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && keyText.trim() && save({ openaiKey: keyText })} />
                <button class="primary" disabled=${busy || !keyText.trim()} onClick=${() => save({ openaiKey: keyText })}>Save key</button>
            </div>
            <p class="muted small">Kept on this computer only, in <code>${s.secretsFile}</code> (readable by you alone), and sent only to OpenAI.</p>`
        : html`
            <p class="muted small">Runs the assistant on a model on your own computer (or any server that speaks the OpenAI-compatible API). Nothing leaves your computer unless the address points elsewhere. The model must support tool calling; bigger models follow the instructions better.</p>
            <div class="field"><label>Server</label>
                <div class="seg wrap" role="group">
                    ${o.presets.map((p) => html`<button class=${o.preset === p.id ? "on" : ""} onClick=${() => save({ localPreset: p.id })}>${p.label}</button>`)}
                    <button class=${custom ? "on" : ""} onClick=${() => save({ localPreset: "custom" })}>Other address</button>
                </div>
                ${preset && html`<p class="muted small"><code>${preset.url}</code>. ${preset.help.split("`").map((t, i) => (i % 2 ? html`<code>${t}</code>` : t))}</p>`}
            </div>
            ${custom && html`<div class="field"><label>Address</label>
                <div class="row"><input placeholder="http://localhost:8000/v1" value=${url} onInput=${(e) => setUrl(e.target.value)}
                    onKeyDown=${(e) => e.key === "Enter" && save({ localUrl: url })} onBlur=${() => url !== (o.customUrl ?? "") && save({ localUrl: url })} /></div>
                <p class="muted small">The API's base address, usually ending in <code>/v1</code>.</p>
            </div>
            <div class="field"><label>API key (optional)</label>
                ${o.hasKey && html`<p>Key saved <code>${o.keyHint}</code> <${ConfirmButton} class="small" onConfirm=${() => save({ removeLocalKey: true })}>Remove</${ConfirmButton}></p>`}
                <div class="row">
                    <input type="password" autocomplete="off" spellcheck="false" placeholder="Only if the server asks for one" value=${keyText} onInput=${(e) => setKey(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && keyText.trim() && save({ localKey: keyText })} />
                    <button disabled=${busy || !keyText.trim()} onClick=${() => save({ localKey: keyText })}>Save key</button>
                </div>
            </div>`}`}
        <div class="field"><label>Model</label>
            <div class="row">
                <input class="grow" list=${`ai-models-${kind}`} placeholder=${models.length ? "Choose or type a model" : kind === "openai" ? "A model id (the list appears once the key is saved)" : "e.g. qwen3"} value=${model}
                    onInput=${(e) => { setModel(e.target.value); if (models.includes(e.target.value)) saveModel(e.target.value); }}
                    onKeyDown=${(e) => e.key === "Enter" && saveModel()} onBlur=${() => saveModel()} />
                <datalist id=${`ai-models-${kind}`}>${models.map((m) => html`<option value=${m} />`)}</datalist>
            </div>
            ${s.remote && (s.remote.ok
                ? html`<p class="muted small">${models.length ? `${models.length} model${models.length === 1 ? "" : "s"} available.` : kind === "local" ? "The server is running but has no models yet." : "No chat models found for this key."}</p>`
                : html`<p class="error small">${s.remote.error}</p>`)}
        </div>
        ${kind === "openai" && html`<div class="field"><label>Effort</label>
            <div class="seg" role="group">${s.efforts.map((e) => html`<button class=${s.effort === e ? "on" : ""} onClick=${() => save({ effort: e })}>${e[0].toUpperCase() + e.slice(1)}</button>`)}</div>
            <p class="muted small">Reasoning effort, for models that reason (ignored by those that don't).</p>
        </div>`}
    </div>`;
}

// ---------------------------------------------------------------- reviewing proposed changes

/** Word-level differences: [{t: "same"|"del"|"add", s}] (falls back to delete-all/add-all for very long passages) */
export function wordDiff(a, b) {
    const tok = (s) => s.match(/\s+|\w+|[^\s\w]/g) ?? [];
    const x = tok(a), y = tok(b);
    if (x.length * y.length > 4e6) return [{ t: "del", s: a }, { t: "add", s: b }];
    const n = x.length, m = y.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    const push = (t, s) => { const last = out.at(-1); if (last?.t === t) last.s += s; else out.push({ t, s }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (x[i] === y[j]) { push("same", x[i]); i++; j++; }
        else if (L[i + 1][j] >= L[i][j + 1]) push("del", x[i++]);
        else push("add", y[j++]);
    }
    while (i < n) push("del", x[i++]);
    while (j < m) push("add", y[j++]);
    // readable runs: a changed stretch (small unchanged bits like spaces or single words inside it included) shows
    // as one deletion followed by one insertion, not interleaved fragments
    const runs = [];
    for (let k = 0; k < out.length; k++) {
        const d = out[k];
        const trivial = d.t === "same" && (/^[\s\W]*$/.test(d.s) || d.s.trim().split(/\s+/).length === 1) && k > 0 && k < out.length - 1;
        const last = runs.at(-1);
        if (d.t === "same" && !trivial) { runs.push({ t: "same", s: d.s }); continue; }
        const run = last?.t === "change" ? last : (runs.push({ t: "change", del: "", add: "" }), runs.at(-1));
        if (d.t !== "add") run.del += d.s;
        if (d.t !== "del") run.add += d.s;
    }
    return runs.flatMap((r) => (r.t === "same" ? [r] : [r.del && { t: "del", s: r.del }, r.add && { t: "add", s: r.add }].filter(Boolean)));
}

const STATUS = { pending: "Waiting", applied: "Applied", rejected: "Rejected", failed: "Failed" };

/** The review panel: every proposed change with what it would do, Apply / Reject each, or all */
export function ProposalView({ id }) {
    const { data, error } = useApi(`/api/ai/proposal?id=${encodeURIComponent(id)}`);
    const [p, setP] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (data) setP(data); }, [data]);
    if (!p) return error ? html`<p class="error">${error}</p>` : html`<p class="muted">Loading…</p>`;
    const act = async (verb, which) => {
        setBusy(true);
        try {
            const next = await api.send("POST", `/api/ai/proposal/${verb}`, { id, which });
            setP(next);
            const failed = next.changes.filter((c) => c.status === "failed" && c.error);
            if (failed.length) toast(`Couldn't apply: ${failed.map((c) => c.error).join("; ")}`);
        } catch (e) { toast(e.message); }
        setBusy(false);
    };
    const pending = p.changes.filter((c) => c.status === "pending").length;
    return html`<div class="proposal">
        <div class="proposal-head">
            <div><h2>${p.title}</h2><p class="muted small">Proposed by the assistant · ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}${pending && pending < p.changes.length ? `, ${pending} waiting` : ""}. Nothing is written until you apply it.</p></div>
            <div class="row">
                <button class="small" onClick=${backToConversation}>Back to the conversation</button>
                ${pending > 0 && html`<button disabled=${busy} onClick=${() => act("reject", "all")}>Reject all</button>
                    <button class="primary" disabled=${busy} onClick=${() => act("apply", "all")}>Apply ${pending === p.changes.length ? "all" : `the ${pending} left`}</button>`}
            </div>
        </div>
        ${p.changes.map((c) => html`<${ChangeCard} key=${c.i} c=${c} busy=${busy} act=${act} />`)}
    </div>`;
}

function ChangeCard({ c, busy, act }) {
    const head = c.action === "create_note" ? html`New ${c.kind === "character" ? "character" : `entry in ${c.collection}`}: <b>${c.name}</b>${c.renamed ? html` <span class="muted small">(name taken, so renamed)</span>` : ""}`
        : c.action === "ledger_entry" ? html`${c.replaceKey ? `Change ${c.type} entry ${c.replaceKey}` : `New ${c.type} entry`} for <b>${c.owner}</b>, chapter ${c.entry.chapter}${c.entry.title ? html`: ${c.entry.title}` : ""}${c.status === "applied" && c.key ? html` <span class="muted small">(${c.key})</span>` : ""}`
        : c.action === "delete_ledger_entry" ? html`Delete ${c.type} entry ${c.key} of <b>${c.owner}</b>, chapter ${c.chapter}${c.title ? html`: ${c.title}` : ""}`
        : c.action === "edit_fields" ? html`Fields of <b>${c.name}</b>`
        : c.action === "create_facet" ? html`New taxonomy <b>${c.name}</b>${c.levels ? " (levels)" : ""}`
        : c.action === "add_facet_values" ? html`Add ${c.values.length} value${c.values.length === 1 ? "" : "s"} to <b>${c.collection.slice(9)}</b>`
        : c.action === "set_facet_systems" ? html`Power systems of <b>${c.collection.slice(9)}</b>`
        : c.action === "link_facet_system" ? html`<b>${c.system}</b> uses <b>${c.collection.slice(9)}</b>${c.from ? html` instead of <b>${c.from.slice(9)}</b>` : ""}`
        : c.action === "unlink_facet_system" ? html`<b>${c.system}</b> stops using <b>${c.collection.slice(9)}</b>`
        : c.action === "remove_facet" ? html`Remove the taxonomy <b>${c.collection.slice(9)}</b>`
        : c.action === "edit_text" ? html`Text of <b>${c.name}</b>` : html`Add to <b>${c.name}</b>`;
    return html`<div class=${`change ${c.status}`}>
        <div class="change-head">
            <span class="change-n">${c.i + 1}</span><span class="grow">${head}</span>
            <span class=${`badge ${c.status === "applied" ? "ok" : c.status === "failed" ? "bad" : c.status === "rejected" ? "" : "warn"}`}>${STATUS[c.status]}</span>
            ${c.status === "pending" && html`<button class="small" disabled=${busy} onClick=${() => act("reject", c.i)}>Reject</button><button class="small primary" disabled=${busy} onClick=${() => act("apply", c.i)}>Apply</button>`}
            ${c.status === "applied" && c.path && html`<button class="small" onClick=${() => openInDrawer(`#/note/${c.path}`)}>Open</button>`}
        </div>
        ${c.error && html`<p class="error small">${c.error}</p>`}
        <div class="change-body">
            ${c.action === "create_note" && html`
                ${Object.keys(c.fields ?? {}).length > 0 && html`<table class="change-fields"><tbody>${Object.entries(c.fields).map(([k, v]) => html`<tr><th>${k}</th><td class="ins">${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}</td></tr>`)}</tbody></table>`}
                ${c.text && html`<div class="change-text"><ins>${c.text}</ins></div>`}
                <p class="muted small">${c.path}</p>`}
            ${c.action === "ledger_entry" && html`
                ${c.warnings?.length > 0 && html`<div class="warnbox">${c.warnings.map((w) => html`<div>${w}</div>`)}</div>`}
                ${c.beforeHtml ? html`<div class="change-callouts"><div><div class="muted small">Now</div><${Html} html=${c.beforeHtml} /></div><div><div class="muted small">After</div><${Html} html=${c.calloutHtml} /></div></div>`
                    : html`<${Html} html=${c.calloutHtml} />`}
                ${c.holdings?.length > 0 && html`<table class="change-fields"><thead><tr><th>Holdings at chapter ${c.entry.chapter}</th><th>Now</th><th>After</th></tr></thead><tbody>
                    ${c.holdings.map((r) => html`<tr><th>${r.item}${r.store && r.store !== "inventory" ? html` <span class="muted">@ ${r.store}</span>` : ""}</th><td class="del">${r.before || html`<span class="muted">none</span>`}</td><td class="ins">${r.after || html`<span class="muted">none</span>`}</td></tr>`)}</tbody></table>`}
                ${c.statsHtml && html`<details><summary class="muted small">Stats panel with this entry</summary><${Html} html=${c.statsHtml} /></details>`}
                <p class="muted small">${c.name} · ${c.novelName}${c.entry.lines?.some((l) => l.action === "transfer-out") ? " · the receiver's ledger gets the transfer too" : ""}</p>`}
            ${c.action === "delete_ledger_entry" && html`
                <div class="change-deleted"><${Html} html=${c.calloutHtml} /></div>
                <p class="muted small">${c.name} · ${c.novelName}${c.mirrors?.length ? ` · also removes the transfer in ${c.mirrors.join(", ")}` : ""}${c.receivers?.length ? " · sheets are synced again" : ""}</p>`}
            ${c.action === "edit_fields" && html`<table class="change-fields"><thead><tr><th>Field</th><th>Now</th><th>After</th></tr></thead><tbody>
                ${c.rows.map((r) => html`<tr><th>${r.key}</th><td class="del">${r.before || html`<span class="muted">empty</span>`}</td><td class="ins">${r.removed ? html`<span class="muted">removed</span>` : r.after || html`<span class="muted">empty</span>`}</td></tr>`)}</tbody></table>`}
            ${c.action === "edit_text" && html`<div class="change-text"><span class="ctx">${c.context.before}</span>${wordDiff(c.find, c.replace).map((d, k) => (d.t === "same" ? d.s : d.t === "del" ? html`<del key=${k}>${d.s}</del>` : html`<ins key=${k}>${d.s}</ins>`))}<span class="ctx">${c.context.after}</span></div>`}
            ${(c.action === "create_facet" || c.action === "add_facet_values") && html`
                ${c.values.length > 0 ? html`<table class="change-fields"><thead><tr><th>Value</th>${c.levels && html`<th>Number</th>`}</tr></thead><tbody>
                    ${c.values.map((v) => html`<tr><td class="ins" style=${v.parent ? "padding-left:22px" : ""}>${v.title || v.name}</td>${c.levels && html`<td class="ins num">${v.threshold ?? ""}</td>`}</tr>`)}</tbody></table>`
                    : html`<p class="muted small">No values yet.</p>`}
                <p class="muted small">${c.collection}${c.powerSystems?.length ? ` · levels of ${c.powerSystems.join(", ")}` : ""}${c.action === "add_facet_values" ? ` · ranked after its ${c.existing} value${c.existing === 1 ? "" : "s"}` : ""}</p>`}
            ${c.action === "set_facet_systems" && html`<table class="change-fields"><thead><tr><th></th><th>Now</th><th>After</th></tr></thead><tbody>
                <tr><th>Power systems</th><td class="del">${c.before.join(", ") || html`<span class="muted">none</span>`}</td><td class="ins">${c.powerSystems.join(", ") || html`<span class="muted">none</span>`}</td></tr></tbody></table>
                <p class="muted small">Set on all ${c.count} values of ${c.collection.slice(9)}</p>`}
            ${(c.action === "link_facet_system" || c.action === "unlink_facet_system") && html`<table class="change-fields"><thead><tr><th>Power systems of</th><th>Now</th><th>After</th></tr></thead><tbody>
                <tr><th>${c.collection.slice(9)}</th><td class="del">${c.before.join(", ") || html`<span class="muted">none</span>`}</td><td class="ins">${c.after.join(", ") || html`<span class="muted">none</span>`}</td></tr>
                ${c.from && html`<tr><th>${c.from.slice(9)}</th><td class="del">${c.fromBefore.join(", ") || html`<span class="muted">none</span>`}</td><td class="ins">${c.fromBefore.filter((x) => x.toLowerCase() !== c.system.toLowerCase()).join(", ") || html`<span class="muted">none</span>`}</td></tr>`}</tbody></table>
                <p class="muted small">Written on all ${c.count} values${c.from ? ` of ${c.collection.slice(9)} and on the values of ${c.from.slice(9)}` : ""}; other power systems stay.</p>`}
            ${c.action === "remove_facet" && html`<div class="change-deleted"><p>${c.values.length} value${c.values.length === 1 ? "" : "s"} go to the vault's trash${c.values.length ? `: ${c.values.slice(0, 12).join(", ")}${c.values.length > 12 ? "…" : ""}` : ""}; the taxonomy leaves the schema.</p></div>
                ${c.linkedFrom.length > 0 && html`<div class="warnbox">${c.linkedFrom.length} note${c.linkedFrom.length === 1 ? " links" : "s link"} to these values and will show them as unresolved: ${c.linkedFrom.slice(0, 10).join(", ")}${c.linkedFrom.length > 10 ? "…" : ""}</div>`}`}
            ${c.action === "add_text" && html`<div class="change-text">${c.after ? html`<span class="ctx">${c.context.before}${c.after}${c.context.after}</span>` : html`<span class="ctx">…${c.context}</span>`}${"\n\n"}<ins>${c.text}</ins></div>`}
        </div>
    </div>`;
}
