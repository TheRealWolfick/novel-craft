---
title: Designing callouts
group: Writing
kind: guide
order: 4
blurb: How each kind of callout looks in the writer, notes and previews, in light
  and dark.
---
Callouts are the boxed blocks Obsidian writes as `> [!type] Title`. The callout designer sets how each type looks inside World Builder: in the writer, in notes and in previews.

Open [Callout designer](app:#/callout-design) (sidebar → Tools).

![The callout designer with the Journal style](img/callout-designer.png)

## Styles

The list on the left holds one style per callout type. It starts with system, sysnotify, inventory, item, blueprint, journal and pencil, plus **Any other callout** and **Plain quote**.

- **+ New type** makes a style for another type, starting from the one selected.
- Settings are grouped into **Box**, **Title**, **Text** and **Effects** (grid pattern, ruled lines, a big quote mark, paper shading).
- **Light** / **Dark** at the top switches which colours you edit; a colour left as it is in dark mode uses the light one.
- **Advanced CSS** takes extra rules for effects the settings don't cover. `&` stands for the callout.

The preview shows the callout between two chapter paragraphs, in both modes at once. Edit the sample text to try your own content.

**Save styles** writes them to `90. Templater/Callout Styles.md`, only what differs from the defaults.

> [!note] Obsidian keeps using your vault's theme and CSS snippets; these styles apply inside World Builder.
