---
title: Writing a chapter
group: Writing
kind: guide
order: 1
blurb: 'The writer on the left, the plan and ledger entries on the right: formatting,
  moving around, selecting blocks, scene breaks, find and saving.'
---
The writer opens a chapter note on the left of the window while the chapter's plan and ledger entries stay on the right, in the side drawer.

## Opening the writer

1. Open a chapter: on a novel's [Grand plan](docs:planning), click a chapter row.
2. Press **✎ Write**. A planned chapter already has an empty note to write in; a chapter with neither plan nor note offers **Create chapter**, which names the file the way the Templater Chapter template does.
3. Close or reopen the writer any time with <kbd>Ctrl</kbd>+<kbd>[</kbd>, and the right drawer with <kbd>Ctrl</kbd>+<kbd>]</kbd>. A closed writer keeps your unsaved text; **✎ Open writer** in the sidebar, under World builder, brings it back and shows which chapter it holds (on a chapter page with nothing in the writer, it opens that chapter; otherwise it is greyed out).

![The writer beside chapter 1's plan](img/writer.png)

With both open, the writer and the drawer share the window half and half. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>[</kbd> and <kbd>]</kbd> move the split left and right (between a quarter and three quarters), <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>\\</kbd> puts it back in the middle; the split is remembered. The text sits in a column centred in the writer; its widest is set under **Column width** in [Settings](docs:settings-and-appearance#chapter-text).

## Fields on top

**Details** above the text holds the chapter note's frontmatter (title, arc, characters mentioned…), one field per row. Fold it away while writing. The title is the [plan](docs:planning#writing-a-chapter-plan)'s title too, and renames the file when its name was made from it; the number is changed on the plan.

## Writing in blocks

Each paragraph, heading, list item and callout is a block. Blocks show formatted until you click one; then that block shows its markdown and the cursor lands where you clicked.

- <kbd>Enter</kbd> starts a new paragraph, <kbd>Shift</kbd>+<kbd>Enter</kbd> breaks the line inside it.
- Typing `# `, `- `, `1. `, `> ` or `- [ ] ` at the start of a paragraph turns it into a heading, list item, quote or task.
- <kbd>Backspace</kbd> at the start turns a heading or list item back into a paragraph, or joins the paragraph above.
- <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> moves a block.
- <kbd>Ctrl</kbd>+<kbd>B</kbd>, <kbd>I</kbd>, <kbd>K</kbd> toggle bold, italic and a `[[link]]`; with no selection they take the word at the cursor.

Paragraphs are justified with an indented first line, like the vault's chapter style. Text size, paragraph spacing, column width and a colour for speech in quotes are under [Chapter text](docs:settings-and-appearance#chapter-text) in Settings. Every shortcut is in [Keyboard shortcuts](ref:keyboard-shortcuts).

## Moving around

While you edit a block the arrow keys move through its text. On its first or last line <kbd>↑</kbd> / <kbd>↓</kbd> carry on into the block above or below, at the same place across the line; <kbd>←</kbd> / <kbd>→</kbd> do the same at its start and end. So you can walk through the whole chapter without the page scrolling away from the cursor.

## Selecting blocks

<kbd>Escape</kbd> stops editing and selects the block, shaded in the novel's colour. Now the arrows move by block instead of by line:

- <kbd>↑</kbd> / <kbd>↓</kbd> select the block above or below; with <kbd>Shift</kbd> (or <kbd>Shift</kbd>+click) the selection grows. <kbd>Ctrl</kbd>+<kbd>A</kbd> selects them all.
- <kbd>Enter</kbd> or <kbd>Space</kbd> edits the selected block.
- <kbd>Shift</kbd>+<kbd>Enter</kbd> adds an empty paragraph after the selection and puts the cursor in it (press it again for a line break inside it).
- <kbd>Backspace</kbd> turns the selection red; press it again to delete the blocks. Any other key cancels.
- <kbd>Ctrl</kbd>+<kbd>B</kbd>, <kbd>I</kbd> and the other formatting keys format every selected block; if all of them have it already, it comes off.
- <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> copy or cut the blocks as markdown (formatting included), <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes after them, <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> move them.

<kbd>Escape</kbd> again, or a click on any text, leaves block navigation. While editing, <kbd>Shift</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> with the selection already at the block's start or end selects this block and the next, so a selection can reach across paragraphs.

> [!tip] Note blocks, long text fields such as a description, plots and the scratchpad use the same editor, so this works there too.

## Scene breaks, callouts and images

Press **✱ Break** or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> to insert a centred scene break: an image named `pb-…` from your vault, on a paragraph of its own. The novel's most used one comes first; set a default with `scene-break` in the novel's `config.md`.

Callouts and image lines show rendered, styled the way the [callout designer](docs:designing-callouts) says. Click one to edit its text.

![A journal callout in the writer](img/writer-callout.png)

## Find in the chapter

The find box in the writer's header highlights every match; <kbd>Enter</kbd> and <kbd>Shift</kbd>+<kbd>Enter</kbd> (or <kbd>Ctrl</kbd>+<kbd>↓</kbd> / <kbd>↑</kbd>) step through them. <kbd>Ctrl</kbd>+<kbd>F</kbd> inside the writer jumps to the box, and pressed again goes back to where you were writing. <kbd>Escape</kbd> clears the search and puts the cursor in the text at the current match.

![Find highlights every match](img/writer-find.png)

## Saving

**Save** (or <kbd>Ctrl</kbd>+<kbd>S</kbd>) writes only what changed: untouched paragraphs keep their exact text, and the frontmatter is only rewritten when you changed a field. **Preview** (<kbd>Ctrl</kbd>+<kbd>E</kbd>) shows the chapter as it reads. **Plan** brings the chapter's plan back into the drawer when you've opened something else there.

> [!warning] If the chapter changed in Obsidian since you opened it, saving stops and offers to load the saved version. Copy anything you want to keep first.
