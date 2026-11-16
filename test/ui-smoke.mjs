// Loads public/app.js in jsdom against a running server and visits every route, then creates one
// ledger entry through the UI. Run via `npm test`, which points it at a throwaway vault copy.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import { parseOutline } from "../public/outline.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:4398";
const COPY = process.env.VAULT_COPY;
if (!COPY) throw new Error("Run through `npm test` so writes go to a vault copy");

const dom = new JSDOM(`<!doctype html><body><div id="app"></div></body>`, { url: `${BASE}/`, pretendToBeVisual: true });
const w = dom.window;
const errors = [];
for (const k of ["window", "document", "location", "localStorage", "navigator", "history", "HTMLElement", "Node", "Event", "CustomEvent",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "confirm", "prompt"]) {
    Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true });
}
globalThis.addEventListener = w.addEventListener.bind(w);
globalThis.removeEventListener = w.removeEventListener.bind(w);
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(new URL(u, BASE), o);
globalThis.EventSource = class { };
w.console.error = console.error = (...a) => errors.push(a.map(String).join(" "));
process.on("unhandledRejection", (e) => errors.push(`unhandled: ${e?.stack ?? e}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const get = (p) => realFetch(new URL(p, BASE)).then((r) => r.json());

// pick real data to visit
const index = await get("/api/index");
const novelWithLedgers = [];
for (const n of index.novels) { const d = await get(`/api/novel?folder=${enc(n.folder)}`); if (d.ledgers?.length) novelWithLedgers.push(d); }
const novel = novelWithLedgers[0] ?? (await get(`/api/novel?folder=${enc(index.novels[0].folder)}`));
const owner = novel.ledgers[0]?.owner ?? novel.characters[0]?.name;
const firstOf = (c) => index.notes.find((n) => n.collection === c)?.path;
const recipe = firstOf("Recipes");
const itemWithRecipe = index.notes.find((n) => n.collection === "Items" && n.fm.recipe)?.path;

// every module the browser imports must be served (jsdom imports from disk, so a missing STATIC entry would pass)
{
    const mods = new Set(["app.js"]);
    for (const f of fs.readdirSync(new URL("../public/", import.meta.url))) if (f.endsWith(".js")) for (const m of fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8").matchAll(/from "\.\/([\w-]+\.js)"/g)) mods.add(m[1]);
    const missing = [];
    for (const m of mods) if ((await realFetch(new URL(`/${m}`, BASE))).status !== 200) missing.push(m);
    console.log(`${missing.length ? "FAIL" : "ok  "} every browser module is served${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
    if (missing.length) process.exitCode = 1;
}
await import("../public/app.js");
await wait(600);
const routes = [
    "#/", "#/c/Items", `#/c/${enc("Taxonomy/Genres")}`, "#/c/Locations",
    itemWithRecipe && `#/note/${enc(itemWithRecipe)}`, recipe && `#/note/${enc(recipe)}`,
    `#/edit/${enc(firstOf("Items"))}`, "#/new/Items", `#/newchar/${enc(novel.folder)}`,
    `#/novel/${enc(novel.folder)}`, owner && `#/owner/${enc(novel.folder)}/${enc(owner)}`,
    `#/chapter/${enc(novel.folder)}/${novel.latestChapter}`, `#/entry/${enc(novel.folder)}?owner=${enc(owner ?? "")}&type=Inventory`,
    `#/callouts/${enc(novel.folder)}`, "#/qa", "#/callout-design", "#/import", "#/map-assets", "#/docs", "#/docs/import-reference", "#/settings",
].filter(Boolean);

let failed = 0;
for (const r of routes) {
    const before = errors.length;
    w.location.hash = r;
    await wait(900);
    const main = w.document.querySelector("main");
    const text = (main?.textContent ?? "").replace(/\s+/g, " ").trim();
    const err = w.document.querySelector(".error")?.textContent;
    const ok = !err && !/Loading…$/.test(text) && errors.length === before;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${decodeURIComponent(r).slice(0, 100)}${err ? `\n     error: ${err}` : ""}`);
    for (const e of errors.slice(before)) console.log(`     console: ${e.slice(0, 300)}`);
}

// create an entry through the editor
if (owner) {
    const fire = (el, type, init = {}) => el.dispatchEvent(new (type.startsWith("key") ? w.KeyboardEvent : w.Event)(type, { bubbles: true, ...init }));
    const setVal = (el, v) => { el.value = v; fire(el, "input"); };
    w.location.hash = `#/entry/${enc(novel.folder)}?owner=${enc(owner)}&type=Inventory&chapter=999`;
    await wait(1200);
    const doc = w.document;
    setVal([...doc.querySelectorAll("input")].find((x) => (x.getAttribute("placeholder") ?? "").startsWith("Short summary")), "Smoke test entry");
    const item = doc.querySelector(".lines-editor input[placeholder^='Item']");
    fire(item, "focus"); setVal(item, "smoke test widget"); await wait(50); fire(item, "keydown", { key: "Enter" }); await wait(50);
    await wait(700);
    [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click();
    await wait(1200);
    const ledgerFile = `${COPY}/${novel.ledgersFolder}/${owner} - Inventory.md`;
    const saved = fs.existsSync(ledgerFile) && fs.readFileSync(ledgerFile, "utf8").includes("Smoke test entry");
    if (!saved) failed++;
    console.log(`${saved ? "ok  " : "FAIL"} create entry through the editor`);
}
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `\n     ${detail}` : ""}`); };
{
    const doc = w.document;
    w.location.hash = "#/c/Items";
    await wait(900);
    // facets: picking a value greys out (not hides) values with no remaining items
    const countChips = () => doc.querySelectorAll(".facet .chip").length;
    const before = countChips();
    const pick = [...doc.querySelectorAll(".facet .chip")].find((c) => !c.classList.contains("off"));
    pick.click();
    await wait(300);
    check(countChips() === before && doc.querySelectorAll(".facet .chip.off").length > 0, "facet values stay listed and grey out", `${before} -> ${countChips()}`);
    pick.click();
    await wait(300);

    // grouping by a list field puts an item in every matching group
    const catBtn = () => [...doc.querySelectorAll(".groupbar button")].find((b) => b.textContent.trim() === "cat");
    catBtn().click();
    await wait(300);
    const groups = doc.querySelectorAll("section.group");
    const rows = doc.querySelectorAll("section.group tbody tr").length;
    const items = index.notes.filter((n) => n.collection === "Items");
    const expected = items.reduce((s, n) => s + Math.max(1, new Set([n.fm.cat ?? []].flat()).size), 0);
    check(groups.length > 1 && rows === expected, "group by cat splits into tables", `${groups.length} groups, ${rows} rows, expected ${expected}`);

    // columns: drag an edge to resize every table; hold a header to collapse; both persist in localStorage
    const pointer = (el, type, init = {}) => el.dispatchEvent(new (w.PointerEvent ?? w.MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, ...init }));
    const handle = doc.querySelector("section.group th[data-col='cat'] .resizer");
    pointer(handle, "pointerdown", { clientX: 0 }); pointer(handle, "pointermove", { clientX: 210 }); pointer(handle, "pointerup", { clientX: 210 });
    await wait(200);
    const catIdx = [...doc.querySelectorAll("section.group th[data-col]")].findIndex((x) => x.dataset.col === "cat");
    const colWidths = [...doc.querySelectorAll("main table.coltable")].map((tb) => tb.querySelectorAll("col")[catIdx]?.style.width);
    check(colWidths.length > 2 && colWidths.every((x) => x === "210px") && w.localStorage.getItem("colWidths:Items")?.includes("210"),
        "resizing a column applies to all tables and is saved", colWidths.join(","));
    const header = doc.querySelector("section.group th[data-col='cat']");
    pointer(header, "pointerdown"); await wait(600); pointer(header, "pointerup"); header.click();
    await wait(200);
    check(doc.querySelectorAll("section.group th.collapsed[data-col='cat']").length === groups.length && JSON.parse(w.localStorage.getItem("colHidden:Items")).includes("cat"),
        "holding a header collapses the column in every table and is saved");
    doc.querySelector("section.group th[data-col='cat']").click();
    await wait(200);
    check(!doc.querySelector("th.collapsed") && w.localStorage.getItem("colHidden:Items") === "[]", "clicking a collapsed column shows it again");

    catBtn().click();
    await wait(300);
    check(!doc.querySelector("section.group h2"), "clicking the active group button ungroups");

    // link chips in the table open the drawer; nested links go to the front of the recent boxes; the drawer collapses instead of closing
    const chip = doc.querySelector("main table a.chip");
    chip.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    const drawerOpen = () => !!doc.querySelector(".drawer-wrap.open");
    const recent = () => [...doc.querySelectorAll(".drawer-recent button")].map((b) => b.title);
    check(drawerOpen() && w.location.hash === "#/c/Items" && recent().length === 1, "table link opens the drawer");
    check(!!doc.querySelector(".drawer .note-cols .note-side .formgrid") && !doc.querySelector(".drawer .note-main .formgrid"),
        "drawer note shows frontmatter in the right column");
    const first = recent()[0];
    const nested = [...doc.querySelectorAll(".drawer-body a.chip[href^='#/note/']")].find((a) => a.getAttribute("href") !== `#/${first}`);
    if (nested) {
        nested.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(700);
        check(recent().length === 2 && recent()[1] === first && doc.querySelector(".drawer-recent button.on") === doc.querySelector(".drawer-recent button"),
            "nested link opens in front of the previous drawer page", recent().join(" | "));
        doc.querySelectorAll(".drawer-recent button")[1].click();
        await wait(300);
        check(recent().length === 2 && recent()[0] === first, "clicking a recent box moves it to the front", recent().join(" | "));
    }
    doc.querySelector(".drawer-backdrop").click();
    await wait(400);
    check(!drawerOpen() && !!doc.querySelector(".drawer-wrap.collapsed .drawer-tab"), "backdrop click collapses the drawer to a tab");
    doc.querySelector(".drawer-tab").click();
    await wait(300);
    check(drawerOpen() && recent()[0] === first, "clicking the tab reopens the drawer on the same page");
    w.location.hash = "#/qa";
    await wait(500);
    check(!drawerOpen() && recent()[0] === first, "navigating collapses the drawer and keeps its pages");

    // drawer summary leads with the description; ranked taxonomy notes show their facet in class order
    w.location.hash = "#/c/Taxonomy%2FRarity";
    await wait(600);
    doc.querySelector("main table a[href^='#/note/']").dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    const strip = () => [...doc.querySelectorAll(".drawer .class-strip a")];
    check(strip().length === 6 && strip().map((a) => +a.querySelector(".rank").textContent).join() === "1,2,3,4,5,6" && doc.querySelectorAll(".drawer .class-strip a.on").length === 1,
        "ranked taxonomy note shows its classes in order", strip().map((a) => a.textContent).join(" | "));
    const next = strip().find((a) => !a.classList.contains("on"));
    next.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    check(doc.querySelector(".drawer .class-strip a.on")?.textContent === next.textContent && !!doc.querySelector(".drawer .note-main .note-summary"),
        "clicking a class opens it in the drawer with its summary");
    doc.querySelector(".drawer-tabs button[title^='Collapse']").click();
    await wait(300);

    // notes are editable in place with a Save changes button
    const note = index.notes.find((n) => n.collection === "Items");
    w.location.hash = `#/note/${enc(note.path)}`;
    await wait(900);
    const label = [...doc.querySelectorAll(".formgrid label")].find((l) => l.textContent === "description");
    const ta = label?.nextElementSibling;
    const saveBtn = () => [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save changes");
    check(!!saveBtn()?.disabled, "Save changes is disabled until something changes");
    ta.value = "Smoke test description"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
    await wait(100);
    saveBtn().click();
    await wait(1000);
    const text = fs.readFileSync(`${COPY}/${note.path}`, "utf8");
    check(text.includes("Smoke test description") && saveBtn()?.disabled, "editing a note saves only through Save changes");
}
// planning: grand plan, chapters in the drawer with the outline editor, plots by grade
{
    const doc = w.document;
    // the first novel in the vault that has a grand plan
    let planNovel = null, plan = null;
    // (preferably one with graded plots too)
    for (const n of index.novels) {
        const p = await get(`/api/plan?novel=${enc(n.folder)}`);
        if (!p.volumes?.length) continue;
        if (!planNovel || (!plan.plots?.length && p.plots?.length)) { planNovel = n; plan = p; }
        if (p.plots?.length) break;
    }
    if (planNovel) {
        w.location.hash = `#/novel/${enc(planNovel.folder)}`;
        await wait(900);
        const tab = (label) => [...doc.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === label);
        tab("Grand plan").click();
        await wait(300);
        const vols = doc.querySelectorAll("section.volume");
        check(vols.length >= plan.volumes.length && doc.querySelectorAll(".chapter-row").length === plan.chapters.length, "grand plan lists volumes and chapters",
            `${vols.length} volumes, ${doc.querySelectorAll(".chapter-row").length} rows / ${plan.chapters.length}`);

        // a chapter with a planned outline of a few events
        const planned = plan.chapters.find((c) => parseOutline(c.plan ?? "").length > 3);
        if (planned) {
            const row = [...doc.querySelectorAll(".chapter-row")].find((r) => r.querySelector(".badge")?.textContent === String(planned.number));
            row.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
            await wait(900);
            check(new RegExp(`Chapter ${planned.number}\\b`).test(doc.querySelector(".drawer h1")?.textContent ?? "") && doc.querySelectorAll(".drawer .plan-row").length > 3, "chapter opens in the drawer with its plan");
            doc.querySelector(".drawer-tabs button[title^='Collapse']").click();
            await wait(400);
        }

        // plan a new chapter: Enter keeps the level, Tab makes a sub event
        const last = Math.max(...plan.chapters.filter((c) => !c.draft).map((c) => c.number));
        const planLink = [...doc.querySelectorAll("a.button")].find((a) => a.textContent.includes(`Plan chapter ${last + 1}`));
        planLink.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(900);
        const rows = () => [...doc.querySelectorAll(".drawer .plan-row textarea")];
        const type = (el, text) => { el.focus(); el.value = text; el.dispatchEvent(new w.Event("input", { bubbles: true })); el.setSelectionRange(text.length, text.length); };
        const key = (el, k, init = {}) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
        type(rows()[0], "Smoke event"); await wait(50);
        key(rows()[0], "Enter"); await wait(50);
        type(rows()[1], "Smoke sub event"); await wait(50);
        key(rows()[1], "Tab"); await wait(50);
        key(rows()[1], "Enter"); await wait(50);
        type(rows()[2], "Second sub"); await wait(50);
        check(rows().length === 3 && doc.querySelectorAll(".drawer .plan-row.lvl-1").length === 2, "outline editor: Enter keeps the indent, Tab indents");
        [...doc.querySelectorAll(".drawer button")].find((b) => b.textContent.trim() === "Save changes").click();
        await wait(1200);
        const planFile = `${COPY}/${planNovel.folder}/Plan/Chapter Plans/Plan ${String(last + 1).padStart(3, "0")} (${planNovel.name}).md`;
        const saved = fs.existsSync(planFile) ? fs.readFileSync(planFile, "utf8") : "";
        const vol = plan.volumes.find((v) => last + 1 >= v.start && last + 1 <= (v.end ?? Infinity));
        check(saved.includes("- Smoke event\n  \t- Smoke sub event\n  \t- Second sub") && (!vol || saved.includes(`volume: ${vol.label}`)),
            "saving a new chapter plan creates the plan note with its volume", saved.slice(0, 300));
        doc.querySelector(".drawer-tabs button[title^='Collapse']").click();
        await wait(400);

        tab("Plots").click();
        await wait(400);
        const cards = doc.querySelectorAll(".plot-card");
        if (plan.plots.length && plan.ratings.length > 1) {
        check(cards.length === plan.plots.length && doc.querySelectorAll(".plot-grade h2").length >= plan.ratings.length, "plots are listed by grade", `${cards.length} cards`);
        const sel = cards[0].querySelector("select");
        const target = plan.ratings.find((r) => r.path !== sel.value);
        const plotPath = plan.plots.find((p) => cards[0].querySelector(".plot-title").textContent === p.title)?.path;
        sel.value = target.path; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
        await wait(800);
        check(fs.readFileSync(`${COPY}/${plotPath}`, "utf8").includes(`rating: "${target.name === target.title ? `[[${target.name}]]` : `[[${target.name}|${target.title}]]`}"`), "changing a plot's grade saves its rating");
        }
    }
}
// theme: light/dark switch and novel accents
{
    const doc = w.document, root = doc.documentElement;
    const novel0 = index.novels[0];
    w.location.hash = `#/novel/${enc(novel0.folder)}`;
    await wait(900);
    const accent = root.style.getPropertyValue("--novel-accent"), accentDark = root.style.getPropertyValue("--novel-accent-dark");
    check(/^#[0-9a-f]{6}$/i.test(accent) && /^#[0-9a-f]{6}$/i.test(accentDark) && accent !== accentDark, "a novel page sets its light and dark accent", `${accent} ${accentDark}`);
    check(doc.querySelector(".sidebar .novel-link.active .name")?.textContent === novel0.name && doc.querySelectorAll(".sidebar .novel-dot").length === index.novels.length, "sidebar shows novel dots and the active novel");
    const themeBtn = (label) => [...doc.querySelectorAll(".theme-switch button")].find((b) => b.textContent === label);
    themeBtn("Dark").click(); await wait(100);
    const dark = root.dataset.theme === "dark" && w.localStorage.getItem("theme") === '"dark"';
    themeBtn("System").click(); await wait(100);
    check(dark && !root.dataset.theme && w.localStorage.getItem("theme") === '"system"', "theme switch sets dark and back to system");
    const picker = doc.querySelector(".novel-colour input[type=color]");
    picker.value = "#2f6fb0"; picker.dispatchEvent(new w.Event("change", { bubbles: true }));
    await wait(900);
    check(fs.readFileSync(`${COPY}/${novel0.folder}/config.md`, "utf8").includes("accent: \"#2f6fb0\""), "novel colour is saved to config.md");
    w.location.hash = "#/qa";
    await wait(700);
    check(!root.style.getPropertyValue("--novel-accent"), "pages outside a novel use the default accent");
}
// stats: build a template in the editor, assign it, save a Stats entry through the prefilled form
{
    const doc = w.document;
    let statNovel = null, hero = null;
    for (const n of index.novels) { const d = await get(`/api/novel?folder=${enc(n.folder)}`); if (d.characters?.length) { statNovel = n; hero = d.characters[0].name; break; } }
    if (statNovel) {
        const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
        const setVal = (el, v, type = "input") => { el.value = v; fire(el, type); };
        const btn = (label, root = doc) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
        globalThis.prompt = () => "Hero";
        w.location.hash = `#/novel/${enc(statNovel.folder)}`;
        await wait(900);
        [...doc.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "Stats").click();
        await wait(900);
        btn("+ Template").click(); await wait(100);
        btn("+ Field").click(); await wait(50);
        btn("+ Field").click(); await wait(50);
        const rows = () => [...doc.querySelectorAll(".field-row")];
        setVal(rows()[0].querySelector("input[aria-label=Label]"), "Level"); await wait(50);
        setVal(rows()[1].querySelector("input[aria-label=Label]"), "Power"); await wait(50);
        setVal(rows()[1].querySelector("select[aria-label=Type]"), "computed", "change"); await wait(50);
        setVal([...rows()[1].querySelectorAll("input")].find((i) => i.placeholder.startsWith("strength")), "level * 10"); await wait(50);
        rows()[0].querySelector("input[type=checkbox]").click(); await wait(50); // whole numbers
        btn("Save templates").click();
        await wait(1200);
        const cfg = fs.readFileSync(`${COPY}/${statNovel.folder}/config.md`, "utf8");
        check(/stat-templates:\s*\n\s+Hero:/.test(cfg) && cfg.includes("key: stats/level") && cfg.includes("formula: level * 10") && cfg.includes("integer: true"), "template editor saves to config.md", cfg.slice(cfg.indexOf("stat-templates"), cfg.indexOf("stat-templates") + 300));

        // jsdom gets no live updates: reopen the tab to load the saved templates
        w.location.hash = "#/qa"; await wait(500);
        w.location.hash = `#/novel/${enc(statNovel.folder)}`; await wait(1200);
        const heroRow = [...doc.querySelectorAll(".templates-editor ~ div tr, .grid2 tr")].find((tr) => tr.textContent.includes(hero));
        setVal(heroRow.querySelector("select"), "Hero", "change");
        await wait(1000);
        check(fs.readFileSync(`${COPY}/${statNovel.folder}/Characters/${hero}.md`, "utf8").includes("stat-template: Hero"), "assigning a template writes stat-template");

        w.location.hash = `#/entry/${enc(statNovel.folder)}?owner=${enc(hero)}&type=Stats&chapter=20`;
        await wait(1500);
        const levelLabel = [...doc.querySelectorAll(".stat-lines label")].find((l) => l.textContent === "Level");
        const levelInput = levelLabel?.nextElementSibling.querySelector("input");
        check(!!levelInput, "Stats entry shows the template as a form");
        setVal(levelInput, "4"); await wait(800);
        setVal([...doc.querySelectorAll("input")].find((x) => (x.getAttribute("placeholder") ?? "").startsWith("Short summary")), "Level up"); await wait(500);
        btn("Save").click();
        await wait(1500);
        const ledger = fs.readFileSync(`${COPY}/${statNovel.folder}/Ledgers/${hero} - Stats.md`, "utf8");
        check(ledger.includes("[set:: stats/level] [value:: 4]") && !ledger.includes("stats/power"), "only changed stats become ledger lines", ledger.slice(-300));
        w.location.hash = `#/owner/${enc(statNovel.folder)}/${enc(hero)}`;
        await wait(1500);
        const panel = doc.querySelector(".stats-panel")?.textContent ?? "";
        check(/Power\s*40/.test(panel.replace(/\s+/g, " ")) || panel.includes("Power: 40") || /Power.{0,20}40/.test(panel), "owner page shows the stats panel with computed values", panel.slice(0, 200));
    }
}
// world builder: outline add + move, then a square-grid map with floors, stamps, text and layers
{
    const doc = w.document;
    const fireEv = (el, type, init = {}) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    const button = (label, root = doc) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
    const L = "80. Global Data Store/Locations";
    // a made-up world in the vault copy: Smoke Region > Smoke Kingdom > Smoke Town, and Other Kingdom
    const post = (p, body) => realFetch(new URL(p, BASE), { method: "POST", headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const worldPath = (await post("/api/note", { collection: "Worlds", name: "Smoke World", fm: {} })).path;
    const region = (await post("/api/world/location", { world: worldPath, parent: null, name: "Smoke Region", scale: "region" })).path;
    const kingdom = (await post("/api/world/location", { world: worldPath, parent: region, name: "Smoke Kingdom", scale: "nation" })).path;
    await post("/api/world/location", { world: worldPath, parent: region, name: "Other Kingdom", scale: "nation" });
    const town = (await post("/api/world/location", { world: worldPath, parent: kingdom, name: "Smoke Town", scale: "town" })).path;
    const smokeWorld = (await get("/api/worlds")).worlds.find((x) => x.path === worldPath);
    if (smokeWorld && town) {
        w.location.hash = "#/world";
        await wait(1200);
        check(w.location.hash.startsWith("#/world/"), "the world builder opens a world");
        w.location.hash = `#/world/${enc(worldPath)}`;
        await wait(1500);
        const rows = () => [...doc.querySelectorAll(".loc-row[role=treeitem]")];
        check(rows().length === smokeWorld.count && smokeWorld.count === 4, "world builder lists the world's locations", `${rows().length} vs ${smokeWorld.count}`);
        const townRow = rows().find((r) => r.querySelector(".t")?.textContent === "Smoke Town");
        townRow.querySelector("[aria-label='Add a sub-location to Smoke Town']").click();
        await wait(300);
        const input = doc.querySelector(".add-row input");
        input.value = "Smoke Square"; input.dispatchEvent(new w.Event("input", { bubbles: true }));
        await wait(100);
        input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await wait(1200);
        const sq = fs.readFileSync(`${COPY}/${L}/Smoke Square.md`, "utf8");
        check(sq.includes('parent: "[[Smoke Town]]"') && sq.includes('world: "[[Smoke World]]"') && sq.includes('scale: "[[village]]"'), "adding a sub-location writes parent, world and the next scale", sq.slice(0, 300));
        w.location.hash = "#/qa"; await wait(400); w.location.hash = `#/world/${enc(worldPath)}`; await wait(1500);
        rows().find((r) => r.querySelector(".t")?.textContent === "Smoke Square").querySelector("[aria-label='Move Smoke Square']").click();
        await wait(300);
        [...doc.querySelectorAll(".move-list button")].find((b) => b.querySelector("b")?.textContent === "Other Kingdom").click();
        await wait(100);
        button("Move", doc.querySelector(".modal")).click();
        await wait(1200);
        check(fs.readFileSync(`${COPY}/${L}/Smoke Square.md`, "utf8").includes('parent: "[[Other Kingdom]]"'), "Move to… changes the parent");

        // map editor
        w.location.hash = `#/map/${enc(town)}`;
        await wait(1200);
        [...doc.querySelectorAll(".kind-pick button")].find((b) => b.textContent.includes("Square grid")).click();
        await wait(100);
        button("Create map").click();
        await wait(1500);
        const svg = doc.querySelector(".map-svg");
        check(!!svg && doc.querySelectorAll(".tool-rail button").length >= 12, "a new square-grid map opens in the editor");
        const at = (x, y) => ({ clientX: x, clientY: y, button: 0, buttons: 1 });
        doc.querySelector(".tool-rail [aria-label='Paint floor']").click(); await wait(100);
        fireEv(svg, "pointerdown", at(100, 300)); fireEv(svg, "pointermove", at(160, 300)); fireEv(svg, "pointerup", at(160, 300));
        await wait(200);
        button("Stamps").click(); await wait(600);
        const tile = [...doc.querySelectorAll(".stamp-tile")].find((t) => t.title.startsWith("Steam car"));
        tile?.click(); await wait(100);
        fireEv(svg, "pointerdown", at(300, 300)); fireEv(svg, "pointerup", at(300, 300));
        await wait(300);
        doc.querySelector(".tool-rail [aria-label='Text and notes']").click(); await wait(100);
        fireEv(svg, "pointerdown", at(400, 200)); fireEv(svg, "pointerup", at(400, 200));
        await wait(300);
        const ta = doc.querySelector(".inspector textarea");
        ta.value = "Gas leak here"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
        await wait(200);
        // choices open a modal: a click picks, Confirm applies, and the keyboard goes back to the map
        {
            doc.querySelector(".tool-rail [aria-label^='Line']").click(); await wait(100);
            const pick = () => doc.querySelector("button.pick[aria-label^='Line style']");
            const before = pick()?.getAttribute("aria-label");
            pick().click(); await wait(150);
            const modal = doc.querySelector(".pick-modal");
            const other = [...(modal?.querySelectorAll(".pick-opt") ?? [])].find((b) => !b.classList.contains("current"));
            other?.click(); await wait(50);
            button("Confirm", modal).click(); await wait(200);
            check(!!modal && !doc.querySelector(".pick-modal") && pick().getAttribute("aria-label") !== before && pick().textContent.includes(other.textContent.trim()),
                "a line style is chosen in a modal and applied on Confirm", `${before} -> ${pick()?.getAttribute("aria-label")}`);
            await wait(50);
            check(doc.activeElement === doc.querySelector(".map-canvas"), "after choosing, the keyboard is back on the map", doc.activeElement?.outerHTML.slice(0, 80));
            pick().click(); await wait(150);
            const third = [...doc.querySelectorAll(".pick-modal .pick-opt")].find((b) => !b.classList.contains("current"));
            third.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true })); await wait(150);
            check(!doc.querySelector(".pick-modal") && pick().textContent.includes(third.textContent.trim()), "a double click chooses at once");
            pick().click(); await wait(150);
            doc.querySelector(".pick-modal").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(150);
            check(!doc.querySelector(".pick-modal") && pick().textContent.includes(third.textContent.trim()), "Escape closes it without changing anything");
        }
        // erase floor, a room holding a stamp, a curved strip, snapping off
        doc.querySelector(".tool-rail [aria-label='Erase floor']").click(); await wait(100);
        fireEv(svg, "pointerdown", at(100, 300)); fireEv(svg, "pointerup", at(100, 300)); await wait(150);
        [...doc.querySelectorAll(".tool-rail button")].find((b) => b.getAttribute("aria-label") === "Room: floor + walls").click(); await wait(100);
        fireEv(svg, "pointerdown", at(450, 330)); fireEv(svg, "pointermove", at(580, 460)); fireEv(svg, "pointerup", at(580, 460)); await wait(300);
        button("Stamps").click(); await wait(300);
        [...doc.querySelectorAll(".stamp-tile")].find((t) => t.title.startsWith("Crate"))?.click(); await wait(100);
        fireEv(svg, "pointerdown", at(500, 380)); fireEv(svg, "pointerup", at(500, 380)); await wait(300);
        // grow the room with a box, then put a door in its wall
        const toolBtn = (label) => [...doc.querySelectorAll(".tool-rail button")].find((b) => b.getAttribute("aria-label").startsWith(label));
        toolBtn("Add to or cut from a room").click(); await wait(100);
        fireEv(svg, "pointerdown", at(560, 380)); fireEv(svg, "pointermove", at(650, 430)); fireEv(svg, "pointerup", at(650, 430)); await wait(200);
        toolBtn("Opening, door or window").click(); await wait(100);
        fireEv(svg, "pointermove", at(500, 334)); fireEv(svg, "pointerdown", at(500, 334)); fireEv(svg, "pointerup", at(500, 334)); await wait(200);
        // a second room, joined to the first: dragging one moves both
        [...doc.querySelectorAll(".tool-rail button")].find((b) => b.getAttribute("aria-label") === "Room: floor + walls").click(); await wait(100);
        fireEv(svg, "pointerdown", at(250, 560)); fireEv(svg, "pointermove", at(380, 650)); fireEv(svg, "pointerup", at(380, 650)); await wait(300);
        toolBtn("Select").click(); await wait(100);
        // (jsdom has no hit testing: events go straight to each room's own element)
        const roomEls = () => [...doc.querySelectorAll(".layer-active g[data-id]")].filter((g) => g.querySelector(":scope > path[pointer-events='all']") && g.getAttribute("transform"));
        const [r1] = roomEls();
        fireEv(r1, "pointerdown", at(470, 440)); fireEv(svg, "pointerup", at(470, 440)); await wait(100);
        fireEv(roomEls()[1], "pointerdown", { ...at(300, 600), shiftKey: true }); fireEv(svg, "pointerup", { ...at(300, 600), shiftKey: true }); await wait(150);
        w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true })); await wait(200);
        const saveNow = async () => { w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })); await wait(1200); };
        await saveNow();
        const mapFile = `${COPY}/80. Global Data Store/_Attachments/Maps/Smoke Town (Map).svg`;
        const roomsOf = () => JSON.parse(fs.readFileSync(mapFile, "utf8").match(/<!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]).layers[0].objects.filter((o) => o.type === "room");
        const before = roomsOf();
        fireEv(roomEls()[1], "pointerdown", at(300, 600)); fireEv(svg, "pointermove", at(360, 600)); fireEv(svg, "pointerup", at(360, 600)); await wait(200);
        await saveNow();
        const after = roomsOf();
        const moved = after.map((r) => r.x - (before.find((b) => b.id === r.id)?.x ?? NaN));
        check(before.length === 2 && before[0].group && before[0].group === before[1].group && moved.every((m) => m > 0 && Math.abs(m - moved[0]) < 0.01),
            "joined rooms share a group and move together", JSON.stringify(before.map((r) => [r.x, r.group])) + " moved " + JSON.stringify(moved));
        doc.querySelector(".tool-rail [aria-label^='Track or strip']").click(); await wait(100);
        for (const [x, y] of [[100, 120], [200, 150], [300, 120]]) { fireEv(svg, "pointerdown", at(x, y)); fireEv(svg, "pointerup", at(x, y)); await wait(50); }
        w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await wait(200);
        // a derived texture made in the Textures panel, then painted
        button("Textures").click(); await wait(300);
        const planks = [...doc.querySelectorAll(".tex-item")].find((x) => x.querySelector(".tex-name")?.textContent === "Wood planks");
        button("New from this", planks).click(); await wait(200);
        button("Save texture").click(); await wait(1200);
        fireEv(svg, "pointerdown", at(120, 500)); fireEv(svg, "pointerup", at(120, 500)); await wait(200);
        doc.querySelector(".snap-toggle").click(); await wait(100);
        // pipes snap end to end (grid snapping is off now)
        button("Stamps").click(); await wait(300);
        [...doc.querySelectorAll(".stamp-tile")].find((t) => t.title.startsWith("Copper straight"))?.click(); await wait(100);
        fireEv(svg, "pointerdown", at(120, 220)); fireEv(svg, "pointerup", at(120, 220)); await wait(200);
        fireEv(svg, "pointermove", at(143, 223)); fireEv(svg, "pointerdown", at(143, 223)); fireEv(svg, "pointerup", at(143, 223)); await wait(200);
        // a room drawn inside a room goes in it; dragged out it stands on the map, dragged back it goes in again
        {
            await saveNow();
            const objs = () => JSON.parse(fs.readFileSync(mapFile, "utf8").match(/<!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]).layers[0].objects;
            const outer = objs().find((o) => o.type === "room" && o.children?.some((c) => c.src?.includes("crate")));
            const crate = outer.children.find((c) => c.src?.includes("crate"));
            // the inner room goes in the half of the outer room away from the crate
            const left = crate.x + crate.w / 2 > outer.w / 2;
            const [u0, u1] = left ? [0.1, 0.35] : [0.65, 0.9];
            const vb = svg.getAttribute("viewBox").split(" ").map(Number), k = 800 / vb[2];
            const scr = ([x, y]) => at((x - vb[0]) * k, (y - vb[1]) * k);
            const mapPt = (u, q) => [outer.x + outer.w * u, outer.y + outer.h * q];
            toolBtn("Room: floor + walls").click(); await wait(100);
            fireEv(svg, "pointerdown", scr(mapPt(u0, 0.2))); fireEv(svg, "pointermove", scr(mapPt(u1, 0.6))); fireEv(svg, "pointerup", scr(mapPt(u1, 0.6))); await wait(300);
            await saveNow();
            const inner = objs().find((o) => o.id === outer.id)?.children?.find((c) => c.type === "room");
            check(!!inner && !objs().some((o) => o.id === inner.id), "a room drawn inside a room goes in it", JSON.stringify(objs().find((o) => o.id === outer.id)?.children?.map((c) => c.type)));
            toolBtn("Select").click(); await wait(100);
            const drag = async (from, to) => {
                const el = doc.querySelector(`.layer-active g[data-id="${inner.id}"]`);
                fireEv(el, "pointerdown", scr(from)); fireEv(svg, "pointermove", scr(to)); fireEv(svg, "pointerup", scr(to)); await wait(200);
                await saveNow();
            };
            const mid = mapPt((u0 + u1) / 2, 0.4), away = [outer.x - outer.w * 1.5, outer.y + outer.h * 0.4];
            await drag(mid, away);
            check(objs().some((o) => o.id === inner.id) && !objs().find((o) => o.id === outer.id)?.children?.some((c) => c.id === inner.id), "dragged out of its room, a room stands on the map");
            await drag(away, mid);
            check(objs().find((o) => o.id === outer.id)?.children?.some((c) => c.id === inner.id) && !objs().some((o) => o.id === inner.id), "dragged back in, it goes inside the room again");
        }
        button("Layers").click(); await wait(200);
        button("+ Layer above the current one").click(); await wait(200);
        button("Only this layer", doc.querySelector(".layers-panel")).click(); await wait(200);
        button("Save").click();
        await wait(1500);
        const file = `${COPY}/80. Global Data Store/_Attachments/Maps/Smoke Town (Map).svg`;
        const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
        const saved = m ? JSON.parse(m[1]) : null;
        const ground = saved?.layers[0];
        check(!!saved && Object.keys(ground.floor).length >= 1 && ground.objects.some((o) => o.type === "stamp" && o.src.includes("steam-car")) && ground.objects.some((o) => o.text === "Gas leak here")
            && saved.layers.length === 2 && saved.view === "current", "map saves floors, stamps, text and layers into the SVG", JSON.stringify(saved)?.slice(0, 400));
        const texNote = fs.existsSync(`${COPY}/90. Templater/Map Textures.md`) ? fs.readFileSync(`${COPY}/90. Templater/Map Textures.md`, "utf8") : "";
        // (the vault may already have a "Wood planks (aged)", so the new id can carry a number)
        const newTex = Object.entries(saved?.textures ?? {}).find(([, t]) => t.from === "wood-planks" && Array.isArray(t.details))?.[0];
        check(!!newTex && texNote.includes(`${newTex}:`) && Object.values(ground?.floor ?? {}).includes(newTex) && text.includes(`id="f-${newTex}"`),
            "a derived texture is saved to Map Textures.md, painted, and copied into the map", texNote.slice(0, 200) + JSON.stringify(saved?.textures));
        const pipes = ground?.objects.filter((o) => o.src?.includes("pipe-copper-straight")) ?? [];
        check(pipes.length === 2 && Math.abs(Math.abs(pipes[1].x - pipes[0].x) - 64) < 0.01 && Math.abs(pipes[1].y - pipes[0].y) < 0.01, "a pipe placed near another snaps end to end", JSON.stringify(pipes.map((x) => [x.x, x.y])));
        const room = ground?.objects.find((o) => o.type === "room");
        check(room?.shapes?.some((x) => x.op === "add" && x.shape === "rect") && room.shapes.some((x) => x.op === "open") && room.children?.some((c) => c.name === "door" && c.src?.startsWith("data:image/svg+xml")),
            "a room grows with an added box and gets a door in its wall", JSON.stringify(room?.shapes));
        check(!!room && room.children?.some((c) => c.src?.includes("crate")) && !ground.objects.some((o) => o.src?.includes("crate")), "a room holds the stamp placed inside it", JSON.stringify(room)?.slice(0, 300));
        check(ground?.objects.some((o) => o.type === "ribbon" && o.style === "railway" && o.pts.length === 3) && saved.snap === false, "a curved railway strip is saved and snapping can be turned off", JSON.stringify(ground?.objects.filter((o) => o.type === "ribbon")) + " snap=" + saved.snap);
        check(!ground?.floor["0,0"] || Object.keys(ground.floor).length >= 1, "erase floor tool runs");
        check(text.includes("data:image/svg+xml;base64,") && fs.readFileSync(`${COPY}/${town}`, "utf8").includes('map: "[[Smoke Town (Map).svg]]"'), "the saved SVG embeds its stamps and the location links it");
    }
}
// sidebar sections collapse on their heading and remember it
{
    const doc = w.document;
    const head = (t) => [...doc.querySelectorAll(".sidebar .side-head")].find((b) => b.textContent.startsWith(t));
    const links = () => doc.querySelectorAll(".sidebar a[href^='#/c/']").length;
    const before = links();
    head("Data store").click(); await wait(200);
    check(links() < before && head("Data store").getAttribute("aria-expanded") === "false" && JSON.parse(w.localStorage.getItem("sidebarClosed")).datastore === true,
        "clicking a sidebar heading collapses its section", `${before} -> ${links()}`);
    head("Data store").click(); await wait(200);
    check(links() === before, "clicking it again shows the items");
}
// deleting a note: the button needs a second click, the note goes to .trash, protected notes are refused
{
    const doc = w.document;
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const { path } = await send("POST", "/api/plan/plot", { novel: novel.folder, title: "Smoke Delete Plot", fm: {} });
    w.location.hash = `#/note/${enc(path)}`;
    await wait(1200);
    const delBtn = () => [...doc.querySelectorAll("main button.danger")].find((b) => /Delete|confirm/.test(b.textContent));
    delBtn().click(); await wait(300);
    check(fs.existsSync(`${COPY}/${path}`) && delBtn()?.textContent === "Click to confirm", "first click on Delete only asks to confirm");
    delBtn().click(); await wait(1200);
    check(!fs.existsSync(`${COPY}/${path}`) && fs.existsSync(`${COPY}/.trash/Smoke Delete Plot.md`), "second click moves the note to .trash", w.location.hash);
    const r = await send("DELETE", `/api/note?path=${enc(`${novel.folder}/config.md`)}`);
    check(r.status === 400 && fs.existsSync(`${COPY}/${novel.folder}/config.md`), "config notes can't be deleted", JSON.stringify(r));
}
// chapter writer (left drawer) and the drawer's Lookup and Novel tabs
{
    const doc = w.document;
    const { parseBlocks, serializeBlocks, inlineHtml } = await import("../public/blocks.js");
    const shown = (md) => inlineHtml(md).replace(/<span[^>]*>|<\/span>/g, "");
    check(shown("\\**Knock*\\*") === "*<em>Knock</em>*" && shown("a **b** ***c***") === "a <strong>b</strong> <em><strong>c</strong></em>" && shown("5 * 3 * 2") === "5 * 3 * 2",
        "live preview shows bold, italics and escaped stars like Obsidian", shown("\\**Knock*\\*"));
    // click a formatted paragraph: it becomes a text box with the caret in it
    const editPara = async (test) => {
        const div = [...doc.querySelectorAll(".writer .be-p.be-live .be-text")].find((d) => test(d.textContent));
        if (!div) return null;
        div.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(200);
        return doc.querySelector(".writer .be-p textarea");
    };
    const fire = (el, type, init = {}) => el.dispatchEvent(new (type.startsWith("key") ? w.KeyboardEvent : w.Event)(type, { bubbles: true, cancelable: true, ...init }));
    const btn = (label, root = doc) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
    // every chapter in the vault copy reads and writes back unchanged
    let same = 0, all = 0, wn = null, wc = null;
    for (const n of index.novels) {
        const d = await get(`/api/novel?folder=${enc(n.folder)}`);
        for (const c of d.chapters) {
            const text = fs.readFileSync(`${COPY}/${c.path}`, "utf8");
            const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
            all++; if (serializeBlocks(parseBlocks(body)) === body) same++;
            if (!wc && /\n\n[A-Za-z"“]/.test(body) && body.length > 400) { wn = d; wc = c; }
        }
    }
    check(all > 0 && same === all, "chapter text round-trips through the block editor model", `${same}/${all}`);

    // side buttons: viewer + lookup outside a novel, + novel inside one
    w.location.hash = "#/qa"; await wait(500);
    const side = () => [...doc.querySelectorAll(".drawer-side .drawer-tab")].map((b) => b.textContent.split(":")[0].trim());
    check(side().join() === "Viewer,Lookup,Data store,Taxonomy", "outside a novel the collapsed drawer offers Viewer, Lookup, Data store and Taxonomy", side().join());
    // data store tab: one group open at a time, the filter hides what doesn't match, opening shows the note in the viewer
    [...doc.querySelectorAll(".drawer-side .drawer-tab")].find((b) => b.textContent.startsWith("Data store")).click();
    await wait(400);
    const groupsBox = () => doc.querySelector(".drawer-pane:not([hidden]) .browse-groups");
    const toggles = () => [...groupsBox().querySelectorAll(".browse-toggle")];
    toggles()[0].click(); await wait(100);
    toggles()[1].click(); await wait(100);
    check(groupsBox().querySelectorAll(".browse-group.open").length === 1 && toggles()[1].getAttribute("aria-expanded") === "true", "the data store tab opens one group at a time");
    const someItem = index.notes.find((n) => n.collection === "Items");
    const filter = doc.querySelector(".drawer-pane:not([hidden]) .browse input[type=search]");
    filter.value = someItem.name; filter.dispatchEvent(new w.Event("input", { bubbles: true }));
    await wait(200);
    const rows = [...groupsBox().querySelectorAll(".browse-group.open .lookup-item")];
    check(rows.length >= 1 && rows.every((r) => r.textContent.toLowerCase().includes(someItem.name.toLowerCase().split(" ")[0])), "the filter hides what doesn't match and opens a group with matches", `${rows.length} rows`);
    rows[0].click(); await wait(700);
    check(!!doc.querySelector(".drawer-pane:not([hidden]) .drawer-recent button.on"), "a data store row opens in the viewer");
    filter.value = ""; filter.dispatchEvent(new w.Event("input", { bubbles: true }));
    [...doc.querySelectorAll(".drawer-tabs [role=tab]")].find((b) => b.textContent === "Taxonomy").click();
    await wait(300);
    check(groupsBox().querySelectorAll(".browse-group").length === Object.keys(index.schema.collections).filter((c) => c.startsWith("Taxonomy/")).length, "the taxonomy tab lists every facet");
    doc.querySelector(".drawer-tabs button[title^='Collapse']").click();
    await wait(300);
    if (wc) {
        w.location.hash = `#/chapter/${enc(wn.folder)}/${wc.number}`;
        await wait(1000);
        check(side().join() === "Viewer,Lookup,Data store,Taxonomy,Novel", "inside a novel it offers the Novel tab too", side().join());
        const before = fs.readFileSync(`${COPY}/${wc.path}`, "utf8");
        btn("✎ Write", doc.querySelector("main")).click();
        await wait(1200);
        check(!!doc.querySelector(".writer-wrap.open .be-page .be-text") && !!doc.querySelector(".drawer-wrap.open .drawer-pane:not([hidden]) .chapter-plan"),
            "Write opens the chapter on the left and its plan on the right");
        check(!!doc.querySelector(".writer .writer-fieldlist .wf label"), "the writer shows the frontmatter fields on top");
        check(doc.querySelectorAll(".writer .be-p textarea").length === 0 && doc.querySelectorAll(".writer .be-live .be-text").length > 3, "paragraphs show formatted until clicked");
        check(!doc.querySelector(".writer-body .savebar") && !!doc.querySelector(".writer-foot .savebar"), "the save bar sits below the scrolling text");
        const para = await editPara((t) => t.length > 20);
        const old = para.value;
        para.value = `Smoke writer. ${old}`; fire(para, "input");
        await wait(100);
        // Enter splits the paragraph in two
        const count = doc.querySelectorAll(".writer .be-row").length;
        para.setSelectionRange(13, 13);
        fire(para, "keydown", { key: "Enter" });
        await wait(150);
        check(doc.querySelectorAll(".writer .be-row").length === count + 1, "Enter in a paragraph starts a new one");
        btn("Save changes", doc.querySelector(".writer")).click();
        await wait(1200);
        const after = fs.readFileSync(`${COPY}/${wc.path}`, "utf8");
        const want = before.replace(old, `Smoke writer.\n\n ${old}`);
        const at = [...want].findIndex((ch, k) => after[k] !== ch);
        check(after === want, "saving the writer changes only the edited paragraph", JSON.stringify([want.slice(at - 60, at + 60), after.slice(at - 60, at + 60)]));
        // Ctrl+I toggles italics on the word at the caret; Ctrl+Shift+Enter adds a centred scene break line
        fire(doc.activeElement, "keydown", { key: "Escape" });
        await wait(150);
        const p2 = await editPara((t) => /^[A-Za-z]{4,}\b/.test(t));
        if (p2) {
            const word = p2.value.match(/^[A-Za-z]+/)[0];
            p2.focus(); p2.setSelectionRange(2, 2);
            fire(p2, "keydown", { key: "i", ctrlKey: true });
            await wait(150);
            const it = doc.activeElement;
            check(it?.value?.startsWith(`*${word}*`), "Ctrl+I italicises the word at the caret", it?.value?.slice(0, 40));
            fire(it, "keydown", { key: "i", ctrlKey: true });
            await wait(150);
            check(doc.activeElement?.value?.startsWith(word + (p2.value[word.length] ?? "")), "Ctrl+I again removes it");
            fire(doc.activeElement, "keydown", { key: "Enter", ctrlKey: true, shiftKey: true });
            await wait(300);
            check(!!doc.querySelector(".writer .be-image .be-render"), "Ctrl+Shift+Enter inserts a scene break shown as an image line");
            btn("Save changes", doc.querySelector(".writer")).click();
            await wait(1200);
            check(/\n\n!\[\[pb-[^\]]+\]\]\n\n/.test(fs.readFileSync(`${COPY}/${wc.path}`, "utf8")), "the scene break is saved as its own paragraph");
        }
        // find in the chapter: counts matches and steps through them
        const findBox = doc.querySelector(".writer-find input");
        findBox.value = "Smoke writer"; fire(findBox, "input");
        await wait(300);
        check(doc.querySelector(".writer-find .find-count")?.textContent.trim() === "1 / 1", "the writer's find bar counts matches", doc.querySelector(".writer-find .find-count")?.textContent);
        findBox.value = ""; fire(findBox, "input");
        await wait(100);
        // the drawer keeps its width while writing
        check(doc.querySelector(".layout").classList.contains("writing") && doc.querySelector(".layout").classList.contains("drawer-open"), "the layout knows both drawers are open");
        // Ctrl+[ and Ctrl+] close and open the writer and the drawer
        const key = (k) => w.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
        key("["); key("]"); await wait(200);
        const closed = !doc.querySelector(".writer-wrap.open") && !doc.querySelector(".drawer-wrap.open");
        key("["); key("]"); await wait(200);
        check(closed && !!doc.querySelector(".writer-wrap.open") && !!doc.querySelector(".drawer-wrap.open"), "Ctrl+[ and Ctrl+] toggle the writer and the drawer");
        doc.querySelector(".drawer-backdrop").click();
        await wait(300);
        check(!doc.querySelector(".writer-wrap.open") && !!doc.querySelector(".writer-wrap.collapsed .writer-tab"), "the backdrop collapses the writer to a tab on the left");

        // novel tab: characters, New character in the viewer
        [...doc.querySelectorAll(".drawer-side .drawer-tab")].find((b) => b.textContent.startsWith("Novel")).click();
        await wait(1200);
        [...doc.querySelectorAll(".novel-drawer .tabs button")].find((b) => b.textContent === "Characters").click();
        await wait(300);
        check(doc.querySelectorAll(".novel-drawer .people-list li").length >= wn.characters.length, "the novel tab lists the characters");
        btn("+ New character", doc.querySelector(".novel-drawer")).click();
        await wait(800);
        check(!!doc.querySelector(".drawer-pane:not([hidden]) h1")?.textContent.includes("New character"), "New character opens its form in the viewer");
        [...doc.querySelectorAll(".drawer-tabs [role=tab]")].find((b) => b.textContent.startsWith("Novel")).click();
        await wait(200);
        [...doc.querySelectorAll(".novel-drawer .tabs button")].find((b) => b.textContent === "World").click();
        await wait(1200);
        check(!!doc.querySelector(".novel-drawer .loc-tree, .novel-drawer p.muted"), "the novel tab shows the world hierarchy");

        // lookup: chapter text search, open a result, it is kept in the recent list
        [...doc.querySelectorAll(".drawer-tabs [role=tab]")].find((b) => b.textContent === "Lookup").click();
        await wait(300);
        const q = doc.querySelector(".lookup input[type=search]");
        q.value = "Smoke writer"; fire(q, "input");
        await wait(1200);
        const hit = [...doc.querySelectorAll(".lookup-item")].find((li) => li.textContent.includes("Chapters"));
        check(!!hit && !!hit.querySelector("mark"), "lookup finds chapter text and marks the words");
        hit?.click();
        await wait(800);
        check(!!doc.querySelector(".drawer-pane:not([hidden]) .drawer-recent button.on"), "opening a lookup result shows it in the viewer");
        q.value = ""; fire(q, "input");
        [...doc.querySelectorAll(".drawer-tabs [role=tab]")].find((b) => b.textContent === "Lookup").click();
        await wait(500);
        check(doc.querySelectorAll(".lookup-recent .lookup-item").length >= 1, "opened results are listed under Recently opened");
        doc.querySelector(".drawer-tabs button[title^='Collapse']").click();
        await wait(200);
    }
    // a chapter without a note can be started from the writer
    const created = await realFetch(new URL("/api/write/chapter", BASE), { method: "POST", headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: JSON.stringify({ novel: novel.folder, n: 777, title: "Smoke Start" }) }).then((r) => r.json());
    check(created.path?.endsWith("/777 - Smoke Start.md") && fs.readFileSync(`${COPY}/${created.path}`, "utf8").includes("chapter title: Smoke Start"), "a chapter note is created like the Templater template", JSON.stringify(created));
}
// note blocks: the body's "## " sections can be edited, moved, deleted and added
{
    const doc = w.document;
    const fire = (el, type, init = {}) => el.dispatchEvent(new (type.startsWith("key") ? w.KeyboardEvent : w.Event)(type, { bubbles: true, cancelable: true, ...init }));
    const btn = (label, root = doc) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
    const rel = "80. Global Data Store/Worlds/Smoke Blocks World.md";
    fs.writeFileSync(`${COPY}/${rel}`, "---\ntitle: Smoke Blocks World\ntype: world\n---\nIntro line.\n\n## Calendar\n1. Sol\n2. Luna\n\n## Languages\nCommon tongue\n");
    await wait(600);
    const read = () => fs.readFileSync(`${COPY}/${rel}`, "utf8");
    const open = async () => { w.location.hash = "#/qa"; await wait(300); w.location.hash = `#/note/${enc(rel)}`; await wait(1000); };
    await open();
    const heads = () => [...doc.querySelectorAll("main .nblock-head h3")].map((h) => h.textContent);
    check(heads().join() === "Calendar,Languages" && !!doc.querySelector("main .nblock.pre"), "note body shows as blocks", heads().join());
    // move Languages up with the arrow keys
    doc.querySelector("main button[aria-label='Move Languages']").click(); await wait(100);
    const moving = doc.querySelector("main .nblock.moving");
    fire(moving, "keydown", { key: "ArrowUp" }); await wait(100);
    fire(doc.querySelector("main .nblock.moving"), "keydown", { key: "Enter" }); await wait(800);
    check(/## Languages\nCommon tongue\n\n## Calendar\n1. Sol\n2. Luna\n/.test(read()) && read().startsWith("---\ntitle: Smoke Blocks World\ntype: world\n---\nIntro line.\n\n## Languages"), "moving a block with the arrow keys reorders the sections", JSON.stringify(read()));
    // edit Calendar
    doc.querySelector("main button[aria-label='Edit Calendar']").click(); await wait(300);
    const t = doc.querySelector("main .nblock.editing textarea");
    t.value = "Sol (summer)"; fire(t, "input"); await wait(100);
    btn("Save", doc.querySelector("main .nblock.editing")).click(); await wait(900);
    check(read().includes("## Calendar\n1. Sol (summer)\n2. Luna\n") && read().includes("## Languages\nCommon tongue\n"), "editing a block rewrites only that section", JSON.stringify(read()));
    // delete Languages (two clicks)
    const del = () => doc.querySelector("main button[aria-label='Delete Languages']");
    del().click(); await wait(50); del().click(); await wait(900);
    check(!read().includes("Languages") && read().includes("## Calendar"), "deleting a block removes its section");
    // add a block
    btn("+ Add block").click(); await wait(100);
    const ti = doc.querySelector("main .nblock-add input");
    ti.value = "Currency"; fire(ti, "input"); await wait(50);
    fire(ti, "keydown", { key: "Enter" }); await wait(300);
    const t2 = doc.querySelector("main .nblock.editing textarea");
    t2.value = "Spirit stones"; fire(t2, "input"); await wait(100);
    btn("Add", doc.querySelector("main .nblock.editing")).click(); await wait(900);
    check(/## Currency\nSpirit stones\n/.test(read()) && heads().includes("Currency"), "adding a block appends a section", JSON.stringify(read()));
    // scratchpad: started from the novel page, ideas are blocks
    w.location.hash = `#/novel/${enc(novel.folder)}`; await wait(900);
    [...doc.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "Scratchpad").click(); await wait(400);
    btn("Start the scratchpad").click(); await wait(1200);
    btn("+ Add idea").click(); await wait(100);
    const si = doc.querySelector("main .nblock-add input");
    si.value = "Twist"; fire(si, "input"); await wait(50); fire(si, "keydown", { key: "Enter" }); await wait(300);
    const st = doc.querySelector("main .nblock.editing textarea");
    st.value = "The mentor is the **villain**"; fire(st, "input"); await wait(100);
    check(!doc.querySelector("main .nblock.editing .be-toolbar button[aria-label='Callout']"), "the scratchpad editor has no callouts");
    btn("Add", doc.querySelector("main .nblock.editing")).click(); await wait(900);
    const pad = `${COPY}/${novel.folder}/Plan/Scratchpad (${novel.name}).md`;
    check(fs.existsSync(pad) && fs.readFileSync(pad, "utf8").includes("## Twist\nThe mentor is the **villain**") && !!doc.querySelector("main .nblock strong"), "the scratchpad saves ideas as formatted blocks", fs.existsSync(pad) ? fs.readFileSync(pad, "utf8") : "no file");
}
// import data: identical files skip themselves, conflicts are decided, name clashes are skipped
{
    const doc = w.document;
    const fire = (el, type, init = {}) => el.dispatchEvent(new (type.startsWith("key") ? w.KeyboardEvent : w.Event)(type, { bubbles: true, cancelable: true, ...init }));
    const btn = (label) => [...doc.querySelectorAll("main button")].find((b) => b.textContent.trim().startsWith(label));
    const ds = fs.mkdtempSync(`${process.env.SETTINGS_DIR ?? "/tmp"}/dataset-`);
    const items = index.notes.filter((n) => n.collection === "Items");
    const same = items[0].path, diff = items[1].path, clashName = items[2].name;
    const put = (rel, text) => { fs.mkdirSync(`${ds}/vault/${rel.split("/").slice(0, -1).join("/")}`, { recursive: true }); fs.writeFileSync(`${ds}/vault/${rel}`, text); };
    fs.writeFileSync(`${ds}/world-builder.json`, JSON.stringify({ name: "Smoke dataset", root: "vault" }));
    fs.writeFileSync(`${ds}/README.md`, "not data");
    put(same, fs.readFileSync(`${COPY}/${same}`, "utf8"));
    put(diff, fs.readFileSync(`${COPY}/${diff}`, "utf8") + "\nIncoming change.\n");
    put("80. Global Data Store/Items/Smoke Imported Item.md", "---\ntitle: Smoke Imported Item\n---\n");
    // the same note with another created date and an empty field written differently counts as identical
    const eq = items[3].path, eqText = fs.readFileSync(`${COPY}/${eq}`, "utf8");
    put(eq, eqText.includes("created-date:") ? eqText.replace(/created-date:.*/, "created-date: 1999-01-01").replace(/^---\n/, "---\nsmoke-empty: \"\"\n") : eqText);
    put(`80. Global Data Store/Materials/${clashName}.md`, "---\ntitle: clash\n---\n");
    w.location.hash = "#/import"; await wait(500);
    const src = doc.querySelector(".import-source input");
    src.value = ds; fire(src, "input"); await wait(50);
    btn("Check").click(); await wait(1500);
    const counts = [...doc.querySelectorAll(".import-counts .chip")].map((c) => c.textContent);
    check(counts.join("|") === "1 new|2 identical (skipped)|1 to decide|1 name already used", "the import check sorts files into new, identical, different and name clashes", counts.join("|"));
    const importBtn = () => [...doc.querySelectorAll("main .savebar button")].find((b) => /^Import \d/.test(b.textContent.trim()));
    check(!!doc.querySelector(".import-diff .diff") && importBtn().disabled, "a different file shows both versions and must be decided before importing");
    btn("Overwrite").click(); await wait(200);
    importBtn().click(); await wait(1200);
    check(fs.readFileSync(`${COPY}/${diff}`, "utf8").endsWith("Incoming change.\n") && fs.existsSync(`${COPY}/80. Global Data Store/Items/Smoke Imported Item.md`)
        && !fs.existsSync(`${COPY}/80. Global Data Store/Materials/${clashName}.md`) && !fs.existsSync(`${COPY}/README.md`) && !!doc.querySelector(".import-done"),
        "importing writes new files and chosen overwrites, skipping name clashes and repository files");

    // importing the same dataset again: the record tells updates from local edits, and remembers clash choices
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const imported = "80. Global Data Store/Items/Smoke Imported Item.md";
    put(imported, "---\ntitle: Smoke Imported Item\ndescription: Upstream change\n---\n");     // changed in the dataset only
    fs.appendFileSync(`${COPY}/${diff}`, "Local edit.\n");                                     // changed in the vault only
    // a new note whose name is taken, a note linking to it, and a link to nothing
    const taken = items[4].name;
    put(`80. Global Data Store/Materials/${taken}.md`, "---\ntitle: incoming\n---\nIncoming twin.\n");
    put("80. Global Data Store/Items/Smoke Linker.md", `---\ntitle: Smoke Linker\nmade-from: "[[${taken}]]"\n---\nSee [[${taken}]] and [[Nowhere Smoke Note]].\n`);
    const r2 = await send("POST", "/api/import/check", { source: ds });
    const st = (rel) => r2.files.find((f) => f.path === rel)?.status;
    check(st(imported) === "update" && st(diff) === "local" && st(`80. Global Data Store/Materials/${clashName}.md`) === "kept" && st(`80. Global Data Store/Materials/${taken}.md`) === "new"
        && r2.unresolved.some((u) => u.target === "Nowhere Smoke Note"),
        "a second import finds updates, your own edits, earlier clash choices and links to nothing", JSON.stringify(r2.counts));
    const clashFile = r2.files.find((f) => f.path === `80. Global Data Store/Materials/${taken}.md`);
    const a2 = await send("POST", "/api/import/apply", { id: r2.id, clashes: { [clashFile.path]: "rename" } });
    const renamedRel = `80. Global Data Store/Materials/${clashFile.renameTo}.md`;
    const linker = fs.readFileSync(`${COPY}/80. Global Data Store/Items/Smoke Linker.md`, "utf8");
    check(a2.renamed === 1 && fs.existsSync(`${COPY}/${renamedRel}`) && linker.includes(`[[${clashFile.renameTo}|${taken}]]`) && linker.includes(`made-from: "[[${clashFile.renameTo}|${taken}]]"`)
        && fs.readFileSync(`${COPY}/${imported}`, "utf8").includes("Upstream change") && fs.readFileSync(`${COPY}/${diff}`, "utf8").endsWith("Local edit.\n"),
        "a clash imported under a new name takes the links with it; updates are written and local edits kept", linker);
    // rename the renamed note in the app: the record follows, so the next import finds it identical
    const rn = await send("POST", "/api/rename", { path: renamedRel, name: `${clashFile.renameTo} Moved` });
    const r3 = await send("POST", "/api/import/check", { source: ds });
    const f3 = r3.files.find((f) => f.path === clashFile.path);
    check(rn.renamed && f3?.status === "same" && f3.target.endsWith(`${clashFile.renameTo} Moved.md`) && r3.counts.clash === 0,
        "renaming an imported note keeps later imports pointing at it", JSON.stringify({ f3, counts: r3.counts }));
}
// a new vault has no data until a dataset is imported (the starter data repository, when it is on this machine)
const STARTER = `${process.env.HOME}/Projects/world-builder-data`;
if (process.env.SETTINGS_DIR && fs.existsSync(STARTER)) {
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const empty = `${process.env.SETTINGS_DIR}/Empty Vault`;
    fs.mkdirSync(`${empty}/.obsidian`, { recursive: true });
    await send("POST", "/api/settings", { vault: empty });
    const before = await get("/api/settings");
    const c = await send("POST", "/api/import/check", { source: STARTER });
    const a = await send("POST", "/api/import/apply", { id: c.id });
    const after = await get("/api/settings");
    check(!before.hasSchema && before.notes === 0 && c.counts.new > 100 && a.added === c.counts.new && a.folders > 5 && after.hasSchema && fs.existsSync(`${empty}/80. Global Data Store/Items`),
        "an empty vault gets the schema, taxonomy and collection folders from the starter data", JSON.stringify({ before: before.notes, counts: c.counts, a }));
    const again = await send("POST", "/api/import/check", { source: STARTER });
    check(again.counts.same === c.counts.new && again.counts.new === 0 && again.counts.conflict === 0, "importing the same data again finds every file identical");
    await send("POST", "/api/settings", { vault: COPY });
}
// docs: grouped contents with the open page's sections, search with guides / references, reference links in the drawer
{
    const doc = w.document;
    w.location.hash = "#/docs"; await wait(900);
    check(doc.querySelectorAll(".doc-home .doc-card").length >= 2 && !!doc.querySelector(".docs-nav .docs-group-head") && !doc.querySelector(".topbar"), "the docs home lists the pages by group, without the data store search bar");
    w.location.hash = "#/docs/importing-data"; await wait(900);
    check(!!doc.querySelector(".docs-page.on") && doc.querySelectorAll(".docs-sections a").length >= 3 && !!doc.querySelector(".doc-prose h1"), "a docs page shows with its sections under it in the contents");
    const q = doc.querySelector(".docs-search input");
    q.value = "rename"; q.dispatchEvent(new w.Event("input", { bubbles: true })); await wait(900);
    const hits = () => [...doc.querySelectorAll(".docs-hit")];
    const guides = hits().length;
    [...doc.querySelectorAll(".docs-kinds button")].find((b) => b.textContent === "Reference").click(); await wait(100);
    check(guides >= 1 && hits().length >= 1 && !!doc.querySelector(".docs-hit mark"), "docs search lists matches with snippets, split into guides and references");
    q.value = ""; q.dispatchEvent(new w.Event("input", { bubbles: true })); await wait(400);
    doc.querySelector(".doc-prose .ref-link").dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); await wait(900);
    check(w.location.hash.startsWith("#/docs/importing-data") && !!doc.querySelector(".drawer-wrap.open .drawer-pane:not([hidden]) .doc-prose.in-drawer"), "a reference link opens beside the page, in the drawer");
    doc.querySelector(".drawer-tabs button[title^='Collapse']").click(); await wait(300);
}
// callout designer: styles saved to the vault, callout metadata rendered
{
    const doc = w.document;
    const r = await realFetch(new URL("/api/render", BASE), { method: "POST", headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: JSON.stringify({ markdown: "> [!Journal|noattr] Wade\n> Text" }) }).then((x) => x.json());
    check(/data-callout="journal" data-callout-metadata="noattr"/.test(r.html), "callouts with |metadata render", r.html.slice(0, 120));
    w.location.hash = "#/callout-design";
    await wait(1000);
    check(!!doc.getElementById("callout-styles")?.textContent.includes('data-callout="system"'), "the callout styles are in the page");
    [...doc.querySelectorAll(".co-types button")].find((b) => b.textContent.includes("Journal")).click();
    await wait(200);
    const width = [...doc.querySelectorAll(".co-field")].find((f) => f.textContent.startsWith("Width"))?.querySelector("input[type=number]");
    width.value = "70"; width.dispatchEvent(new w.Event("change", { bubbles: true }));
    await wait(100);
    check(doc.querySelector(".co-designer style").textContent.includes("width: 70%"), "designer changes show in the preview");
    [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save styles").click();
    await wait(1000);
    const note = `${COPY}/90. Templater/Callout Styles.md`;
    check(fs.existsSync(note) && /callout-styles:\s*\n\s+journal:\s*\n\s+width: 70/.test(fs.readFileSync(note, "utf8")), "saving writes only the changes to Callout Styles.md", fs.existsSync(note) ? fs.readFileSync(note, "utf8").slice(0, 300) : "no note");
}
// world export and import: maps carry stamp hashes; stamps you have are reused, missing ones come from the maps
if (process.env.SETTINGS_DIR) {
    const send = (method, p, body, raw) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", ...(raw ? {} : { "content-type": "application/json" }) }, body: raw ?? (body && JSON.stringify(body)) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const { newMap } = await import("../public/map-core.js");
    const ws = await get("/api/worlds");
    const world = ws.worlds.find((x) => x.count > 0) ?? ws.worlds[0];
    const wd = await get(`/api/world?world=${enc(world.path)}`);
    const loc = wd.locations[0];
    // an own stamp, a derived texture, a built-in stamp
    // a stamp image of its own (a copy of a built-in would rightly be recognised as that built-in)
    const crate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#8a5a2b"/><text y="8">smoke ${Date.now()}</text></svg>`);
    const own = await send("POST", "/api/stamps?filename=smoke-crate.svg&set=Smoke", null, crate);
    const builtin = JSON.parse(fs.readFileSync(new URL("../public/stamps/manifest.json", import.meta.url))).stamps[0];
    const tex = await get("/api/textures");
    await send("POST", "/api/textures", { textures: { ...tex.textures, "smoke-moss": { name: "Smoke moss", from: "grass", age: 0.5 } }, baseMtime: tex.mtime });
    const doc = newMap("grid", { cols: 6, rows: 4 });
    doc.layers[0].floor = { "1,1": "smoke-moss" };
    doc.textures = { "smoke-moss": { name: "Smoke moss", from: "grass", age: 0.5 } };
    doc.layers[0].objects.push({ id: "a", type: "stamp", src: own.src, x: 64, y: 64, w: 64, h: 64 }, { id: "b", type: "stamp", src: `/stamps/${builtin.file}`, x: 128, y: 64, w: 64, h: 64 });
    const saved = await send("POST", "/api/map", { location: loc.path, doc });
    const svg = fs.readFileSync(`${COPY}/${saved.file}`, "utf8");
    check(/"hash":"[0-9a-f]{16}"/.test(svg) && svg.includes('"assets"'), "a saved map records its stamps' and textures' hashes");

    const pv = await get(`/api/world/export?world=${enc(world.path)}&linked=1`);
    const zipRes = await realFetch(new URL(`/api/world/export.zip?world=${enc(world.path)}&linked=1`, BASE));
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    const { readZip } = await import("../lib/zip.js");
    const names = readZip(zipBuf).map((e) => e.name);
    const manifest = JSON.parse(readZip(zipBuf).find((e) => e.name === "world-builder.json").data.toString());
    check(zipRes.headers.get("content-type") === "application/zip" && names.includes(`vault/${saved.file}`) && names.some((n) => n.endsWith("smoke-crate.svg"))
        && !names.some((n) => /Taxonomy\/Novels\/|\/Chapters\/|\/Characters\/|\/Plan\//.test(n)) && manifest.kind === "world" && manifest.assets.stamps.some((x) => x.builtin) && manifest.assets.textures["smoke-moss"]
        && pv.maps >= 1, "a world exports as a zip with its maps, your stamps and textures, and only data store notes", JSON.stringify({ pv, n: names.length }));
    const outDir = `${process.env.SETTINGS_DIR}/exported-world`;
    const fold = await send("POST", "/api/world/export/folder", { world: world.path, linked: true, folder: outDir });
    check(fold.files > 1 && fs.existsSync(`${outDir}/world-builder.json`) && fs.existsSync(`${outDir}/vault/${saved.file}`) && fs.existsSync(`${outDir}/README.md`), "a world exports into a folder ready for git");
    const again = await send("POST", "/api/world/export/folder", { world: world.path, linked: false, folder: outDir });
    check(again.updated === true, "exporting into the same folder again replaces the earlier export");

    // map assets: your stamp with the maps using it; a pack of it exports and imports elsewhere without duplicates
    const ma = await get("/api/map-assets");
    const mine = ma.stamps.find((x) => x.src === own.src);
    check(mine?.uses.length >= 1 && ma.textures.some((t) => t.id === "smoke-moss" && t.uses.length >= 1) && ma.builtin.stamps > 100, "map assets list your stamps and textures with the maps using them", JSON.stringify(mine));
    const packRes = await realFetch(new URL(`/api/map-assets/pack.zip?stamps=${enc(mine.file)}&textures=smoke-moss&name=Smoke%20pack`, BASE));
    const packBuf = Buffer.from(await packRes.arrayBuffer());

    // into an empty vault, from the zip
    const empty = `${process.env.SETTINGS_DIR}/World Target`;
    fs.mkdirSync(`${empty}/.obsidian`, { recursive: true });
    await send("POST", "/api/settings", { vault: empty });
    const up = await send("POST", "/api/import/upload?filename=world.zip", null, zipBuf);
    const ap = await send("POST", "/api/import/apply", { id: up.id });
    const m1 = await get(`/api/map?location=${enc(loc.path)}`);
    const tx1 = await get("/api/textures");
    check(up.kind === "world" && ap.added > 0 && m1.doc && m1.missingStamps.length === 0 && m1.doc.layers[0].objects.some((o) => o.src === own.src) && tx1.textures["smoke-moss"],
        "a zipped world imports with its maps, stamps and textures", JSON.stringify({ added: ap.added, missing: m1.missingStamps, a: up.assets }));

    // the pack again into the same vault: the stamp is already there (same image), the texture too
    const pk = await send("POST", "/api/import/upload?filename=pack.zip", null, packBuf);
    check(pk.kind === "assets" && (pk.counts.same + pk.counts.library) >= 1 && pk.counts.new === 0 && pk.assets.textures.every((t) => t.status === "same"), "a pack of things you already have imports nothing new", JSON.stringify(pk.counts));

    // a copy whose stamp file is missing: the stamp is taken from the map itself, into Map Stamps/Imported
    const empty2 = `${process.env.SETTINGS_DIR}/World Target 2`;
    fs.mkdirSync(`${empty2}/.obsidian`, { recursive: true });
    fs.rmSync(`${outDir}/vault/${decodeURIComponent(own.src.slice(7))}`);
    await send("POST", "/api/settings", { vault: empty2 });
    // a texture with the same id but another look is already there
    await send("POST", "/api/textures", { textures: { "smoke-moss": { name: "Other moss", from: "grass", age: 0.1 } } });
    const c2 = await send("POST", "/api/import/check", { source: outDir });
    const tc = c2.assets?.textures.find((t) => t.id === "smoke-moss");
    const a2 = await send("POST", "/api/import/apply", { id: c2.id });
    const m2 = await get(`/api/map?location=${enc(loc.path)}`);
    const st2 = m2.doc?.layers[0].objects.find((o) => o.id === "a");
    const tx2 = await get("/api/textures");
    check(c2.assets?.embedded.length === 1 && a2.stamps === 1 && st2?.src.includes("Map%20Stamps/Imported") && m2.missingStamps.length === 0,
        "a stamp only the map carries is added to the library and the map points at it", JSON.stringify({ embedded: c2.assets?.embedded, st2: st2?.src }));
    check(tc?.status === "conflict" && tx2.textures[tc.newId] && tx2.textures["smoke-moss"].name === "Other moss" && JSON.stringify(m2.doc.layers[0].floor).includes(tc.newId),
        "a texture whose id is taken by another look imports under a new id and the map follows", JSON.stringify({ tc, keys: Object.keys(tx2.textures) }));
    await send("POST", "/api/settings", { vault: COPY });
}
// appearance: the app colour, fonts and sizes show at once and are saved for this device
if (process.env.SETTINGS_DIR) {
    const doc = w.document;
    w.location.hash = "#/settings"; await wait(900);
    const sw = [...doc.querySelectorAll(".accent-swatches button")].find((b) => b.title === "#2f6fb0");
    sw.click(); await wait(100);
    const size = [...doc.querySelectorAll(".appearance-range input")].find((i) => i.getAttribute("aria-label") === "writerSize");
    size.value = "21"; size.dispatchEvent(new w.Event("input", { bubbles: true }));
    doc.querySelector(".appearance-stepper button[aria-label='Larger']").click();
    await wait(800);
    const zoomed = doc.querySelector(".appearance-stepper .stepper-value").textContent;
    const st = doc.documentElement.style;
    const saved = JSON.parse(fs.readFileSync(`${process.env.SETTINGS_DIR}/books-meta-viewer/settings.json`, "utf8"));
    check(st.getPropertyValue("--app-accent").startsWith("#") && st.getPropertyValue("--writer-size") === "21px" && saved.appearance?.accent === "#2f6fb0" && saved.appearance?.writerSize === 21 && zoomed === "110%" && saved.appearance?.uiScale === 1.1,
        "appearance changes show at once and are saved in settings.json", JSON.stringify(saved.appearance));
    [...doc.querySelectorAll(".appearance-range button")].forEach((b) => b.click());
    [...doc.querySelectorAll(".accent-swatches button")][0].click(); await wait(600);
}
// where you were is remembered: the page and the drawer, for the next start
{
    const doc = w.document;
    w.location.hash = "#/c/Items"; await wait(600);
    doc.querySelector("main table a[href^='#/note/']").dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); await wait(600);
    const saved = JSON.parse(w.localStorage.getItem("drawerState") ?? "null");
    check(w.localStorage.getItem("lastHash") === "#/c/Items" && saved?.open === true && saved.recent.length >= 1, "the page and the drawer are saved for the next start", JSON.stringify({ last: w.localStorage.getItem("lastHash"), saved }));
    doc.querySelector(".drawer-tabs button[title^='Collapse']").click(); await wait(300);
}
// AI assistant (the test server runs with WB_AI_MOCK=1: a stand-in for Claude, no network)
{
    const doc = w.document;
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) });
    await send("POST", "/api/ai/settings", { auth: "key" });   // these tests use the API chat (the default is Claude Code)
    const st = await get("/api/ai/status");
    check(st.mock && st.ready && st.model === "claude-opus-5-5", "the assistant is ready in test mode with Opus 5.5 by default", JSON.stringify(st));
    // a chat turn streams JSON lines: text, a tool call with its result, the reply after it
    const r = await send("POST", "/api/ai/chat", { message: "search: Mara", view: { page: "test" } });
    const events = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    const tool = events.find((e) => e.t === "tool_done");
    const reply = events.filter((e) => e.t === "text").map((e) => e.d).join("");
    check(events[0].t === "start" && tool?.name === "search" && /results/.test(tool.summary) && /Tool said: (\d+ of \d+ results|No results)/.test(reply) && events.at(-1).t === "done", "a chat turn streams text, runs the search tool and answers with its result", JSON.stringify(events.slice(-3)));
    const conv = events[0].conversation;
    const r2 = await send("POST", "/api/ai/chat", { conversation: conv, message: "view?", view: { page: "Chapter 2", selection: "the lamp" } });
    const ev2 = (await r2.text()).trim().split("\n").map((l) => JSON.parse(l));
    check(ev2[0].conversation === conv && ev2.some((e) => e.t === "tool_done" && e.name === "current_view") && ev2.filter((e) => e.t === "text").map((e) => e.d).join("").includes("Page: Chapter 2"), "the conversation continues and current_view reports the screen");
    check((await send("POST", "/api/ai/chat", { message: "  " })).ok && true, "an empty message is answered (with an error line)");
    // the tools reach only novels and the data store
    const { Vault } = await import("../lib/vault.js"); const { Novels } = await import("../lib/novels.js"); const { Blueprints } = await import("../lib/blueprints.js");
    const { DataStore } = await import("../lib/datastore.js"); const { Plans } = await import("../lib/plans.js"); const { Worlds } = await import("../lib/worlds.js");
    const { Search } = await import("../lib/search.js"); const { AiTools } = await import("../lib/ai-tools.js");
    const v = new Vault(COPY); await v.load();
    const nv = new Novels(v), ds = new DataStore(v, nv, new Blueprints(v)), pl = new Plans(v, nv, ds), wl = new Worlds(v, ds), se = new Search(v, nv, ds);
    const tools = new AiTools(() => ({ vault: v, novels: nv, store: ds, plans: pl, worlds: wl, search: se }));
    v.close?.();
    const novel = nv.list()[0];
    check(/outside the novels/.test(tools.run("read_note", { note: "90. Templater/Data Store Schema.md" }).error ?? ""), "notes outside the novels and the data store are refused");
    check(!/90\. Templater|\.obsidian/.test(tools.run("search", { query: "schema" }).text ?? ""), "search results leave out Templater notes");
    const ov = tools.run("novel_overview", { novel: novel.name });
    check(ov.text?.includes("Chapters (") && ov.text.includes(novel.name), "novel_overview lists the chapters", ov.error);
    const ch = pl.chapters(novel).find((c) => c.written);
    if (ch) check(tools.run("read_chapter", { novel: novel.folder, chapter: ch.number }).text?.includes(`Chapter ${ch.number}`), "read_chapter returns a chapter's text");
    const sc = tools.run("schema", { collection: "Items" });
    check(/cat → links to/.test(sc.text ?? ""), "schema lists a collection's fields and link targets", sc.text?.slice(0, 200));
    check(!!tools.run("query_collection", { collection: "items", limit: 2 }).text?.match(/rows in Items/), "query_collection lists rows");
    // the drawer tab: the robot button opens it, a message gets a reply with its steps
    doc.querySelector(".bot-button").click(); await wait(500);
    const ta = doc.querySelector(".ai-input textarea");
    check(!!ta && [...doc.querySelectorAll(".drawer-tabs button")].some((b) => b.textContent === "AI"), "the robot button opens the AI tab");
    ta.value = "search: Mara"; ta.dispatchEvent(new w.Event("input", { bubbles: true })); await wait(50);
    doc.querySelector(".ai-input button.primary").click();
    for (let i = 0; i < 40 && !doc.querySelector(".ai-steps"); i++) await wait(100);
    check(doc.querySelector(".ai-msg.user")?.textContent === "search: Mara" && /Tool said/.test(doc.querySelector(".ai-msg.bot")?.textContent ?? "") && /1 step$/.test(doc.querySelector(".ai-steps summary")?.textContent ?? ""), "a message in the AI tab gets a rendered reply with its steps", doc.querySelector(".ai-list")?.textContent);
    check(/Tell me more/.test(doc.querySelector(".ai-chips")?.textContent ?? "") && !/<replies>/.test(doc.querySelector(".ai-msg.bot")?.textContent ?? "") && /follow-up/.test(doc.querySelector(".ai-input textarea")?.placeholder ?? ""),
        "suggested replies show as chips under the chat (not in the text) and the hint asks for a follow-up", doc.querySelector(".ai-chips")?.textContent);
    // proposals: nothing is written until approved, one by one or all
    const written = pl.chapters(novel).find((c) => c.written && v.notes.get(c.notePath)?.body.split(/\n{2,}/).some((p) => p.length > 80));
    const bodyOf = (p) => fs.readFileSync(`${COPY}/${p}`, "utf8");
    const para = written && v.notes.get(written.notePath).body.split(/\n{2,}/).map((p) => p.trim()).find((p) => p.length > 80 && !/[[\]*_>#%!]/.test(p) && v.notes.get(written.notePath).body.split(p).length === 2);
    const item = v.inFolder("80. Global Data Store/Items")[0];
    if (para && item) {
        const find = para.slice(0, 60);
        const changes = [
            { action: "edit_text", note: written.notePath, find, replace: "WB-EDIT " + find },
            { action: "edit_fields", note: item.path, set: { description: "WB-REJECT" } },
            { action: "create_note", collection: "Items", name: "WB Test Goggles", fields: { description: "Smoked glass." }, text: "Issued to couriers." },
        ];
        const bad = await send("POST", "/api/ai/chat", { message: "propose: " + JSON.stringify({ title: "Bad", changes: [{ action: "edit_text", note: written.notePath, find: "no such text anywhere 123", replace: "x" }] }) });
        check(/occurs 0 times/.test(await bad.text()), "a text edit whose passage isn't there is refused with a reason the model can use");
        const cfg = await send("POST", "/api/ai/chat", { message: "propose: " + JSON.stringify({ title: "Cfg", changes: [{ action: "edit_fields", note: novel.configPath, set: { accent: "#000000" } }] }) });
        check(/settings note/.test(await cfg.text()), "a novel's settings note can't be changed through proposals");
        doc.querySelector(".bot-button").click(); await wait(300);
        const ta2 = doc.querySelector(".ai-input textarea");
        ta2.value = "propose: " + JSON.stringify({ title: "Test changes", changes }); ta2.dispatchEvent(new w.Event("input", { bubbles: true })); await wait(50);
        doc.querySelector(".ai-input button.primary").click();
        for (let i = 0; i < 40 && !doc.querySelector(".proposal .change"); i++) await wait(100);
        check(doc.querySelectorAll(".proposal .change").length === 3 && !!doc.querySelector(".proposal ins") && bodyOf(written.notePath).includes(find) && !bodyOf(written.notePath).includes("WB-EDIT"),
            "proposed changes open for review in the drawer, and nothing is written yet");
        const pid = JSON.parse(w.localStorage.getItem("drawerState")).recent[0].split("/").pop();
        const json = (r) => r.json();
        await send("POST", "/api/ai/proposal/apply", { id: pid, which: 0 }).then(json);
        await send("POST", "/api/ai/proposal/reject", { id: pid, which: 1 }).then(json);
        const done = await send("POST", "/api/ai/proposal/apply", { id: pid, which: "all" }).then(json);
        check(done.changes.map((c) => c.status).join() === "applied,rejected,applied" && bodyOf(written.notePath).includes("WB-EDIT " + find) && !bodyOf(item.path).includes("WB-REJECT") && /Smoked glass/.test(bodyOf("80. Global Data Store/Items/WB Test Goggles.md")),
            "applying one, rejecting one and applying the rest writes exactly the approved changes", JSON.stringify(done.changes.map((c) => [c.status, c.error])));
        const conv2 = (await send("POST", "/api/ai/chat", { message: "hi" }).then((r) => r.text())).split("\n")[0];
        const follow = await send("POST", "/api/ai/chat", { conversation: JSON.parse(conv2).conversation, message: "hi" }).then((r) => r.text());
        check(!/heard/.test(follow), "review notes go only to the conversation that proposed the changes");
        const cid = done.conversation;
        const told = (await send("POST", "/api/ai/chat", { conversation: cid, message: "and now?" }).then((r) => r.text())).trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.t === "text").map((e) => e.d).join("");
        check(/heard: Review of "Test changes": applied: 1, 3; rejected: 2/.test(told), "the assistant hears what was applied and rejected with the next message", told);
        // put the chapter back for the tests after this
        fs.writeFileSync(`${COPY}/${written.notePath}`, bodyOf(written.notePath).replace("WB-EDIT " + find, find));
    }
    doc.querySelector(".drawer-tabs button[title^='Collapse']").click(); await wait(300);
    // API chat conversations are saved and listed (History), and can be deleted
    {
        const saved = (await get("/api/ai/conversations")).conversations;
        const one = saved.find((x) => x.title.startsWith("search: Mara"));
        const shownC = one && await get(`/api/ai/conversation?id=${one.id}`);
        check(!!one && shownC.display[0]?.text === "search: Mara" && shownC.display[1]?.parts?.some((p) => p.kind === "tool"), "API chat conversations are saved with what was shown, and listed", JSON.stringify(saved.slice(0, 3)));
        check(fs.readdirSync(`${process.env.SETTINGS_DIR}/data/world-builder/conversations`).length === saved.length, "saved conversations live in the app's data folder");
        await send("DELETE", `/api/ai/conversation?id=${one.id}`);
        check(!(await get("/api/ai/conversations")).conversations.some((x) => x.id === one.id), "a conversation can be deleted from History");
    }
    // Claude Code: the terminal (here `cat`), its workspace, and World Builder's MCP server
    if (process.env.SETTINGS_DIR) {
        const ts = await get("/api/terminal/status");
        const started = await (await send("POST", "/api/terminal/start", { cols: 90, rows: 20 })).json();
        await send("POST", "/api/terminal/input", { data: "hello terminal\r" });
        await wait(400);
        const ctrl = new AbortController();
        const sse = await realFetch(new URL("/api/terminal/stream", BASE), { signal: ctrl.signal });
        const reader = sse.body.getReader(); let got = "";
        for (let i = 0; i < 10 && !got.includes("hello terminal"); i++) {
            const { value } = await Promise.race([reader.read(), wait(500).then(() => ({}))]);
            if (value) got += new TextDecoder().decode(value).split("\n").filter((l) => l.startsWith("data: ")).map((l) => Buffer.from(l.slice(6), "base64").toString()).join("");
        }
        ctrl.abort();
        check(started.running && got.includes("hello terminal"), "the terminal runs, takes keys and streams what it shows", got.slice(0, 200));
        check((await send("POST", "/api/terminal/resize", { cols: 120, rows: 30 })).ok, "the terminal can be resized");
        const ws = `${process.env.SETTINGS_DIR}/data/world-builder/claude-code`;
        const cfg = JSON.parse(fs.readFileSync(`${ws}/.claude/settings.json`, "utf8"));
        const mcpCfg = JSON.parse(fs.readFileSync(`${ws}/mcp.json`, "utf8"));
        const token = mcpCfg.mcpServers["world-builder"].headers.Authorization.slice(7);
        check(ts.workspace === ws && cfg.permissions.allow.includes("mcp__world-builder") && cfg.permissions.deny.includes(`Read(/${COPY}/**)`) && cfg.permissions.deny.includes(`Edit(/${COPY}/**)`) && cfg.permissions.deny.includes("Bash")
            && /127\.0\.0\.1:\d+\/mcp$/.test(mcpCfg.mcpServers["world-builder"].url) && (fs.statSync(`${ws}/mcp.json`).mode & 0o777) === 0o600 && /Never read, search or edit the vault's files/.test(fs.readFileSync(`${ws}/CLAUDE.md`, "utf8")),
            "the workspace allows World Builder's tools and refuses the vault's files and shell commands", JSON.stringify(cfg));
        await send("POST", "/api/terminal/stop");
        check(!(await get("/api/terminal/status")).running, "the session can be ended");
        // the MCP server
        const rpc = (body, headers = {}) => realFetch(new URL("/mcp", BASE), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
        const call = async (method, params, id = 1) => (await (await rpc({ jsonrpc: "2.0", id, method, params })).json()).result;
        check((await realFetch(new URL("/mcp", BASE), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 401 && (await rpc({}, { origin: "https://example.com" })).status === 403,
            "the MCP server needs the workspace's token and refuses web pages");
        const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        check(init.serverInfo.name === "world-builder" && init.protocolVersion === "2025-06-18" && /Never read, search or edit the vault's files/.test(init.instructions) && /propose_changes/.test(init.instructions), "MCP initialize gives the rules and the vault's conventions as instructions");
        check((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "MCP notifications are accepted");
        const tl = (await call("tools/list")).tools;
        check(["search", "read_chapter", "character_state", "propose_changes", "proposal_status", "current_view"].every((n) => tl.some((t) => t.name === n)) && tl.find((t) => t.name === "search").annotations.readOnlyHint, "MCP lists the tools, read-only ones marked so");
        check((await call("prompts/list")).prompts.some((p) => p.name === "review-chapter") && /propose_changes/.test((await call("prompts/get", { name: "review-chapter", arguments: { novel: "X", chapter: "3" } })).messages[0].content.text), "MCP offers prompts (slash commands in Claude Code)");
        const sr = await call("tools/call", { name: "read_note", arguments: { note: "90. Templater/Data Store Schema.md" } });
        check(sr.isError && /outside the novels/.test(sr.content[0].text), "MCP tools keep to the novels and the data store");
        await send("POST", "/api/ai/view", { view: { page: "Test page", selection: "picked words" } });
        check(/picked words/.test((await call("tools/call", { name: "current_view", arguments: {} })).content[0].text), "current_view over MCP reports what the page shows");
        const item2 = v.inFolder("80. Global Data Store/Items")[0];
        const pr = await call("tools/call", { name: "propose_changes", arguments: { title: "MCP test", changes: [{ action: "edit_fields", note: item2.path, set: { description: "WB-MCP" } }] } });
        const pid2 = /Proposal id: (\w+)/.exec(pr.content[0].text)?.[1];
        check(!!pid2 && /waiting/.test((await call("tools/call", { name: "proposal_status", arguments: { id: pid2 } })).content[0].text), "a proposal over MCP waits for review");
        const waiting = call("tools/call", { name: "proposal_status", arguments: { id: pid2, wait_seconds: 10 } });
        await wait(300);
        await send("POST", "/api/ai/proposal/reject", { id: pid2, which: "all" });
        check(/1\. rejected[\s\S]*decided on every change/.test((await waiting).content[0].text) && !fs.readFileSync(`${COPY}/${item2.path}`, "utf8").includes("WB-MCP"), "proposal_status waits for the decision and reports it");
    }
    // the API key: checked, kept owner-only in secrets.json, never sent back whole
    if (process.env.SETTINGS_DIR) {
        check((await send("POST", "/api/ai/settings", { apiKey: "not-a-key" })).status === 400, "something that isn't an API key is refused");
        const key = "sk-ant-api03-" + "x".repeat(40) + "WXYZ";
        const saved = await (await send("POST", "/api/ai/settings", { apiKey: key, effort: "high", model: "claude-sonnet-5-5" })).json();
        const file = `${process.env.SETTINGS_DIR}/books-meta-viewer/secrets.json`;
        check(saved.hasKey && saved.keyHint === "…WXYZ" && !JSON.stringify(saved).includes(key) && (fs.statSync(file).mode & 0o777) === 0o600 && saved.effort === "high" && saved.model === "claude-sonnet-5-5",
            "a saved key is kept owner-only and only its last four characters are shown", JSON.stringify(saved));
        const removed = await (await send("POST", "/api/ai/settings", { removeKey: true, effort: "medium", model: "claude-opus-5-5" })).json();
        check(!removed.hasKey && !JSON.parse(fs.readFileSync(file, "utf8")).anthropicKey, "the key can be removed");
    }
}
// settings: the vault folder can be browsed and switched (the test server keeps its settings in SETTINGS_DIR)
if (process.env.SETTINGS_DIR) {
    const doc = w.document;
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    w.location.hash = "#/settings";
    await wait(900);
    check(doc.querySelector("main")?.textContent.includes(COPY) && [...doc.querySelectorAll(".folders button.link")].some((b) => b.textContent === "80. Global Data Store"),
        "settings page shows the vault folder and browses its folders");
    const notesBefore = (await get("/api/index")).notes.length;
    const other = `${process.env.SETTINGS_DIR}/Other Vault`;
    fs.mkdirSync(`${other}/.obsidian`, { recursive: true });
    fs.writeFileSync(`${other}/Hello.md`, "# Hello\n");
    const listed = await get(`/api/settings/folders?path=${enc(process.env.SETTINGS_DIR)}`);
    check(listed.folders.some((f) => f.name === "Other Vault" && f.vault), "the folder picker marks Obsidian vaults");
    check((await send("POST", "/api/settings", { vault: `${other}/missing` })).status === 400, "a folder that doesn't exist is refused");
    const r = await send("POST", "/api/settings", { vault: other });
    const saved = JSON.parse(fs.readFileSync(`${process.env.SETTINGS_DIR}/books-meta-viewer/settings.json`, "utf8"));
    check(r.notes === 1 && (await get("/api/settings")).vault === other && saved.vault === other, "switching the vault opens it and saves the choice", JSON.stringify(r));
    await send("POST", "/api/settings", { vault: COPY });
    check((await get("/api/index")).notes.length === notesBefore, "switching back opens the first vault again");
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
