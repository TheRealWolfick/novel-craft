// A demo vault for screenshots and trying the app: the starter data plus two invented novels (Ashfall Road, The Glass
// Orchard) with characters, chapters, plans, plots, ledgers, a scratchpad, two worlds with locations and maps.
// Everything in it is made up; it never touches another vault.
//
//   node scripts/demo-vault.js <new folder> [--data <starter dataset: GitHub URL or folder>]
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Vault } from "../lib/vault.js";
import { Novels } from "../lib/novels.js";
import { Blueprints } from "../lib/blueprints.js";
import { DataStore } from "../lib/datastore.js";
import { Worlds } from "../lib/worlds.js";
import { Assets } from "../lib/assets.js";
import { Importer } from "../lib/importer.js";
import { fmBlock } from "../lib/write.js";
import { newMap, CELL } from "../public/map-core.js";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--data");
if (!target) { console.log("Usage: node scripts/demo-vault.js <new folder> [--data <starter dataset>]"); process.exit(2); }
const ROOT = path.resolve(target.replace(/^~(?=\/)/, process.env.HOME));
if (fs.existsSync(ROOT) && fs.readdirSync(ROOT).filter((f) => f !== ".obsidian").length) { console.error(`${ROOT} is not empty`); process.exit(1); }
const DATA = opt("data") ?? (fs.existsSync(path.join(process.env.HOME, "Projects/world-builder-data")) ? path.join(process.env.HOME, "Projects/world-builder-data") : "https://github.com/TheRealWolfick/world-builder-data");

await fsp.mkdir(path.join(ROOT, ".obsidian"), { recursive: true });
const DS = "80. Global Data Store";
const L = (n) => `[[${n}]]`;
const files = [];
async function note(rel, fm, body = "") {
    const abs = path.join(ROOT, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, fmBlock(fm) + body);
    files.push(rel);
}

// ---------------------------------------------------------------- starter data
let vault = new Vault(ROOT);
await vault.load();
{
    const novels = new Novels(vault), store = new DataStore(vault, novels, new Blueprints(vault)), worlds = new Worlds(vault, store);
    const assets = new Assets(vault, worlds);
    worlds.assets = assets;
    const imp = new Importer(vault, store, worlds, assets);
    const c = await imp.check(DATA);
    const a = await imp.apply(c.id);
    console.log(`starter data: ${a.added} files`);
}

// ---------------------------------------------------------------- shared data: races, worlds, factions, items
await fsp.mkdir(path.join(ROOT, "99. Resources"), { recursive: true });
await fsp.writeFile(path.join(ROOT, "99. Resources", "pb-ember-line.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="14" viewBox="0 0 420 14"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#b5482f" stop-opacity="0"/><stop offset=".5" stop-color="#b5482f"/><stop offset="1" stop-color="#b5482f" stop-opacity="0"/></linearGradient></defs><rect y="6" width="420" height="2" fill="url(#g)"/><circle cx="210" cy="7" r="4" fill="#b5482f"/></svg>\n`);

for (const [n, d] of [["Human", "The most common people of the Reach, scattered along the caravan roads."], ["Ashborn", "People born under the ash cloud, grey-eyed and said to sense coming storms."]])
    await note(`${DS}/Races/${n}.md`, { title: n, type: "race", description: d, novels: [L("Ashfall Road")] });

await note(`${DS}/Worlds/The Cinder Reach.md`, {
    title: "The Cinder Reach", type: "world", status: "draft", genre: [L("Post-Apocalyptic"), L("Steampunk")], races: [L("Human"), L("Ashborn")], novels: [L("Ashfall Road")],
    description: "A continent of ash plains a century after the Burning. Caravans and lantern-lit waystations keep the old roads alive.",
}, "## Calendar\n1. Thaw (the grey months)\n2. Kindling\n3. High Ash\n4. Long Dark\n\nThe year begins when the first rain falls clean.\n\n## Currency\n- **Wick**: a lantern-guild token, one night's lamp oil\n- **Plate**: ten wicks, stamped brass\n");
await note(`${DS}/Worlds/Vessmoor.md`, {
    title: "Vessmoor", type: "world", status: "stub", genre: [L("Urban Fantasy")], races: [L("Human")], novels: [L("The Glass Orchard")],
    description: "A fog-bound harbour city where the old orchards were roofed in glass and never let go of their summers.",
});

const loc = (title, fm) => note(`${DS}/Locations/${title}.md`, { title, type: "location", world: L(fm.world ?? "The Cinder Reach"), status: "draft", ...fm, world: L(fm.world ?? "The Cinder Reach") });
await loc("The Cinder Reach (Realm)", { scale: L("realm"), description: "Everything the ash cloud covers." });
await loc("Ashen Expanse", { parent: L("The Cinder Reach (Realm)"), scale: L("continent"), cat: [L("wilderness")], description: "Grey plains crossed by the old rail and the caravan roads." });
await loc("Kettle Flats", { parent: L("Ashen Expanse"), scale: L("region"), cat: [L("tundra")], description: "Flat, cold and windy; steam vents warm the hollows." });
await loc("Lantern Cross", { parent: L("Kettle Flats"), scale: L("town"), cat: [L("market")], "controlled-by": [L("Lantern Guild")], description: "Where four roads meet and the guild keeps its great lamp lit." });
await loc("Pell's Crossing", { parent: L("Kettle Flats"), scale: L("village"), description: "A bridge village over a dry riverbed." });
await loc("Waystation Nine", { parent: L("Lantern Cross"), scale: L("building"), cat: [L("guild hall")], "controlled-by": [L("Lantern Guild")], description: "A stone waystation on the north road: beds, a forge and a lamp that never goes out." });
await loc("Waystation Nine Ground Floor", { parent: L("Waystation Nine"), scale: L("floor") });
for (const r of ["Common Room", "Workshop", "Bunk Room"]) await loc(r, { parent: L("Waystation Nine Ground Floor"), scale: L("room") });
await loc("Glass Coast", { parent: L("Ashen Expanse"), scale: L("region"), description: "The shore where the sand fused to glass during the Burning." });
await loc("Sunken Halvard", { parent: L("Glass Coast"), scale: L("city"), cat: [L("ruins")], "controlled-by": [L("Rustwater Syndicate")], description: "A half-drowned city the Syndicate salvages for parts." });
await loc("Vessmoor Harbour", { world: "Vessmoor", scale: L("city"), cat: [L("harbour")], description: "The fog city itself." });
await loc("The Glass Orchard (Place)", { world: "Vessmoor", parent: L("Vessmoor Harbour"), scale: L("estate"), cat: [L("farm")], description: "An orchard under glass on the hill above the harbour." });

await note(`${DS}/Factions/Lantern Guild.md`, { title: "Lantern Guild", type: "faction", world: L("The Cinder Reach"), cat: [L("guild")], seat: L("Lantern Cross"), territory: [L("Kettle Flats")], description: "Keepers of the waystations and the roads between them." });
await note(`${DS}/Factions/Rustwater Syndicate.md`, { title: "Rustwater Syndicate", type: "faction", world: L("The Cinder Reach"), cat: [L("megacorp")], seat: L("Sunken Halvard"), description: "Salvagers who sell the old world back to the new one." });

const item = (title, fm) => note(`${DS}/Items/${title}.md`, { title, type: "item", novels: [L("Ashfall Road")], genre: [L("Post-Apocalyptic")], ...fm });
await item("Signal Lantern", { cat: [L("tool")], rarity: L("rare"), description: "A guild lantern whose shutter can flash the road codes.", recipe: L("Signal Lantern (Blueprint)") });
await item("Brass Compass", { cat: [L("tool")], rarity: L("uncommon"), description: "Points true even under the ash cloud, mostly." });
await item("Ration Tin", { cat: [L("food")], rarity: L("common"), description: "Pressed oats and salt pork. Lasts longer than its owner." });
await item("Ash Mask", { cat: [L("clothing")], rarity: L("common"), description: "Charcoal-lined cloth mask for storm days." });
await item("Courier's Satchel", { cat: [L("container")], rarity: L("common"), description: "Waxed canvas, guild stitching, a hidden pocket." });
for (const [m, cat, d] of [["brass", "metals", "Salvaged and recast in the guild forges."], ["lamp glass", "minerals", "Clear glass from the Glass Coast."], ["tallow", "fuels", "Rendered fat for lamps and candles."]])
    await note(`${DS}/Materials/${m}.md`, { title: m, type: "material", cat: [L(cat)], description: d });
await note(`${DS}/Recipes/Signal Lantern (Blueprint).md`, { title: "Signal Lantern (Blueprint)", type: "recipe", item: L("Signal Lantern"), materials: [L("brass"), L("lamp glass"), L("tallow")], components: [], tier: 2, description: "The guild pattern lantern." },
    "## Materials Required\nmaterial:: [[brass]]\nquantity:: 200\nunit:: g\n\nmaterial:: [[lamp glass]]\nquantity:: 1\nunit:: ea\n\nmaterial:: [[tallow]]\nquantity:: 50\nunit:: g\n\n## Assembly\nSolder the housing, seat the glass, fit the shutter last.\n");

// ---------------------------------------------------------------- novels
const AR = "1. Ashfall Road", GO = "2. The Glass Orchard";
await note(`${DS}/Taxonomy/Novels/Ashfall Road.md`, { title: "Ashfall Road", type: "novel", facet: "Novels", folder: AR });
await note(`${DS}/Taxonomy/Novels/The Glass Orchard.md`, { title: "The Glass Orchard", type: "novel", facet: "Novels", folder: GO });
await note(`${AR}/config.md`, { type: "config", blueprints: true, "contains-system": false, accent: "#b5482f" }, "Settings for this novel.\n");
await note(`${GO}/config.md`, { type: "config", blueprints: false, "contains-system": false, accent: "#2e7f86" }, "Settings for this novel.\n");

const char = (novel, name, fm, body) => note(`${novel}/Characters/${name}.md`, { name, title: name, type: "character", novel: novel.replace(/^\d+\.\s/, ""), ...fm }, body);
await char(AR, "Mara Venn", { race: L("Ashborn"), role: "Courier", age: 24, personality: "Stubborn, dry, keeps her promises and her debts.", appearance: "Grey eyes, ash-scarred hands, a guild satchel she never takes off.", "relations/ally": [L("Tobin Hale")] },
    "## Bio\n\n### Background\nBorn at Waystation Nine during a storm year. Owes the Lantern Guild for her mother's passage.\n\n## Relationships\n");
await char(AR, "Tobin Hale", { race: L("Human"), role: "Mechanic", age: 31, personality: "Cheerful, careless with money, careful with engines.", appearance: "Oil to the elbows, a brass leg brace." }, "## Bio\n");
await char(AR, "Sister Ilse", { race: L("Human"), role: "Waystation keeper", age: 58, personality: "Patient until she isn't." }, "## Bio\n");
await char(GO, "Elodie Marsh", { race: L("Human"), role: "Apprentice glazier", age: 19, personality: "Curious, sleepless, writes everything down." }, "## Bio\n");
await char(GO, "Professor Augustin Quill", { race: L("Human"), role: "Botanist", age: 66, personality: "Courteous, secretive, allergic to fog." }, "## Bio\n");

const chapter = (novel, n, title, body) => note(`${novel}/Chapters/${String(n).padStart(3, "0")} - ${title}.md`, {
    type: "chapter", novel: novel.replace(/^\d+\.\s/, ""), arc: "The Long Haul", chapter: n, "chapter title": title, "created date": "2026-11-01 09-00", cssclasses: ["chapter"], "characters-mentioned": [],
}, body);
await chapter(AR, 1, "The Lamp at Nine", `The lamp at Waystation Nine had burned for ninety years, and Mara Venn had hated it for twenty-four of them.

It hung above the north door in its iron cage, throwing a hard yellow light across the yard, across the steam wagons and the sleeping mules, across the ash that never stopped falling. *Keep the lamp lit and the road stays open.* Sister Ilse said it every night, the way other people said grace.

"You're leaving before the bell," Ilse said from the doorway. It was not a question.

"The Syndicate wants the parcel in Halvard by Kindling." Mara pulled the strap of her satchel tight. "If I wait for the bell, I wait for the storm."

![[pb-ember-line.svg]]

Tobin found her at the gate with the wagon half loaded and his hands black to the wrist.

"You'll want the brass compass," he said, holding it out like a peace offering. "The old one lies once you're past the Flats."

"Everything lies past the Flats," said Mara, but she took it.
`);
await chapter(AR, 2, "Kettle Flats", `By noon the wind had teeth. The road ran straight as a ruler across the Flats, and the vents along its edge breathed white steam into the grey.

Mara kept the ash mask over her mouth and counted posts. Every ninth post had a guild mark; every ninth mark meant she was still on the road.

> [!journal] Mara's journal
> Day one. The compass works. Tobin was right, which I will never tell him.
>
> Saw lights to the east where nobody lives.

She did not write the rest: that the lights had moved when she looked at them, and stopped when she looked away.
`);
await chapter(AR, 3, "What the Syndicate Carries", `Pell's Crossing was a bridge, a well and eleven houses, and every one of them had its shutters down.

"Courier," said the man at the well, without looking up. "You're carrying for the Syndicate."

"I'm carrying a parcel."

"Same thing, out here." He nodded at the satchel. "Whatever's in that, it's heavier than it was when you left."

It was. Mara had noticed at the third post and decided not to.
`);
await chapter(AR, 4, "The Silent Towers", ``);
await chapter(GO, 1, "Glass in the Fog", `The orchard had been roofed in glass for a hundred years, and in all that time, Elodie was told, not one pane had cracked.

She found the first broken one on her third morning.
`);

// plans: volumes, chapter plans, plots
await note(`${AR}/Plan/Book Plan/The Long Haul.md`, { type: "volume", title: "The Long Haul", number: 1, plot: L("Mara's Debt"), subplots: [L("The Silent Towers (Plot)"), L("Tobin's Brother")], "chapter-start": 1, "chapter-end": 12, description: "Mara carries a Syndicate parcel from Waystation Nine to Sunken Halvard.", plan: "- Mara leaves Nine\n\n- The parcel changes\n\n- Halvard" });
await note(`${AR}/Plan/Book Plan/Glass and Salt.md`, { type: "volume", title: "Glass and Salt", number: 2, "chapter-start": 13, "chapter-end": 24, description: "The coast, and what the parcel was for." });
const plans = [
    [1, "The Lamp at Nine", "- Mara leaves before the morning bell\n\t- Ilse disapproves, says the lamp line\n\t- Tobin gives her the brass compass\n\n- The road north opens onto the Flats"],
    [2, "Kettle Flats", "- Storm wind, counting guild posts\n\n- Lights to the east\n\t- They move when she looks away\n\n- Journal entry: day one"],
    [3, "What the Syndicate Carries", "- Pell's Crossing, shutters down\n\n- The man at the well knows the Syndicate\n\t- The satchel is heavier than it was"],
    [4, "The Silent Towers", "- Mara reaches the towers at dusk\n\t- No lamps, no keepers\n\n- Something answers her signal lantern"],
    [5, "", "- Tobin catches up on a stolen rail cart\n\n- They argue about opening the parcel"],
    [6, "", "- The Glass Coast\n\n- First sight of Halvard"],
];
for (const [n, title, plan] of plans) await note(`${AR}/Plan/Chapter Plans/Plan ${String(n).padStart(3, "0")} (Ashfall Road).md`, { type: "chapter-plan", chapter: n, title, volume: "1 - The Long Haul", plan });
await note(`${GO}/Plan/Chapter Plans/Plan 001 (The Glass Orchard).md`, { type: "chapter-plan", chapter: 1, title: "Glass in the Fog", plan: "- Elodie arrives at the orchard\n\n- The first broken pane" });
const plot = (novel, title, fm) => note(`${novel}/Plots/${title}.md`, { type: "plot", title: title.replace(/ \(Plot\)$/, ""), ...fm });
await plot(AR, "Mara's Debt", { rating: "[[Excellent (Rating)|Excellent]]", characters: [L("Mara Venn"), L("Sister Ilse")], mood: "dogged", plot: "Mara owes the guild for her mother's passage; the Syndicate job would clear it, if she survives delivering it." });
await plot(AR, "The Silent Towers (Plot)", { rating: "[[Good (Rating)|Good]]", characters: [L("Mara Venn")], mood: "eerie", plot: "The signal towers on the old line have gone dark, but something still answers the codes." });
await plot(AR, "Tobin's Brother", { rating: "Average", characters: [L("Tobin Hale")], mood: "bittersweet", plot: "Tobin's brother works for the Syndicate in Halvard and wants him to stop asking questions." });
await plot(GO, "The First Cracked Pane", { rating: "[[Good (Rating)|Good]]", characters: [L("Elodie Marsh"), L("Professor Augustin Quill")], plot: "A pane that should not break, breaks; the professor is not surprised." });

// ledgers
const ledger = (owner, type, body) => note(`${AR}/Ledgers/${owner} - ${type}.md`, { type: "ledger", "ledger-type": type, owner: L(owner), novel: L("Ashfall Road") }, body);
await ledger("Mara Venn", "Inventory", `# Chapter 1
## 1.1 Packed for the road
id:: demo0000001
- [action:: add] [item:: [[Courier's Satchel]]] [qty:: 1] [condition:: [[Good]]]
- [action:: add] [item:: [[Ash Mask]]] [qty:: 1]
- [action:: add] [item:: [[Ration Tin]]] [qty:: 4]
## 1.2 Tobin's compass
id:: demo0000002
- [action:: add] [item:: [[Brass Compass]]] [qty:: 1] [rarity:: [[uncommon]]]

# Chapter 3
## 3.1 Supplies at Pell's Crossing
id:: demo0000003
- [action:: remove] [item:: [[Ration Tin]]] [qty:: 1]
- [action:: add] [item:: [[Signal Lantern]]] [qty:: 1] [rarity:: [[rare]]]
`);
await ledger("Mara Venn", "Journal", `# Chapter 2
## 2.1 Day one
id:: demo0000004
Saw lights to the east where nobody lives.
`);

// scratchpad
await note(`${AR}/Plan/Scratchpad (Ashfall Road).md`, { type: "scratchpad", novel: "Ashfall Road", title: "Ashfall Road scratchpad" },
    "## The parcel\nIt is getting **heavier** because it is *growing*. Seeds? Something from before the Burning.\n\n## Lamp line\nIlse's \"keep the lamp lit\" should come back in the last chapter, from Mara.\n\n## Names\n- Halvard districts: Brine Steps, the Drowned Exchange\n- A Syndicate fixer called *Copperhand*\n");

// ---------------------------------------------------------------- maps
vault = new Vault(ROOT);
await vault.load();
const novels = new Novels(vault), store = new DataStore(vault, novels, new Blueprints(vault)), worlds = new Worlds(vault, store);
worlds.assets = new Assets(vault, worlds);
const locPath = (t) => `${DS}/Locations/${t}.md`;
const S = (id) => `/stamps/${JSON.parse(fs.readFileSync(new URL("../public/stamps/manifest.json", import.meta.url))).stamps.find((s) => s.id === id).file}`;
let n = 0;
const uid = () => `d${++n}`;
const stamp = (id, x, y, w, h, extra = {}) => ({ id: uid(), type: "stamp", src: S(id), x, y, w, h, ...extra });
{
    // the waystation's ground floor: three rooms with furniture
    const doc = newMap("grid", { cols: 18, rows: 11, terrain: "street" });
    doc.title = "Waystation Nine, ground floor";
    const room = (x, y, w, h, floor, children) => ({ id: uid(), type: "room", x: x * CELL, y: y * CELL, w: w * CELL, h: h * CELL, box: CELL, floor, wall: "wall-stone", grid: true, cells: {}, children });
    const C = CELL;
    doc.layers[0].objects.push(
        room(1, 1, 9, 6, "wood-planks", [stamp("steampunk/table-long", 2 * C, 2 * C, 3 * C, C), stamp("steampunk/chair", 2 * C, 1 * C, C, C), stamp("steampunk/chair", 4 * C, 1 * C, C, C), stamp("steampunk/chair", 3 * C, 3 * C, C, C, { rot: 180 }), stamp("steampunk/rug-kilim", 6 * C, 1 * C, 2 * C, 3 * C), stamp("steampunk/stove", 0, 4 * C, C, C), stamp("steampunk/armchair", 7 * C, 4 * C, C, C)]),
        room(10, 1, 7, 6, "flagstone", [stamp("steampunk/workbench", 1 * C, 0, 2 * C, C), stamp("steampunk/anvil", 4 * C, 2 * C, C, C), stamp("steampunk/crate", 5 * C, 4 * C, C, C), stamp("steampunk/barrel", 6 * C, 4 * C, C, C)]),
        room(1, 7, 16, 3, "wood-planks", [stamp("steampunk/bed-single", 1 * C, 0, C, 2 * C), stamp("steampunk/bed-single", 3 * C, 0, C, 2 * C), stamp("steampunk/bed-single", 5 * C, 0, C, 2 * C), stamp("steampunk/bed-single", 7 * C, 0, C, 2 * C), stamp("steampunk/crate", 12 * C, 1 * C, C, C)]),
        { id: uid(), type: "pin", location: L("Common Room"), x: 5.5 * C, y: 6.4 * C },
        { id: uid(), type: "pin", location: L("Workshop"), x: 13.5 * C, y: 6.4 * C },
        { id: uid(), type: "pin", location: L("Bunk Room"), x: 9 * C, y: 9.5 * C },
    );
    await worlds.saveMap(locPath("Waystation Nine Ground Floor"), doc);
}
{
    // Kettle Flats: relief, the road, the two settlements
    const doc = newMap("freeform", { width: 1600, height: 1000, backdrop: "parchment" });
    const objs = doc.layers[0].objects;
    const mounts = [[120, 150], [230, 110], [330, 170], [190, 250], [440, 130], [1250, 720], [1360, 650], [1440, 740], [1320, 820]];
    mounts.forEach(([x, y], i) => objs.push(stamp(`azgaar/illustrated/mount-${(i % 6) + 1}`, x, y, 150, 115)));
    for (const [x, y] of [[600, 250], [690, 290], [980, 620], [1070, 580], [500, 700], [580, 740], [1100, 250], [1180, 220]]) objs.push(stamp("azgaar/illustrated/hill-2", x, y, 100, 66));
    for (let i = 0; i < 26; i++) objs.push(stamp(`azgaar/illustrated/deadTree-${(i % 2) + 1}`, 260 + (i * 137) % 900, 560 + (i * 71) % 260, 40, 52));
    objs.push({ id: uid(), type: "path", style: "river", pts: [[540, 0], [600, 180], [560, 420], [640, 640], [600, 1000]], smooth: true });
    objs.push({ id: uid(), type: "path", style: "road", pts: [[60, 520], [400, 500], [800, 430], [1200, 460], [1560, 380]], smooth: true });
    objs.push({ id: uid(), type: "path", style: "rail", pts: [[100, 880], [700, 760], [1500, 900]], smooth: true });
    objs.push(stamp("azgaar/burg/caravanserai", 780, 380, 50, 50), stamp("azgaar/burg/camp", 1180, 410, 44, 44));
    objs.push({ id: uid(), type: "text", style: "region", text: "Kettle Flats", x: 800, y: 120 });
    objs.push({ id: uid(), type: "text", style: "label", text: "Lantern Cross", x: 805, y: 460 });
    objs.push({ id: uid(), type: "text", style: "label", text: "Pell's Crossing", x: 1205, y: 490 });
    objs.push({ id: uid(), type: "pin", location: L("Lantern Cross"), x: 805, y: 405 }, { id: uid(), type: "pin", location: L("Pell's Crossing"), x: 1202, y: 432 });
    await worlds.saveMap(locPath("Kettle Flats"), doc);
}
console.log(`demo vault ready: ${ROOT} (${files.length} notes written, plus the starter data and two maps)`);
