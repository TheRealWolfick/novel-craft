---
title: Stat templates
group: Novels and characters
kind: guide
order: 4
blurb: 'Typed stats per novel: fields, formulas, panels, and creature stat blocks.'
---
A stat template defines the stats characters (and creatures) have in one novel: their names, types, limits and formulas. Templates are made on the novel page's **Stats** tab and saved in the novel's `config.md`.

## Making a template

1. **+ Template** names a new template; mark one as the novel's default. **callout** picks the callout type its panel is written as, from the styles in the [callout designer](docs:designing-callouts).
2. Fields show folded to one line (label, type, section, key); click one, or **Expand all**, to change its settings, and **Collapse all** to fold them again. **+ Field** adds a stat (it opens unfolded): a label and a type: number, text, long text, list, yes/no, choice, link, links, resource (current / maximum) or computed.
3. Numbers can be whole and have a minimum and maximum; computed fields have a formula such as `level * 10 + floor(strength / 2)`.
4. The live preview shows the stat panel as a callout. **panel** chooses the built-in layout: a **status window** (the default: a table per section, values on the right, current / max as a bar, the `status` callout, which follows the light and dark themes) or the **classic list** (`**Label:** value` lines in the `system` callout, styled like the vault theme's dark system window). A custom panel layout replaces both.

## The stats panel

The owner page and the drawer's **Ledger** tab show a character's stats at the chapter on the slider: a table of every stat with its value, where it came from (the chapter that set it, the sheet, computed) and, for unlinked levels, their overflow or underflow, with the panel callout beside it. **Hide callout** / **Show callout** shows the table alone or with the callout; **Copy panel** copies the callout to paste into the chapter.

The status window callout is a card with a small *Status* label over the character's name, the chapter, then a table per section with bars for current / max values; it follows the light and dark themes. Change its colours in the [callout designer](docs:designing-callouts) (*Status window (stats)*). In Obsidian the tables show inside the callout with your vault's own callout styling.

## Choices

A **choice** offers a list of values, set from **values from**:

- *options typed here*: a comma-separated list (Common, Rare, Epic).
- *a taxonomy*: the values of a taxonomy facet in their rank (`class`) order, stored as links to their notes (`"[[Golden Core]]"`). The list follows the taxonomy: a new value there is a new option here. When the values have sub-levels, **use** picks *every value*, *top levels only* (realms) or *sub-levels only* (stages).

A choice can also **follow** a number field: each option applies from its lowest value up (*Qi Refining* from 0, *Foundation Establishment* from 1000…), and the choice is worked out from the number at every chapter, like a computed field. You never set it; you change the number. With a taxonomy, the lowest values come from the values' own `threshold`; a number typed in the template's table overrides it for this template.

[Levels and mastery systems](docs:levels-and-mastery) walks through a whole cultivation ladder: making the levels, linking them to a template, and changing them through the ledger.

## Values over the story

On a character's page the stats are a **Stats** section of their own, never mixed in with the other fields; a character without a template (assigned, or the novel's default) shows no stats at all. Blank stats are hidden unless the template has **show empty fields in panels** on; **+ N empty stats** shows them so you can fill them in.

A character's sheet holds the starting values. A **Stats** ledger entry changes them from a chapter on; the entry editor shows the template as a form with the previous values filled in, and only changed fields become lines. Values that break the template (over the maximum, not a choice) are refused. A number or resource can also **change by** an amount, such as a reward of `+50` qi or a cost of `-20`: the form's *change by* box writes the line `[set:: stats/qi] [add:: 50]` (a value written `+50` means the same), which adds to whatever the value was at that point, so earlier entries can be edited without redoing later ones. Choices that follow a number update with it, and can be set themselves (the number moves to the level's lowest value) or unlinked from it: see [Levels and mastery systems](docs:levels-and-mastery#overflow-special-constitutions-and-deficiencies).

The owner page's stats panel shows the values at any chapter, ready to copy into the text.

## Creatures

On the Stats tab, pick a creature and a template and press **Add**: this makes a stat note for a data store creature in this novel (`Creatures/<Creature> (<Novel>).md`), using a template. Data store creature pages list the novels they have stats in.
