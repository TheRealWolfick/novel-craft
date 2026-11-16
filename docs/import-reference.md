---
title: Import data reference
group: Getting started
kind: reference
order: 4
blurb: Sources, dataset layout, every comparison status and what each choice writes.
---
## Sources

| Source | What is read |
| --- | --- |
| `https://github.com/owner/repo` | The default branch, downloaded as one archive. Public repositories need no account. |
| `…/tree/branch/folder` | A branch or tag, and optionally one folder inside it. |
| `owner/repo` | Short for the GitHub URL. |
| `~/datasets/mine` | A folder on this computer, read in place. |

## Dataset layout

```
world-builder.json     {"name", "description", "root"}   (optional)
vault/                 files at their vault paths
  90. Templater/Data Store Schema.md
  80. Global Data Store/Taxonomy/Rarity/common.md
```

- `root` names the folder that holds the vault files. Without it, `vault/` is used when the repository has one, else the repository itself minus README, LICENSE and dot files.
- Paths with `..`, dot folders (`.obsidian`, `.git`, `.trash`) and anything outside the vault are never written.

## How files are compared

| Status | Meaning | Default |
| --- | --- | --- |
| New | Not in your vault. | Written |
| Identical | Byte for byte the same, or a note with the same fields and text. Created dates and blank fields (`key:`, `key: ""`, `key: []`) are ignored. | Skipped, not asked |
| Updated in the dataset | Imported before, unchanged by you since, changed in the dataset. | Written (untick to keep) |
| Changed by you | Imported before, changed by you, unchanged in the dataset. | Kept, not asked |
| To decide | Changed on both sides, or not imported before and different. | You choose |
| Deleted since the last import | Imported before, deleted from your vault since. | You choose: Restore or Skip |
| Name already used | A new note whose name another note in the vault has. | Use mine |

## Links and name clashes

- Before importing, the check lists links in the incoming notes that point to nothing in the dataset or your vault. They import unchanged and show as unresolved links.
- **Import renamed** writes the note as `Name (Folder)`, the vault's usual way to keep names unique, and rewrites `[[Name]]` links in every imported note to `[[Name (Folder)|Name]]`, so the text still reads the same.
- **Use mine** imports nothing for that note; the dataset's links to it resolve to your note.

## The import record

`90. Templater/Imports.md` holds, per dataset, the vault path and content hash of each file as imported and the choice made for each name clash. It is what lets a later import tell an update from your own edit. Renaming an imported note in the app updates it. Deleting the record makes the next import treat every file as if it had never been imported.

## What gets written

After the import every collection in the schema gets its folder, since repositories keep no empty folders.
