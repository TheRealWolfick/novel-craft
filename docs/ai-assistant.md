---
title: The AI assistant
group: Tools
kind: guide
order: 2
blurb: Ask Claude about your novels and worlds from the side drawer. It reads only what each question needs.
---
The assistant is Claude, in the side drawer's **AI** tab. Ask it what happened in a chapter, what a character carries at a given point, where a place sits in your world, or for ideas about what comes next.

## Connecting

Open [Settings](app:#/settings?s=ai) and find **AI assistant**. There are two ways to connect:

- **Sign in with Anthropic.** This uses Anthropic's `ant` command-line tool: the button opens your browser, you sign in to your Anthropic API account, and the app uses that sign-in from then on. Install `ant` first if the panel says it's missing.
- **API key.** Create a key in the Claude Console and paste it in. The key stays on this computer, in a file only you can read, and the page never shows it again (only its last four characters).

Either way, what the assistant does is billed to your Anthropic API account. **Test the connection** sends one tiny request to check everything works.

**Model** picks which Claude answers (Opus 5.5 is the default; Sonnet and Haiku are faster and cheaper). **Effort** sets how hard it thinks before answering: Medium suits most questions, High suits chapter reviews and tricky continuity.

## Asking

Click the robot button at the top right to open the AI tab (click it again to close the drawer). Type a question and press Enter; Shift+Enter starts a new line, Escape stops a reply. **New** starts a fresh conversation.

While it works you see each step it takes ("Searched 'lantern' · 9 results", "Read chapter 3"); when the reply is finished the steps fold away under "N steps". Note names in replies are links that open in the viewer.

The assistant knows which page you're on, which chapter is in the writer and what the drawer shows. Select some text first and say "this" or "the selection" to ask about it.

The running cost of the conversation (an estimate) shows at the top of the tab.

> [!note] What it can read
> Only your novel folders and the data store, nothing else in the vault (not your Templater notes, not `.obsidian`). It reads a little at a time: overviews, search results, the parts of a note or chapter it needs. It can't change anything yet; when you ask for an entry or a rewrite it gives you the text to paste.
