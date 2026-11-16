// World Builder as an MCP server (Streamable HTTP, JSON responses) for Claude Code running in the AI tab's terminal:
// the same tools as the API chat (lib/ai-tools.js, scoped to the novels and the data store), proposals the user reviews
// in the app (lib/ai-proposals.js) with proposal_status to wait for the decision, and prompts that show up in Claude Code
// as slash commands. Requests need the workspace's bearer token and are refused from web pages (an Origin header).
import { instructions } from "./ai-instructions.js";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TITLES = { search: "Search the vault", novel_overview: "Novel overview", read_chapter: "Read a chapter", read_note: "Read a note", query_collection: "Query a collection", schema: "Collection fields", character_state: "Character state at a chapter", world_tree: "World outline", taxonomy: "Taxonomy values", current_view: "What World Builder shows", propose_changes: "Propose changes for review", proposal_status: "Review status" };

const PROMPTS = [
    { name: "summarise-chapter", description: "Summarise a chapter: events, characters, what changes", arguments: [{ name: "novel", description: "Novel name", required: true }, { name: "chapter", description: "Chapter number", required: true }],
        text: (a) => `Summarise chapter ${a.chapter} of ${a.novel}: the events in order, who is in it, and what changes by its end (possessions, relationships, where people are). Compare it with the chapter's plan and note anything the plan has that the text doesn't.` },
    { name: "review-chapter", description: "Review a chapter's prose, pacing and continuity, with edits to review", arguments: [{ name: "novel", description: "Novel name", required: true }, { name: "chapter", description: "Chapter number", required: true }, { name: "focus", description: "What to look at (optional)", required: false }],
        text: (a) => `Review chapter ${a.chapter} of ${a.novel}${a.focus ? `, focusing on ${a.focus}` : ""}: pacing, prose, dialogue and continuity with earlier chapters and the ledgers. List the main points briefly, then propose the edits you'd make with propose_changes (a few focused passages, in my voice), and wait for my review.` },
    { name: "brainstorm", description: "Ideas for what could happen next in a novel", arguments: [{ name: "novel", description: "Novel name", required: true }, { name: "about", description: "What to brainstorm (optional)", required: false }],
        text: (a) => `Brainstorm ${a.about ? a.about : "what could happen next"} in ${a.novel}. Read the overview, the latest chapters' plans and the open plots first; give five varied ideas that fit what is established, each in two or three sentences, and say which threads each one pulls on.` },
    { name: "new-entry", description: "Draft a data store entry (item, creature, location…) for review", arguments: [{ name: "collection", description: "Collection, e.g. Items", required: true }, { name: "idea", description: "What it is", required: true }],
        text: (a) => `Draft a new ${a.collection} entry: ${a.idea}. Check the collection's fields and existing taxonomy values and similar entries first, so it fits the world; then propose it with propose_changes and wait for my review.` },
    { name: "continuity-check", description: "Check a character's state and story for contradictions", arguments: [{ name: "novel", description: "Novel name", required: true }, { name: "character", description: "Character name", required: true }],
        text: (a) => `Check ${a.character} in ${a.novel} for continuity problems: what their ledgers say they hold and know at each point against what the chapters say, and their sheet against the text. List contradictions with chapter numbers; propose fixes only if I ask.` },
];

export class McpServer {
    /** @param assistant the Assistant (tools, proposals, outline); @param onProposal (proposal) => void, to show it in the app */
    constructor(assistant, { onProposal } = {}) { this.a = assistant; this.onProposal = onProposal; }

    tools() {
        const defs = this.a.tools.definitions().map((d) => ({ name: d.name, title: TITLES[d.name], description: d.description, inputSchema: d.input_schema, annotations: d.name === "propose_changes" ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } : READ_ONLY }));
        defs.push({ name: "proposal_status", title: TITLES.proposal_status, description: "Which changes of a proposal the user applied, rejected or hasn't decided yet. With wait_seconds it waits (up to 300 s) until they have decided on all of them, so call it right after propose_changes.",
            inputSchema: { type: "object", properties: { id: { type: "string", description: "The proposal id from propose_changes" }, wait_seconds: { type: "integer", description: "Wait up to this long for the user's decision (0-300)" } }, required: ["id"], additionalProperties: false }, annotations: READ_ONLY });
        return defs;
    }

    /** One JSON-RPC message -> its response (null for notifications) */
    async handle(msg, session) {
        const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
        const error = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
        if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Invalid request");
        if (msg.id === undefined) return null;   // a notification (initialized, cancelled…)
        const p = msg.params ?? {};
        switch (msg.method) {
            case "initialize":
                return reply({
                    protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[0],
                    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
                    serverInfo: { name: "world-builder", title: "World Builder", version: "1.0.0" },
                    instructions: instructions("claude-code", this.a.tools.outline()),
                });
            case "ping": return reply({});
            case "tools/list": return reply({ tools: this.tools() });
            case "tools/call": return reply(await this.call(p.name, p.arguments ?? {}, session));
            case "prompts/list": return reply({ prompts: PROMPTS.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })) });
            case "prompts/get": {
                const pr = PROMPTS.find((x) => x.name === p.name);
                if (!pr) return error(-32602, `No prompt ${p.name}`);
                return reply({ description: pr.description, messages: [{ role: "user", content: { type: "text", text: pr.text(p.arguments ?? {}) } }] });
            }
            case "resources/list": return reply({ resources: [] });
            default: return error(-32601, `Method not found: ${msg.method}`);
        }
    }

    async call(name, args, session) {
        const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
        if (!this.a.ctx().vault) return text("World Builder has no vault open: choose one in its Settings.", true);
        if (name === "proposal_status") return this.status(args);
        const def = this.a.tools.definitions().find((d) => d.name === name);
        if (!def) return text(`Unknown tool ${name}`, true);
        if (name === "propose_changes") {
            const r = this.a.propose(`mcp:${session ?? "claude-code"}`, args);
            if (r.error) return text(r.error, true);
            this.onProposal?.(r.proposal);
            return text(`${r.text}\nProposal id: ${r.proposal.id}. World Builder has opened it for review beside the terminal. Call proposal_status with this id and wait_seconds to wait for the decision.`);
        }
        const r = this.a.tools.run(name, args, { view: this.a.view });
        return r.error ? text(r.error, true) : text(r.text);
    }

    async status({ id, wait_seconds = 0 }) {
        let p;
        try { p = this.a.proposals.get(String(id)); } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
        const until = Date.now() + Math.min(300, Math.max(0, Number(wait_seconds) || 0)) * 1000;
        while (p.changes.some((c) => c.status === "pending") && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
        const lines = p.changes.map((c) => `${c.i + 1}. ${c.status}${c.error ? ` (${c.error})` : ""}${c.status === "applied" && c.path ? `: ${c.path}` : ""}`);
        const pending = p.changes.filter((c) => c.status === "pending").length;
        return { content: [{ type: "text", text: `"${p.title}":\n${lines.join("\n")}${pending ? `\n${pending} still waiting for the user's review.` : "\nThe user has decided on every change."}` }] };
    }
}
