// Scaffold a novel and/or a world in a vault: the novel's folder, sub folders, config.md and Taxonomy/Novels note, and a
// world note. The vault needs a data store schema first: import a dataset (Tools → Import data in the app, e.g. the
// Novel Craft starter data). Never overwrites: anything that already exists is left alone.
//
//   node scripts/scaffold.js <vault folder> [--novel "Name"] [--number 3] [--world "Name"] [--dry-run]
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Vault, DS, SCHEMA_NOTE } from "../lib/vault.js";
import { Novels } from "../lib/novels.js";
import { Blueprints } from "../lib/blueprints.js";
import { DataStore } from "../lib/datastore.js";
import { createNote } from "../lib/write.js";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const flag = (n) => args.includes(`--${n}`);
const target = args.find((a, i) => !a.startsWith("--") && !["--novel", "--number", "--world"].includes(args[i - 1]));
if (!target || flag("help")) {
    console.log(`Usage: node scripts/scaffold.js <vault folder> [--novel "Name"] [--number N] [--world "Name"] [--dry-run]`);
    process.exit(target ? 0 : 2);
}
const ROOT = path.resolve(target.replace(/^~(?=\/)/, process.env.HOME));
const DRY = flag("dry-run");
const done = [];
const say = (what) => { done.push(what); console.log(`${DRY ? "would " : ""}${what}`); };

async function ensureDir(rel) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) return;
    say(`create folder ${rel}/`);
    if (!DRY) await fsp.mkdir(abs, { recursive: true });
}
if (!fs.existsSync(path.join(ROOT, SCHEMA_NOTE))) {
    console.error(`${ROOT} has no ${SCHEMA_NOTE}. Import a dataset first (Tools → Import data in the app).`);
    process.exit(1);
}
// one flat folder per collection, as the schema lists them
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, SCHEMA_NOTE), "utf8").match(/```json\n([\s\S]*?)```/)[1]);
for (const c of Object.keys(schema.collections)) await ensureDir(`${DS}/${c}`);

// the app's own index of the vault, so names stay unique the way Obsidian resolves links
const vault = new Vault(ROOT);
if (fs.existsSync(ROOT)) await vault.load();
const novels = new Novels(vault);
const store = new DataStore(vault, novels, new Blueprints(vault));
const existing = (collection, title) => vault.inFolder(`${DS}/${collection}`).some((n) => [n.name, n.fm.title].some((t) => String(t ?? "").toLowerCase() === title.toLowerCase()));
async function addNote(collection, title, fm) {
    if (existing(collection, title)) return null;
    say(`add ${collection}: ${title}`);
    if (DRY) return `${DS}/${collection}/${title}.md`;
    return store.create(collection, title, fm);
}

// a novel: "<N>. <Name>" with its folders and config, plus its Taxonomy/Novels note
const novelName = opt("novel");
if (novelName) {
    const used = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).map((d) => /^(\d+)\.\s/.exec(d)?.[1]).filter(Boolean).map(Number) : [];
    const existingFolder = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).find((d) => d.replace(/^\d+\.\s+/, "").toLowerCase() === novelName.toLowerCase()) : null;
    let number = Number(opt("number")) || 1;
    if (!opt("number")) while (used.includes(number)) number++;
    if (number >= 20) { console.error("Novel numbers must be below 20 (folders 80. and 90. are the data store and templates)"); process.exit(2); }
    const folder = existingFolder ?? `${number}. ${novelName}`;
    for (const d of ["Chapters", "Characters", "Ledgers", "Creatures", "Plots", "Plan/Book Plan", "Plan/Chapter Plans"]) await ensureDir(`${folder}/${d}`);
    if (!fs.existsSync(path.join(ROOT, folder, "config.md"))) {
        say(`add ${folder}/config.md`);
        if (!DRY) await createNote(vault, `${folder}/config.md`, { type: "config", blueprints: false, "contains-system": false },
            "Settings for this novel (Novel Craft and Templater read the frontmatter).\n");
    }
    await addNote("Taxonomy/Novels", novelName, { type: "novel", facet: "Novels", folder });
}

// a world
const worldName = opt("world");
if (worldName) await addNote("Worlds", worldName, novelName ? { novels: [`[[${novelName}]]`] } : {});

console.log(done.length ? `\n${DRY ? "Dry run: " : ""}${done.length} change${done.length === 1 ? "" : "s"} in ${ROOT}` : `\nNothing to do: ${ROOT} already has everything.`);
