// The API chat with OpenAI and local models: one client for anything that speaks the OpenAI-compatible
// /chat/completions API with tool calling (OpenAI itself, Ollama, the llama.cpp server, a custom URL). Plain fetch, no
// SDK. The tool loop is the same as the Anthropic one in ai.js: the model calls Novel Craft's read-only tools and
// propose_changes, which waits for the user's review.
import crypto from "node:crypto";

export const OPENAI_URL = "https://api.openai.com/v1";
export const LOCAL_PRESETS = {
    ollama: { label: "Ollama", url: "http://localhost:11434/v1", help: "Start Ollama and pull a model that can use tools, e.g. `ollama pull qwen3`." },
    llamacpp: { label: "llama.cpp server", url: "http://localhost:8080/v1", help: "Start `llama-server -m <model.gguf> --jinja` (--jinja turns on tool calling)." },
};

const fail = (status, message) => Object.assign(new Error(message), { status });
const trimSlash = (u) => String(u ?? "").trim().replace(/\/+$/, "");

/** Anthropic-style tool definitions ({name, description, input_schema}) as OpenAI functions */
export const asFunctions = (defs) => defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.input_schema } }));

export class OpenAiCompatible {
    /** @param {{url: string, key?: string, name: string, local?: boolean}} o  name: "OpenAI", "Ollama"… for messages */
    constructor({ url, key, name, local = false }) {
        this.url = trimSlash(url);
        this.key = key || null;
        this.name = name;
        this.local = local;
        this.noEffort = new Set();     // models that refused reasoning_effort (non-reasoning models)
    }

    headers() {
        return { "content-type": "application/json", ...(this.key ? { authorization: `Bearer ${this.key}` } : {}) };
    }

    async request(pathname, init = {}) {
        let res;
        try {
            res = await fetch(this.url + pathname, { ...init, headers: { ...this.headers(), ...init.headers } });
        } catch (err) {
            if (init.signal?.aborted) throw err;
            throw fail(502, this.local ? `Couldn't reach ${this.name} at ${this.url}: is it running?` : `Couldn't reach ${this.name}: check the internet connection`);
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            let msg = body;
            try { const j = JSON.parse(body); msg = j.error?.message ?? j.error ?? j.message ?? body; } catch { /* plain text */ }
            throw Object.assign(fail(res.status, String(msg).slice(0, 400) || res.statusText), { api: true });
        }
        return res;
    }

    /** The server's models: ids, sorted */
    async models(signal) {
        const r = await this.request("/models", { signal });
        const j = await r.json();
        return (j.data ?? j.models ?? []).map((m) => m.id ?? m.name).filter(Boolean).sort();
    }

    /**
     * One streamed completion. Calls onText(delta) as text arrives and resolves to
     * {content, toolCalls: [{id, name, arguments}], finish, usage: {input, output}}.
     */
    async complete({ model, messages, tools, effort }, { onText, signal } = {}) {
        const body = {
            model, messages, stream: true, stream_options: { include_usage: true },
            ...(tools?.length ? { tools } : {}),
            ...(effort && !this.local && !this.noEffort.has(model) ? { reasoning_effort: effort } : {}),
        };
        let res;
        try {
            res = await this.request("/chat/completions", { method: "POST", body: JSON.stringify(body), signal });
        } catch (err) {
            // a model without reasoning refuses the effort setting: remember that and ask again without it
            if (err.status === 400 && body.reasoning_effort && /reasoning/i.test(err.message)) {
                this.noEffort.add(model);
                return this.complete({ model, messages, tools }, { onText, signal });
            }
            throw err;
        }
        let content = "", finish = null, usage = null;
        const calls = [];
        const dec = new TextDecoder();
        let buf = "";
        const handle = (data) => {
            if (data === "[DONE]") return;
            let j; try { j = JSON.parse(data); } catch { return; }
            if (j.error) throw fail(500, j.error.message ?? String(j.error));
            if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
            const ch = j.choices?.[0];
            if (!ch) return;
            const d = ch.delta ?? {};
            if (d.content) { content += d.content; onText?.(d.content); }
            for (const t of d.tool_calls ?? []) {
                const i = t.index ?? calls.length;
                const c = (calls[i] ??= { id: "", name: "", arguments: "" });
                if (t.id) c.id = t.id;
                if (t.function?.name) c.name += t.function.name;
                if (t.function?.arguments) c.arguments += t.function.arguments;
            }
            if (ch.finish_reason) finish = ch.finish_reason;
        };
        for await (const chunk of res.body) {
            buf += dec.decode(chunk, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
                if (line.startsWith("data:")) handle(line.slice(5).trim());
            }
        }
        if (buf.trim().startsWith("data:")) handle(buf.trim().slice(5).trim());
        const toolCalls = calls.filter((c) => c.name).map((c) => ({ ...c, id: c.id || `call_${crypto.randomUUID().slice(0, 12)}` }));
        return { content, toolCalls, finish, usage };
    }

    /** A message for the user about an error from this provider */
    explain(err) {
        if (err?.name === "AbortError") return "Stopped";
        if (!err?.api) return err?.message ?? String(err);
        if (/does not support tools|tool.*not supported|tools? (is|are) not supported/i.test(err.message)) return `This model can't use tools, which the assistant needs. Pick one that can (for Ollama e.g. qwen3, llama3.1, mistral-nemo).`;
        if (err.status === 401) return `${this.name} didn't accept the API key: check it in Settings → AI assistant`;
        if (err.status === 403) return `This ${this.name} account can't use that model`;
        if (err.status === 404) return `${this.name} doesn't know that model (${err.message})`;
        if (err.status === 429) return `${this.name}: too many requests or no credit left (${err.message})`;
        return `${this.name} answered with an error (${err.status}): ${err.message}`;
    }
}
