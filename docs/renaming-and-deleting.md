---
title: Renaming and deleting
group: Tools
kind: guide
order: 4
blurb: Rename a note and every link follows; deleted notes go to the vault's trash.
---
## Renaming

**Rename file** on a note page (or **Rename** / <kbd>F2</kbd> in the world outline) changes the note's file name. The title is separate: change it in the fields, or in the same dialog.

When a note is renamed:

- every `[[link]]` and embed to it in the vault is rewritten (only the link's name; headings, aliases and folder parts stay);
- pins in maps and blueprints that point to it are updated;
- a location's map file is renamed with it;
- an imported note keeps its place in the import record, so later imports still find it.

The new name must not be used by another note anywhere in the vault. Config, ledger and `90. Templater/` notes can't be renamed here.

## Deleting

**Delete** (two clicks) moves the note to the vault's `.trash/` folder, the same as Obsidian's trash. Links to it are left as they are and show as unresolved. Config, ledger and `90. Templater/` notes can't be deleted here.

> [!tip] To bring a note back, move it out of `.trash/` in your file manager or in Obsidian.
