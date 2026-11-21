// The AI assistant: connection settings, conversations and the tool loop. The model sees nothing of the vault until it
// calls a tool (lib/ai-tools.js), so a conversation costs what it reads. Settings live in settings.json `ai`; API keys
// in secrets.json beside it (owner-only), never in the vault and never sent to the page.
//
// Modes (`ai.auth`): "claude-code" (the user's own Claude Code in the AI tab's terminal, lib/claude-code.js; nothing
// here), "signin" / "key" (Anthropic's API through the SDK), "openai" and "local" (any OpenAI-compatible server:
// OpenAI, Ollama, llama.cpp, a custom URL; lib/ai-openai.js). Only Claude Code uses the terminal.
//
// Sign-in: Anthropic's `ant` command-line tool (`ant auth login`) saves a sign-in profile the SDK reads by itself, so
// "Sign in with Anthropic" runs it and then connects with that profile.
import fs from "node:fs";
import os from "node:os";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { AiTools, checkInput } from "./ai-tools.js";
import { Proposals } from "./ai-proposals.js";
import { instructions } from "./ai-instructions.js";
import { findClaude, workspaceDir } from "./claude-code.js";
import { terminalSupport } from "./capabilities.js";
import { OpenAiCompatible, OPENAI_URL, LOCAL_PRESETS, asFunctions } from "./ai-openai.js";

export const MODELS = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Recommended", price: [4, 20, 0.2], fallbacks: true },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster, cheaper", price: [2, 10, 0.1], fallbacks: true },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest, cheapest", price: [0.1, 0.5, 0.01], fallbacks: false },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2", note: "Most capable, slower, dearest", price: [8, 40, 0.2], fallbacks: true },
];
export const EFFORTS = ["low", "medium", "high"];
export const MODES = ["claude-code", "signin", "key", "openai", "local"];
// Claude Code is the default where its terminal works; elsewhere the API key mode
const defaults = () => ({ model: "claude-opus-5-5", effort: "medium", auth: terminalSupport().ok ? "claude-code" : "key", openaiModel: "", localPreset: "ollama", localUrl: "", localModel: "" });
/** Which API a mode talks to: "anthropic", "openai", "local", or null (Claude Code) */
const providerOf = (auth) => (auth === "key" || auth === "signin" ? "anthropic" : auth === "openai" || auth === "local" ? auth : null);
const PROVIDER_NAMES = { anthropic: "Claude (Anthropic API)", openai: "OpenAI", local: "a local model" };
const hint = (k) => (k ? `…${k.slice(-4)}` : null);
// OpenAI's model list holds every kind of model; the assistant needs ones that chat
const isOpenAiChatModel = (id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding|instruct|codex/.test(id);
const MAX_ROUNDS = 24;          // tool rounds per reply
const KEEP = 30;                // conversations kept in memory
const fail = (status, message) => Object.assign(new Error(message), { status });



export class Assistant {
    /**
     * @param {{settingsFile: string, readSettings: () => object, writeSettings: (patch) => Promise, ctx: () => object}} o
     */
    constructor({ settingsFile, readSettings, writeSettings, ctx }) {
        this.secretsFile = path.join(path.dirname(settingsFile), "secrets.json");
        this.readSettings = readSettings;
        this.writeSettings = writeSettings;
        this.ctx = ctx;
        this.view = null;               // what the page shows (POST /api/ai/view), for current_view from Claude Code
        this.tools = new AiTools(ctx);
        this.proposals = new Proposals(ctx, this.tools);
        this.conversations = new Map();
        this.login = null;              // {proc, output, done, ok}
        this.mock = process.env.WB_AI_MOCK === "1";
    }

    settings() { return { ...defaults(), ...(this.readSettings().ai ?? {}) }; }
    secrets() { try { return JSON.parse(fs.readFileSync(this.secretsFile, "utf8")); } catch { return {}; } }
    async writeSecrets(patch) {
        const next = { ...this.secrets(), ...patch };
        for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
        await fsp.mkdir(path.dirname(this.secretsFile), { recursive: true });
        await fsp.writeFile(this.secretsFile, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        await fsp.chmod(this.secretsFile, 0o600);
    }

    // ------------------------------------------------------------ connection

    /** Is the `ant` tool installed? Resolves its path or null */
    antPath() {
        return new Promise((resolve) => execFile("ant", ["--version"], { timeout: 4000 }, (err) => resolve(err ? null : "ant")));
    }
    antStatus() {
        return new Promise((resolve) => execFile("ant", ["auth", "status"], { timeout: 8000, env: cleanEnv() }, (err, stdout, stderr) => resolve(err && !stdout ? null : String(stdout || stderr).trim())));
    }

    /** The OpenAI-compatible server the mode "openai" or "local" talks to */
    compatible(s = this.settings()) {
        const sec = this.secrets();
        if (s.auth === "openai") return new OpenAiCompatible({ url: OPENAI_URL, key: sec.openaiKey ?? process.env.OPENAI_API_KEY, name: "OpenAI" });
        const preset = LOCAL_PRESETS[s.localPreset];
        return new OpenAiCompatible({ url: preset ? preset.url : s.localUrl, key: preset ? null : sec.localKey, name: preset?.label ?? "the model server", local: true });
    }

    /** probe: also ask an OpenAI-compatible server for its models (is it running, is the key good) */
    async status({ probe = false } = {}) {
        const s = this.settings();
        const sec = this.secrets();
        const key = sec.anthropicKey;
        const provider = providerOf(s.auth);
        const ant = this.mock ? null : await this.antPath();
        const antStatus = ant && s.auth === "signin" ? await this.antStatus() : null;
        const terminal = terminalSupport();
        const claude = findClaude();
        const localUrl = LOCAL_PRESETS[s.localPreset]?.url ?? s.localUrl;
        const openaiReady = !!(sec.openaiKey || process.env.OPENAI_API_KEY) && !!s.openaiModel;
        const localReady = !!localUrl && !!s.localModel;
        let remote = null;
        if (probe && (provider === "openai" || provider === "local") && (provider === "local" ? !!localUrl : !!(sec.openaiKey || process.env.OPENAI_API_KEY))) {
            const c = this.compatible(s);
            try { remote = { ok: true, models: (await c.models(AbortSignal.timeout(4000))).filter((m) => provider !== "openai" || isOpenAiChatModel(m)) }; } catch (e) { remote = { ok: false, error: e.name === "TimeoutError" ? `${c.name} didn't answer at ${c.url}` : c.explain(e), models: [] }; }
        }
        const model = provider === "anthropic" ? s.model : provider === "openai" ? s.openaiModel : provider === "local" ? s.localModel : null;
        return {
            provider, model, effort: s.effort, auth: s.auth,
            modelLabel: provider === "anthropic" ? MODELS.find((m) => m.id === s.model)?.label ?? s.model : model,
            models: MODELS.map(({ id, label, note }) => ({ id, label, note })), efforts: EFFORTS,
            hasKey: !!key, keyHint: hint(key), envKey: !!process.env.ANTHROPIC_API_KEY,
            ant: !!ant, antStatus, signingIn: !!this.login && !this.login.done, loginOutput: this.login?.output.slice(-2000) ?? "",
            openai: { hasKey: !!sec.openaiKey, keyHint: hint(sec.openaiKey), envKey: !!process.env.OPENAI_API_KEY, model: s.openaiModel },
            local: { preset: s.localPreset, url: localUrl, customUrl: s.localUrl, model: s.localModel, hasKey: !!sec.localKey, keyHint: hint(sec.localKey),
                presets: Object.entries(LOCAL_PRESETS).map(([id, p]) => ({ id, ...p })) },
            remote,
            ready: s.auth === "claude-code" ? terminal.ok && !!claude
                : this.mock && provider === "anthropic" ? true
                : s.auth === "key" ? !!key || !!process.env.ANTHROPIC_API_KEY : s.auth === "signin" ? !!ant
                : s.auth === "openai" ? openaiReady : s.auth === "local" ? localReady : false,
            capabilities: { terminal },
            claude, workspace: workspaceDir(),
            mock: this.mock, secretsFile: this.secretsFile,
        };
    }

    async configure(b) {
        const s = this.settings();
        const next = { ...s };
        if (b.model && MODELS.some((m) => m.id === b.model)) next.model = b.model;
        if (EFFORTS.includes(b.effort)) next.effort = b.effort;
        if (MODES.includes(b.auth)) {
            if (b.auth === "claude-code" && !terminalSupport().ok) throw fail(400, terminalSupport().reason);
            next.auth = b.auth;
        }
        const text = (v) => (typeof v === "string" ? v.trim().slice(0, 300) : undefined);
        if (text(b.openaiModel) !== undefined) next.openaiModel = text(b.openaiModel);
        if (text(b.localModel) !== undefined) next.localModel = text(b.localModel);
        if (b.localPreset && (LOCAL_PRESETS[b.localPreset] || b.localPreset === "custom")) next.localPreset = b.localPreset;
        if (text(b.localUrl) !== undefined) {
            const u = text(b.localUrl);
            if (u && !/^https?:\/\/[^\s/]+/.test(u)) throw fail(400, "The server address should start with http:// or https://");
            next.localUrl = u;
        }
        if (typeof b.apiKey === "string" && b.apiKey.trim()) {
            const k = b.apiKey.trim();
            if (!/^sk-ant-[\w-]{20,}$/.test(k)) throw fail(400, "That doesn't look like an Anthropic API key (they start with sk-ant-)");
        }
        if (typeof b.openaiKey === "string" && b.openaiKey.trim() && !/^sk-[\w-]{20,}$/.test(b.openaiKey.trim())) throw fail(400, "That doesn't look like an OpenAI API key (they start with sk-)");
        await this.writeSettings({ ai: next });
        if (typeof b.apiKey === "string" && b.apiKey.trim()) await this.writeSecrets({ anthropicKey: b.apiKey.trim() });
        if (b.removeKey) await this.writeSecrets({ anthropicKey: null });
        if (typeof b.openaiKey === "string" && b.openaiKey.trim()) await this.writeSecrets({ openaiKey: b.openaiKey.trim() });
        if (b.removeOpenaiKey) await this.writeSecrets({ openaiKey: null });
        if (typeof b.localKey === "string" && b.localKey.trim()) await this.writeSecrets({ localKey: b.localKey.trim().slice(0, 500) });
        if (b.removeLocalKey) await this.writeSecrets({ localKey: null });
        this.client = null;
        return this.status();
    }

    /** The bearer token Claude Code's workspace uses for the MCP server (made once, kept in secrets.json) */
    async mcpToken() {
        let t = this.secrets().mcpToken;
        if (!t) { t = crypto.randomBytes(24).toString("base64url"); await this.writeSecrets({ mcpToken: t }); }
        return t;
    }

    /** Run `ant auth login` (it opens the browser); the Settings page polls status() for the outcome */
    async signIn() {
        if (!(await this.antPath())) throw fail(400, "The ant command-line tool isn't installed");
        if (this.login && !this.login.done) return this.status();
        const proc = spawn("ant", ["auth", "login"], { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
        const login = (this.login = { proc, output: "", done: false, ok: false });
        const add = (d) => { login.output += d.toString(); };
        proc.stdout.on("data", add);
        proc.stderr.on("data", add);
        proc.on("close", (code) => { login.done = true; login.ok = code === 0; this.client = null; });
        proc.on("error", (e) => { login.done = true; login.output += String(e.message); });
        await this.writeSettings({ ai: { ...this.settings(), auth: "signin" } });
        return this.status();
    }
    async signOut() {
        if (await this.antPath()) await new Promise((resolve) => execFile("ant", ["auth", "logout"], { timeout: 8000, env: cleanEnv() }, () => resolve()));
        this.client = null;
        return this.status();
    }

    client_() {
        if (this.mock) return (this.client ??= mockClient());
        if (this.client) return this.client;
        const s = this.settings();
        const key = this.secrets().anthropicKey;
        if (s.auth === "key") {
            if (!key && !process.env.ANTHROPIC_API_KEY) throw fail(400, "No API key yet: add one in Settings → AI assistant");
            this.client = new Anthropic(key ? { apiKey: key } : {});
        } else this.client = new Anthropic({ profile: activeProfile() });  // the sign-in from `ant auth login`, ahead of any key in the environment
        return this.client;
    }

    // ------------------------------------------------------------ conversations

    // Conversations are saved in the app's data folder (one JSON file each: the messages as sent to Claude, the
    // conversation as shown, usage), so they survive restarts and can be reopened from History.
    conversationsDir() { return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "world-builder", "conversations"); }
    conversationFile(id) { return /^[0-9a-f-]{36}$/.test(String(id)) ? path.join(this.conversationsDir(), `${id}.json`) : null; }

    conversation(id) {
        let c = id && this.conversations.get(id);
        if (!c && id && this.conversationFile(id)) {
            try { c = { ...JSON.parse(fs.readFileSync(this.conversationFile(id), "utf8")), busy: false }; this.conversations.set(c.id, c); } catch { c = null; }
        }
        if (!c) {
            c = { id: crypto.randomUUID(), title: "", created: Date.now(), messages: [], display: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, busy: false };
            this.conversations.set(c.id, c);
        }
        while (this.conversations.size > KEEP) this.conversations.delete(this.conversations.keys().next().value);
        return c;
    }
    async save(c) {
        if (!c.messages.length) return;
        const { busy, ...keep } = c;
        await fsp.mkdir(this.conversationsDir(), { recursive: true });
        await fsp.writeFile(this.conversationFile(c.id), JSON.stringify({ ...keep, updated: Date.now() }), { mode: 0o600 });
    }
    /** Saved conversations, newest first: [{id, title, updated, cost, messages}] */
    async list(limit = 60) {
        let files = [];
        try { files = (await fsp.readdir(this.conversationsDir())).filter((f) => f.endsWith(".json")); } catch { return []; }
        const out = [];
        for (const f of files) {
            try {
                const c = JSON.parse(await fsp.readFile(path.join(this.conversationsDir(), f), "utf8"));
                out.push({ id: c.id, title: c.title || "Untitled", updated: c.updated ?? 0, cost: c.usage?.cost ?? 0, tokens: (c.usage?.input ?? 0) + (c.usage?.output ?? 0), provider: c.provider ?? "anthropic", messages: (c.display ?? []).length });
            } catch { /* unreadable: skip */ }
        }
        return out.sort((a, b) => b.updated - a.updated).slice(0, limit);
    }
    /** A saved conversation as shown: {id, title, display, usage} */
    shown(id) {
        const c = this.conversation(id);
        if (c.id !== id) { this.conversations.delete(c.id); throw fail(404, "That conversation is gone"); }
        return { id: c.id, title: c.title, display: c.display ?? [], usage: c.usage, provider: c.provider ?? "anthropic" };
    }
    async forget(id) {
        this.conversations.delete(id);
        const f = this.conversationFile(id);
        if (f) await fsp.rm(f, { force: true });
        return { ok: true };
    }

    /** The system prompt: fixed instructions plus the vault's outline (names only, so the cached prefix rarely changes) */
    system() {
        return [{ type: "text", text: instructions("chat", this.tools.outline()) }];
    }

    /**
     * One user turn: streams events to `emit` ({t: "start"|"text"|"thinking"|"tool"|"tool_done"|"done"|"error", …}) until
     * the reply is finished. `signal` stops it.
     */
    async chat({ conversation, message, view }, emit, signal) {
        const c = this.conversation(conversation);
        if (c.busy) throw fail(409, "This conversation is still answering");
        const text = String(message ?? "").trim();
        if (!text) throw fail(400, "Write a message first");
        const s = this.settings();
        const provider = providerOf(s.auth);
        if (!provider) throw fail(400, "The assistant is set to Claude Code, which runs in the AI tab's terminal");
        // a conversation keeps the provider it started with (the message formats differ)
        if (c.messages.length && (c.provider ?? "anthropic") !== provider) throw fail(409, `This conversation was with ${PROVIDER_NAMES[c.provider ?? "anthropic"]}: press New to start one with ${PROVIDER_NAMES[provider]}`);
        c.provider = provider;
        const compat = provider !== "anthropic" ? this.compatible(s) : null;
        const compatModel = provider === "openai" ? s.openaiModel : s.localModel;
        if (compat && !compatModel) throw fail(400, "Choose a model first in Settings → AI assistant");
        const client = compat ?? this.client_();
        const model = compat ? { id: compatModel } : MODELS.find((m) => m.id === s.model) ?? MODELS[0];
        const defs = this.tools.definitions();
        const tools = defs.map((d) => ({ ...d, eager_input_streaming: true }));
        // where the user is, one line, so "this chapter" needs no tool call; details through current_view
        const where = view?.page ? `\n\n(On screen: ${[view.page, view.writer && `writer: ${view.writer}`, view.drawer && `drawer: ${view.drawer}`, view.selection && "some text selected"].filter(Boolean).join("; ")})` : "";
        // what the user decided about earlier proposals in this conversation
        const review = this.proposals.report(c.id);
        const reviewed = review.length ? `\n\n(${review.join("\n")})` : "";
        const rollback = c.messages.length, rollbackShown = (c.display ??= []).length;
        c.messages.push({ role: "user", content: text + where + reviewed });
        c.busy = true;
        if (!c.title) c.title = text.replace(/\s+/g, " ").slice(0, 80);
        // the conversation as shown, kept with it: the user's words, then the reply's text, steps and proposals
        const reply = { role: "assistant", parts: [] };
        c.display.push({ role: "user", text }, reply);
        const shown = (ev) => {
            if (ev.t === "text") { const last = reply.parts.at(-1); if (last?.kind === "text") last.text += ev.d; else reply.parts.push({ kind: "text", text: ev.d }); }
            else if (ev.t === "tool_done") { reply.parts.push({ kind: "tool", id: ev.id, name: ev.name, label: ev.summary, error: ev.error }); if (ev.proposal) reply.parts.push({ kind: "proposal", ...ev.proposal }); }
            else if (ev.t === "error") reply.error = ev.message;
        };
        const out = emit;
        emit = (ev) => { shown(ev); out(ev); };
        emit({ t: "start", conversation: c.id, model: model.id });
        let jsonRetries = 0;
        try {
            if (compat) await this.loopCompatible({ c, client: compat, model: model.id, effort: s.effort, defs, emit, signal, view });
            else for (let round = 0; round < MAX_ROUNDS; round++) {
                const params = {
                    model: model.id, max_tokens: 32000, system: this.system(), tools, messages: c.messages,
                    output_config: { effort: s.effort }, cache_control: { type: "ephemeral" },
                    ...(model.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
                };
                const stream = client.beta.messages.stream(params, { signal });
                stream.on("text", (d) => emit({ t: "text", d }));
                stream.on("streamEvent", (ev) => { if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") emit({ t: "thinking" }); });
                let msg;
                try {
                    msg = await stream.finalMessage();
                    jsonRetries = 0;
                } catch (err) {
                    if (signal?.aborted || err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
                    continue;  // a tool input that could not be parsed: ask again
                }
                this.count(c, model, msg.usage);
                if (msg.stop_reason === "refusal") {
                    c.messages.push({ role: "assistant", content: msg.content });
                    emit({ t: "text", d: "\n\n*Claude declined to continue this request.*" });
                    break;
                }
                c.messages.push({ role: "assistant", content: msg.content });
                if (msg.stop_reason === "pause_turn") continue;
                const uses = msg.content.filter((b) => b.type === "tool_use");
                if (!uses.length) break;
                if (msg.stop_reason === "max_tokens") throw fail(500, "The reply was cut off (too long)");
                const results = [];
                for (const u of uses) {
                    const r = this.runTool({ c, defs, id: u.id, name: u.name, input: u.input, view, emit });
                    results.push({ type: "tool_result", tool_use_id: u.id, content: r.error ?? r.text, ...(r.error ? { is_error: true } : {}) });
                }
                c.messages.push({ role: "user", content: results });
                if (round === MAX_ROUNDS - 1) emit({ t: "text", d: "\n\n*Stopped after many tool calls; ask me to continue if needed.*" });
            }
            emit({ t: "done", usage: c.usage });
        } catch (err) {
            // a turn that failed leaves no half-finished exchange behind (tool calls must always have results)
            const last = c.messages.at(-1);
            if (compat) c.messages.length = rollback;   // OpenAI-style turns are rolled back whole
            if (last?.role === "assistant" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_use")) c.messages.length = rollback;
            if (c.messages.at(-1)?.role === "user" && typeof c.messages.at(-1).content === "string") c.messages.length = rollback;
            if (c.messages.length === rollback) c.display.length = rollbackShown;   // nothing of the turn was kept
            if (!c.messages.length) delete c.provider;
            emit({ t: "error", message: signal?.aborted ? "Stopped" : compat ? compat.explain(err) : explain(err), stopped: !!signal?.aborted, usage: c.usage });
        } finally {
            c.busy = false;
            await this.save(c).catch((e) => console.error("Couldn't save the conversation:", e.message));
        }
    }

    /** One tool call (any provider): checked, run, reported to the page; returns {text, summary} or {error} */
    runTool({ c, defs, id, name, input, view, emit }) {
        const def = defs.find((d) => d.name === name);
        const bad = input === undefined ? "the arguments weren't valid JSON" : def ? checkInput(def.input_schema, input) : `unknown tool ${name}`;
        emit({ t: "tool", id, name, input });
        const r = bad ? { error: `Invalid input: ${bad}` } : name === "propose_changes" ? this.propose(c.id, input) : this.tools.run(name, input, { view });
        emit({ t: "tool_done", id, name, summary: r.error ? `${name}: ${r.error}` : r.summary, error: !!r.error, ...(r.proposal ? { proposal: r.proposal } : {}) });
        return r;
    }

    /** The tool loop with an OpenAI-compatible server; messages are kept in OpenAI's format */
    async loopCompatible({ c, client, model, effort, defs, emit, signal, view }) {
        const tools = asFunctions(defs);
        const system = { role: "system", content: instructions("chat", this.tools.outline()) };
        for (let round = 0; round < MAX_ROUNDS; round++) {
            const r = await client.complete({ model, effort, tools, messages: [system, ...c.messages] }, { onText: (d) => emit({ t: "text", d }), signal });
            if (r.usage) { c.usage.input += r.usage.input; c.usage.output += r.usage.output; }
            c.messages.push({ role: "assistant", content: r.content ?? "", ...(r.toolCalls.length ? { tool_calls: r.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments || "{}" } })) } : {}) });
            if (!r.toolCalls.length) {
                if (r.finish === "length") emit({ t: "text", d: "\n\n*The reply was cut off (too long).*" });
                return;
            }
            for (const t of r.toolCalls) {
                let input;
                try { input = t.arguments?.trim() ? JSON.parse(t.arguments) : {}; } catch { input = undefined; }
                const res = this.runTool({ c, defs, id: t.id, name: t.name, input, view, emit });
                c.messages.push({ role: "tool", tool_call_id: t.id, content: res.error ? `Error: ${res.error}` : res.text });
            }
            if (round === MAX_ROUNDS - 1) emit({ t: "text", d: "\n\n*Stopped after many tool calls; ask me to continue if needed.*" });
        }
    }

    /** The propose_changes tool: stored for review, the model told it waits */
    propose(conversation, input) {
        try {
            const p = this.proposals.propose(conversation, input);
            const list = p.changes.map((x) => `${x.i + 1}. ${describe(x)}`).join("\n");
            return { text: `Proposal "${p.title}" (${p.changes.length} change${p.changes.length === 1 ? "" : "s"}) is waiting for the user's review:\n${list}\nNothing is written until they approve; their decision comes with their next message.`, summary: `Proposed ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}: ${p.title}`, proposal: { id: p.id, title: p.title, count: p.changes.length } };
        } catch (e) {
            if (!e.toolError) console.error(e);
            return { error: e.message };
        }
    }

    count(c, model, u) {
        if (!u) return;
        const [inP, outP, readP] = model.price;
        const input = u.input_tokens ?? 0, output = u.output_tokens ?? 0, read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
        c.usage.input += input; c.usage.output += output; c.usage.cacheRead += read; c.usage.cacheWrite += write;
        c.usage.cost += (input * inP + write * inP * 1.25 + read * readP + output * outP) / 1e6;
    }

    /** A one-line request to check the connection (costs a fraction of a cent) */
    async test() {
        const s = this.settings();
        if (s.auth === "openai" || s.auth === "local") {
            const c = this.compatible(s);
            const model = s.auth === "openai" ? s.openaiModel : s.localModel;
            if (!model) return { ok: false, error: "Choose a model first" };
            try {
                const r = await c.complete({ model, effort: "low", messages: [{ role: "user", content: "Reply with the single word: connected" }] }, { signal: AbortSignal.timeout(120000) });
                return { ok: true, model, reply: r.content.trim().slice(0, 80) };
            } catch (err) { return { ok: false, error: err.name === "TimeoutError" ? `${c.name} took too long to answer` : c.explain(err) }; }
        }
        const client = this.client_();
        try {
            const msg = await client.messages.create({ model: s.model, max_tokens: 400, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with the single word: connected" }] });
            const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
            return { ok: true, model: msg.model, reply: text.slice(0, 80) };
        } catch (err) { return { ok: false, error: explain(err) }; }
    }
}

const describe = (x) => (x.action === "create_note" ? `create ${x.kind === "character" ? "character" : x.collection} "${x.name}"${x.renamed ? " (renamed: the name was taken)" : ""}`
    : x.action === "ledger_entry" ? `${x.replaceKey ? `replace ${x.type} entry ${x.replaceKey}` : `new ${x.type} entry`} for ${x.owner}, chapter ${x.entry.chapter}${x.warnings?.length ? ` (warnings: ${x.warnings.join("; ")})` : ""}`
    : x.action === "edit_fields" ? `fields of ${x.name}: ${x.rows.map((r) => r.key).join(", ")}` : x.action === "edit_text" ? `text edit in ${x.name}` : `text added to ${x.name}`);

/** The environment for `ant`, without a stale key that would win over the sign-in profile */
function cleanEnv() {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return env;
}

/** The sign-in profile `ant` uses: ANTHROPIC_PROFILE, else the one its active_config file names, else "default" */
function activeProfile() {
    if (process.env.ANTHROPIC_PROFILE) return process.env.ANTHROPIC_PROFILE;
    const dir = process.env.ANTHROPIC_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME ?? "", ".config"), "anthropic");
    try { return fs.readFileSync(path.join(dir, "active_config"), "utf8").trim() || "default"; } catch { return "default"; }
}

function explain(err) {
    if (err instanceof Anthropic.AuthenticationError) return "Claude didn't accept the sign-in or API key: check it in Settings → AI assistant";
    if (err instanceof Anthropic.PermissionDeniedError) return "This account can't use that model";
    if (err instanceof Anthropic.RateLimitError) return "Too many requests right now: wait a moment and try again";
    if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude: check the internet connection";
    if (err instanceof Anthropic.APIError) return `Claude answered with an error${err.status ? ` (${err.status})` : ""}: ${err.message}`;
    return err?.message ?? String(err);
}

// ---------------------------------------------------------------- mock (tests: WB_AI_MOCK=1)

/**
 * A stand-in for the SDK client that talks like Claude without the network. "search: <words>" makes it call the search
 * tool, "view?" current_view, "propose: {json}" propose_changes; after a tool result it reports the result's first line; otherwise it echoes the message.
 */
function mockClient() {
    const make = (params) => {
        const last = params.messages.at(-1);
        const listeners = { text: [], streamEvent: [] };
        let content;
        if (Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
            content = [{ type: "text", text: `Tool said: ${String(last.content[0].content).split("\n")[0]}\n<replies>["Tell me more", "Thanks"]</replies>` }];
        } else {
            const said = String(last.content).split("\n\n(")[0];
            const m = /^search:\s*(.+)$/i.exec(said);
            if (m) content = [{ type: "text", text: "Looking. " }, { type: "tool_use", id: `toolu_${crypto.randomUUID().slice(0, 8)}`, name: "search", input: { query: m[1] } }];
            else if (/^propose:/.test(said)) content = [{ type: "tool_use", id: `toolu_${crypto.randomUUID().slice(0, 8)}`, name: "propose_changes", input: JSON.parse(said.slice(8)) }];
            else if (/^view\?/.test(said)) content = [{ type: "tool_use", id: `toolu_${crypto.randomUUID().slice(0, 8)}`, name: "current_view", input: {} }];
            else content = [{ type: "text", text: `Mock reply to: ${said}${/\(Review of/.test(String(last.content)) ? ` [heard: ${/\(Review of[^\n)]*/.exec(String(last.content))[0].slice(1)}]` : ""}` }];
        }
        const msg = { id: "msg_mock", type: "message", role: "assistant", model: params.model, content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        return {
            on(ev, f) { listeners[ev]?.push(f); return this; },
            async finalMessage() {
                for (const b of content) if (b.type === "text") for (const piece of b.text.match(/.{1,6}/gs) ?? []) { listeners.text.forEach((f) => f(piece)); await new Promise((r) => setTimeout(r, 1)); }
                return msg;
            },
        };
    };
    return {
        beta: { messages: { stream: make } },
        messages: { create: async (p) => ({ model: p.model, content: [{ type: "text", text: "connected" }] }) },
    };
}
