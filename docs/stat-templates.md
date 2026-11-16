---
title: Stat templates
group: Novels and characters
kind: guide
order: 4
blurb: 'Typed stats per novel: fields, formulas, panels, and creature stat blocks.'
---
A stat template defines the stats characters (and creatures) have in one novel: their names, types, limits and formulas. Templates are made on the novel page's **Stats** tab and saved in the novel's `config.md`.

## Making a template

1. **+ Template** names a new template; mark one as the novel's default.
2. **+ Field** adds a stat: a label and a type: number, text, long text, list, yes/no, choice, link, links, resource (current / maximum) or computed.
3. Numbers can be whole and have a minimum and maximum; choices list their options; computed fields have a formula such as `level * 10 + floor(strength / 2)`.
4. The live preview shows the stat panel as a callout. A template's **panel** setting can replace that layout.

## Values over the story

A character's sheet holds the starting values. A **Stats** ledger entry changes them from a chapter on; the entry editor shows the template as a form with the previous values filled in, and only changed fields become lines. Values that break the template (over the maximum, not a choice) are refused.

The owner page's stats panel shows the values at any chapter, ready to copy into the text.

## Creatures

On the Stats tab, pick a creature and a template and press **Add**: this makes a stat note for a data store creature in this novel (`Creatures/<Creature> (<Novel>).md`), using a template. Data store creature pages list the novels they have stats in.
