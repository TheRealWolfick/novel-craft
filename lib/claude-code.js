// Claude Code in the AI tab: the user's own, unmodified `claude`, signed in with their own subscription, running in a
// pseudo-terminal (util-linux `script`, so no native module) in a workspace folder of the app's own data. The workspace
// connects Claude Code to Novel Craft's MCP server (lib/mcp.js) and nothing else (--strict-mcp-config), allows the
// Novel Craft tools, and refuses file access to the vault and shell commands, so changes go through the review panel.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { instructions } from "./ai-instructions.js";

const BUFFER = 512 * 1024;   // output kept for a page that (re)connects
// markers a running Claude Code session puts in its environment (settings such as CLAUDE_CODE_USE_BEDROCK stay)
const SESSION_VARS = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_SESSION_ID", "CLAUDE_EFFORT", "CLAUDE_PID"];
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export const workspaceDir = () => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "world-builder", "claude-code");

/** Where `claude` is: PATH, then the places its installers use (the desktop app may start with a short PATH) */
export function findClaude() {
    const home = os.homedir();
    const dirs = [...String(process.env.PATH ?? "").split(path.delimiter), path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), path.join(home, ".npm-global", "bin"), "/usr/local/bin", "/usr/bin"];
    for (const d of dirs) {
        if (!d) continue;
        const f = path.join(d, "claude");
        try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile() || fs.lstatSync(f).isSymbolicLink()) return f; } catch { /* not here */ }
    }
    return null;
}

/**
 * Write the workspace: mcp.json (Novel Craft only), .claude/settings.json (Novel Craft tools allowed; the vault's
 * files and shell commands refused) and CLAUDE.md (what it may and may not do). Rewritten at every start, since the
 * port, the vault and the token can change.
 */
export async function prepareWorkspace({ url, token, vaultRoot, outline }) {
    const dir = workspaceDir();
    await fsp.mkdir(path.join(dir, ".claude"), { recursive: true });
    const mcp = { mcpServers: { "world-builder": { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } };
    await fsp.writeFile(path.join(dir, "mcp.json"), JSON.stringify(mcp, null, 2) + "\n", { mode: 0o600 });
    await fsp.chmod(path.join(dir, "mcp.json"), 0o600);
    const vault = vaultRoot ? `/${path.resolve(vaultRoot)}` : null;   // "//abs/path" = an absolute path in permission rules
    const settings = {
        permissions: {
            allow: ["mcp__world-builder"],
            deny: [...(vault ? [`Read(${vault}/**)`, `Edit(${vault}/**)`] : []), "Bash", "NotebookEdit"],   // Edit covers writing too
        },
    };
    await fsp.writeFile(path.join(dir, ".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
    await fsp.writeFile(path.join(dir, "CLAUDE.md"), `# Novel Craft workspace\n\nThis folder is Novel Craft's workspace for Claude Code; it is rewritten each time the terminal starts.\n\n${instructions("claude-code", outline)}\n`);
    return dir;
}

/**
 * Claude Code's conversations in the workspace, newest first: [{id, title, prompt, updated, messages}]. Claude Code
 * keeps each as a JSONL file in <config>/projects/<the folder's path with every non-alphanumeric as "-">/<id>.jsonl;
 * the title is its own ("ai-title"), else the first thing the user typed. Read defensively: the format is Claude Code's.
 */
export function sessions(dir = workspaceDir(), limit = 40) {
    const conf = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    const folder = path.join(conf, "projects", path.resolve(dir).replace(/[^a-zA-Z0-9]/g, "-"));
    let files;
    try { files = fs.readdirSync(folder).filter((f) => /^[0-9a-f-]{36}\.jsonl$/.test(f)); } catch { return []; }
    const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join(" ") : "");
    const out = [];
    for (const f of files) {
        const file = path.join(folder, f);
        let st, lines;
        try { st = fs.statSync(file); lines = fs.readFileSync(file, "utf8").split("\n"); } catch { continue; }
        let title = "", prompt = "", messages = 0;
        for (const l of lines) {
            if (!l) continue;
            let o; try { o = JSON.parse(l); } catch { continue; }
            if (o.type === "ai-title" && o.aiTitle) title = String(o.aiTitle);
            else if (o.type === "summary" && o.summary && !title) title = String(o.summary);
            else if (o.type === "user" && !o.isMeta && !o.isSidechain) {
                const t = text(o.message?.content).trim();
                if (t && !t.startsWith("<") && !/^\[Request interrupted/.test(t)) { messages++; if (!prompt) prompt = t; }
            } else if (o.type === "assistant" && !o.isSidechain) messages++;
        }
        if (!messages) continue;   // started and left without a word
        out.push({ id: f.slice(0, 36), title: title || prompt.slice(0, 80) || "Untitled", prompt: prompt.slice(0, 200), updated: st.mtimeMs, messages });
    }
    return out.sort((a, b) => b.updated - a.updated).slice(0, limit);
}

export class Terminal {
    constructor() { this.proc = null; this.chunks = []; this.size = 0; this.total = 0; this.id = 0; this.listeners = new Set(); this.exit = null; this.tty = null; }

    get running() { return !!this.proc; }

    /** Start `claude` (or WB_TERMINAL_CMD in tests) in the workspace; resume: false, "last", or a conversation id */
    start({ claude, cwd, cols = 100, rows = 30, resume = false }) {
        if (this.proc) return;
        const again = resume === "last" || resume === true ? " --continue" : /^[0-9a-f-]{36}$/.test(String(resume)) ? ` --resume ${resume}` : "";
        this.session = again ? String(resume) : null;
        const cmd = process.env.WB_TERMINAL_CMD ? `${process.env.WB_TERMINAL_CMD}${again ? ` # ${again.trim()}` : ""}` : `exec ${q(claude)} --settings .claude/settings.json --mcp-config mcp.json --strict-mcp-config${again}`;
        const c = Math.max(20, Math.min(500, cols | 0)), r = Math.max(5, Math.min(200, rows | 0));
        const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", PATH: `${path.dirname(claude ?? "/usr/bin/x")}${path.delimiter}${process.env.PATH ?? ""}` };
        // a fresh session of its own, even when Novel Craft itself was started from a Claude Code session
        for (const k of SESSION_VARS) delete env[k];
        this.chunks = []; this.size = 0; this.total = 0; this.exit = null; this.tty = null;
        this.id = Date.now();   // a session id: a page that reconnects knows whether it still shows this session
        for (const f of this.listeners) f({ start: { id: this.id } });
        const proc = spawn("script", ["-qfec", `stty cols ${c} rows ${r}; ${cmd}`, "/dev/null"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
        this.proc = proc;
        const out = (d) => {
            this.chunks.push(d); this.size += d.length; this.total += d.length;
            while (this.size > BUFFER && this.chunks.length > 1) this.size -= this.chunks.shift().length;
            for (const f of this.listeners) f({ data: d });
        };
        proc.stdout.on("data", out);
        proc.stderr.on("data", out);
        proc.on("close", (code) => {
            if (this.proc !== proc) return;
            this.proc = null;
            this.exit = { code };
            for (const f of this.listeners) f({ exit: this.exit });
        });
        proc.on("error", (e) => out(Buffer.from(`\r\n${e.message}\r\n`)));
    }

    write(data) { if (this.proc) this.proc.stdin.write(String(data)); }

    /** Tell the program its new size (the kernel sends it SIGWINCH) */
    resize(cols, rows) {
        if (!this.proc) return;
        try {
            if (!this.tty) {
                const kid = execFileSync("pgrep", ["-P", String(this.proc.pid)]).toString().trim().split("\n")[0];
                this.tty = fs.readlinkSync(`/proc/${kid}/fd/0`);
            }
            execFileSync("stty", ["-F", this.tty, "cols", String(Math.max(20, Math.min(500, cols | 0))), "rows", String(Math.max(5, Math.min(200, rows | 0)))]);
        } catch { this.tty = null; /* not started yet, or gone */ }
    }

    /** End the session; resolves once it has gone (so another can start) */
    stop() {
        if (!this.proc) return Promise.resolve();
        const done = new Promise((resolve) => this.proc.once("close", resolve));
        const p = this.proc;
        try { process.kill(-p.pid, "SIGHUP"); } catch { /* not a group */ }
        p.kill("SIGHUP");
        setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, 1500);
        return done;
    }

    /** Everything shown so far (for a page that connects late) */
    backlog() { return Buffer.concat(this.chunks); }
    /** Output since byte `from` of session `id` when it's still kept, else null */
    since(id, from) {
        const start = this.total - this.size;
        if (Number(id) !== this.id || !(from >= start) || from > this.total) return null;
        return this.backlog().subarray(from - start);
    }
}
