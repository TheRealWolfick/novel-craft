---
title: Callout templates reference
group: Novels and characters
kind: reference
order: 3
blurb: The template language and every field ledger callouts can show.
---
A ledger entry becomes a callout through a template. Templates live in `90. Templater/Ledger Types.md` per ledger type and variant, and a novel's `config.md` can override any of them. Edit them on the novel's **Callouts** page.

## Which template is used

1. The entry's own variant (`callout:: name`) in the novel's config, then the novel's default variant,
2. then the same in the shared Ledger Types note.

## Template language

| Syntax | Means |
| --- | --- |
| `{{field}}` | A value |
| `{{#list}}…{{/list}}` | Repeat for each item of a list (or show when a value is set) |
| `{{^list}}…{{/list}}` | Show when the list is empty |

A section tag alone on its line takes the line with it. Templates are written without the `> ` callout prefix; it is added to every line.

## Fields

| Field | Value |
| --- | --- |
| `ownerName`, `chapter`, `title`, `body` | The entry |
| `eventLink` | A hidden marker linking the entry, so the chapter page knows it is in the text |
| `added`, `removed`, `transferredIn`, `transferredOut`, `moved` | Inventory lines by kind |
| `gained`, `lost`, `set` | Lines of state ledgers (stats, relationships) |
| `items`, `materials`, `lines` | All lines |

Each line has `item`, `itemName`, `qtyText` (`5x`, `2.30kg`), `plural`, `haveHas`, `condition`, `rarity`, `mods`, `modsText`, `details`, `destination`, `source`, `toName`, `fromName`, `note`, `setField`, `setValue`, `withName`.

`details` lists condition, rarity and modifiers as indented bullets under the item's line; end item lines with `{{details}}` so held items show them.
