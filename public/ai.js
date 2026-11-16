// The AI assistant: its drawer tab (a conversation with Claude that streams in, tool steps shown as one-line notes)
// and its Settings panel (sign-in or API key, model, effort). The server runs the conversation (lib/ai.js); this page
// sends one message at a time with a short description of what is on screen.
import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";
import { api, toast, Html, ConfirmButton } from "./app.js";
import { writerNow } from "./writer.js";

const html = htm.bind(h);

/** The robot head used for the topbar button and the drawer tab */
export const BotIcon = ({ size = 18 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3v3" /><circle cx="12" cy="2.6" r="0.9" fill="currentColor" stroke="none" />
    <rect x="4" y="6" width="16" height="12" rx="3.5" /><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <path d="M9.5 15.5h5" /><path d="M2 11v3M22 11v3" /></svg>`;

// ---------------------------------------------------------------- what is on screen

/** A short description of the screen for the assistant: page, drawer page, writer chapter, selected text */
function screenView() {
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
const setChat = (c) => { chat = c; chatListeners.forEach((f) => f(c)); };

const TOOL_LABELS = { search: "Searching", novel_overview: "Reading the novel overview", read_chapter: "Reading a chapter", read_note: "Reading a note", query_collection: "Listing a collection", schema: "Reading the fields", character_state: "Checking ledgers", world_tree: "Reading the world outline", taxonomy: "Reading taxonomy values", current_view: "Looking at the screen" };
const money = (n) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

export function AiPane({ active }) {
    const [c, set] = useState(chat);
    useEffect(() => { chatListeners.add(set); return () => chatListeners.delete(set); }, []);
    const [status, setStatus] = useState(null);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const stopper = useRef(null);
    const list = useRef(null);
    const box = useRef(null);
    const stick = useRef(true);
    useEffect(() => { if (active) api.get("/api/ai/status").then(setStatus).catch(() => setStatus({ ready: false })); }, [active]);
    useEffect(() => { if (active) box.current?.focus(); }, [active]);
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
                    else if (ev.t === "tool_done") patchReply((r2) => ({ ...r2, parts: r2.parts.map((p) => (p.id === ev.id ? { ...p, running: false, label: ev.summary, error: ev.error } : p)) }));
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
        }
    };
    const stop = () => stopper.current?.abort();
    const fresh = () => {
        if (chat.id) api.send("DELETE", `/api/ai/conversation?id=${encodeURIComponent(chat.id)}`).catch(() => { });
        setChat({ id: null, items: [], usage: null });
        box.current?.focus();
    };
    const onKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(text); }
        if (e.key === "Escape" && busy) { e.preventDefault(); e.stopPropagation(); stop(); }
    };
    const onScroll = () => { const el = list.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

    if (status && !status.ready) return html`<div class="drawer-body ai-pane"><div class="ai-setup">
        <${BotIcon} size=${40} />
        <h3>Connect the assistant</h3>
        <p class="muted">Sign in with Anthropic or add a Claude API key in Settings. The assistant only reads your novels and data store, and only what it needs for each question.</p>
        <a class="button primary" href="#/settings?s=ai" data-page>Open Settings</a></div></div>`;
    return html`<div class="ai-pane">
        <div class="ai-head">
            <span class="muted small">${status ? status.models.find((m) => m.id === status.model)?.label ?? status.model : ""}${status?.mock ? " (test mode)" : ""}</span>
            <span class="grow" />
            ${c.usage && html`<span class="muted small" title=${`${c.usage.input.toLocaleString()} tokens in, ${c.usage.cacheRead.toLocaleString()} from the cache, ${c.usage.output.toLocaleString()} out (estimate)`}>${money(c.usage.cost)}</span>`}
            <button class="small" onClick=${fresh} disabled=${busy || !c.items.length} title="Start a new conversation">New</button>
        </div>
        <div class="ai-list" ref=${list} onScroll=${onScroll} data-drawer>
            ${!c.items.length && html`<div class="ai-empty muted">
                <p>Ask about your novels and worlds: what happened in a chapter, who holds what, where a place is, ideas for what comes next.</p>
                <div class="ai-starters">${["Summarise the chapter I'm on", "What does the main character carry right now?", "Brainstorm three complications for the next chapter"].map((s) => html`<button class="small" onClick=${() => send(s)}>${s}</button>`)}</div>
            </div>`}
            ${c.items.map((it, i) => (it.role === "user"
                ? html`<div class="ai-msg user" key=${i}>${it.text}</div>`
                : html`<div class="ai-msg bot" key=${i}>
                    ${it.html ? html`<${Html} html=${it.html} />` : it.parts.map((p, j) => (p.kind === "tool"
                        ? html`<div class=${`ai-tool ${p.running ? "running" : ""} ${p.error ? "error" : ""}`} key=${j}>${p.running ? "⋯ " : p.error ? "⚠ " : "✓ "}${p.label}</div>`
                        : html`<div class="ai-text" key=${j}>${p.text}</div>`))}
                    ${it.html && it.parts.some((p) => p.kind === "tool") && html`<details class="ai-steps"><summary>${((n) => `${n} step${n === 1 ? "" : "s"}`)(it.parts.filter((p) => p.kind === "tool").length)}</summary>${it.parts.filter((p) => p.kind === "tool").map((p, j) => html`<div class=${`ai-tool ${p.error ? "error" : ""}`} key=${j}>${p.error ? "⚠ " : "✓ "}${p.label}</div>`)}</details>`}
                    ${it.thinking && html`<div class="ai-tool running">⋯ Thinking</div>`}
                    ${it.streaming && !it.thinking && !it.parts.length && html`<div class="ai-tool running">⋯</div>`}
                    ${it.error && html`<p class="error small">${it.error}</p>`}
                </div>`))}
        </div>
        <div class="ai-input">
            <textarea ref=${box} rows="2" placeholder="Ask about your novels… (Enter sends, Shift+Enter: new line)" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey} />
            ${busy ? html`<button onClick=${stop} title="Stop (Escape)">Stop</button>` : html`<button class="primary" onClick=${() => send(text)} disabled=${!text.trim()}>Send</button>`}
        </div>
    </div>`;
}

/** A finished reply's text as rendered markdown ([[links]] open in the viewer); tool notes fold into "N steps" */
async function renderReply(i) {
    const it = chat.items[i];
    const md = it?.parts?.filter((p) => p.kind === "text").map((p) => p.text).join("\n\n").trim();
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
    const load = () => api.get("/api/ai/status").then(setS).catch((e) => setError(e.message));
    useEffect(() => { load(); }, []);
    // "Open Settings" from the AI tab lands here
    useEffect(() => { if (s && /[?&]s=ai\b/.test(location.hash)) document.getElementById("ai-settings")?.scrollIntoView({ block: "start" }); }, [!!s]);
    // while signing in, check every 2 s until `ant auth login` finishes
    useEffect(() => { if (!s?.signingIn) return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [s?.signingIn]);
    const save = async (patch) => {
        setBusy(true); setError(null);
        try { setS(await api.send("POST", "/api/ai/settings", patch)); if (patch.apiKey) { setKey(""); toast("API key saved"); } } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const act = async (url) => { setBusy(true); setError(null); try { setS(await api.send("POST", url)); } catch (e) { setError(e.message); } setBusy(false); };
    const runTest = async () => { setTest({ busy: true }); try { setTest(await api.send("POST", "/api/ai/test")); } catch (e) { setTest({ ok: false, error: e.message }); } };
    if (!s) return html`<div class="panel" id="ai-settings"><h3>AI assistant</h3>${error ? html`<p class="error">${error}</p>` : html`<p class="muted">Loading…</p>`}</div>`;
    return html`<div class="panel ai-settings" id="ai-settings">
        <h3><${BotIcon} /> AI assistant</h3>
        <p class="muted">Claude answers questions about your novels and worlds in the side drawer's AI tab (the robot button at the top right). It reads only your novel folders and the data store, a little at a time, and can't change anything.</p>
        <div class="field"><label>Connect with</label>
            <div class="seg" role="group">
                <button class=${s.auth === "signin" ? "on" : ""} onClick=${() => save({ auth: "signin" })}>Sign in with Anthropic</button>
                <button class=${s.auth === "key" ? "on" : ""} onClick=${() => save({ auth: "key" })}>API key</button>
            </div>
        </div>
        ${s.auth === "signin" ? html`<div class="ai-signin">
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
        <div class="field"><label>Model</label>
            <div class="seg wrap" role="group">${s.models.map((m) => html`<button class=${s.model === m.id ? "on" : ""} title=${m.note} onClick=${() => save({ model: m.id })}>${m.label}</button>`)}</div>
            <p class="muted small">${s.models.find((m) => m.id === s.model)?.note}</p>
        </div>
        <div class="field"><label>Effort</label>
            <div class="seg" role="group">${s.efforts.map((e) => html`<button class=${s.effort === e ? "on" : ""} onClick=${() => save({ effort: e })}>${e[0].toUpperCase() + e.slice(1)}</button>`)}</div>
            <p class="muted small">How hard Claude thinks before answering. Medium suits most questions; High for reviewing chapters or tricky continuity, at more time and cost.</p>
        </div>
        <div class="row">
            <button disabled=${!s.ready || test?.busy} onClick=${runTest}>${test?.busy ? "Testing…" : "Test the connection"}</button>
            ${test && !test.busy && (test.ok ? html`<span class="ok">Connected (${test.model})</span>` : html`<span class="error">${test.error}</span>`)}
        </div>
        ${error && html`<p class="error">${error}</p>`}
    </div>`;
}
