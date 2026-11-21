# The AI integration and Anthropic's terms

Why Novel Craft's Claude features are built the way they are, what Anthropic's terms say about it, and the rules any change must keep. Read this before changing anything in `lib/ai*.js`, `lib/mcp.js`, `lib/claude-code.js`, `public/ai.js` or `public/terminal.js`.

This is the project's own reading of public documents, written down so they don't have to be re-read every time. It is not legal advice. Anthropic can change its terms; the "Checked" date below says when this was last compared with them.

**Checked:** 2026-11-16, against the four pages under [Sources](#sources).

## The three ways Novel Craft talks to Claude

| Mode (Settings → AI assistant) | Who signs in | Billed to | How the app reaches Claude |
| --- | --- | --- | --- |
| **Claude Code (your subscription)**, the default | The user, inside Claude Code itself | The user's own Claude plan | Starts the user's own, unmodified `claude` in a terminal in the AI tab; Novel Craft is an MCP server it connects to |
| **Sign in with Anthropic (API)** | The user, through Anthropic's `ant` CLI (`ant auth login`) | The user's Anthropic API account | The official Anthropic SDK with that sign-in profile |
| **API key** | The user pastes their own API key | The user's Anthropic API account | The official Anthropic SDK |

Nobody's requests ever go through anyone else's account: every user of Novel Craft uses their own plan or API account.

Two more modes don't involve Anthropic at all: **OpenAI API key** (the user's own key, billed to their OpenAI account) and **Local model** (Ollama, the llama.cpp server or any OpenAI-compatible address the user enters). Both go through `lib/ai-openai.js` with plain `fetch`, use the same read-only tools and review panel as the Anthropic API chat, and never use the terminal: **the terminal is only ever Claude Code.** Their keys follow rule 8 below (kept in `secrets.json`, sent only to that provider). Anthropic's terms quoted here don't govern them; OpenAI's API terms cover the OpenAI mode, and a local model is the user's own software.

## What the terms say

**Subscription sign-in in other apps** (Claude Code's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)):

- OAuth authentication (the Free/Pro/Max/Ultra sign-in) "is intended exclusively for purchasers" of those plans.
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users."
- Developers "may not collect, store, or intermediate Claude.ai credentials or session tokens".
- But this doesn't prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
- "The Claude Code binary must not be modified." Customers may not "pay for, resell, or intermediate Claude usage on their end users' behalf."
- Products and services built on Claude, "including those using the Agent SDK, should use API key authentication".
- Pro/Max/Ultra usage limits "assume ordinary, individual usage of Claude Code and the Agent SDK".
- The page's own advice for unclear cases: contact Anthropic sales about permitted authentication methods.

**The Agent SDK** ([overview](https://code.claude.com/docs/en/agent-sdk/overview)): unless approved, Anthropic doesn't allow third-party developers "to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK". Running `claude -p` as a subprocess is described as driving the same agent loop as the SDK.

**Automated access** ([Consumer Terms](https://www.anthropic.com/legal/consumer-terms), effective 8 Oct 2025, section 3): no access "through automated or non-human means, whether through a bot, script, or otherwise", except via an Anthropic API key "or where we otherwise explicitly permit it". Account logins may not be shared.

**Headless mode** ([docs](https://code.claude.com/docs/en/headless)): `claude -p` is the supported non-interactive mode and uses the subscription login unless `--bare` is given (bare mode needs an API key).

**Not addressed anywhere:** an app on the user's own computer that starts the user's own `claude` with the user's own sign-in. That is the gap the design below is placed in.

## How the Claude Code mode stays inside them

- **Unmodified binary, the user's own sign-in.** Novel Craft finds the `claude` the user installed and runs it as it is, in a terminal. Claude Code signs in by itself, with the user's own plan; Novel Craft never sees, reads, stores or passes on that sign-in (no credentials file is read, no token is handled). This is the case the legal page allows explicitly.
- **The user drives it by hand.** It is an interactive terminal session: every message is typed or clicked by the user. The app doesn't script conversations, run Claude Code in the background, or use headless mode (`claude -p`), which is the Agent SDK path the terms point to API keys for. The text box, clickable links, bubbles and command buttons only make typing and reading easier; each one sends exactly what the user chose to send.
- **No intermediating.** Novel Craft doesn't proxy Claude Code's traffic, offer a Claude.ai login, pool accounts, charge for use, or show plan usage by reading the sign-in: the Usage button types `/usage` into Claude Code, which answers itself.
- **Novel Craft is a tool provider, not a Claude client.** In this mode it is an ordinary MCP server (a standard Claude Code feature) that Claude Code connects to with a per-install token. Claude Code calls Novel Craft, not the other way round.
- **Each user, their own account.** Novel Craft is distributed as software people run on their own computers; it doesn't host Claude for anyone.

The API modes are the plain case: the official SDK with the user's own API key or `ant` sign-in, billed to their API account.

## Rules for future changes

Keep all of these unless Anthropic's terms change (check the sources again) or Anthropic approves something in writing:

1. **Never read, store, copy or send Claude.ai / subscription credentials or session tokens** (`~/.claude/.credentials.json`, the keychain entry, OAuth tokens). This includes reading them to show usage, to call an Anthropic endpoint directly, or to "help" sign-in.
2. **Never offer a Claude.ai login in Novel Craft**, and never sign in to Claude Code on the user's behalf.
3. **Never modify, patch, wrap or bundle the Claude Code binary.** Start the user's installed `claude` as it is; command-line flags documented by Claude Code (`--settings`, `--mcp-config`, `--strict-mcp-config`, `--continue`, `--resume`) are fine.
4. **Subscription use stays interactive and user-driven.** No `claude -p`, `--print`, `--output-format stream-json`, Agent SDK, or other programmatic driving with the subscription login: not for background summaries, the planned summary index, batch jobs, or a chat view that hides the terminal. (A chat-style view over headless mode was considered and turned down for this reason, 2026-11-16.) Features like that use the API modes, or a local model.
5. **Typing for the user only on their action.** Buttons may type a command or message into the terminal when the user clicks them; nothing may send input to Claude Code by itself (on a timer, on vault changes, in a loop).
6. **No proxying or sharing.** Never route one person's requests through another person's plan or API account, never run Claude Code for someone else (a server, a shared install), never resell or meter Claude use.
7. **Don't use Anthropic's names or logos as the product's name** (the Claude Code and Agent SDK pages forbid naming a product "Claude Code" or similar). "Works with Claude Code" in descriptions is fine; the app is Novel Craft.
8. **API keys stay the user's own** and stay on their computer (`secrets.json`, owner-only), never sent anywhere but Anthropic's API.

The workspace's own guard rails (connected to Novel Craft only, the vault's files and shell commands refused, every change through the review panel) are about the user's manuscript, not the terms, but they are part of the same design: see the AI assistant section of `CLAUDE.md`.

## If something here needs to change

- Re-read the [sources](#sources) and update this file, quoting what changed and the date.
- When the terms don't settle a question, the legal page's answer is to ask Anthropic (sales) about the authentication method for the use case; record their reply here.

## Sources

- Claude Code, Legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance> (no date on the page; read 2026-11-16)
- Anthropic Consumer Terms of Service: <https://www.anthropic.com/legal/consumer-terms> (effective 8 October 2025)
- Claude Agent SDK overview: <https://code.claude.com/docs/en/agent-sdk/overview> (read 2026-11-16)
- Claude Code headless / programmatic mode: <https://code.claude.com/docs/en/headless> (read 2026-11-16)
- Not yet read, but referenced by the pages above: Anthropic's Commercial Terms (<https://www.anthropic.com/legal/commercial-terms>), which govern the API and the Agent SDK, and Claude Code's authentication page (<https://code.claude.com/docs/en/authentication>).
