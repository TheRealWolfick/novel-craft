# Novel Craft

**A companion app for novelists who write in [Obsidian](https://obsidian.md).** Write chapters beside their plan, keep a shared encyclopedia of your worlds (items, creatures, factions, places…), track what every character carries and knows chapter by chapter, and draw the maps, all in the same vault you already use.

Everything stays in your vault as ordinary markdown notes. There is no database and no account: Novel Craft reads your notes, notices when you change them in Obsidian, and writes back in the same shape Obsidian, Dataview, Bases and Templater expect.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/writer.dark.png"><img alt="The chapter writer beside the chapter's plan" src="docs/img/writer.png"></picture>

## What you can do with it

### Write chapters next to their plan

The writer opens a chapter on the left while its plan and ledger entries stay on the right. Paragraphs show formatted (bold, italic, callouts, scene breaks) until you click them, find highlights every match, and saving changes only what you edited.

| Light | Dark |
| --- | --- |
| ![Writer, light](docs/img/writer.png) | ![Writer, dark](docs/img/writer.dark.png) |

### Plan books, volumes and chapters

A grand plan per novel: volumes with their main plot and subplots, every chapter's outline, plot ideas graded on a board, and a scratchpad for loose ideas.

| Grand plan | Plot board |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/novel-plan.dark.png"><img alt="Grand plan" src="docs/img/novel-plan.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/novel-plots.dark.png"><img alt="Plots" src="docs/img/novel-plots.png"></picture> |

### Track characters through the story

Ledgers record what a character gains, loses and learns in each chapter: inventory, journal, stats and relationships. Look at anyone at any chapter, and copy entries into the text as callouts styled the way you design them.

| A character's ledgers | Writing an entry |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/owner.dark.png"><img alt="Owner page" src="docs/img/owner.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/entry-editor.dark.png"><img alt="Entry editor" src="docs/img/entry-editor.png"></picture> |

### Keep your world's encyclopedia

Every collection (items, materials, recipes, creatures, races, factions, locations…) as filterable tables, with notes you edit in place, blocks of information you can add and reorder, and crafting blueprints with their bill of materials.

| Collections | A note in the side drawer |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/collection-items.dark.png"><img alt="Items" src="docs/img/collection-items.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/drawer-note.dark.png"><img alt="Side drawer" src="docs/img/drawer-note.png"></picture> |

### Look anything up without losing your place

The side drawer keeps a note, a lookup across everything (notes, taxonomy, chapter text), the whole data store and the novel you're in one click away while you write.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/drawer-lookup.dark.png"><img alt="Lookup in the side drawer" src="docs/img/drawer-lookup.png"></picture>

### Build worlds and draw their maps

Each world's places as an outline you rearrange by dragging, and a map for any of them: fantasy region maps or square-grid floor plans with rooms, walls, doors, textures and hundreds of stamps. Maps are saved as images Obsidian shows.

| A floor plan | A region map |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/map-floor.dark.png"><img alt="Floor plan" src="docs/img/map-floor.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/map-region.dark.png"><img alt="Region map" src="docs/img/map-region.png"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/world-outline.dark.png"><img alt="World outline" src="docs/img/world-outline.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/world-atlas.dark.png"><img alt="Atlas" src="docs/img/world-atlas.png"></picture> |

### Share worlds and datasets

Export a world (its places, maps, stamps and textures, and optionally the notes they link to) as a git repository or a zip. Anyone can import it, or any other dataset, from a GitHub link: files you already have are skipped, differences are yours to decide, and later imports bring only what changed.

| Exporting a world | Importing a dataset |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/world-export.dark.png"><img alt="Export" src="docs/img/world-export.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/import-check.dark.png"><img alt="Import" src="docs/img/import-check.png"></picture> |

### Make it yours

Design how each kind of callout looks, pick the app's colour, fonts and text sizes, and read the built-in docs (Tools → Docs) whenever you need them.

| Callout designer | Settings |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/callout-designer.dark.png"><img alt="Callout designer" src="docs/img/callout-designer.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/settings.dark.png"><img alt="Settings" src="docs/img/settings.png"></picture> |

## Install

Novel Craft runs on your own computer; nothing is sent anywhere. You need **[Node.js](https://nodejs.org) 20 or newer** and **[git](https://git-scm.com)**. It is developed and tested on Linux; macOS and Windows should work with the browser or `npx electron` options below.

### 1. Get it

```sh
git clone https://github.com/TheRealWolfick/novel-craft.git
cd novel-craft
npm install
```

### 2. Start it

Pick one:

- **As a desktop app (Arch Linux).** Builds a local package that uses your system's Electron and adds Novel Craft to your app launcher:
  ```sh
  sudo pacman -S electron43        # once, if you don't have it
  sh packaging/arch/build.sh       # builds and installs; run it again after updating
  world-builder
  ```
- **As a desktop app (any system).** Runs the checkout with Electron (downloaded the first time):
  ```sh
  npx electron .
  ```
  On Linux with a system Electron installed, `npm run app` does the same without the download.
- **In your browser.** Start the server and open <http://127.0.0.1:4321>:
  ```sh
  npm start
  ```
  To keep it running in the background on Linux, install it as a systemd user service: `sh scripts/install-service.sh --vault ~/path/to/vault`.

### 3. First steps

1. **Choose your vault.** On first start the app shows its Settings page: type the path of your Obsidian vault or browse to it (folders Obsidian has opened are marked "vault").
2. **Import the starter data.** Open **Tools → Import data** and press **Use the Novel Craft starter data**, then **Check** and **Import**. This adds the data store schema, ledger types and a basic taxonomy ([novel-craft-data](https://github.com/TheRealWolfick/novel-craft-data)). Nothing you already have is overwritten without asking.
3. **Add a novel** (a folder named like `1. My Novel` with a `config.md`), with Templater's novel script if you use it, or:
   ```sh
   npm run scaffold -- ~/path/to/vault --novel "My Novel" --world "My World"
   ```
4. **Open Tools → Docs** for guides to every part of the app.

### Just looking?

Make a demo vault with two invented novels (the one in the screenshots) and open it on the Settings page:

```sh
npm run demo -- ~/World-Builder-Demo
```

### Updating

```sh
git pull && npm install
```

Then restart the app (or rerun `sh packaging/arch/build.sh` for the Arch package, or `systemctl --user restart books-meta-viewer` for the service).

## How it fits with Obsidian

Keep using Obsidian for writing notes freely; open Novel Craft when you want structure: a chapter beside its plan, a character's inventory at chapter 12, a table of every rare item, a map. Both edit the same files, and each notices the other's changes straight away. If you use Obsidian Bases, Dataview or Templater, the app keeps to their conventions (flat collection folders, links for categories, frontmatter fields), so your bases and scripts keep working.

## Vault structure

```
<vault>/
├── 1. My First Novel/              a novel: "<number>. <Name>", number below 20
│   ├── config.md                   novel settings (frontmatter)
│   ├── Chapters/                   "001 - Title.md"; number from frontmatter `chapter` or the file name (048.5 works)
│   ├── Characters/                 character sheets, one note per character
│   ├── Ledgers/                    "<Owner> - <Ledger type>.md" (made by the app)
│   ├── Creatures/                  per-novel creature stat notes (optional)
│   ├── Plots/                      plot ideas
│   └── Plan/
│       ├── Book Plan/              volumes
│       └── Chapter Plans/          "Plan 014 (<Novel>).md"
├── 80. Global Data Store/          shared worldbuilding data, used by every novel
│   ├── Items/ Materials/ Recipes/ Abilities/ Races/ Creatures/
│   ├── Power Systems/ Power Levels/ Worlds/ Locations/ Factions/
│   ├── Taxonomy/<Facet>/           category values: Rarity, Genres, Location Scales, Item Categories…
│   └── _Attachments/               images, Maps/ (map SVGs), Map Stamps/ (your own stamp images)
└── 90. Templater/
    ├── Data Store Schema.md        the fields of every collection (JSON block): the single source of truth
    ├── Ledger Types.md             ledger types and their callout templates (frontmatter)
    └── Map Textures.md             your own map floor textures (made by the app)
```

The rules the app relies on:

- **Collections are flat folders.** Sub-categories are fields, never subfolders (Obsidian Bases select rows by folder).
- **Categories are links to taxonomy notes**, e.g. `rarity: "[[rare]]"`, `genre: ["[[Steampunk]]"]`. A new category is a new note in `Taxonomy/<Facet>/`. Taxonomy notes can have `parent` (hierarchy) and `ordered: true` + `class` (ranked lists such as Rarity or Location Scales).
- **Note names are unique across the vault**, ignoring case, because Obsidian resolves `[[links]]` by name. Clashes get a label: `Good (Rating)`, `Good (Item Condition)`. The display name lives in `title`.
- **Locations** form a hierarchy through `parent` and belong to a world through `world`; their scale is a link to `Taxonomy/Location Scales`.
- **Field order and defaults** come from `Data Store Schema.md`; edit it to add fields or collections.

`config.md` of a novel holds its settings in frontmatter, for example:

```yaml
type: config
blueprints: true              # the novel uses crafting blueprints
draft-chapter-from: 900       # chapters from this number on are drafts
accent: "#b03a5b"             # the novel's colour in the app
ledger-types:                 # add ledger types or override callout templates for this novel
  Journal:
    default-callout: maven
stat-templates: {}            # stat templates (made on the novel's Stats tab)
```

Folder names inside a novel can be changed with `characters-folder`, `chapters-folder`, `ledgers-folder`, `volumes-folder`, `chapter-plans-folder`, `plots-folder` and `creatures-folder`.

## Development

```sh
npm test                 # runs against a throwaway copy of a vault; the real one is never written
npm run screenshots      # retakes docs/img from the demo vault (scripts/demo-vault.js), never a real vault
```

The code has no build step: `server.js` (node:http) with modules in `lib/`, and a Preact + htm front end in `public/` served as-is; `electron/` wraps it as a desktop app. The in-app docs are markdown in `docs/`. `CLAUDE.md` describes the conventions, the API and the internals in detail. `node scripts/build-stamps.js` regenerates the stamp library in `public/stamps/`.

## Licence

The code is released under the [MIT License](LICENSE). The bundled map stamps keep their own licences, listed below.

The AI assistant uses your own account: your own Claude Code with your own plan, your own Anthropic or OpenAI API key, or a model on your own computer (Ollama, llama.cpp). Novel Craft never handles your Claude sign-in and doesn't route anyone's use through another account. [`AI-INTEGRATION.md`](AI-INTEGRATION.md) explains how this fits Anthropic's terms, and the rules contributors keep.

## Credits

The map stamps come from [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) (MIT), [Kenney](https://kenney.nl) (CC0), and [game-icons.net](https://game-icons.net) (CC BY 3.0; credit them if you publish maps that use those icons); the steampunk, plant and pipework stamps are drawn by `scripts/build-stamps.js`. Details in [`public/stamps/CREDITS.md`](public/stamps/CREDITS.md). The heading font Newsreader is under the SIL Open Font License.
