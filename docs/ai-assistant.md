---
title: The AI assistant
group: Tools
kind: guide
order: 2
blurb: Claude Code (with your own subscription), the Anthropic or OpenAI API, or a model on your own computer, in the side drawer, reading only what each question needs and proposing changes for you to review.
---
The assistant lives in the side drawer's **AI** tab: Claude, an OpenAI model, or a model running on your own computer. Ask it what happened in a chapter, what a character carries at a given point, where a place sits in your world, or for ideas about what comes next.

## Connecting

Open [Settings](app:#/settings?s=ai) and find **AI assistant**. There are five ways to connect:

- **Claude Code (your subscription)**, the default on Linux. The AI tab runs your own Claude Code in a terminal, signed in with your own Claude plan, so it counts against your plan rather than API billing. Install Claude Code and sign in to it once (run `claude` in a terminal) first. For now this needs Linux (the terminal uses Linux tools); on macOS and Windows the option is greyed out and says why.
- **Sign in with Anthropic (API).** Uses Anthropic's `ant` command-line tool: the button opens your browser, you sign in to your Anthropic API account, and the app uses that sign-in from then on.
- **Anthropic API key.** Create a key in the Claude Console and paste it in.
- **OpenAI API key.** Create a key at platform.openai.com and paste it in, then choose a model from the list your key can use.
- **Local model.** A model running on your own computer with [Ollama](https://ollama.com) (`localhost:11434`) or the llama.cpp server (`localhost:8080`, started with `--jinja`), or any other server that speaks the OpenAI-compatible API (**Other address**, with a key if it needs one). Settings lists the models the server has; nothing leaves your computer. The model must support tool calling (for Ollama, e.g. qwen3 or llama3.1); bigger models follow the instructions noticeably better.

Keys stay on this computer, in a file only you can read, and are sent only to their own provider; the page never shows them again (only their last four characters). Everything except Claude Code uses the chat described under [Asking](docs:ai-assistant#asking). **Model** and **Effort** choose which model answers and how hard it thinks (Effort for Claude and OpenAI's reasoning models), and **Test the connection** sends one tiny request to check everything works. The chat shows the cost of a conversation with Claude, and the tokens used with the others. A conversation stays with the provider it started with: after switching, press **New**.

## Claude Code in the AI tab

Click the robot button at the top right, then **Start Claude Code** (after the first time it carries on with your last conversation by itself, also after restarting the app). The first time, Claude Code asks whether to trust its workspace folder; it lists the one permission the workspace gives it, Novel Craft's tools.

What it can and can't do:

- It works through Novel Craft's tools: search, novel overviews, chapters a page at a time, notes by section, collections, characters' ledgers at a chapter and their entries in full, world outlines, taxonomy, and what you have on screen. They reach your novels and the data store, nothing else.
- It can't read or edit the vault's files directly, and can't run commands: its workspace refuses both. Every change goes through the review panel (see [Reviewing changes](docs:ai-assistant#reviewing-changes)), which opens beside it.
- It runs in its own folder in the app's data, connected to Novel Craft and no other MCP servers, and ends when you quit the app.

The bar above the terminal has Claude Code's own commands one click away: **Usage** (your plan's limits and how much is left), **Context**, **Compact**, **Model** and **Effort**; a **Close** button appears over screens like these (Escape closes them too). **History** lists your earlier conversations with their titles; pick one to carry on with it. **New** starts a fresh one, **End** closes Claude Code.

Write your messages in the text box under it (Claude Code's own input line is hidden): an ordinary text field, where you can select, delete and paste as anywhere else. **Shift+Enter** (or **Send**) sends the whole message at once; Enter starts a new line. With the box empty, Enter, the arrow keys and Tab go to Claude Code, and Escape stops it.

When Claude Code asks something (a question with choices, a permission prompt, menus such as **Model**), it shows as a card at the bottom of the conversation: the question on top and the answers as buttons. Click one, or move with ↑ ↓ and press Enter; **Cancel** (or Escape) backs out. For a "Type something" answer, write it in the text box and send it. You can also click into the terminal and type there directly.

Your messages show as bubbles in the novel's colour (the app's colour outside a novel), earlier ones in a resumed conversation too. It's still Claude Code underneath, so a sent message can't be edited or deleted. `[[Note]]` links and note paths in its answers are clickable: they open the note in the viewer. Ctrl+C copies what you've selected (with nothing selected it stops Claude Code, as in any terminal), Ctrl+V pastes.

Type `/world-builder` for ready-made prompts: summarise a chapter, review a chapter (with edits to review), brainstorm, draft a data store entry, check a character's continuity.

> [!note] Your sign-in stays with Claude Code
> Novel Craft never sees or stores your Claude sign-in: it starts the `claude` you installed, unchanged, and only connects it to its tools. That's also why usage is shown by Claude Code itself, and why it stays a terminal you type into rather than something the app runs behind the scenes: Anthropic allows you to use your own subscription in your own Claude Code, not apps to use it for you. AI-INTEGRATION.md in Novel Craft's repository has the details.

## Asking

With an API connection, the AI tab is a chat. Click the robot button at the top right to open it (click it again to close the drawer). Type a question and press Enter; Shift+Enter starts a new line, Escape stops a reply. **New** starts a fresh conversation.

Suggestions sit under the chat as buttons: openers that fit the page you're on when the conversation is empty, then follow-ups after each reply. Click one to send it.

While it works you see each step it takes ("Searched 'lantern' · 9 results", "Read chapter 3"); when the reply is finished the steps fold away under "N steps". Note names in replies are links that open in the viewer.

The assistant knows which page you're on, which chapter is in the writer and what the drawer shows. Select some text first and say "this" or "the selection" to ask about it.

The running cost of the conversation (an estimate) shows at the top of the tab. Conversations are saved in the app's data folder: the one you had open comes back when you reopen the app, **History** lists the others (pick one to carry on, or delete it), and **New** starts a fresh one.

## Reviewing changes

Ask it to create or change something (a new item, a character, field values, a rewrite of a passage, a new ledger entry, a change to one or its deletion, a taxonomy such as a power system's levels) and it prepares the changes instead of writing them. They open in the drawer's viewer for review:

- each change on its own card: a new note with its fields and text, field changes as *now → after*, text edits with the removed words struck through and the new ones highlighted, in their paragraph; a ledger entry as its callout (beside the current one when it changes an entry; a change can be as small as a new title, the rest stays as it is), an entry to delete as its callout greyed out with *to be deleted* (and any transfer it wrote into another ledger, which goes with it), with what it changes in the holdings at that chapter and any warnings, such as stock going below zero; a taxonomy with every value and its number, the power systems it belongs to as *now → after*, or, for one to remove, the values that go and the notes that link to them;
- **Apply** or **Reject** on each card, or **Apply all** / **Reject all** at the top;
- **Back to the conversation** returns to the AI tab you used last, in whichever drawer it is, where a card for the proposal opens it again.

Nothing is written until you apply it, and each change is checked again first (a passage you've edited in the meantime is refused, not overwritten). The assistant hears what you applied and rejected with your next message. An applied ledger entry is saved the way the ledger editor saves one: it gets its number in the chapter, a transfer writes the receiver's entry too, and character sheets are updated. An applied delete removes the entry the way the ledger editor does, with its mirrored transfers, and syncs the sheets again. Entries that mirror a transfer can't be changed or deleted directly (change the giving entry), and novel settings can't be changed this way.

The assistant can make taxonomies, add values to them, link them to power systems or unlink them, and remove them. Required taxonomies, and ones a stat template uses, can't be removed. It can't change a chapter's number, or give a chapter the number and title of an archived one.

> [!tip] After updating the app
> Press **New** in the AI tab: a Claude Code conversation from before the update may still have the older list of what it can propose.

> [!note] What it can read
> Only your novel folders and the data store, nothing else in the vault (not your Templater notes, not `.obsidian`). It reads a little at a time: overviews, search results, the parts of a note or chapter it needs.
