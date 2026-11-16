// Changes the assistant proposes: nothing is written until the user approves it in the review panel (the side drawer's
// viewer, #/proposal/<id>), change by change or all at once. Each change is checked when proposed (the note exists and
// is in scope, the text to replace occurs exactly once, the name is free…) and again when applied, and is written
// through the same functions the app's own editors use (createNote / patchNote).
import crypto from "node:crypto";
import { DS } from "./vault.js";
import { patchNote, sanitizeName, uniqueName } from "./write.js";

const KEEP = 60;
const fail = (message) => Object.assign(new Error(message), { toolError: true });
const plain = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export class Proposals {
    /** @param ctx () => services of the open vault; @param tools AiTools (scope and note lookup) */
    constructor(ctx, tools) { this.ctx = ctx; this.tools = tools; this.all = new Map(); }

    /** A note the assistant may change: in scope, and not a config, ledger or creature-stats note (those have their own editors) */
    editable(ref) {
        const n = this.tools.note(ref);
        if (n.path.endsWith("/config.md") || n.fm.type === "config") throw fail(`${n.name} is a novel's settings note; change it on the novel page`);
        if (n.fm.type === "ledger") throw fail(`${n.name} is a ledger; ledger entries are made in the ledger editor`);
        return n;
    }

    /** Check one change and describe it for the review panel; throws with a message the model can act on */
    prepare(c, reserved) {
        const { vault, store, novels, stats } = this.ctx();
        switch (c.action) {
            case "create_note": {
                const name = sanitizeName(c.name);
                if (!name) throw fail("create_note needs a name");
                const fields = c.fields && typeof c.fields === "object" ? c.fields : {};
                if (String(c.collection).toLowerCase() === "characters") {
                    const novel = this.tools.novel(c.novel ?? "");
                    if (vault.nameTaken(name) || reserved.has(name.toLowerCase())) throw fail(`A note named "${name}" already exists; choose another name or edit that note`);
                    reserved.add(name.toLowerCase());
                    return { action: "create_note", kind: "character", novel: novel.folder, name, path: `${novel.charactersFolder}/${name}.md`, fields, text: String(c.text ?? "") };
                }
                const cols = store.schema().collections ?? {};
                const col = Object.keys(cols).find((k) => k.toLowerCase() === String(c.collection ?? "").toLowerCase().trim());
                if (!col) throw fail(`No collection "${c.collection}". Use one of: Characters (with novel), ${Object.keys(cols).join(", ")}`);
                const final = uniqueName(vault, name, cols[col].label ?? col, reserved);
                reserved.add(final.toLowerCase());
                return { action: "create_note", kind: "data", collection: col, name: final, path: `${DS}/${col}/${final}.md`, fields, text: String(c.text ?? ""), renamed: final !== name };
            }
            case "edit_fields": {
                const n = this.editable(c.note);
                const set = c.set && typeof c.set === "object" ? c.set : {};
                const unset = Array.isArray(c.unset) ? c.unset.map(String) : [];
                if (!Object.keys(set).length && !unset.length) throw fail("edit_fields needs set or unset");
                const problems = stats.checkPatch(n.path, set);
                if (problems.length) throw fail(`${n.name}: ${problems.join("; ")}`);
                const rows = [...Object.entries(set).map(([k, v]) => ({ key: k, before: plain(n.fm[k]), after: plain(v) })), ...unset.map((k) => ({ key: k, before: plain(n.fm[k]), after: "", removed: true }))];
                return { action: "edit_fields", path: n.path, name: n.fm.title || n.name, set, unset, rows };
            }
            case "edit_text": {
                const n = this.editable(c.note);
                const find = String(c.find ?? ""), replace = String(c.replace ?? "");
                if (!find) throw fail("edit_text needs the exact text to find");
                const count = n.body.split(find).length - 1;
                if (count !== 1) throw fail(`${n.name}: the text to replace occurs ${count} times; quote a longer passage so it occurs exactly once (copy it exactly, with its markdown)`);
                return { action: "edit_text", path: n.path, name: chapterLabel(n, novels) ?? (n.fm.title || n.name), find, replace, context: around(n.body, find) };
            }
            case "add_text": {
                const n = this.editable(c.note);
                const text = String(c.text ?? "").trim();
                if (!text) throw fail("add_text needs the text to add");
                if (c.after) {
                    const count = n.body.split(String(c.after)).length - 1;
                    if (count !== 1) throw fail(`${n.name}: the passage to add after occurs ${count} times; quote it exactly so it occurs once`);
                }
                return { action: "add_text", path: n.path, name: chapterLabel(n, novels) ?? (n.fm.title || n.name), after: c.after ? String(c.after) : null, text, context: c.after ? around(n.body, String(c.after)) : n.body.trim().slice(-300) };
            }
            default: throw fail(`Unknown action "${c.action}"`);
        }
    }

    /** The propose_changes tool: all changes valid, or none proposed */
    propose(conversation, { title, changes }) {
        if (!Array.isArray(changes) || !changes.length) throw fail("No changes given");
        const reserved = new Set();
        const out = changes.map((c, i) => {
            try { return { ...this.prepare(c, reserved), i, status: "pending" }; } catch (e) { throw fail(`Change ${i + 1}: ${e.message}`); }
        });
        const p = { id: crypto.randomUUID().slice(0, 8), conversation, title: String(title || "Proposed changes"), created: Date.now(), changes: out, reported: false };
        this.all.set(p.id, p);
        while (this.all.size > KEEP) this.all.delete(this.all.keys().next().value);
        return p;
    }

    get(id) {
        const p = this.all.get(id);
        if (!p) throw Object.assign(new Error("This proposal is gone (proposals are kept until the app restarts)"), { status: 404 });
        return p;
    }

    /** Apply pending changes (`which`: an index, or "all"); each one is checked again first */
    async apply(id, which) {
        const p = this.get(id);
        const { store, novels, plans } = this.ctx();
        for (const c of p.changes) {
            if (c.status !== "pending" || (which !== "all" && c.i !== Number(which))) continue;
            try {
                const vault = this.ctx().vault;
                if (c.action === "create_note") {
                    if (c.kind === "character") {
                        c.path = await novels.createCharacter(novels.get(c.novel), store.schema(), c.name, c.fields);
                        if (c.text) { const n = vault.notes.get(c.path); await patchNote(vault, c.path, { body: `${c.text.trim()}\n\n${n?.body ?? ""}`.replace(/\n{3,}/g, "\n\n") }); }
                    } else c.path = await store.create(c.collection, c.name, c.fields, c.text ? `${c.text.trim()}\n` : "");
                } else {
                    const n = vault.notes.get(c.path);
                    if (!n) throw new Error("The note is gone");
                    if (c.action === "edit_fields") await patchNote(vault, c.path, { set: c.set, unset: c.unset });
                    else if (c.action === "edit_text") {
                        if (n.body.split(c.find).length - 1 !== 1) throw new Error("The text changed since this was proposed");
                        await patchNote(vault, c.path, { body: n.body.replace(c.find, () => c.replace) });
                    } else if (c.action === "add_text") {
                        let body;
                        if (c.after) {
                            if (n.body.split(c.after).length - 1 !== 1) throw new Error("The passage changed since this was proposed");
                            body = n.body.replace(c.after, () => `${c.after}\n\n${c.text}`);
                        } else body = `${n.body.replace(/\s+$/, "")}\n\n${c.text}\n`;
                        await patchNote(vault, c.path, { body });
                    }
                    await plans.afterPatch(c.path);
                }
                c.status = "applied";
                delete c.error;
            } catch (e) {
                c.status = "failed";
                c.error = e.message;
            }
            p.reported = false;
        }
        return p;
    }

    reject(id, which) {
        const p = this.get(id);
        for (const c of p.changes) if (c.status === "pending" && (which === "all" || c.i === Number(which))) { c.status = "rejected"; p.reported = false; }
        return p;
    }

    /** What the user decided since the model last heard, for the next message of that conversation (one line each) */
    report(conversation) {
        const lines = [];
        for (const p of this.all.values()) {
            if (p.conversation !== conversation || p.reported) continue;
            const by = (s) => p.changes.filter((c) => c.status === s).map((c) => c.i + 1);
            const parts = [["applied", by("applied")], ["rejected", by("rejected")], ["failed", by("failed")], ["still waiting", by("pending")]].filter(([, l]) => l.length).map(([k, l]) => `${k}: ${l.join(", ")}`);
            lines.push(`Review of "${p.title}": ${parts.join("; ")}${p.changes.some((c) => c.error) ? ` (${p.changes.filter((c) => c.error).map((c) => `change ${c.i + 1}: ${c.error}`).join("; ")})` : ""}`);
            if (!p.changes.some((c) => c.status === "pending")) p.reported = true;
        }
        return lines;
    }
}

function chapterLabel(n, novels) {
    const novel = novels.list().find((x) => n.path.startsWith(`${x.chaptersFolder}/`));
    if (!novel) return null;
    const num = n.fm.chapter ?? /^(\d+(?:\.\d+)?)/.exec(n.name)?.[1];
    return `${novel.name}, chapter ${num}`;
}

/** The paragraph(s) around a passage, for showing the change in place */
function around(body, find) {
    const at = body.indexOf(find);
    const s = body.lastIndexOf("\n\n", at);
    const start = s < 0 ? 0 : s + 2;
    let end = body.indexOf("\n\n", at + find.length);
    if (end < 0) end = body.length;
    return { before: body.slice(start, at), after: body.slice(at + find.length, end) };
}
