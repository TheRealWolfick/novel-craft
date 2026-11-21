// What this computer can do that some features depend on: the Claude Code terminal (Linux, util-linux `script`,
// /proc), Anthropic's `ant` tool, a local model server. Each check answers {ok, reason?, fix?} so the page can grey out
// what won't work and say why, instead of failing when it is used.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

let terminalCache = null;

/**
 * Can the AI tab run a terminal? It uses util-linux `script` for the pseudo-terminal and /proc + `stty -F` to resize
 * it, so for now only Linux. Tests swap in another command (WB_TERMINAL_CMD) but still need `script`.
 */
export function terminalSupport() {
    if (terminalCache) return terminalCache;
    const no = (reason, fix) => (terminalCache = { ok: false, reason, fix });
    if (process.platform !== "linux") {
        return no(`The Claude Code terminal works only on Linux for now (this is ${platformName()}).`, "Use the Anthropic API, OpenAI or a local model instead.");
    }
    let version = "";
    try { version = execFileSync("script", ["--version"], { timeout: 3000, stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch { /* missing */ }
    if (!/util-linux/.test(version)) return no("The Claude Code terminal needs the script command from util-linux, which isn't installed.", "Install util-linux with your package manager, then restart Novel Craft.");
    if (!fs.existsSync("/proc/self/fd")) return no("The Claude Code terminal needs /proc, which this system doesn't have.", "Use one of the API modes instead.");
    return (terminalCache = { ok: true });
}

export function platformName(p = process.platform) {
    return { darwin: "macOS", win32: "Windows", linux: "Linux" }[p] ?? p;
}

/** Is the program on PATH? (runs it with an argument that only prints something) */
export function hasProgram(cmd, args = ["--version"]) {
    try { execFileSync(cmd, args, { timeout: 4000, stdio: "ignore" }); return true; } catch { return false; }
}
