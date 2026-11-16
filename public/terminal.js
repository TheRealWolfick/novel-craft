// Claude Code in the AI tab: a terminal (xterm.js, loaded when first shown) attached to the `claude` the server runs in
// its workspace (lib/claude-code.js). Output arrives as server-sent events, keys go back in order. While it runs, the
// page tells the server what is on screen, for Claude Code's current_view tool.
import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";
import { api } from "./app.js";
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
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const themeNow = () => ({ background: cssVar("--panel", "#1f1e23"), foreground: cssVar("--text", "#e6e3ea"), cursor: cssVar("--accent", "#b07cf0"), selectionBackground: `${cssVar("--accent", "#b07cf0")}55` });

export function ClaudeTerminal({ active }) {
    const host = useRef(null);
    const term = useRef(null);
    const fit = useRef(null);
    const [status, setStatus] = useState(null);       // {claude, running, exit}
    const [running, setRunning] = useState(false);
    const [exit, setExit] = useState(null);
    const [error, setError] = useState(null);
    const [ready, setReady] = useState(false);
    const [history, setHistory] = useState(null);     // the History list, while open
    const [session, setSession] = useState(null);     // the conversation running ("last", an id, or null for a new one)
    const autoTried = useRef(false);
    const starting = useRef(false);                   // switching conversations: the old one's exit doesn't count
    useEffect(() => { api.get("/api/terminal/status").then((s) => { setStatus(s); setRunning(s.running); setExit(s.exit); setSession(s.session); }).catch((e) => setError(e.message)); }, []);

    // keys go to the server one batch at a time, in order
    const queue = useRef({ pending: "", busy: false });
    const flush = async () => {
        const qd = queue.current;
        if (qd.busy || !qd.pending) return;
        qd.busy = true;
        const data = qd.pending; qd.pending = "";
        try { await api.send("POST", "/api/terminal/input", { data }); } catch { /* the stream shows it ended */ }
        qd.busy = false;
        flush();
    };
    const type = (d) => { queue.current.pending += d; flush(); };

    // the terminal itself, once there is a place for it
    useEffect(() => {
        if (!status?.claude || term.current || !host.current) return;
        let gone = false, es = null, ro = null, timer = null;
        loadXterm().then(([{ Terminal }, { FitAddon }]) => {
            if (gone) return;
            const t = new Terminal({ fontFamily: cssVar("--mono", "monospace"), fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, allowProposedApi: false, theme: themeNow(), macOptionIsMeta: true });
            const f = new FitAddon();
            t.loadAddon(f);
            t.open(host.current);
            term.current = t; fit.current = f;
            try { f.fit(); } catch { /* hidden */ }
            t.onData(type);
            // Ctrl+Shift+C / Ctrl+Shift+V copy and paste (plain Ctrl+C stays an interrupt for Claude Code)
            t.attachCustomKeyEventHandler((e) => {
                if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
                if (e.code === "KeyC") { const s = t.getSelection(); if (s) navigator.clipboard?.writeText(s); return false; }
                if (e.code === "KeyV") { navigator.clipboard?.readText().then((s) => s && t.paste(s)); return false; }
                return true;
            });
            const resize = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (!host.current?.offsetWidth) return;
                    try { f.fit(); } catch { return; }
                    api.send("POST", "/api/terminal/resize", { cols: t.cols, rows: t.rows }).catch(() => { });
                }, 120);
            };
            ro = new ResizeObserver(resize);
            ro.observe(host.current);
            es = new EventSource("/api/terminal/stream");
            es.addEventListener("hello", (e) => { const s = JSON.parse(e.data); setRunning(s.running); setExit(s.exit); t.reset(); });
            es.onmessage = (e) => { const bin = atob(e.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); t.write(bytes); };
            es.addEventListener("exit", (e) => {
                if (starting.current) return;
                setRunning(false); setExit(JSON.parse(e.data));
                api.get("/api/terminal/status").then(setStatus).catch(() => { });   // the conversation just ended joins the list
            });
            // follow the app's light / dark theme
            const mo = new MutationObserver(() => { t.options.theme = themeNow(); });
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
            term.current._mo = mo;
            setReady(true);
        }).catch((e) => setError(`The terminal couldn't load: ${e.message}`));
        return () => { gone = true; es?.close(); ro?.disconnect(); clearTimeout(timer); term.current?._mo?.disconnect(); term.current?.dispose(); term.current = null; };
    }, [status?.claude]);

    // shown again: fit to the pane and take the keyboard
    useEffect(() => {
        if (!active || !term.current) return;
        requestAnimationFrame(() => { try { fit.current.fit(); } catch { /* hidden */ } term.current?.focus(); });
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
        starting.current = true;
        try {
            const t = term.current;
            try { fit.current?.fit(); } catch { /* hidden */ }
            await api.send("POST", "/api/terminal/start", { cols: t?.cols ?? 100, rows: t?.rows ?? 30, resume, restart: running });
            t?.reset();
            setRunning(true); setExit(null); setSession(resume || null);
            t?.focus();
        } catch (e) { setError(e.message); }
        setTimeout(() => { starting.current = false; }, 300);
    };
    const stop = () => api.send("POST", "/api/terminal/stop").catch((e) => setError(e.message));
    // a Claude Code command typed for the user (Claude Code shows the answer itself, in the terminal)
    const run = (cmd) => { setHistory(null); type(`${cmd}\r`); term.current?.focus(); };
    const openHistory = async () => {
        if (history) return setHistory(null);
        try { setHistory((await api.get("/api/terminal/sessions")).sessions); } catch (e) { setError(e.message); }
    };
    // after a restart of the app the last conversation carries on by itself
    useEffect(() => {
        if (!ready || !active || running || exit || autoTried.current || !status?.sessions?.length) return;
        autoTried.current = true;
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
        <div class="term-host" ref=${host} />
        ${!running && html`<div class="term-start">
            <p>${exit ? "Claude Code has ended." : "Start Claude Code to talk about your novels and worlds."}</p>
            <div class="row">${status.sessions?.length ? html`<button class="primary" onClick=${() => start("last")}>Continue “${status.sessions[0].title}”</button><button onClick=${() => start(false)}>New conversation</button><button onClick=${openHistory}>Earlier conversations…</button>`
                : html`<button class="primary" onClick=${() => start(false)}>Start Claude Code</button>`}</div>
            <p class="muted small">It runs your own <code>claude</code>, signed in with your subscription, connected to World Builder's tools. It reads only your novels and the data store, can't touch the vault's files or run commands, and every change it makes opens here for your review first. The first time, it asks whether to trust its workspace folder. Type <code>/world-builder</code> for ready-made prompts. Copy and paste: Ctrl+Shift+C / Ctrl+Shift+V.</p>
            ${error && html`<p class="error small">${error}</p>`}
        </div>`}
    </div>`;
}
