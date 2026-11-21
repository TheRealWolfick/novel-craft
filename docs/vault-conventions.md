---
title: Vault conventions reference
group: Data store
kind: reference
order: 4
blurb: 'Folders, unique names, taxonomy links and the schema: the rules the app relies
  on.'
---
## Folders

| Folder | Holds |
| --- | --- |
| `1. <Novel>/` … `19. <Novel>/` | A novel: `config.md`, `Chapters/`, `Characters/`, `Ledgers/`, `Plan/`, `Plots/` |
| `80. Global Data Store/<Collection>/` | Shared notes, one flat folder per collection |
| `80. Global Data Store/Taxonomy/<Facet>/` | Category values |
| `80. Global Data Store/_Attachments/` | Images, `Maps/`, `Map Stamps/`, `Map Blueprints/` |
| `90. Templater/` | The schema, ledger types, map textures, callout styles, import record |

## Rules

- **Collections are flat.** Sub-categories are fields, never sub-folders (Obsidian Bases select rows by folder).
- **Categories are links to taxonomy notes**: `rarity: "[[rare]]"`, `genre: ["[[Steampunk]]"]`. A new category is a new note in `Taxonomy/<Facet>/`. Taxonomy notes can have a `parent`, and ranked facets (Rarity, Location Scales…) have `ordered: true` and a `class`. A new taxonomy (facet) is an entry in the schema plus its folder: **+ New taxonomy** in the sidebar makes both ([Taxonomies](docs:collections#taxonomies)).
- **Note names are unique across the vault**, ignoring case, because Obsidian links by name. A clash gets a label: `Good (Rating)`, `Good (Item Condition)`. The display name is the `title` field.
- **Locations** form a tree through `parent` and belong to a world through `world`; their `scale` links to `Taxonomy/Location Scales`.
- **Field order and defaults** come from `90. Templater/Data Store Schema.md`. Edit it to add fields or collections.

## A novel's config.md

| Field | Meaning |
| --- | --- |
| `accent` | The novel's colour in the app |
| `draft-chapter-from` | Chapters from this number on are drafts (default 900) |
| `scene-break` | The writer's default scene break image |
| `ledger-types` | Extra ledger types or callout templates for this novel |
| `stat-templates` | Stat templates (made on the Stats tab) |
| `characters-folder`, `chapters-folder`, `ledgers-folder`, `volumes-folder`, `chapter-plans-folder`, `plots-folder`, `creatures-folder`, `scratchpad` | Other folder or note names |
