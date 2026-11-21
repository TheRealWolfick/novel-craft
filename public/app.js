// Novel Craft front end: Preact + htm, no build step.
import { h, render, Component } from "preact";
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import htm from "htm";
import { parseOutline, serializeOutline } from "./outline.js";
import { parseLevels } from "./levels.js";
import { MapEditor } from "./map-editor.js";
import { WorldView, WorldOutline, MapAssetsView } from "./world.js";
import { WriterDrawer, openWriter, useWriter, collapseWriter, toggleWriter, expandWriter, BlockEditor, openOnLeft, closeLeftTab, renameLeftTab } from "./writer.js";
import { joinSections, sectionRaw, preRaw, parseSections, isImagesSection } from "./sections.js";
import { inlineHtml, setSpeechGroups } from "./blocks.js";
import { CalloutDesigner, useCalloutStyles } from "./callout-designer.js";
import { ImportView } from "./importer.js";
import { DocsView, DocArticle } from "./docs.js";
import { AiPane, AiSettingsPanel, BotIcon, ProposalView } from "./ai.js";
import { FIELD_TYPES, normalizeTemplates, checkTemplate, checkValue, fromText, toText, parseResource, computeValues, displayValue, defaultKey, fieldId, namesField, fieldNamed, isDerived, optionOf, applyChange, isChange, thresholdRows, facetChoice, stateFrom, replayLine, valuesFromState, driftOf, sourceOf, UNLINKED } from "./stats-core.js";

const html = htm.bind(h);

// ------------------------------------------------------------------ API + live updates

async function asJson(r) {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
}
const api = {
    get: (url) => fetch(url).then(asJson),
    send: (method, url, body, raw) => fetch(url, {
        method,
        headers: { "x-requested-with": "books-meta-viewer", ...(raw ? {} : { "content-type": "application/json" }) },
        body: raw ?? JSON.stringify(body ?? {}),
    }).then(asJson),
};
const qs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

let vaultVersion = 0;
const versionListeners = new Set();
const events = new EventSource("/api/events");
events.onmessage = (e) => {
    vaultVersion = JSON.parse(e.data).version;
    versionListeners.forEach((f) => f(vaultVersion));
};
// Claude Code (through Novel Craft's MCP server) proposed changes: open them for review in the drawer
events.addEventListener?.("proposal", (e) => {
    const p = JSON.parse(e.data);
    openInDrawer(`#/proposal/${p.id}`);
    toast(`Claude proposed ${p.count} change${p.count === 1 ? "" : "s"} for review`);
});
function useVersion() {
    const [v, setV] = useState(vaultVersion);
    useEffect(() => { versionListeners.add(setV); return () => versionListeners.delete(setV); }, []);
    return v;
}
/** Fetch JSON, refetching whenever the vault changes */
function useApi(url) {
    const v = useVersion();
    const [state, set] = useState({ data: null, error: null });
    useEffect(() => {
        if (!url) return;
        let live = true;
        api.get(url).then((d) => live && set({ data: d, error: null })).catch((e) => live && set((s) => ({ data: s.data, error: e.message })));
        return () => { live = false; };
    }, [url, v]);
    return state;
}

// ------------------------------------------------------------------ helpers

const linkLabel = (v) => {
    const m = String(v ?? "").match(/^!?\[\[([^\]]+)\]\]$/);
    if (!m) return String(v ?? "");
    const [t, alias] = m[1].split("|");
    return (alias ?? t.split("#")[0].split("/").pop()).trim();
};
const isLink = (v) => typeof v === "string" && /^!?\[\[[^\]]+\]\]$/.test(v.trim());
const toLink = (name) => `[[${name}]]`;
const asList = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const noteHref = (p) => `#/note/${encodeURIComponent(p)}`;
const collectionLabel = (c) => c?.replace(/^Taxonomy\//, "") ?? "";
const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ scroll memory

// the page the app opened on (where you were when it closed): only its scroll position comes back by itself
const START_HASH = location.hash;
let leftStart = false;
addEventListener("hashchange", () => { if (location.hash !== START_HASH) leftStart = true; });
const onStartPage = () => !leftStart && location.hash === START_HASH;

const SCROLL_KEY = "scrollPlaces", SCROLL_KEPT = 150;
/**
 * Remembers where a scrolling area was (localStorage scrollPlaces, by `key`) and goes back there when it shows again,
 * also after the app restarts. `box` is a ref (or window) whose scrolling element `scroller(box)` finds (default: the box
 * itself), looked up each time, so a scroller that is re-rendered still counts. With `rows` (a selector) the place is
 * the row at the top of the view and how far into it, so it survives another width or text size; otherwise px.
 * Content that arrives later is waited for (a few tries over 3 s); scrolling, clicking or typing there stops the tries.
 * `restore: false` only saves.
 */
export function useScrollMemory(box, key, { ready = true, rows = null, scroller = null, restore = true } = {}) {
    useLayoutEffect(() => {
        const root = box === window ? window : box?.current;
        if (!ready || !root || !key) return;
        const find = () => (scroller ? scroller(root) : root === window ? document.scrollingElement : root);
        const topOf = (el) => (el === document.scrollingElement ? 0 : el.getBoundingClientRect().top);
        const p = restore ? store.get(SCROLL_KEY, {})[key] : null;
        let moved = false, restoring = !!p, timer = null;
        const apply = () => {
            const el = find();
            if (moved || !p || !el) return;
            const row = rows && p.block != null ? el.querySelectorAll(rows)[p.block] : null;
            el.scrollTop = row ? el.scrollTop + row.getBoundingClientRect().top - topOf(el) + p.off : p.top ?? 0;
        };
        const save = () => {
            const el = find();
            if (!el || el.closest?.("[hidden]")) return;   // a hidden tab: its scroll position means nothing now
            let block = null, off = 0;
            if (rows) {
                const top = topOf(el), all = el.querySelectorAll(rows);
                for (let k = 0; k < all.length; k++) {
                    const r = all[k].getBoundingClientRect();
                    if (r.bottom > top) { block = k; off = Math.round(top - r.top); break; }
                }
            }
            const places = store.get(SCROLL_KEY, {});
            places[key] = { top: Math.round(el.scrollTop), block, off, at: Date.now() };
            const keys = Object.keys(places);
            if (keys.length > SCROLL_KEPT) keys.sort((x, y) => (places[x].at ?? 0) - (places[y].at ?? 0)).slice(0, keys.length - SCROLL_KEPT).forEach((k) => delete places[k]);
            store.set(SCROLL_KEY, places);
        };
        const onScroll = (e) => {
            const el = find();
            if (!el || (e.target !== el && !(e.target === document && el === document.scrollingElement))) return;
            if (restoring && !moved) return;   // our own scrolling while the content is still arriving
            clearTimeout(timer);
            timer = setTimeout(save, 250);
        };
        const mine = () => { moved = true; restoring = false; };
        const INPUT = ["wheel", "pointerdown", "keydown", "touchstart"];
        root.addEventListener("scroll", onScroll, { capture: true, passive: true });
        for (const ev of INPUT) root.addEventListener(ev, mine, { passive: true });
        apply();
        const tries = [100, 300, 700, 1500, 3000].map((ms, k, all) => setTimeout(() => { apply(); if (k === all.length - 1) restoring = false; }, ms));
        return () => {
            tries.forEach(clearTimeout);
            clearTimeout(timer);
            root.removeEventListener("scroll", onScroll, { capture: true });
            for (const ev of INPUT) root.removeEventListener(ev, mine);
        };
    }, [ready, key, restore]);
}

// ------------------------------------------------------------------ theme: light / dark / system, novel accents

const THEMES = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
function applyTheme(mode) {
    if (mode === "light" || mode === "dark") document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
}
// Default colour per novel (by position in the novel list) until config.md sets `accent`
const NOVEL_PALETTE = ["#3D7A5A", "#2F6FB0", "#B03A5B", "#8A4FB8", "#A6621B", "#5E6B78", "#2E7F86", "#7A6A2E", "#B5482F", "#4A5DB0"];
const novelColour = (index, folder) => {
    const i = index?.novels.findIndex((n) => n.folder === folder) ?? -1;
    if (i < 0) return null;
    const own = index.novels[i].accent;
    return /^#[0-9a-f]{6}$/i.test(String(own ?? "")) ? own : NOVEL_PALETTE[i % NOVEL_PALETTE.length];
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mixHex = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const luminance = (hex) => {
    const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** Nudge a colour toward black (light theme) or white (dark theme) until text in it reads at 4.5:1 on every surface */
function readableAccent(hex, dark) {
    const panel = dark ? "#27262c" : "#f0eee9"; // --panel-2, the surface closest to the accent
    let c = dark ? mixHex(hex, "#ffffff", 0.3) : hex;
    for (let i = 0; i < 24 && contrast(c, panel) < 4.6; i++) c = mixHex(c, dark ? "#ffffff" : "#000000", 0.08);
    return c;
}
// Appearance (Settings): the app's own accent (used where no novel colours the page), fonts and sizes, per device
const UI_FONTS = { system: ["System", 'system-ui, -apple-system, "Segoe UI", sans-serif'], humanist: ["Humanist sans", '"Cantarell", "Segoe UI", "Noto Sans", system-ui, sans-serif'], serif: ["Serif (Newsreader)", '"Newsreader", Georgia, serif'], rounded: ["Rounded", '"Nunito", "Varela Round", "Quicksand", system-ui, sans-serif'], mono: ["Monospace", "ui-monospace, \"JetBrains Mono\", Menlo, monospace"] };
const READ_FONTS = { serif: ["Newsreader (serif)", '"Newsreader", "Iowan Old Style", Georgia, serif'], georgia: ["Georgia", 'Georgia, "Times New Roman", serif'], sans: ["Sans serif", 'system-ui, "Segoe UI", sans-serif'], humanist: ["Humanist sans", '"Cantarell", "Segoe UI", "Noto Sans", sans-serif'], mono: ["Monospace (typewriter)", '"Courier Prime", "Courier New", ui-monospace, monospace'] };
const ACCENTS = ["#6a4fc4", "#2f6fb0", "#3d7a5a", "#b03a5b", "#a6621b", "#2e7f86", "#8a4fb8", "#5e6b78"];
/** sRGB hex <-> OKLab (perceptual lightness L 0..1, a, b) */
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLin = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function hexToOklab(hex) {
    const [r, g, b] = rgb(hex).map((v) => toLin(v / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(fromLin);
}
// perceived lightness (OKLab L) of the light and dark page (--panel); speech colours are mirrored between them
const PAGE_L = { light: 1, dark: 0.245 };
/** The same colour with its brightness mirrored between the light and dark page, so it stands out from either as much
 *  (hue kept; colourfulness reduced only as far as sRGB needs) */
function invertLightness(hex) {
    const [L, a, b] = hexToOklab(hex);
    const L2 = Math.min(0.99, Math.max(0.01, PAGE_L.light + PAGE_L.dark - L));
    const ok = (k) => oklabToRgb([L2, a * k, b * k]).every((v) => v >= -0.0005 && v <= 1.0005);
    let lo = 0, hi = 1;
    if (!ok(1)) for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    else lo = 1;
    return toHex(oklabToRgb([L2, a * lo, b * lo]).map((v) => v * 255));
}
/** A picked speech colour as {light, dark}: a darker colour is the light theme's (dark mode gets it mirrored), a lighter one the dark theme's */
function themePair(hex) {
    const inv = invertLightness(hex);
    return hexToOklab(hex)[0] < (PAGE_L.light + PAGE_L.dark) / 2 ? { light: hex, dark: inv } : { light: inv, dark: hex };
}
const SPEECH_KEYS = [["speechColor", "--speech"], ["speechSingle", "--speech-single"], ["speechItalic", "--speech-em"], ["speechBold", "--speech-strong"], ["speechBoldItalic", "--speech-strong-em"]];
// your own groupings ([…], <<…>>): up to SPEECH_GROUPS, each its colour as --sg-<n> (light-dark() follows the theme)
const SPEECH_GROUPS = 8;
const CHAPTER_VARS = ["--writer-para", "--writer-col", ...SPEECH_KEYS.flatMap(([, v]) => [`${v}-light`, `${v}-dark`]), ...Array.from({ length: SPEECH_GROUPS }, (_, k) => `--sg-${k}`)];
function applyAppearance(a = {}) {
    const vars = {};
    if (a.accent) { vars["--app-accent"] = readableAccent(a.accent, false); vars["--app-accent-dark"] = readableAccent(a.accent, true); }
    if (UI_FONTS[a.uiFont] && a.uiFont !== "system") vars["--font-ui"] = UI_FONTS[a.uiFont][1];
    if (READ_FONTS[a.readFont] && a.readFont !== "serif") vars["--font-read"] = READ_FONTS[a.readFont][1];
    if (a.writerSize) vars["--writer-size"] = `${a.writerSize}px`;
    if (a.readSize) vars["--read-size"] = `${a.readSize}px`;
    if (a.writerPara != null) vars["--writer-para"] = `${a.writerPara}em`;
    if (a.writerWidth >= 400) vars["--writer-col"] = `${a.writerWidth}px`; // a maximum: the column never gets wider than the writer
    // speech colours: one per theme (style.css picks --speech from --speech-light or --speech-dark)
    if (a.speechColor) for (const [k, v] of SPEECH_KEYS) if (a[k]) { const p = themePair(a[k]); vars[`${v}-light`] = p.light; vars[`${v}-dark`] = p.dark; }
    const groups = (a.speechGroups ?? []).slice(0, SPEECH_GROUPS);
    groups.forEach((g, k) => { if (g.color) { const p = themePair(g.color); vars[`--sg-${k}`] = `light-dark(${p.light}, ${p.dark})`; } });
    setSpeechGroups(groups);
    store.set("speechGroups", groups.map(({ open, close }) => ({ open, close })));
    const st = document.documentElement.style;
    // (the plain --speech… names are an earlier version's, set inline they would win over the theme's)
    for (const k of ["--app-accent", "--app-accent-dark", "--font-ui", "--font-read", "--writer-size", "--read-size", ...CHAPTER_VARS, ...SPEECH_KEYS.map(([, v]) => v)]) { if (vars[k]) st.setProperty(k, vars[k]); else st.removeProperty(k); }
    // interface size: the desktop app zooms the window; a browser page zooms the document
    const scale = a.uiScale && a.uiScale !== 1 ? a.uiScale : 1;
    if (typeof window.__wbZoom === "function") window.__wbZoom(scale);
    else st.zoom = scale === 1 ? "" : String(scale);
    store.set("appearanceVars", vars);
}

setSpeechGroups(store.get("speechGroups", []));

function applyNovelAccent(hex) {
    const st = document.documentElement.style;
    if (!hex) { st.removeProperty("--novel-accent"); st.removeProperty("--novel-accent-dark"); return; }
    st.setProperty("--novel-accent", readableAccent(hex, false));
    st.setProperty("--novel-accent-dark", readableAccent(hex, true));
}

let toastTimer;
/** Short message in the corner; `action` {label, run} adds a button (e.g. Undo) and keeps it up longer */
function toast(msg, action) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.append(el); }
    el.textContent = msg;
    if (action) {
        const b = Object.assign(document.createElement("button"), { textContent: action.label, className: "toast-action" });
        b.onclick = () => { el.style.display = "none"; action.run(); };
        el.append(b);
    }
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, action ? 6000 : 2200);
}
async function copyText(text, label = "Copied to clipboard") {
    try { await navigator.clipboard.writeText(text); toast(label); }
    catch {
        const ta = Object.assign(document.createElement("textarea"), { value: text });
        document.body.append(ta); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        toast(ok ? label : "Copy failed: select the text manually");
    }
}

// ------------------------------------------------------------------ router

function useRoute() {
    const [hash, setHash] = useState(location.hash);
    useEffect(() => { const f = () => setHash(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
    const [path, query] = hash.replace(/^#\/?/, "").split("?");
    const parts = path.split("/").map(decodeURIComponent);
    return { name: parts[0] || "home", args: parts.slice(1), params: new URLSearchParams(query ?? "") };
}
const go = (href) => { location.hash = href; };
/** Pages shown in the side drawer or a left-drawer tab use the drawer's layout (scope "drawer" / "left") */
const inDrawer = (scope) => scope === "drawer" || scope === "left";

// ------------------------------------------------------------------ unsaved edits

const dirtyForms = new Map(); // `${scope}:${path}` -> true
const markDirty = (scope, path, dirty) => { if (dirty) dirtyForms.set(`${scope}:${path}`, true); else dirtyForms.delete(`${scope}:${path}`); };
const hasDirty = (scope) => [...dirtyForms.keys()].some((k) => k.startsWith(`${scope}:`));
const confirmDiscard = (scope) => !hasDirty(scope) || confirm("Discard unsaved changes?");
addEventListener("beforeunload", (e) => { if (dirtyForms.size) e.preventDefault(); });

// ------------------------------------------------------------------ side drawer (note and chapter links in tables and inside the drawer)

// The drawer has three tabs: the viewer (the five most recent drawer pages, hrefs #/note/… or #/chapter/…, newest
// first; recent[0] is shown), lookup (search everything, with recently opened results) and the novel you are in.
// It never closes: it collapses to buttons on the right edge and stays mounted, so unsaved edits survive navigation.
const DRAWER_RECENT = 5;
// "ai" appears once the robot button has been used (drawer.ai), and stays
const DRAWER_TABS = [["viewer", "Viewer"], ["lookup", "Lookup"], ["datastore", "Data store"], ["taxonomy", "Taxonomy"], ["novel", "Novel"], ["ai", "AI"]];
// where the drawer was when the app last closed (a convenience: the pages, the tab, open or not)
let drawer = (() => { try { const d = JSON.parse(localStorage.getItem("drawerState")); if (d && Array.isArray(d.recent)) return { recent: d.recent.slice(0, DRAWER_RECENT), open: !!d.open && (d.recent.length > 0 || d.tab !== "viewer"), tab: d.tab ?? "viewer", ai: !!d.ai }; } catch { /* none */ } return { recent: [], open: false, tab: "viewer" }; })();
const drawerListeners = new Set();
const setDrawer = (d) => { drawer = d; drawerListeners.forEach((f) => f(d)); try { localStorage.setItem("drawerState", JSON.stringify(d)); } catch { /* private window */ } };
function useDrawer() {
    const [d, set] = useState(drawer);
    useEffect(() => { drawerListeners.add(set); return () => drawerListeners.delete(set); }, []);
    return d;
}
function collapseDrawer() { if (drawer.open) setDrawer({ ...drawer, open: false }); }
function expandDrawer() { if (!drawer.open) setDrawer({ ...drawer, open: true }); }
/** Open the drawer on a tab (viewer, lookup, novel) */
function openDrawerTab(tab) { setDrawer({ ...drawer, open: true, tab, ai: drawer.ai || tab === "ai" }); }
/** The robot button: opens the AI tab, or collapses the drawer when the AI tab is already showing */
function toggleAi() { if (drawer.open && drawer.tab === "ai") collapseDrawer(); else openDrawerTab("ai"); }
// opening a page shows the viewer and moves the page to the front of the recent list (a known page moves up, others shift right)
function openInDrawer(href) {
    if (drawer.recent[0] === href) return setDrawer({ ...drawer, open: true, tab: "viewer" });
    if (!confirmDiscard("drawer")) return;
    setDrawer({ ...drawer, recent: [href, ...drawer.recent.filter((h) => h !== href)].slice(0, DRAWER_RECENT), open: true, tab: "viewer" });
}
// Note and chapter links inside a [data-drawer] container open in the drawer; [data-page] links and modified clicks don't
document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="#/note/"], a[href^="#/chapter/"]');
    if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || a.hasAttribute("data-page") || !a.closest("[data-drawer]")) return;
    e.preventDefault();
    openInDrawer(a.getAttribute("href"));
});
// Escape collapses the drawer (not while typing in the writer, and not under an open lightbox)
// Ctrl+[ opens / closes the writer (left), Ctrl+] the drawer (right), from anywhere (Ctrl+Shift+[ / ] / \ : the split, below)
addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key !== "[" && e.key !== "]")) return;
    if (e.key === "[" && e.target.closest?.(".xterm")) return;   // Ctrl+[ is Escape in a terminal
    e.preventDefault();
    if (e.key === "[") toggleWriter();
    else setDrawer({ ...drawer, open: !drawer.open });
});
// Ctrl+Shift+[ / ] move the split between the writer and the drawer (both open) left / right, Ctrl+Shift+\ (|) puts it
// back in the middle; the writer's share is kept in localStorage (drawerSplit) and set as --split
const SPLIT = { min: 0.25, max: 0.75, step: 0.05 };
const applySplit = (v) => { if (v === 0.5) document.documentElement.style.removeProperty("--split"); else document.documentElement.style.setProperty("--split", String(v)); };
applySplit(store.get("drawerSplit", 0.5));
addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || !["BracketLeft", "BracketRight", "Backslash"].includes(e.code)) return;
    e.preventDefault(); e.stopPropagation();   // (before a terminal reads it as a key for itself)
    const cur = store.get("drawerSplit", 0.5);
    const next = e.code === "Backslash" ? 0.5 : Math.round(Math.min(SPLIT.max, Math.max(SPLIT.min, cur + (e.code === "BracketLeft" ? -SPLIT.step : SPLIT.step))) * 100) / 100;
    store.set("drawerSplit", next);
    applySplit(next);
    const w = Math.round(next * 100);
    toast(`Writer ${w}% · drawer ${100 - w}%${e.code === "Backslash" ? " (reset)" : ""}`);
}, true);
// (an Escape something already handled doesn't count, nor one from an element its handler has just removed)
// Escape never collapses the drawer (it cancels things inside it instead: see useEscapeTwice); the » button, the
// backdrop and Ctrl+] do.

// a renamed note's drawer page follows it
function renameInDrawer(from, to) { if (drawer.recent.includes(from)) setDrawer({ ...drawer, recent: drawer.recent.map((h) => (h === from ? to : h)) }); }

// a deleted note leaves the recent list; the drawer collapses when nothing is left
function dropFromDrawer(href) {
    const recent = drawer.recent.filter((h) => h !== href);
    setDrawer({ ...drawer, recent, open: drawer.open && (recent.length > 0 || drawer.tab !== "viewer") });
}

// Choosing an item for a form (a ledger line) from the drawer: while set, collection pages of `collections` and item
// notes show "Add" buttons, and a note made in the drawer is taken at once. {label, collections, pick(name)}
let itemPick = null;
const pickListeners = new Set();
const setItemPick = (p) => { itemPick = p; pickListeners.forEach((f) => f(p)); };
function useItemPick() {
    const [p, set] = useState(itemPick);
    useEffect(() => { pickListeners.add(set); return () => pickListeners.delete(set); }, []);
    return p;
}
const pickable = (p, collection) => !!p && p.collections.includes(collection);
/** Browse items in the drawer for a form; `pick(name)` gets the chosen (or new) item's note name */
function browseItems({ label, collections = ["Items", "Materials", "Recipes"], pick }) {
    setItemPick({ label, collections, pick: (name) => { setItemPick(null); collapseDrawer(); pick(name); toast(`Added ${name}`); } });
    openInDrawer(`#/c/${encodeURIComponent(collections[0])}`);
}

const parseDrawerHref = (href) => href.replace(/^#\//, "").split("/").map(decodeURIComponent);
/** "#/entry/<folder>?owner=…&chapter=…" -> {folder, params} (the query is split off before decoding, so values keep their & and =) */
const entryParams = (href) => { const [f, q = ""] = href.replace(/^#\/entry\//, "").split("?"); return { folder: decodeURIComponent(f), params: new URLSearchParams(q) }; };
function drawerLabel(href, index) {
    const [name, ...args] = parseDrawerHref(href);
    if (name === "chapter") return `Chapter ${args[1]}`;
    if (name === "entry") { const p = entryParams(href).params; return p.get("key") ? `Edit entry ${p.get("key")}` : `New entry${p.get("chapter") ? ` · ch ${p.get("chapter")}` : ""}`; }
    if (name === "newchar") return "New character";
    if (name === "proposal") return "Review changes";
    if (name === "docs") return `Docs: ${(args[0] ?? "").split("?")[0].replace(/-/g, " ")}`;
    if (name === "c") return collectionLabel(args.join("/"));
    if (name === "new") return `New ${index?.schema.collections[args.join("/")]?.label ?? collectionLabel(args.join("/"))}`;
    const path = args.join("/");
    const n = index?.notes.find((x) => x.path === path);
    return n?.fm.title || n?.name || path.split("/").pop().replace(/\.md$/, "");
}

function Drawer({ index, novel }) {
    const d = useDrawer();
    const tab = (d.tab === "novel" && !novel) || (d.tab === "ai" && !d.ai) ? "viewer" : d.tab;
    // panes stay mounted once shown, so a half-typed search or unsaved edits survive switching tabs
    const [seen, setSeen] = useState(() => new Set([tab]));
    useEffect(() => { if (!seen.has(tab)) setSeen(new Set([...seen, tab])); }, [tab]);
    // each tab (and each page in the viewer) keeps where it was scrolled to, also after a restart
    const panes = { viewer: useRef(), lookup: useRef(), datastore: useRef(), taxonomy: useRef(), novel: useRef() };
    const body = (pane) => pane.querySelector(":scope > .drawer-body");
    useScrollMemory(panes.viewer, d.recent[0] && `drawer:${d.recent[0]}`, { ready: tab === "viewer", scroller: body });
    useScrollMemory(panes.lookup, "drawer:lookup", { ready: tab === "lookup" && seen.has("lookup"), scroller: body });
    useScrollMemory(panes.datastore, "drawer:datastore", { ready: tab === "datastore" && seen.has("datastore"), scroller: body });
    useScrollMemory(panes.taxonomy, "drawer:taxonomy", { ready: tab === "taxonomy" && seen.has("taxonomy"), scroller: body });
    useScrollMemory(panes.novel, novel && `drawer:novel:${novel}`, { ready: tab === "novel" && seen.has("novel"), scroller: body });
    const tabs = DRAWER_TABS.filter(([k]) => (k !== "novel" || novel) && (k !== "ai" || d.ai));
    const label = (h) => drawerLabel(h, index);
    const href = d.recent[0];
    const sideLabel = (k, l) => (k === "viewer" && href ? `${l}: ${label(href)}` : k === "novel" && novel ? `${l}: ${novelName(index, novel)}` : l);
    return html`<div class=${`drawer-wrap ${d.open ? "open" : "collapsed"}`}>
        <div class="drawer-side" role="group" aria-label="Open the drawer">${tabs.map(([k, l]) => html`<button key=${k}
            class=${`drawer-tab ${k === tab ? "current" : ""}`} title=${sideLabel(k, l)} tabIndex=${d.open ? -1 : 0}
            onClick=${() => openDrawerTab(k)}><span>${sideLabel(k, l)}</span></button>`)}</div>
        <aside class="drawer" data-drawer inert=${!d.open}>
            <div class="drawer-tabs" role="tablist">
                ${tabs.map(([k, l]) => html`<button key=${k} role="tab" aria-selected=${k === tab} class=${k === tab ? "on" : ""} onClick=${() => openDrawerTab(k)}>${sideLabel(k, l)}</button>`)}
                <span class="grow" />
                <button class="small" title="Open this tab in the left drawer too" aria-label="Open on the left" disabled=${tab === "viewer" && !href}
                    onClick=${() => openOnLeft(tab === "viewer" ? href : tab === "novel" ? `pane:novel:${novel}` : `pane:${tab}`)}>⇤ On the left</button>
                <button class="small" title="Collapse (Ctrl+])" onClick=${collapseDrawer}>»</button>
            </div>
            <div class="drawer-pane" hidden=${tab !== "viewer"} ref=${panes.viewer}><${DrawerViewer} index=${index} d=${d} /></div>
            ${seen.has("lookup") && html`<div class="drawer-pane" hidden=${tab !== "lookup"} ref=${panes.lookup}><${Lookup} index=${index} novel=${novel} active=${tab === "lookup" && d.open} /></div>`}
            ${seen.has("datastore") && html`<div class="drawer-pane" hidden=${tab !== "datastore"} ref=${panes.datastore}><${BrowsePane} index=${index} taxonomy=${false} active=${tab === "datastore" && d.open} /></div>`}
            ${seen.has("taxonomy") && html`<div class="drawer-pane" hidden=${tab !== "taxonomy"} ref=${panes.taxonomy}><${BrowsePane} index=${index} taxonomy=${true} active=${tab === "taxonomy" && d.open} /></div>`}
            ${novel && seen.has("novel") && html`<div class="drawer-pane" hidden=${tab !== "novel"} ref=${panes.novel}><${NovelDrawer} key=${novel} folder=${novel} index=${index} /></div>`}
            ${d.ai && seen.has("ai") && html`<div class="drawer-pane" hidden=${tab !== "ai"}><${AiPane} active=${tab === "ai" && d.open} /></div>`}
        </aside>
    </div>`;
}
const novelName = (index, folder) => index?.novels.find((n) => n.folder === folder)?.name ?? folder.replace(/^\d+\.\s*/, "");

/** The viewer tab: recent pages as boxes, the newest one shown */
function DrawerViewer({ index, d }) {
    const pick = useItemPick();
    const label = (h) => drawerLabel(h, index);
    if (!d.recent.length) return html`<div class="drawer-body"><div class="drawer-empty muted">
        <p>Nothing opened yet. Links in tables, the novel tab and lookup results open here.</p>
        <button onClick=${() => openDrawerTab("lookup")}>Look something up</button></div></div>`;
    const href = d.recent[0];
    const [name, ...args] = parseDrawerHref(href);
    return html`<div class="drawer-head">
            <div class="drawer-recent">${d.recent.map((h, i) => html`<button key=${h} class=${i ? "" : "on"} title=${h.replace(/^#\//, "")}
                onClick=${() => openInDrawer(h)}>${label(h)}</button>`)}</div>
            <button onClick=${() => { collapseDrawer(); go(href); }}>Open page</button>
        </div>
        <div class="drawer-body" key=${href}>
            ${pick && html`<div class="pick-banner"><span>Choosing for <b>${pick.label}</b>: press Add on a row, or open one and press Use this.</span>
                <span class="row">${pick.collections.map((c) => html`<button class=${`small ${name === "c" && args.join("/") === c ? "on" : ""}`} onClick=${() => openInDrawer(`#/c/${encodeURIComponent(c)}`)}>${collectionLabel(c)}</button>`)}
                    <button class="small" onClick=${() => setItemPick(null)}>Cancel</button></span></div>`}
            <${ErrorBoundary} reset=${href}>${drawerPage(href, index, "drawer")}<//></div>`;
}

/** A drawer page (#/note/…, #/chapter/…, #/c/…, an entry, a form, docs) as shown in the side drawer or a left tab */
function drawerPage(href, index, scope) {
    const [name, ...args] = parseDrawerHref(href);
    if (name === "chapter") return html`<${ChapterView} folder=${args[0]} n=${args[1]} scope=${scope} />`;
    // a ledger entry written from the chapter view in the drawer; saving or cancelling goes back to that chapter
    if (name === "entry") {
        const { folder, params } = entryParams(href); const ch = params.get("chapter");
        return html`<${EntryEditor} index=${index} folder=${folder} params=${params} embedded=${true}
            onDone=${() => (ch ? openInDrawer(chapterHref(folder, ch)) : collapseDrawer())} />`;
    }
    if (name === "c") return html`<${CollectionView} index=${index} collection=${args.join("/")} novelFilter="" scope=${scope} />`;
    if (name === "new") return html`<${NoteForm} index=${index} collection=${args.join("/")} scope=${scope} />`;
    if (name === "newchar") return html`<${NoteForm} index=${index} collection="characters" novel=${args[0]} scope=${scope} />`;
    if (name === "proposal") return html`<${ProposalView} id=${args[0]} />`;
    if (name === "docs") return html`<${DocArticle} id=${args[0].split("?")[0]} section=${new URLSearchParams(args[0].split("?")[1] ?? "").get("s")} scope="drawer" />`;
    return html`<${NoteView} index=${index} path=${args.join("/")} scope=${scope} />`;
}

/** What a left-drawer tab is called: a page's title, or the pane's name */
export function tabLabel(key, index) {
    if (key === "pane:lookup") return "Lookup";
    if (key === "pane:datastore") return "Data store";
    if (key === "pane:taxonomy") return "Taxonomy";
    if (key === "pane:ai") return "AI";
    if (key.startsWith("pane:novel:")) return `Novel: ${novelName(index, key.slice(11))}`;
    return drawerLabel(key, index);
}

/**
 * A tab in the left drawer: a copy of a side-drawer page or pane. It shows the same data as the drawer (pages refetch on
 * every vault change, the assistant's conversation is shared), so a change in one shows in the other.
 */
export function LeftTab({ tab, index, active }) {
    const scroller = useRef();
    useScrollMemory(scroller, `left:${tab}`, { ready: active, scroller: (el) => el.querySelector(":scope > .drawer-body") });
    let body;
    if (tab === "pane:lookup") body = html`<${Lookup} index=${index} novel=${null} active=${active} />`;
    else if (tab === "pane:datastore" || tab === "pane:taxonomy") body = html`<${BrowsePane} index=${index} taxonomy=${tab === "pane:taxonomy"} active=${active} />`;
    else if (tab.startsWith("pane:novel:")) body = html`<${NovelDrawer} folder=${tab.slice(11)} index=${index} />`;
    else if (tab === "pane:ai") return html`<${AiPane} active=${active} />`;
    else body = html`<div class="drawer-body" data-drawer>${drawerPage(tab, index, "left")}</div>`;
    return html`<div class="left-tab-pane" data-drawer ref=${scroller}><${ErrorBoundary} reset=${tab}>${body}<//></div>`;
}

// ------------------------------------------------------------------ lookup (drawer tab)

const LOOKUP_KINDS = [["", "All"], ["data", "Data store"], ["taxonomy", "Taxonomy"], ["chapter", "Chapters"], ["character", "Characters"], ["plan", "Plans"], ["ledger", "Ledgers"], ["other", "Other"]];
const KIND_LABEL = Object.fromEntries(LOOKUP_KINDS);
const LOOKUP_RECENT = 30;

// Recently opened lookup results, newest first (a convenience kept in localStorage), shared by the lookup, data store
// and taxonomy tabs
let lookupRecent = store.get("lookupRecent", []);
const recentListeners = new Set();
const saveRecent = (l) => { lookupRecent = l; store.set("lookupRecent", l); recentListeners.forEach((f) => f(l)); };
const recent = {
    add: (r) => saveRecent([{ ...r, at: Date.now() }, ...lookupRecent.filter((x) => x.href !== r.href)].slice(0, LOOKUP_RECENT)),
    remove: (href) => saveRecent(lookupRecent.filter((x) => x.href !== href)),
    clear: () => saveRecent([]),
};
function useLookupRecent() {
    const [list, set] = useState(lookupRecent);
    useEffect(() => { recentListeners.add(set); return () => recentListeners.delete(set); }, []);
    return { list, ...recent };
}

/** "a b" -> text with every word marked */
function Marked({ text, words }) {
    if (!words.length || !text) return text ?? "";
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((part, i) => (i % 2 ? html`<mark>${part}</mark>` : part));
}

function Lookup({ index, novel, active }) {
    const [q, setQ] = useState(() => store.get("lookupQuery", ""));
    const [term, setTerm] = useState(q);
    const [kind, setKind] = useState("");
    const [onlyNovel, setOnlyNovel] = useState(store.get("lookupOnlyNovel", true));
    const [hl, setHl] = useState(0);
    const recent = useLookupRecent();
    const input = useRef();
    useEffect(() => { if (active) setTimeout(() => input.current?.focus(), 60); }, [active]);
    useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); store.set("lookupQuery", q); }, 200); return () => clearTimeout(t); }, [q]);
    const scoped = novel && onlyNovel ? novel : "";
    const { data, error } = useApi(term ? `/api/search?${qs({ q: term, kind, novel: scoped })}` : null);
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    const results = term && data ? data.results : [];
    useEffect(() => setHl(0), [term, kind, scoped]);
    const hrefOf = (r) => noteHref(r.path);
    const open = (r) => {
        const href = r.href ?? hrefOf(r);
        recent.add({ href, label: r.title || r.name, kind: r.kind, hint: r.hint ?? hintOf(r), path: r.path, novel: r.novel, chapter: r.chapter });
        openInDrawer(href);
    };
    const hintOf = (r) => (r.kind === "data" || r.kind === "taxonomy" ? collectionLabel(r.collection)
        : r.kind === "chapter" ? `${r.novelName} · chapter ${r.chapter ?? "?"}` : r.novelName ? `${r.novelName}${r.planType ? ` · ${r.planType}` : ""}` : r.path.split("/").slice(0, -1).join(" / "));
    const onKey = (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setHl(Math.min(hl + 1, results.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setHl(Math.max(hl - 1, 0)); }
        if (e.key === "Enter" && results[hl]) open(results[hl]);
        if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); }
    };
    const writeBtn = (r) => r.kind === "chapter" && r.chapter != null && html`<button class="small" title="Open in the writer"
        onClick=${(e) => { e.stopPropagation(); recent.add({ href: hrefOf(r), label: r.title || r.name, kind: r.kind, hint: hintOf(r), path: r.path, novel: r.novel, chapter: r.chapter }); openWriter(r.novel, r.chapter); }}>✎ Write</button>`;
    return html`<div class="drawer-body lookup">
        <div class="lookup-bar">
            <input ref=${input} type="search" class="grow" value=${q} placeholder="Look up notes, taxonomy, chapter text…" aria-label="Look up"
                onInput=${(e) => setQ(e.target.value)} onKeyDown=${onKey} />
            ${novel && html`<label class="row muted lookup-scope" title="Only this novel's chapters, characters, plans and ledgers (data store notes always count)">
                <input type="checkbox" checked=${onlyNovel} onChange=${(e) => { setOnlyNovel(e.target.checked); store.set("lookupOnlyNovel", e.target.checked); }} />
                Only ${novelName(index, novel)}</label>`}
        </div>
        ${term && html`<div class="lookup-kinds">${LOOKUP_KINDS.map(([k, l]) => {
            const n = k ? data?.counts?.[k] ?? 0 : data?.total ?? 0;
            return html`<button key=${k} class=${`chip ${kind === k ? "on" : ""} ${!n && k !== kind ? "off" : ""}`} onClick=${() => setKind(k)}>${l} <span class="count">${n}</span></button>`;
        })}</div>`}
        ${error && html`<p class="error">${error}</p>`}
        ${term ? html`<ul class="lookup-list" role="listbox" aria-label="Results">
            ${!data ? html`<li class="muted">Searching…</li>` : !results.length ? html`<li class="muted">Nothing found for “${term}”.</li>` : results.map((r, i) => html`<li key=${r.path} role="option" aria-selected=${i === hl}
                class=${`lookup-item ${i === hl ? "hl" : ""}`} onClick=${() => open(r)} onMouseEnter=${() => setHl(i)}>
                <div class="lookup-line"><b><${Marked} text=${r.title || r.name} words=${words} /></b>
                    ${r.title && r.title !== r.name && html`<span class="muted">${r.name}</span>`}
                    <span class=${`badge kind-${r.kind}`}>${KIND_LABEL[r.kind] ?? r.kind}</span>
                    <span class="muted lookup-hint">${hintOf(r)}</span>
                    ${r.where === "text" && r.matches > 1 && html`<span class="muted">${r.matches} matches</span>`}
                    <span class="grow" />${writeBtn(r)}</div>
                ${r.snippet && html`<div class="lookup-snippet"><${Marked} text=${r.snippet} words=${words} /></div>`}
            </li>`)}
            ${data && data.results.length < (kind ? data.counts[kind] : data.total) && html`<li class="muted">Showing the best ${data.results.length}; add words to narrow it down.</li>`}
        </ul>` : html`<div class="lookup-recent">
            <div class="spread"><h3>Recently opened</h3>${recent.list.length > 0 && html`<button class="small" onClick=${recent.clear}>Clear</button>`}</div>
            ${!recent.list.length ? html`<p class="muted">Results you open are listed here.</p>` : html`<ul class="lookup-list">${recent.list.map((r) => html`<li key=${r.href} class="lookup-item" onClick=${() => open(r)}>
                <div class="lookup-line"><b>${r.label}</b><span class=${`badge kind-${r.kind}`}>${KIND_LABEL[r.kind] ?? r.kind}</span><span class="muted lookup-hint">${r.hint}</span>
                    <span class="grow" />${writeBtn(r)}
                    <button class="small" title="Remove from the list" aria-label=${`Remove ${r.label}`} onClick=${(e) => { e.stopPropagation(); recent.remove(r.href); }}>×</button></div>
            </li>`)}</ul>`}
        </div>`}
    </div>`;
}

// ------------------------------------------------------------------ data store / taxonomy (drawer tabs)

/**
 * Every data store (or taxonomy) note, one collapsible group per collection, for finding something without knowing
 * its name. Only one group is open at a time (big collections stay cheap); the filter hides what doesn't match and
 * opens the first group with matches when the open one has none. Opening a note shows it in the viewer.
 */
function BrowsePane({ index, taxonomy, active }) {
    const key = taxonomy ? "taxonomy" : "datastore";
    const [q, setQ] = useState("");
    const [open, setOpenState] = useState(() => store.get(`browseOpen:${key}`, null));
    const setOpen = (c) => { setOpenState(c); store.set(`browseOpen:${key}`, c); };
    const pick = useItemPick();
    const input = useRef();
    useEffect(() => { if (active) setTimeout(() => input.current?.focus(), 60); }, [active]);
    const groups = useMemo(() => {
        if (!index) return [];
        const cols = Object.keys(index.schema.collections).filter((c) => c.startsWith("Taxonomy/") === taxonomy);
        return cols.map((c) => {
            const notes = index.inCollection(c);
            const rankedAll = notes.length > 0 && notes.every(ranked);
            const sorted = [...notes].sort((a, b) => (rankedAll ? Number(a.fm.class) - Number(b.fm.class) : 0) || String(a.fm.title || a.name).localeCompare(String(b.fm.title || b.name)));
            return { c, label: collectionLabel(c), notes: sorted, rankedAll };
        });
    }, [index, taxonomy]);
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (n) => [n.name, n.fm.title, ...asList(n.fm.aliases), n.fm.description, ...asList(n.fm.cat).map(linkLabel), n.fm.parent && linkLabel(n.fm.parent)]
        .filter(Boolean).join(" ").toLowerCase();
    const shown = groups.map((g) => ({ ...g, hits: words.length ? g.notes.filter((n) => { const h = hay(n); return words.every((w) => h.includes(w)); }) : g.notes }))
        .filter((g) => !words.length || g.hits.length);
    const current = shown.some((g) => g.c === open) ? open : words.length ? shown[0]?.c ?? null : null;
    const openNote = (n, g) => {
        const href = noteHref(n.path);
        recent.add({ href, label: n.fm.title || n.name, kind: taxonomy ? "taxonomy" : "data", hint: g.label, path: n.path });
        openInDrawer(href);
    };
    const hint = (n, g) => taxonomy
        ? [g.rankedAll ? `#${n.fm.class}` : "", n.fm.parent ? `in ${linkLabel(n.fm.parent)}` : ""].filter(Boolean).join(" · ")
        : String(n.fm.description ?? "").replace(/\s+/g, " ").slice(0, 110);
    if (!index) return html`<div class="drawer-body"><${Loading} /></div>`;
    return html`<div class="drawer-body browse">
        <div class="lookup-bar">
            <input ref=${input} type="search" class="grow" value=${q} placeholder=${taxonomy ? "Filter taxonomy…" : "Filter the data store…"} aria-label="Filter"
                onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); } }} />
            ${words.length > 0 && html`<span class="muted">${shown.reduce((s, g) => s + g.hits.length, 0)} found</span>`}
        </div>
        ${!shown.length && html`<p class="muted">Nothing matches “${q}”.</p>`}
        <div class="browse-groups">${shown.map((g) => {
            const isOpen = g.c === current;
            return html`<section key=${g.c} class=${`browse-group ${isOpen ? "open" : ""}`}>
                <div class="browse-head">
                    <button class="browse-toggle" aria-expanded=${isOpen} onClick=${() => setOpen(isOpen ? null : g.c)}>
                        <span class="caret" aria-hidden="true">▸</span><b>${g.label}</b>
                        <span class="count">${words.length ? `${g.hits.length} / ${g.notes.length}` : g.notes.length}</span></button>
                    <button class="small" title=${`New ${g.label}`} onClick=${() => openInDrawer(`#/new/${encodeURIComponent(g.c)}`)}>+ New</button>
                </div>
                ${isOpen && html`<ul class="lookup-list browse-list">${g.hits.map((n) => html`<li key=${n.path} class="lookup-item" onClick=${() => openNote(n, g)}>
                    <div class="lookup-line"><b><${Marked} text=${n.fm.title || n.name} words=${words} /></b>
                        ${n.fm.title && n.fm.title !== n.name && html`<span class="muted">${n.name}</span>`}
                        <span class="grow" />
                        ${pickable(pick, g.c) && html`<button class="small primary" onClick=${(e) => { e.stopPropagation(); pick.pick(n.name); }}>Add</button>`}</div>
                    ${hint(n, g) && html`<div class="muted browse-hint"><${Marked} text=${hint(n, g)} words=${words} /></div>`}
                </li>`)}
                ${!g.hits.length && html`<li class="muted">None yet.</li>`}</ul>`}
            </section>`;
        })}</div>
    </div>`;
}

// ------------------------------------------------------------------ novel (drawer tab)

const NOVEL_DRAWER_TABS = [["plan", "Grand plan"], ["plots", "Plots"], ["people", "Characters"], ["world", "World"], ["scratch", "Scratchpad"]];

/** The novel's scratchpad: ideas as blocks (add, edit, move, delete) or one page; the note is made on first use */
function Scratchpad({ folder, novel }) {
    const [made, setMade] = useState(null);
    const path = novel.scratchpad ?? made;
    const { data: page, error } = useApi(path ? `/api/note?${qs({ path })}` : null);
    const start = async () => {
        try { const r = await api.send("POST", "/api/scratchpad", { novel: folder }); setMade(r.path); }
        catch (e) { toast(e.message); }
    };
    if (!path) return html`<div class="panel scratch-empty">
        <h3 style="margin-top:0">Scratchpad</h3>
        <p class="muted">A place for loose ideas and thoughts about ${novel.name}: write them as blocks you can move around, or as one page. Saved as <code>${novel.scratchpadPath.split("/").slice(1).join("/")}</code>.</p>
        <button class="primary" onClick=${start}>Start the scratchpad</button>
    </div>`;
    if (!page) return html`<${Loading} error=${error} />`;
    return html`<div class="scratchpad">
        <${NoteBlocks} key=${page.path} page=${page} callouts=${false} wholePage=${true} addLabel="+ Add idea" empty="Nothing here yet. Add an idea, or write freely with Edit as one page." />
    </div>`;
}

function NovelDrawer({ folder, index }) {
    const { data: novel, error } = useApi(`/api/novel?${qs({ folder })}`);
    const { data: plan } = useApi(`/api/plan?${qs({ novel: folder })}`);
    const [tab, setTabState] = useState(store.get("drawerNovelTab", "plan"));
    const setTab = (t) => { setTabState(t); store.set("drawerNovelTab", t); };
    if (!novel) return html`<div class="drawer-body"><${Loading} error=${error} /></div>`;
    return html`<div class="drawer-body novel-drawer">
        <div class="spread">
            <div><div class="muted">${novel.folder}</div><h2 style="margin:0">${novel.name}</h2></div>
            <div class="row">
                <button onClick=${() => openWriter(folder, novel.latestChapter)} title="Open the latest chapter in the writer">✎ Write chapter ${novel.latestChapter}</button>
                <a class="button" href=${novelHref(folder)} data-page>Novel page</a>
            </div>
        </div>
        <div class="tabs" style="margin-top:10px">${NOVEL_DRAWER_TABS.map(([k, l]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>${l}</button>`)}</div>
        <div class="tab-body" key=${tab}>
            ${tab === "people" ? html`<${NovelDrawerPeople} folder=${folder} novel=${novel} />`
            : tab === "world" ? html`<${NovelWorld} novel=${novel} />`
            : tab === "scratch" ? html`<${Scratchpad} folder=${folder} novel=${novel} />`
            : !plan ? html`<${Loading} />`
            : tab === "plots" ? html`<${PlotBoard} folder=${folder} plan=${plan} />`
            : html`<${GrandPlan} folder=${folder} plan=${plan} />`}
        </div>
    </div>`;
}

/** Characters (open in the viewer), other ledger owners, and a New character form in the viewer */
function NovelDrawerPeople({ folder, novel }) {
    const [filter, setFilter] = useState("");
    const characterNames = new Set(novel.characters.map((c) => c.name.toLowerCase()));
    const ledgersOf = (o) => novel.ledgers.filter((l) => l.owner.toLowerCase() === o.toLowerCase());
    const others = [...new Set(novel.ledgers.map((l) => l.owner))].filter((o) => !characterNames.has(o.toLowerCase()));
    const f = filter.trim().toLowerCase();
    const chars = novel.characters.filter((c) => !f || c.name.toLowerCase().includes(f) || String(c.fm.title ?? "").toLowerCase().includes(f));
    return html`<div>
        <div class="row" style="margin-bottom:10px">
            <input class="grow" type="search" placeholder="Filter characters…" value=${filter} onInput=${(e) => setFilter(e.target.value)} aria-label="Filter characters" />
            <button class="primary" onClick=${() => openInDrawer(`#/newchar/${encodeURIComponent(folder)}`)}>+ New character</button>
            <button onClick=${() => go(entryHref(folder, {}))}>New ledger entry</button>
        </div>
        <ul class="people-list">${chars.map((c) => html`<li key=${c.path}>
            ${c.cover ? html`<span class="avatar" style=${`background-image:url("${c.cover}")`} />` : html`<span class="avatar empty" aria-hidden="true">${c.name[0]}</span>`}
            <div class="grow"><a href=${noteHref(c.path)}><b>${c.fm.title || c.name}</b></a>
                <div class="muted people-sub">${[c.fm.race, c.fm.role, c.fm.personality].map(shownValue).filter(Boolean).join(" · ").slice(0, 160)}</div></div>
            <span class="row">${ledgersOf(c.name).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}
                <a class="small-link" href=${ownerHref(folder, c.name)} data-page title="Ledgers and holdings page">Ledgers</a></span>
        </li>`)}</ul>
        ${!chars.length && html`<p class="muted">${f ? "No character matches." : "No characters yet."}</p>`}
        ${others.length > 0 && html`<h3>Other ledger owners</h3><ul class="people-list">${others.map((o) => html`<li key=${o}>
            <span class="avatar empty" aria-hidden="true">${o[0]}</span><div class="grow"><b>${o}</b></div>
            <span class="row">${ledgersOf(o).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}<a class="small-link" href=${ownerHref(folder, o)} data-page>Ledgers</a></span>
        </li>`)}</ul>`}
    </div>`;
}

/** The world hierarchy of the novel's world (Worlds whose `novels` names it), as the editable outline */
function NovelWorld({ novel }) {
    const { data: worlds } = useApi("/api/worlds");
    const mine = worlds?.worlds.filter((w) => w.novels?.some((n) => n.folder === novel.folder || n.name.toLowerCase() === novel.name.toLowerCase())) ?? [];
    const key = `drawerWorld:${novel.folder}`;
    const [picked, setPicked] = useState(store.get(key, null));
    const choices = mine.length ? mine : worlds?.worlds ?? [];
    const current = choices.find((w) => w.path === picked)?.path ?? choices[0]?.path ?? null;
    const { data, error } = useApi(current ? `/api/world?${qs({ world: current })}` : null);
    if (!worlds) return html`<${Loading} />`;
    if (!choices.length) return html`<p class="muted">No worlds yet. Create one in the <a href="#/c/Worlds" data-page>Worlds</a> collection.</p>`;
    return html`<div class="novel-world">
        <div class="spread" style="margin-bottom:10px">
            <span class="muted">${mine.length ? "" : html`No world lists ${novel.name} in its <code>novels</code>; showing all worlds.`}</span>
            <div class="row">
                ${choices.length > 1 && html`<select value=${current} onChange=${(e) => { setPicked(e.target.value); store.set(key, e.target.value); }} aria-label="World">
                    ${choices.map((w) => html`<option value=${w.path}>${w.title} (${w.count})</option>`)}</select>`}
                <a class="button" href=${noteHref(current)}>World note</a>
                <a class="button" href=${`#/world/${encodeURIComponent(current)}`} data-page>World builder</a>
            </div>
        </div>
        ${!data ? html`<${Loading} error=${error} />` : html`<${WorldOutline} key=${current} data=${data} world=${current} worlds=${worlds.worlds} />`}
    </div>`;
}

// ------------------------------------------------------------------ animations

let flipPaused = false; // set while dragging a column edge
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; } };
/**
 * FLIP animation for keyed children ([data-flip]) of a container: rows that stay slide from their old
 * position, new rows fade in. Call on every render; positions are measured after each commit.
 */
function useFlip() {
    const ref = useRef();
    const last = useRef(new Map());
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return;
        const els = [...root.querySelectorAll("[data-flip]")];
        const now = new Map(els.map((el) => [el.dataset.flip, el.getBoundingClientRect()]));
        const prev = last.current;
        last.current = now;
        if (!prev.size || flipPaused || reducedMotion() || typeof Element.prototype.animate !== "function") return;
        for (const el of els) {
            const a = prev.get(el.dataset.flip), b = now.get(el.dataset.flip);
            if (!a) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" }); continue; }
            const dx = a.left - b.left, dy = a.top - b.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            if (Math.abs(dy) > innerHeight * 1.5) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }); continue; }
            el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
        }
    });
    return ref;
}

// ------------------------------------------------------------------ index context (data store listing)

function useIndex(enabled = true) {
    const { data } = useApi(enabled ? "/api/index" : null);
    return useMemo(() => {
        if (!data) return null;
        const byName = new Map();
        for (const n of data.notes) {
            byName.set(n.name.toLowerCase(), n);
            for (const a of asList(n.fm.aliases)) if (!byName.has(String(a).toLowerCase())) byName.set(String(a).toLowerCase(), n);
        }
        const inCollection = (c) => data.notes.filter((n) => n.collection === c);
        return { ...data, byName, inCollection, resolve: (v) => byName.get(linkLabel(v).toLowerCase()) ?? null };
    }, [data]);
}

// ------------------------------------------------------------------ small components

/** Destructive button: the first click arms it ("Click to confirm"), a second click within a few seconds runs it */
function ConfirmButton({ onConfirm, children, confirmLabel = "Click to confirm", class: cls = "small", ...rest }) {
    const [armed, setArmed] = useState(false);
    const timer = useRef();
    useEffect(() => () => clearTimeout(timer.current), []);
    const disarm = () => { clearTimeout(timer.current); setArmed(false); };
    const click = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 4000); return; }
        disarm();
        onConfirm();
    };
    return html`<button class=${`${cls} danger ${armed ? "armed" : ""}`} onClick=${click} onBlur=${disarm} ...${rest}>${armed ? confirmLabel : children}</button>`;
}

/**
 * Keeps a crash in one page from taking the rest of the app (the drawer, the other tabs) with it: the page shows what
 * went wrong and a Retry button instead. `reset` (a key such as the page's href) clears the error when it changes.
 */
class ErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null }; }
    componentDidCatch(error) { console.error(error); this.setState({ error }); }
    componentDidUpdate(prev) { if (prev.reset !== this.props.reset && this.state.error) this.setState({ error: null }); }
    render() {
        if (!this.state.error) return this.props.children;
        return html`<div class="warnbox crash">
            <b>This page ran into a problem and stopped.</b> Nothing was lost on disk; the rest of the app still works.
            <div class="muted small" style="margin:6px 0">${String(this.state.error?.message ?? this.state.error)}</div>
            <button class="small" onClick=${() => this.setState({ error: null })}>Retry</button>
        </div>`;
    }
}

function Chip({ value, links, index, onRemove }) {
    if (!isLink(value)) return html`<span class="chip">${String(value)}${onRemove && html`<span class="x" onClick=${onRemove}>×</span>`}</span>`;
    // the page's resolved links, else the index; a link just typed or picked may be in neither until the note is saved
    const known = links && value in links ? links[value] : undefined;
    const resolved = known !== undefined ? known : index?.resolve(value) ? { path: index.resolve(value).path } : undefined;
    const label = linkLabel(value);
    if (!resolved?.path) {
        const missing = known === null || (links == null && index && !resolved);
        return html`<span class=${`chip ${missing ? "unresolved" : ""}`} title=${missing ? "No note with this name" : ""}>${label}${onRemove && html`<span class="x" onClick=${onRemove}>×</span>`}</span>`;
    }
    return html`<a class="chip" href=${noteHref(resolved.path)}>${label}${onRemove && html`<span class="x" onClick=${(e) => { e.preventDefault(); onRemove(); }}>×</span>`}</a>`;
}

function Value({ v, links, index }) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return html`<span class="muted">—</span>`;
    if (Array.isArray(v)) return html`${v.map((x) => html`<${Chip} value=${x} links=${links} index=${index} />`)}`;
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "object") return html`<code>${JSON.stringify(v)}</code>`;
    if (isLink(v)) return html`<${Chip} value=${v} links=${links} index=${index} />`;
    return String(v);
}

function Html({ html: content, class: cls = "md" }) {
    return html`<div class=${cls} dangerouslySetInnerHTML=${{ __html: content }} />`;
}

function Loading({ error }) {
    return error ? html`<p class="error">${error}</p>` : html`<p class="muted">Loading…</p>`;
}

/** The nearest ancestor that `position: fixed` children are placed in instead of the window (null: the window) */
function fixedBox(el) {
    for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.transform !== "none" || /transform|perspective|filter/.test(cs.willChange) || /paint|layout|strict|content/.test(cs.contain)
            || (cs.filter && cs.filter !== "none") || (cs.backdropFilter && cs.backdropFilter !== "none") || (cs.perspective && cs.perspective !== "none")) return n;
    }
    return null;
}

/** Text input with suggestions; picks one value. `clearOnPick`: the box empties after each pick (adding to a list) */
function Picker({ value, options, onChange, placeholder, allowFree = true, onCreate, createLabel = "Create", autoFocus, onClear, clearOnPick = false }) {
    const [text, setText] = useState(value ?? "");
    const [open, setOpen] = useState(false);
    const [hl, setHl] = useState(0);
    useEffect(() => setText(value ?? ""), [value]);
    const matches = useMemo(() => {
        const t = text.trim().toLowerCase();
        const list = t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
        return list.slice(0, 14);
    }, [text, options]);
    const exact = options.some((o) => o.label.toLowerCase() === text.trim().toLowerCase());
    const choose = (o) => { onChange(o); setText(o && !clearOnPick ? o.label : ""); setOpen(false); };
    // the list is placed against the window (fixed), measured from the input, so a scrolling or clipped container
    // (a table that scrolls sideways, a panel) never cuts it off; it opens upwards when there is more room above
    const input = useRef();
    const [place, setPlace] = useState(null);
    useLayoutEffect(() => {
        if (!open) return;
        const measure = () => {
            const r = input.current?.getBoundingClientRect();
            if (!r) return;
            const vh = globalThis.innerHeight ?? 800;
            const below = vh - r.bottom - 8, above = r.top - 8;
            const up = below < 220 && above > below;
            // inside a box with a transform / will-change / containment (the drawers, for their slide), "fixed" is
            // relative to that box, not the window: place the list in its coordinates
            const cb = fixedBox(input.current);
            const o = cb ? cb.getBoundingClientRect() : { left: 0, top: 0, height: vh };
            setPlace({ left: r.left - o.left, width: Math.max(r.width, 220), up, top: up ? null : r.bottom + 2 - o.top, bottom: up ? o.top + o.height - r.top + 2 : null, max: Math.max(120, Math.min(up ? above : below, vh * 0.6)) });
        };
        measure();
        addEventListener("scroll", measure, true);
        addEventListener("resize", measure);
        return () => { removeEventListener("scroll", measure, true); removeEventListener("resize", measure); };
    }, [open]);
    const placed = place && `position:fixed;left:${place.left}px;width:${place.width}px;right:auto;${place.up ? `bottom:${place.bottom}px;top:auto` : `top:${place.top}px;bottom:auto`};max-height:${place.max}px;z-index:80`;
    // typed text is taken when the field is left; an emptied field clears it (`onClear`)
    const commitFree = () => {
        if (!text.trim()) { if (onClear && value) onClear(); return; }
        if (allowFree && text !== value) { onChange({ label: text.trim(), free: true }); if (clearOnPick) setText(""); }
    };
    return html`<div class="picker">
        <input ref=${input} value=${text} placeholder=${placeholder} autoFocus=${autoFocus}
            onInput=${(e) => { setText(e.target.value); setOpen(true); setHl(0); }}
            onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => { setOpen(false); commitFree(); }, 150)}
            onKeyDown=${(e) => {
                if (e.key === "ArrowDown") { setHl((x) => Math.min(x + 1, matches.length - 1)); e.preventDefault(); }
                if (e.key === "ArrowUp") { setHl((x) => Math.max(x - 1, 0)); e.preventDefault(); }
                if (e.key === "Enter") { e.preventDefault(); if (open && matches[hl]) choose(matches[hl]); else commitFree(); }
                if (e.key === "Escape") setOpen(false);
            }} />
        ${open && (matches.length > 0 || (onCreate && text.trim() && !exact)) && html`<div class="results" style=${placed || ""}>
            ${matches.map((o, i) => html`<a class=${i === hl ? "hl" : ""} onMouseDown=${(e) => { e.preventDefault(); choose(o); }}><span>${o.label}</span><span class="muted">${o.hint ?? ""}</span></a>`)}
            ${onCreate && text.trim() && !exact && html`<a onMouseDown=${(e) => { e.preventDefault(); setOpen(false); onCreate(text.trim()); }}><span>${createLabel} “${text.trim()}”</span><span class="muted">new</span></a>`}
        </div>`}
    </div>`;
}

/** Multi or single link field editor backed by a data store folder */
function LinkField({ value, multiple, target, index, onChange, options: given }) {
    const computed = useMemo(() => (given ? null : ((target ? index?.inCollection(target) : index?.notes) ?? []).map((n) => ({ label: n.name, hint: n.fm.title !== n.name ? n.fm.title : "" }))), [index, target, given]);
    const options = given ?? computed;
    const values = asList(value);
    // the picker shows what the field holds again (a typed name that was not taken must not look saved)
    const [shown, setShown] = useState(0);
    const add = async (o) => {
        if (!o) return;
        let name = o.label;
        // "@plots" style targets are novel folders: free text just links by name
        if (o.free && !index.resolve(name) && typeof target === "string" && target && !target.startsWith("@")) {
            if (!confirm(`Create “${name}” in ${collectionLabel(target)}?`)) { setShown((n) => n + 1); return; }
            const r = await api.send("POST", "/api/note", { collection: target, name });
            name = r.path.split("/").pop().replace(/\.md$/, "");
        }
        onChange(multiple ? [...values.filter((v) => linkLabel(v) !== name), toLink(name)] : toLink(name));
    };
    return html`<div>
        ${multiple && html`<div>${values.map((v) => html`<${Chip} value=${v} index=${index} onRemove=${() => onChange(values.filter((x) => x !== v))} />`)}</div>`}
        <div class="link-single"><${Picker} key=${shown} value=${multiple ? "" : linkLabel(value ?? "")} options=${options} onChange=${add} onClear=${multiple ? undefined : () => onChange("")} clearOnPick=${multiple}
            placeholder=${Array.isArray(target) ? `Search ${target.map((t) => collectionLabel(t.replace(/^@/, "")).toLowerCase()).join(" and ")}…` : target ? `Search ${collectionLabel(target.replace(/^@/, ""))}…` : "Search notes…"} />
        ${!multiple && value && html`<button type="button" class="small link-clear" title="Clear" aria-label="Clear" onClick=${() => onChange("")}>×</button>`}</div>
    </div>`;
}

// ------------------------------------------------------------------ layout

const route0 = () => location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
/** Pages under Tools: no data store search or novel filter at the top */
const TOOL_PAGES = new Set(["settings", "callout-design", "import", "map-assets", "qa"]);

// Sidebar sections collapse on a click of their heading; closed ones are remembered (Taxonomy starts closed)
function SideSection({ id, title, closed, toggle, children }) {
    const open = !closed[id];
    return html`<section class=${`side-section ${open ? "open" : ""}`}>
        <h4><button class="side-head" aria-expanded=${open} onClick=${() => toggle(id)}>${title}<span class="caret" aria-hidden="true">▸</span></button></h4>
        ${open && html`<div class="side-items">${children}</div>`}
    </section>`;
}

function Sidebar({ index, novelFolder }) {
    const active = (href) => (location.hash === href ? "active" : "");
    const [closed, setClosed] = useState(() => store.get("sidebarClosed", { taxonomy: !store.get("showTax", false) }));
    const toggle = (id) => { const c = { ...closed, [id]: !closed[id] }; setClosed(c); store.set("sidebarClosed", c); };
    const [theme, setThemeState] = useState(store.get("theme", "system"));
    const [newTax, setNewTax] = useState(false);
    const setTheme = (m) => { setThemeState(m); store.set("theme", m); applyTheme(m); };
    if (!index) return html`<nav class="sidebar"><div class="brand">Novel Craft</div>
        <div class="side-section"><a class=${active("#/settings")} href="#/settings"><span>Settings</span></a><a class=${route0() === "docs" ? "active" : ""} href="#/docs"><span>Docs</span></a></div></nav>`;
    const cols = Object.keys(index.schema.collections);
    const main = cols.filter((c) => !c.startsWith("Taxonomy/"));
    const tax = cols.filter((c) => c.startsWith("Taxonomy/"));
    const section = (id, title, items) => html`<${SideSection} id=${id} title=${title} closed=${closed} toggle=${toggle}>${items}<//>`;
    return html`<nav class="sidebar">
        <div class="brand"><a href="#/" style="padding:0">Novel Craft</a></div>
        ${section("novels", "Novels", index.novels.map((n) => html`<a class=${`novel-link ${n.folder === novelFolder ? "active" : ""}`} href=${`#/novel/${encodeURIComponent(n.folder)}`}>
            <span class="novel-dot" style=${`--dot:${novelColour(index, n.folder)}`} aria-hidden="true" /><span class="name">${n.name}</span><span class="count">${n.number}</span></a>`))}
        <a class=${`side-pill ${route0() === "world" || route0() === "map" ? "active" : ""}`} href="#/world">World builder<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg></a>
        <${WriterButton} index=${index} />
        ${section("datastore", "Data store", main.map((c) => html`<a class=${active(`#/c/${encodeURIComponent(c)}`)} href=${`#/c/${encodeURIComponent(c)}`}><span>${c}</span><span class="count">${index.counts[c] ?? 0}</span></a>`))}
        ${section("taxonomy", "Taxonomy", html`${tax.map((c) => html`<a class=${active(`#/c/${encodeURIComponent(c)}`)} href=${`#/c/${encodeURIComponent(c)}`}><span>${collectionLabel(c)}</span><span class="count">${index.counts[c] ?? 0}</span></a>`)}
            <button class="side-add" onClick=${() => setNewTax(true)}>+ New taxonomy</button>`)}
        ${newTax && html`<${TaxonomyDialog} index=${index} onClose=${() => setNewTax(false)} />`}
        ${section("tools", "Tools", html`<a class=${active("#/qa")} href="#/qa"><span>Quality checks</span></a><a class=${active("#/callout-design")} href="#/callout-design"><span>Callout designer</span></a><a class=${active("#/import")} href="#/import"><span>Import data</span></a><a class=${active("#/map-assets")} href="#/map-assets"><span>Map assets</span></a><a class=${route0() === "docs" ? "active" : ""} href="#/docs"><span>Docs</span></a><a class=${active("#/settings")} href="#/settings"><span>Settings</span></a>`)}
        <div class="theme-switch" role="group" aria-label="Theme">${THEMES.map(([m, label]) => html`<button class=${theme === m ? "on" : ""} aria-pressed=${theme === m} onClick=${() => setTheme(m)}>${label}</button>`)}</div>
    </nav>`;
}

/**
 * A new taxonomy (a facet: schema entry + folder), or several values for an existing one, from a pasted list:
 * "Qi Refining (Layer 1 - 9)" makes a value with nine sub-levels, indented lines are sub-levels, "= 100" a value's
 * number (parseLevels in levels.js). Values can be levels of a power system, each with a number that stat templates
 * use (a cultivation stage worked out from qi).
 */
/**
 * Its children rendered into a box at the end of <body>: a modal opened from inside a stacking context (the sticky
 * sidebar, a drawer) would otherwise be drawn under the page beside it, whatever its z-index.
 */
function Portal({ children }) {
    const box = useMemo(() => document.createElement("div"), []);
    useLayoutEffect(() => { document.body.append(box); return () => { render(null, box); box.remove(); }; }, []);
    useLayoutEffect(() => { render(children, box); });
    return null;
}

function TaxonomyDialog({ index, collection = null, onClose }) {
    const existing = collection ? index.schema.collections[collection] : null;
    const levelsFacet = existing ? existing.fields.some(([k]) => k === "threshold") : true;
    const [name, setName] = useState("");
    const [levels, setLevels] = useState(levelsFacet);
    const [system, setSystem] = useState(() => { const v = collection && index.inCollection(collection).map((n) => n.fm["power-system"]).find(Boolean); return v ? linkLabel(String(v)) : ""; });
    const [text, setText] = useState("");
    const [numbers, setNumbers] = useState({});
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
    const values = useMemo(() => parseLevels(text), [text]);
    const systems = index.inCollection("Power Systems").map((n) => n.name).sort();
    const numberOf = (v) => (v.name in numbers ? numbers[v.name] : v.threshold ?? "");
    const submit = async (e) => {
        e.preventDefault();
        if (busy || (!collection && !name.trim()) || (collection && !values.length)) return;
        setBusy(true); setErr("");
        const list = values.map((v) => ({ ...v, threshold: levels && numberOf(v) !== "" ? Number(numberOf(v)) : null }));
        try {
            const r = collection
                ? await api.send("POST", "/api/taxonomy/values", { collection, values: list, powerSystem: levels ? system : "" })
                : await api.send("POST", "/api/taxonomy/facet", { name: name.trim(), levels, values: list, powerSystem: levels ? system : "" });
            toast(`${collection ? "Added" : `Made ${r.collection.slice(9)} with`} ${r.paths.length} value${r.paths.length === 1 ? "" : "s"}`);
            onClose();
            if (!collection) go(`#/c/${encodeURIComponent(r.collection)}`);
        } catch (e2) { setErr(e2.message); }
        setBusy(false);
    };
    return html`<${Portal}><div class="modal-back" onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <form class="modal taxonomy-modal" role="dialog" aria-label=${collection ? "Add values" : "New taxonomy"} onSubmit=${submit}>
            <div class="spread"><h2 style="margin:0">${collection ? `Add to ${collectionLabel(collection)}` : "New taxonomy"}</h2><button type="button" onClick=${onClose} aria-label="Close">×</button></div>
            ${!collection && html`<label class="field"><span>Name</span><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Cultivation Levels" required autofocus /></label>`}
            ${(!collection || levelsFacet) && html`<label class="row"><input type="checkbox" style="width:auto" checked=${levels} disabled=${!!collection} onChange=${(e) => setLevels(e.target.checked)} /> levels with a number each (stat templates can work a level out from a stat, e.g. a cultivation stage from qi)</label>`}
            ${levels && html`<label class="field"><span>Levels of the power system</span><select value=${system} onChange=${(e) => setSystem(e.target.value)}>
                <option value="">none</option>${systems.map((x) => html`<option value=${x}>${x}</option>`)}</select></label>`}
            <label class="field"><span>Values, one per line</span>
                <textarea class="mono" style="min-height:130px" value=${text} onInput=${(e) => setText(e.target.value)}
                    placeholder=${"Qi Refining (Layer 1 - 9)\nFoundation Establishment (Early, Mid, Late, Peak)\nGolden Core = 5000\n\tEarly = 5000\n\tMid = 6000"} /></label>
            <p class="muted small-note">"Name (A, B, C)" or "Name (Layer 1 - 9)" adds sub-levels; indented lines are sub-levels of the line above; "= 100" at the end gives a value its number. You can type the numbers below too. Values are ranked in this order.</p>
            ${values.length > 0 && html`<div class="taxonomy-preview"><table><thead><tr><th>Value</th>${levels && html`<th>Number</th>`}</tr></thead><tbody>
                ${values.map((v) => html`<tr class=${v.parent ? "sub" : ""}><td>${v.title}</td>
                    ${levels && html`<td><input type="number" value=${numberOf(v)} placeholder=${v.parent ? "—" : "first sub-level's"} onInput=${(e) => setNumbers({ ...numbers, [v.name]: e.target.value })} /></td>`}</tr>`)}</tbody></table></div>`}
            ${err && html`<p class="error">${err}</p>`}
            <div class="row" style="justify-content:flex-end"><button type="button" onClick=${onClose}>Cancel</button>
                <button type="submit" class="primary" disabled=${busy || (!collection && !name.trim()) || (collection && !values.length)}>${busy ? "Saving…" : collection ? `Add ${values.length} value${values.length === 1 ? "" : "s"}` : `Make taxonomy${values.length ? ` with ${values.length} value${values.length === 1 ? "" : "s"}` : ""}`}</button></div>
        </form>
    </div><//>`;
}

/**
 * The sidebar's "Open writer": brings back the chapter in the writer, or on a chapter page opens that chapter;
 * greyed out when there is neither (Ctrl+[ does the same)
 */
function WriterButton({ index }) {
    const w = useWriter();
    const m = /^#\/chapter\/([^/]+)\/([\d.]+)/.exec(location.hash);
    const novelName = (folder) => index?.novels.find((n) => n.folder === folder)?.name ?? folder;
    const can = !!w.folder || !!m || w.tabs.length > 0;
    const label = w.folder ? `Chapter ${w.n}` : m ? `Chapter ${m[2]}` : "";
    const title = w.folder ? `Open the writer: ${novelName(w.folder)}, chapter ${w.n} (Ctrl+[)`
        : m ? `Write chapter ${m[2]} (Ctrl+[)` : "No chapter in the writer yet: open a chapter and press ✎ Write";
    return html`<button class="side-pill writer-pill" disabled=${!can} aria-disabled=${!can} title=${title}
        onClick=${() => (w.folder || w.tabs.length ? expandWriter() : toggleWriter())}>
        <span>✎ Open writer</span>${label && html`<span class="writer-pill-ch">${label}</span>`}</button>`;
}

function Search({ index }) {
    const [q, setQ] = useState("");
    const [hl, setHl] = useState(0);
    const results = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t || !index) return [];
        return index.notes.filter((n) => n.name.toLowerCase().includes(t) || String(n.fm.title ?? "").toLowerCase().includes(t)).slice(0, 20);
    }, [q, index]);
    const open = (n) => { setQ(""); go(noteHref(n.path)); };
    return html`<div class="search">
        <input placeholder="Search the data store…" value=${q} onInput=${(e) => { setQ(e.target.value); setHl(0); }}
            onKeyDown=${(e) => { if (e.key === "ArrowDown") setHl(Math.min(hl + 1, results.length - 1)); if (e.key === "ArrowUp") setHl(Math.max(hl - 1, 0)); if (e.key === "Enter" && results[hl]) open(results[hl]); if (e.key === "Escape") setQ(""); }} />
        ${results.length > 0 && html`<div class="results">${results.map((n, i) => html`<a class=${i === hl ? "hl" : ""} href=${noteHref(n.path)} onClick=${() => setQ("")}><span>${n.name}</span><span class="muted">${collectionLabel(n.collection)}</span></a>`)}</div>`}
    </div>`;
}

function NovelFilter({ index, value, onChange }) {
    if (!index) return null;
    return html`<label class="row muted">Novel
        <select value=${value} onChange=${(e) => onChange(e.target.value)}>
            <option value="">All novels</option>
            ${index.novels.map((n) => html`<option value=${n.name}>${n.name}</option>`)}
        </select></label>`;
}

// ------------------------------------------------------------------ home

function Home({ index }) {
    if (!index) return html`<${Loading} />`;
    const cols = Object.keys(index.schema.collections).filter((c) => !c.startsWith("Taxonomy/"));
    return html`<div>
        <h1>Novel Craft</h1>
        <p class="muted">${index.notes.length} data store notes across ${cols.length} collections.</p>
        <div class="cards">
            ${cols.map((c) => html`<a class="card" href=${`#/c/${encodeURIComponent(c)}`}><div class="body"><h3>${c}</h3><p>${index.counts[c] ?? 0} entries</p></div></a>`)}
        </div>
        <h2>Novels</h2>
        <div class="cards">
            ${index.novels.map((n) => html`<a class="card" href=${`#/novel/${encodeURIComponent(n.folder)}`}><div class="body"><h3>${n.name}</h3><p>${n.folder}</p></div></a>`)}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ collection view

const HIDDEN_COLS = new Set(["title", "aliases", "type", "created-date", "tags", "description", "images", "facet"]);

function CollectionView({ index, collection, novelFilter, scope = "page" }) {
    const pick = useItemPick();
    const [q, setQ] = useState("");
    const [addingMany, setAddingMany] = useState(false);
    // picked filter values, kept per collection in localStorage like the rest of the view's settings
    const [filters, setFiltersNow] = useState(() => store.get(`filters:${collection}`, {}));
    const setFilters = (fn) => setFiltersNow((f) => { const next = typeof fn === "function" ? fn(f) : fn; store.set(`filters:${collection}`, next); return next; });
    const [mode, setMode] = useState(store.get("viewMode", "table"));
    const [sort, setSort] = useState({ key: "name", dir: 1 });
    const [groupBy, setGroupBy] = useState(store.get(`groupBy:${collection}`, ""));
    // filter groups hidden with the Filters dialog, and group tables folded away (per collection, in localStorage)
    const [hiddenFacets, setHiddenFacets] = useState(() => store.get(`hiddenFacets:${collection}`, []));
    const [picking, setPicking] = useState(false);
    const [closedGroups, setClosedGroups] = useState(() => store.get(`groupsClosed:${collection}`, {}));
    const flip = useFlip();
    useEffect(() => {
        setFiltersNow(store.get(`filters:${collection}`, {})); setQ(""); setGroupBy(store.get(`groupBy:${collection}`, ""));
        setHiddenFacets(store.get(`hiddenFacets:${collection}`, [])); setClosedGroups(store.get(`groupsClosed:${collection}`, {}));
    }, [collection]);
    if (!index) return html`<${Loading} />`;
    const col = index.schema.collections[collection];
    if (!col) return html`<p class="error">Unknown collection ${collection}</p>`;
    const all = index.inCollection(collection);
    const facetKeys = Object.keys(col.links).filter((k) => !["novels"].includes(k)).concat(col.fields.some(([k]) => k === "tier") ? ["tier"] : []);
    const values = (n, k) => asList(n.fm[k]).map((v) => (isLink(v) ? linkLabel(v) : String(v)));
    const base = all.filter((n) => !novelFilter || values(n, "novels").includes(novelFilter));
    const t = q.trim().toLowerCase();
    // saved filter values only count while they exist (a value no longer in the collection would hide every row
    // without a chip to switch it off)
    const active = Object.entries(filters).map(([k, set]) => [k, set.filter((v) => base.some((n) => values(n, k).includes(v)))]);
    const passes = (n, skip) => {
        if (t && !`${n.name} ${n.fm.title ?? ""} ${n.fm.description ?? ""}`.toLowerCase().includes(t)) return false;
        return active.every(([k, set]) => k === skip || !set.length || values(n, k).some((v) => set.includes(v)));
    };
    const matches = base.filter((n) => passes(n));
    // Every value present in the collection stays listed in a fixed order (it never moves while filtering);
    // counts ignore the facet's own selection (values within a facet are OR-ed), so a 0 means picking it
    // would leave nothing and it is greyed out.
    const allFacets = facetKeys.map((k) => {
        const counts = new Map();
        for (const n of base) for (const v of values(n, k)) counts.set(v, 0);
        for (const n of base) if (passes(n, k)) for (const v of values(n, k)) counts.set(v, counts.get(v) + 1);
        return { key: k, values: [...counts.entries()].sort(([a], [b]) => compareValues(a, b, index)) };
    }).filter((f) => f.values.length > 1 || (filters[f.key]?.length));
    const facets = allFacets.filter((f) => !hiddenFacets.includes(f.key));
    // a hidden filter group stops filtering too, so nothing is filtered out of sight
    const setHidden = (keys) => {
        setHiddenFacets(keys); store.set(`hiddenFacets:${collection}`, keys);
        setFilters((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k))));
    };
    const closed = new Set(closedGroups[groupBy] ?? []);
    const toggleGroup = (g) => {
        const next = closed.has(g) ? [...closed].filter((x) => x !== g) : [...closed, g];
        const all2 = { ...closedGroups, [groupBy]: next };
        setClosedGroups(all2); store.set(`groupsClosed:${collection}`, all2);
    };
    const groupHead = (g, n) => html`<h2><button class="group-toggle" aria-expanded=${!closed.has(g)} title=${closed.has(g) ? "Show this group" : "Hide this group"} onClick=${() => toggleGroup(g)}>
        <span class="caret" aria-hidden="true">${closed.has(g) ? "▸" : "▾"}</span>${g} <span class="muted" style="font-size:13px">${n}</span></button></h2>`;
    const toggle = (k, v) => setFilters((f) => { const cur = f[k] ?? []; return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
    const columns = col.fields.map(([k]) => k).filter((k) => !HIDDEN_COLS.has(k) && all.some((n) => asList(n.fm[k]).length && n.fm[k] !== false)).slice(0, 7);
    const groupKeys = [...new Set([...columns, ...facetKeys])];
    const setGroup = (k) => { setGroupBy(k); store.set(`groupBy:${collection}`, k); };
    const sortVal = (n, k) => (k === "name" ? n.name.toLowerCase() : values(n, k).join(", ").toLowerCase());
    const sorted = [...matches].sort((a, b) => {
        const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
        const nx = Number(x), ny = Number(y);
        return (x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y)) * sort.dir;
    });
    const groups = groupKeys.includes(groupBy) ? groupRows(sorted, groupBy, values, index) : [[null, sorted]];
    const cards = (rows, g) => html`<div class="cards" data-drawer>${rows.map((n) => html`<a class="card" href=${noteHref(n.path)} key=${n.path} data-flip=${`${g}|${n.path}`}>
        ${n.cover && html`<div class="cover" style=${`background-image:url("${n.cover}")`} />`}
        <div class="body"><h3>${addBtn(n)}${n.fm.title && n.fm.title !== n.name ? n.fm.title : n.name}</h3>
            <div>${asList(n.fm.cat).slice(0, 3).map((v) => html`<span class="chip">${linkLabel(v)}</span>`)}${n.fm.tier ? html`<span class="badge">tier ${n.fm.tier}</span>` : ""}</div>
            <p>${n.fm.description ?? ""}</p></div></a>`)}</div>`;
    const groupBtn = (k) => html`<button class=${`small ${groupBy === k ? "on" : ""}`} aria-pressed=${groupBy === k}
        title=${groupBy === k ? "Ungroup" : `Group by ${k}`} onClick=${() => setGroup(groupBy === k ? "" : k)}>${k}</button>`;
    const adding = pickable(pick, collection);
    const addBtn = (n) => adding && html`<button class="small primary pick-add" title=${`Use ${n.name} for ${pick.label}`} onClick=${(e) => { e.preventDefault(); e.stopPropagation(); pick.pick(n.name); }}>Add</button>`;
    const cell = (n, k) => (k === "name" ? html`${addBtn(n)}<a href=${noteHref(n.path)}>${n.name}</a>`
        : k === "description" ? String(n.fm.description ?? "").slice(0, 160) : html`<${Value} v=${n.fm[k]} index=${index} />`);
    return html`<div ref=${flip}>
        <div class="spread">
            <h1>${collectionLabel(collection)} <span class="muted" style="font-size:14px">${matches.length} / ${base.length}</span></h1>
            <div class="row">
                <input placeholder="Filter…" value=${q} onInput=${(e) => setQ(e.target.value)} />
                ${allFacets.length > 0 && html`<button title="Choose which filter groups show" onClick=${() => setPicking(true)}>Filters${hiddenFacets.some((k) => allFacets.some((f) => f.key === k)) ? html` <span class="muted">(${facets.length}/${allFacets.length})</span>` : ""}</button>`}
                <button onClick=${() => { const m = mode === "table" ? "cards" : "table"; setMode(m); store.set("viewMode", m); }}>${mode === "table" ? "Cards" : "Table"}</button>
                ${collection.startsWith("Taxonomy/") && html`<button title="Add several values at once from a list (levels with sub-levels and numbers)" onClick=${() => setAddingMany(true)}>Add several…</button>`}
                <button class="primary" onClick=${() => (inDrawer(scope) ? openInDrawer : go)(`#/new/${encodeURIComponent(collection)}`)}>New</button>
            </div>
            ${addingMany && html`<${TaxonomyDialog} index=${index} collection=${collection} onClose=${() => setAddingMany(false)} />`}
        </div>
        <div class="facets">
            ${facets.map((f) => html`<div class="facet"><b>${f.key}</b>${f.values.slice(0, 40).map(([v, c]) => {
                const on = (filters[f.key] ?? []).includes(v);
                return html`<a class=${`chip ${on ? "on" : ""} ${!c && !on ? "off" : ""}`} href="javascript:" aria-disabled=${!c && !on}
                    onClick=${() => (c || on) && toggle(f.key, v)}>${v} <span class="muted">${c}</span></a>`;
            })}</div>`)}
        </div>
        ${mode === "cards" ? html`
            <div class="groupbar row"><b>Group by</b>${groupKeys.map(groupBtn)}</div>
            ${groups.map(([g, rows]) => html`<section class=${`group ${g !== null && closed.has(g) ? "folded" : ""}`} key=${g ?? ""} data-flip=${`group|${g}`}>
                ${g !== null && groupHead(g, rows.length)}
                ${(g === null || !closed.has(g)) && cards(rows, g)}</section>`)}`
        : html`<${ColumnTables} id=${collection} cols=${["name", ...columns, "description"]} groups=${groups} sort=${sort} setSort=${setSort}
            cell=${cell} groupBtn=${(k) => (groupKeys.includes(k) ? groupBtn(k) : null)} extraGroupKeys=${groupKeys.filter((k) => !columns.includes(k))}
            closed=${closed} groupHead=${groupHead} />`}
        ${picking && html`<${FacetPicker} facets=${allFacets} hidden=${hiddenFacets} onChange=${setHidden} onClose=${() => setPicking(false)} />`}
    </div>`;
}

/** Which filter groups show above a collection's tables: a checkbox per group (hidden ones stop filtering too) */
function FacetPicker({ facets, hidden, onChange, onClose }) {
    useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
    const shown = (k) => !hidden.includes(k);
    const set = (k, on) => onChange(on ? hidden.filter((x) => x !== k) : [...hidden, k]);
    return html`<div class="modal-back" onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <div class="modal facet-picker" role="dialog" aria-label="Filter groups">
            <div class="spread"><h2 style="margin:0">Filter groups</h2><button onClick=${onClose} aria-label="Close">×</button></div>
            <p class="muted small-note">Choose which groups of filters show above the table. A hidden group stops filtering.</p>
            <div class="facet-list">${facets.map((f) => html`<label class="row"><input type="checkbox" checked=${shown(f.key)} onChange=${(e) => set(f.key, e.target.checked)} />
                <span>${f.key}</span><span class="muted">${f.values.length} value${f.values.length === 1 ? "" : "s"}</span></label>`)}</div>
            <div class="spread"><div class="row"><button class="small" onClick=${() => onChange([])}>Show all</button><button class="small" onClick=${() => onChange(facets.map((f) => f.key))}>Hide all</button></div>
                <button class="primary" onClick=${onClose}>Done</button></div>
        </div>
    </div>`;
}

const COLLAPSED_W = 9;
const LONG_PRESS_MS = 450;
const LAST_MIN_W = 220;

/**
 * One table per group, all sharing one set of column widths. Widths start from the first table's natural
 * layout; dragging a header edge resizes (double-click resets), holding a header collapses the column to a
 * thin strip (click or hold to restore). Resized widths and hidden columns are kept in localStorage.
 * The last column takes the remaining width.
 */
function ColumnTables({ id, cols, groups, sort, setSort, cell, groupBtn, extraGroupKeys, closed = new Set(), groupHead }) {
    const [userW, setUserW] = useState(() => store.get(`colWidths:${id}`, {}));
    const [measured, setMeasured] = useState({});
    const [hidden, setHidden] = useState(() => store.get(`colHidden:${id}`, []));
    const [pressing, setPressing] = useState(null);
    const first = useRef();
    const press = useRef({});
    const userRef = useRef(userW);
    userRef.current = userW;
    const last = cols[cols.length - 1];
    const isHidden = (k) => hidden.includes(k);
    const width = (k) => (isHidden(k) ? COLLAPSED_W : k === last ? null : userW[k] ?? measured[k]);
    const fixed = cols.filter((k) => k !== last);
    const measuring = fixed.some((k) => width(k) == null);
    useLayoutEffect(() => {
        if (!measuring || !first.current) return;
        const ths = new Map([...first.current.querySelectorAll("thead th[data-col]")].map((el) => [el.dataset.col, el]));
        const m = {};
        for (const k of fixed) if (width(k) == null) m[k] = Math.round(Math.min(320, Math.max(60, ths.get(k)?.getBoundingClientRect().width ?? 120)));
        setMeasured((s) => ({ ...s, ...m }));
    });
    const saveWidths = (next) => { setUserW(next); store.set(`colWidths:${id}`, next); };
    const toggleHidden = (k) => setHidden((h) => {
        const next = h.includes(k) ? h.filter((x) => x !== k) : [...h, k];
        store.set(`colHidden:${id}`, next);
        return next;
    });
    const startResize = (k) => (e) => {
        if (e.button) return;
        e.preventDefault(); e.stopPropagation();
        const handle = e.currentTarget;
        const x0 = e.clientX, w0 = handle.parentElement.getBoundingClientRect().width;
        let w = Math.round(w0);
        handle.setPointerCapture?.(e.pointerId);
        handle.classList.add("active");
        flipPaused = true;
        const move = (ev) => { w = Math.max(40, Math.round(w0 + ev.clientX - x0)); setUserW((s) => ({ ...s, [k]: w })); };
        const up = () => {
            for (const [t, f] of [["pointermove", move], ["pointerup", up], ["pointercancel", up]]) handle.removeEventListener(t, f);
            handle.classList.remove("active");
            flipPaused = false;
            saveWidths({ ...userRef.current, [k]: w });
        };
        for (const [t, f] of [["pointermove", move], ["pointerup", up], ["pointercancel", up]]) handle.addEventListener(t, f);
    };
    const resetWidth = (k) => (e) => { e.stopPropagation(); const { [k]: _, ...rest } = userRef.current; saveWidths(rest); };
    const endPress = () => { clearTimeout(press.current.t); setPressing(null); };
    const th = (k) => html`<th data-col=${k} class=${`${isHidden(k) ? "collapsed" : ""} ${pressing === k ? "pressing" : ""}`}
        title=${isHidden(k) ? `${k} (hidden): click to show` : "Click to sort, hold to hide"}
        onPointerDown=${(e) => {
            if (e.button) return;
            clearTimeout(press.current.t);
            setPressing(k);
            press.current = { fired: false, t: setTimeout(() => { press.current.fired = true; setPressing(null); toggleHidden(k); }, LONG_PRESS_MS) };
        }}
        onPointerUp=${endPress} onPointerLeave=${endPress} onPointerCancel=${endPress}
        onContextMenu=${(e) => pressing && e.preventDefault()}
        onClick=${() => {
            if (press.current.fired) { press.current.fired = false; return; }
            if (isHidden(k)) toggleHidden(k);
            else setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }));
        }}>
        ${!isHidden(k) && html`<span class="th-label">${k}${sort.key === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</span>`}
        ${!isHidden(k) && k !== last && html`<span class="resizer" title="Drag to resize, double-click to reset"
            onPointerDown=${startResize(k)} onClick=${(e) => e.stopPropagation()} onDblClick=${resetWidth(k)} />`}
    </th>`;
    // explicit widths of all columns, so panels can scroll together in one container
    const total = fixed.reduce((s, k) => s + (width(k) ?? 0), 0) + (isHidden(last) ? COLLAPSED_W : LAST_MIN_W) + 2;
    const panelStyle = measuring ? "" : isHidden(last) ? `width:${total}px` : `width:max(100%, ${total}px)`;
    const tableStyle = `table-layout:${measuring ? "auto" : "fixed"}`;
    const colgroup = html`<colgroup>${cols.map((k) => html`<col style=${width(k) != null ? `width:${width(k)}px` : ""} />`)}</colgroup>`;
    const td = (k, content) => html`<td class=${`${isHidden(k) ? "collapsed" : ""} ${k === "description" ? "desc" : ""}`}>${isHidden(k) ? "" : content}</td>`;
    const firstOpen = groups.find(([g]) => g === null || !closed.has(g))?.[0];
    return html`<div class="coltables">
        <div class="panel groupbar-panel" style=${panelStyle}><table class="coltable" style=${tableStyle}>${colgroup}
            <tbody><tr class="groupbar">${cols.map((k, i) => td(k, i === 0 ? html`<b>Group by</b>` : k === last ? extraGroupKeys.map(groupBtn) : groupBtn(k)))}</tr></tbody>
        </table></div>
        ${isHidden(last) && extraGroupKeys.length > 0 && html`<div class="groupbar row">${extraGroupKeys.map(groupBtn)}</div>`}
        ${groups.map(([g, rows]) => {
            const folded = g !== null && closed.has(g);
            // (widths are measured on the first table that is showing)
            return html`<section class=${`group ${folded ? "folded" : ""}`} key=${g ?? ""} data-flip=${`group|${g}`}>
            ${g !== null && (groupHead ? groupHead(g, rows.length) : html`<h2>${g} <span class="muted" style="font-size:13px">${rows.length}</span></h2>`)}
            ${!folded && html`<div class="panel" style=${panelStyle} data-drawer><table class="coltable" style=${tableStyle} ref=${g === firstOpen ? first : null}>${colgroup}
                <thead><tr>${cols.map(th)}</tr></thead>
                <tbody>${rows.map((n) => html`<tr key=${n.path} data-flip=${`${g}|${n.path}`}>${cols.map((k) => td(k, cell(n, k)))}</tr>`)}</tbody>
            </table></div>`}</section>`;
        })}
    </div>`;
}

/** Split rows into [label, rows] groups by a field; list values put a row in every matching group */
function groupRows(rows, key, values, index) {
    const groups = new Map();
    for (const n of rows) {
        const vs = values(n, key);
        for (const v of vs.length ? [...new Set(vs)] : ["(none)"]) {
            if (!groups.has(v)) groups.set(v, []);
            groups.get(v).push(n);
        }
    }
    return [...groups.entries()].sort(([a], [b]) => (a === "(none)") - (b === "(none)") || compareValues(a, b, index));
}

/** Ranked taxonomies (Rarity, Rating…) sort by their class, everything else by name */
function compareValues(a, b, index) {
    const rank = (v) => { const c = Number(index.resolve(toLink(v))?.fm.class); return Number.isFinite(c) ? c : Infinity; };
    return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ------------------------------------------------------------------ note view

function Tree({ node, depth = 0 }) {
    const [open, setOpen] = useState(depth < 2);
    const kids = node.children ?? [];
    return html`<li>
        <span class="node">
            <span class="toggle" onClick=${() => setOpen(!open)}>${kids.length ? (open ? "▾" : "▸") : "·"}</span>
            <b>${node.count}×</b>
            ${node.item ? html`<a href=${noteHref(node.item)}>${node.name}</a>` : html`<span class="unresolved">${node.name}</span>`}
            ${node.tier ? html`<span class="badge">T${node.tier}</span>` : ""}
            ${!node.recipe && node.item && depth > 0 ? html`<span class="badge warn">no blueprint</span>` : ""}
            ${node.cycle ? html`<span class="badge bad">cycle</span>` : ""}
            ${node.missing ? html`<span class="badge bad">missing</span>` : ""}
        </span>
        ${open && node.materials?.length > 0 && html`<div class="mats">${node.materials.map((m) => `${m.qtyText} ${m.name}`).join(" · ")}</div>`}
        ${open && kids.length > 0 && html`<ul>${kids.map((k) => html`<${Tree} node=${k} depth=${depth + 1} />`)}</ul>`}
    </li>`;
}

function WhereUsed({ uses }) {
    if (!uses?.length) return null;
    return html`<ul>${uses.map((u) => html`<li>${u.count}× in ${u.item ? html`<a href=${noteHref(u.item)}>${u.name}</a>` : u.name}${u.parents?.length ? html`<${WhereUsed} uses=${u.parents} />` : ""}</li>`)}</ul>`;
}

/** "[[Name]]" for a note path (a misc name stays as text) */
const pathLink = (p, name) => (p ? `[[${p.split("/").pop().replace(/\.md$/, "")}]]` : name);
/**
 * A blueprint as a callout (the vault theme styles [!blueprint]): the item's name and description, then tier, power
 * system and disciplines ("-" when blank), then the bill of materials for the whole build (raw materials, and parts
 * that have no blueprint of their own), one per line under its label: the same layout as the item callout (groups
 * as paragraphs, separated by blank ">" lines). `count` builds that many.
 */
function blueprintCallout(bp, page, count = 1, index = null) {
    const root = bp.root;
    const dash = (v) => shownValue(v) || "-";
    // the item's description (what is being made), else the recipe's own
    const itemNote = root.item === page.path ? page : index?.notes.find((n) => n.path === root.item);
    const desc = shownValue(itemNote?.fm.description) || shownValue(page.fm.description) || "-";
    const lines = [`[!blueprint] ${root.name}${count > 1 ? ` ×${count}` : ""}`, desc, ""];
    lines.push(`**Tier:** ${dash(root.tier ?? page.fm.tier)}`);
    lines.push(`**Power system:** ${dash(page.fm["power-system"])}`);
    lines.push(`**Disciplines:** ${dash(bp.disciplines.map((d) => `[[${d}]]`))}`);
    const bill = [...bp.bill.map((b) => `${b.qtyText} ${pathLink(b.material, b.name)}`), ...bp.parts.map((x) => `${x.count}× ${pathLink(x.item, x.name)}`)];
    // (formatted like the item callout: one line each, no list)
    lines.push("", "**Bill of materials:**", ...(bill.length ? bill : ["-"]));
    return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
}

const GRAMS = { g: 1, kg: 1000, t: 1e6 };
/**
 * Make the recipe (blueprint) for an item: its components and materials, description, category, tier, power system
 * and disciplines. Components and materials can be looked up in the drawer (Browse); comparable recipes (same kind
 * of item, power system, nearby tier) sit beside the form with their bills, to keep costs in balance. Saving creates
 * "<item> (Blueprint)" and links it from the item (`recipe`), then opens the item.
 */
function RecipeCreator({ index, item }) {
    const rootRef = useRef();
    useEscapeTwice(true, () => { markDirty("page", `recipe:${item}`, false); go(noteHref(item)); }, rootRef);
    const { data: page, error } = useApi(`/api/note?${qs({ path: item })}`);
    const { data: cmp } = useApi(`/api/recipe/compare?${qs({ item })}`);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const latest = useRef(null);
    latest.current = form;
    useEffect(() => {
        if (!page || form) return;
        setForm({
            description: "", tier: page.fm.tier ?? "", cat: index?.resolve("tech blueprint") ? ["[[tech blueprint]]"] : [],
            "power-system": asList(page.fm["power-system"]), disciplines: [], components: [], materials: [{ material: "", qty: "", unit: "g" }], assembly: "",
        });
    }, [page]);
    const touched = !!form && (form.description || form.components.length || form.materials.some((m) => m.material) || form.assembly || form.disciplines.length);
    useEffect(() => markDirty("page", `recipe:${item}`, !!touched), [touched]);
    useEffect(() => () => { markDirty("page", `recipe:${item}`, false); if (itemPick) setItemPick(null); }, []);
    if (!page || !form) return html`<${Loading} error=${error} />`;
    if (page.blueprint) return html`<p>${page.name} already has a recipe. <a href=${noteHref(item)}>Open the item</a></p>`;
    const set = (patch) => setForm({ ...form, ...patch });
    const rowSet = (key, i, patch) => set({ [key]: form[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    const rowDel = (key, i) => set({ [key]: form[key].filter((_, j) => j !== i) });
    // a pick from the drawer lands in the form as it is by then
    const browse = (key, field, i, collections, label) => browseItems({ label, collections, pick: (name) => {
        const f = latest.current;
        setForm({ ...f, [key]: f[key].map((r, j) => (j === i ? { ...r, [field]: toLink(name) } : r)) });
    } });
    const opts = (c) => (index?.inCollection(c) ?? []).map((n) => ({ label: n.name, hint: n.fm.title && n.fm.title !== n.name ? n.fm.title : linkLabel(asList(n.fm.cat)[0] ?? "") }));
    const itemOpts = opts("Items").filter((o) => o.label !== page.name), matOpts = opts("Materials");
    const draftGrams = form.materials.reduce((n, m) => n + (m.material && GRAMS[m.unit] ? (Number(m.qty) || 0) * GRAMS[m.unit] : 0), 0);
    const draftParts = form.components.reduce((n, c) => n + (c.item ? Number(c.count) || 1 : 0), 0);
    const weight = (g) => (g >= 1000 ? `${(g / 1000).toFixed(g >= 10000 ? 0 : 1)} kg` : `${Math.round(g)} g`);
    const save = async () => {
        if (busy) return;
        setBusy(true); setErr("");
        try {
            const r = await api.send("POST", "/api/recipe", {
                item, assembly: form.assembly,
                fm: { description: form.description, tier: form.tier, cat: form.cat, disciplines: form.disciplines, "power-system": form["power-system"] },
                components: form.components.filter((c) => c.item).map((c) => ({ item: c.item, count: c.count })),
                materials: form.materials.filter((m) => m.material).map((m) => ({ material: m.material, qty: m.qty, unit: m.unit })),
            });
            markDirty("page", `recipe:${item}`, false);
            toast(`Created ${r.name} and linked it from ${page.name}`);
            go(noteHref(item));
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    return html`<div ref=${rootRef}>
        <div class="muted"><a href=${noteHref(item)}>${page.name}</a></div>
        <h1>New recipe for ${page.fm.title || page.name}</h1>
        <div class="recipe-make">
            <div>
                <div class="panel"><div class="formgrid">
                    <label>Description</label><${AutoTextarea} value=${form.description} onInput=${(e) => set({ description: e.target.value })} style="font-family:inherit" />
                    <label>Category</label><${LinkField} value=${form.cat} multiple=${true} target="Taxonomy/Recipe Categories" index=${index} onChange=${(v) => set({ cat: v })} />
                    <label>Tier</label><input type="number" min="0" value=${form.tier} onInput=${(e) => set({ tier: e.target.value })} style="width:90px" />
                    <label>Power system</label><${LinkField} value=${form["power-system"]} multiple=${true} target="Power Systems" index=${index} onChange=${(v) => set({ "power-system": v })} />
                    <label>Disciplines</label><${LinkField} value=${form.disciplines} multiple=${true} target="Taxonomy/Engineering Disciplines" index=${index} onChange=${(v) => set({ disciplines: v })} />
                </div></div>
                <div class="panel">
                    <h3 style="margin-top:0">Materials</h3>
                    <table class="lines-editor"><thead><tr><th>material</th><th style="width:90px">amount</th><th style="width:70px">unit</th><th></th></tr></thead><tbody>
                        ${form.materials.map((m, i) => html`<tr>
                            <td><div class="item-cell"><${Picker} value=${linkLabel(m.material ?? "")} options=${matOpts} placeholder="Material" onChange=${(o) => rowSet("materials", i, { material: o ? toLink(o.label) : "" })} />
                                <button type="button" class="small" title="Look up materials in the side drawer (density, rarity, sources…) and add one" onClick=${() => browse("materials", "material", i, ["Materials"], `material ${i + 1}`)}>Browse</button></div></td>
                            <td><input type="number" min="0" step="any" value=${m.qty} onInput=${(e) => rowSet("materials", i, { qty: e.target.value })} /></td>
                            <td><select value=${m.unit} onChange=${(e) => rowSet("materials", i, { unit: e.target.value })}>${["g", "kg", "t", "ea"].map((u) => html`<option>${u}</option>`)}</select></td>
                            <td><button type="button" class="small" aria-label="Remove material" onClick=${() => rowDel("materials", i)}>×</button></td></tr>`)}
                    </tbody></table>
                    <button class="small" onClick=${() => set({ materials: [...form.materials, { material: "", qty: "", unit: "g" }] })}>+ Material</button>
                </div>
                <div class="panel">
                    <h3 style="margin-top:0">Components <span class="muted" style="font-size:13px">items built into it (with their own recipes)</span></h3>
                    ${form.components.length > 0 && html`<table class="lines-editor"><thead><tr><th>item</th><th style="width:90px">count</th><th></th></tr></thead><tbody>
                        ${form.components.map((c, i) => html`<tr>
                            <td><div class="item-cell"><${Picker} value=${linkLabel(c.item ?? "")} options=${itemOpts} placeholder="Component item" onChange=${(o) => rowSet("components", i, { item: o ? toLink(o.label) : "" })} />
                                <button type="button" class="small" title="Browse the items in the side drawer and add one" onClick=${() => browse("components", "item", i, ["Items"], `component ${i + 1}`)}>Browse</button></div></td>
                            <td><input type="number" min="1" value=${c.count} onInput=${(e) => rowSet("components", i, { count: e.target.value })} /></td>
                            <td><button type="button" class="small" aria-label="Remove component" onClick=${() => rowDel("components", i)}>×</button></td></tr>`)}
                    </tbody></table>`}
                    <button class="small" onClick=${() => set({ components: [...form.components, { item: "", count: 1 }] })}>+ Component</button>
                </div>
                <div class="panel"><h3 style="margin-top:0">Assembly <span class="muted" style="font-size:13px">optional</span></h3>
                    <${AutoTextarea} value=${form.assembly} onInput=${(e) => set({ assembly: e.target.value })} placeholder="1. Steps for putting it together…" style="font-family:inherit;width:100%" /></div>
                ${err && html`<p class="error">${err}</p>`}
                <div class="row"><button class="primary" disabled=${busy} onClick=${save}>${busy ? "Creating…" : "Create recipe"}</button><a class="button" href=${noteHref(item)}>Cancel</a>
                    <span class="muted">Saved as "${page.name} (Blueprint)" and linked from the item.</span></div>
            </div>
            <aside class="panel recipe-compare" data-drawer>
                <h3 style="margin-top:0">Comparable recipes</h3>
                <p class="muted small-note">Same kind of item, power system or a nearby tier: their whole-build bills, to keep costs in balance.</p>
                <div class="cmp-card this"><b>This recipe</b> <span class="muted">${form.tier !== "" ? `tier ${form.tier}` : "no tier"}</span>
                    <div class="muted">${draftGrams ? weight(draftGrams) : "no weighed materials"} · ${draftParts} component${draftParts === 1 ? "" : "s"}</div></div>
                ${!cmp ? html`<p class="muted">Looking…</p>` : !cmp.recipes.length ? html`<p class="muted">No similar recipes yet.</p>`
                    : cmp.recipes.map((r) => html`<div class="cmp-card">
                        <div class="spread"><a href=${noteHref(r.path)}>${r.itemName}</a><span class="muted">${r.tier ? `tier ${r.tier}` : "—"}</span></div>
                        ${r.why.length > 0 && html`<div class="muted small-note">like it: ${r.why.join(" · ")}</div>`}
                        <div class="muted">${r.grams ? weight(r.grams) : "no weighed materials"}${r.components ? ` · ${r.components} component${r.components === 1 ? "" : "s"}` : ""}${r.disciplines.length ? ` · ${r.disciplines.join(", ")}` : ""}</div>
                        <ul class="cmp-bill">${r.bill.map((b) => html`<li><span>${b.name}</span><span class="num">${b.qtyText}</span></li>`)}${r.parts.map((x) => html`<li><span>${x.name}</span><span class="num">${x.count}×</span></li>`)}</ul>
                    </div>`)}
            </aside>
        </div>
    </div>`;
}

function BlueprintPanel({ page, index }) {
    const [count, setCount] = useState(1);
    const item = page.collection === "Recipes" ? page.blueprint.root.item : page.path;
    const { data } = useApi(count === 1 ? null : `/api/blueprint?${qs({ item, count })}`);
    const bp = count === 1 ? page.blueprint : data ?? page.blueprint;
    return html`<div class="panel">
        <div class="spread"><h2 style="margin:0">Build tree</h2>
            <div class="row"><label class="row muted">Build <input type="number" min="1" value=${count} style="width:70px" onInput=${(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></label>
                <button class="small" title="Copy the blueprint as a callout (components, materials and what it takes to make)" onClick=${() => copyText(blueprintCallout(bp, page, count, index), `Copied the ${bp.root.name} blueprint as a callout`)}>⧉ Copy callout</button></div></div>
        <div class="grid2" style="margin-top:10px">
            <div class="tree"><ul><${Tree} node=${bp.root} /></ul></div>
            <div>
                <h3>Total materials</h3>
                <table><tbody>${bp.bill.map((b) => html`<tr><td>${b.material ? html`<a href=${noteHref(b.material)}>${b.name}</a>` : b.name}</td><td class="num">${b.qtyText}</td></tr>`)}</tbody></table>
                ${bp.parts.length > 0 && html`<h3 style="margin-top:12px">Parts without a blueprint</h3>
                    <table><tbody>${bp.parts.map((p) => html`<tr><td><a href=${noteHref(p.item)}>${p.name}</a></td><td class="num">${p.count}×</td></tr>`)}</tbody></table>`}
                <h3 style="margin-top:12px">Knowledge needed</h3>
                <div>${bp.disciplines.map((d) => html`<span class="chip">${d}</span>`)}${bp.maxTier ? html` <span class="badge">max tier ${bp.maxTier}</span>` : ""}</div>
            </div>
        </div>
    </div>`;
}

function ImageDrop({ path, onDone }) {
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const input = useRef();
    const upload = async (files) => {
        setBusy(true);
        try {
            for (const f of files) {
                if (!f.type.startsWith("image/")) continue;
                await api.send("POST", `/api/images?${qs({ path, filename: f.name || "pasted.png" })}`, null, f);
            }
            toast("Image added");
            onDone?.();
        } catch (e) { toast(e.message); }
        setBusy(false);
    };
    useEffect(() => {
        const paste = (e) => { const files = [...(e.clipboardData?.files ?? [])]; if (files.length) { e.preventDefault(); upload(files); } };
        addEventListener("paste", paste);
        return () => removeEventListener("paste", paste);
    }, [path]);
    return html`<div class=${`drop ${over ? "over" : ""}`} onClick=${() => input.current.click()}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
        ${busy ? "Uploading…" : "Drop, paste or click to add images"}
        <input ref=${input} type="file" accept="image/*" multiple style="display:none" onChange=${(e) => upload([...e.target.files])} />
    </div>`;
}

function Gallery({ images }) {
    const [big, setBig] = useState(null);
    if (!images?.length) return null;
    return html`<div class="gallery">${images.map((src) => html`<img src=${src} onClick=${() => setBig(src)} />`)}
        ${big && html`<div class="lightbox" onClick=${() => setBig(null)}><img src=${big} /></div>`}</div>`;
}

const READONLY_KEYS = new Set(["type", "created-date", "facet"]);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const sameValue = (a, b) => (isEmpty(coerce(a)) ? "" : JSON.stringify(coerce(a))) === (isEmpty(coerce(b)) ? "" : JSON.stringify(coerce(b)));

/**
 * Rename a note's file; every link to it in the vault follows (notes, map pins, canvases; a location's map file is
 * renamed with it). The title is a separate field: `withTitle` shows it too (the world builder edits both).
 * onDone({path, name}) after a change.
 */
function RenameDialog({ path: p, title: title0 = "", withTitle = false, onDone, onClose }) {
    const { data: info, error } = useApi(`/api/rename?${qs({ path: p })}`);
    const [name, setName] = useState(null);
    const [title, setTitle] = useState(title0);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const ref = useRef();
    useEffect(() => { if (info && name == null) { setName(info.name); setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 0); } }, [info]);
    useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
    const nameChanged = info && name != null && name.trim() !== info.name;
    const titleChanged = withTitle && title.trim() !== title0;
    const submit = async (e) => {
        e.preventDefault();
        if (busy || (!nameChanged && !titleChanged) || !name?.trim()) return;
        setBusy(true); setErr("");
        try {
            const r = await api.send("POST", "/api/rename", { path: p, name: name.trim(), ...(titleChanged ? { title: title.trim() } : {}) });
            const others = r.updated.length;
            toast(r.renamed ? `Renamed to ${r.name}${others ? `; links updated in ${others} file${others === 1 ? "" : "s"}` : ""}` : "Saved");
            onDone?.(r);
        } catch (e2) { setErr(e2.message); }
        setBusy(false);
    };
    return html`<div class="modal-back" onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <form class="modal rename-modal" role="dialog" aria-label="Rename" onSubmit=${submit} onKeyDown=${(e) => { if (e.key === "Escape") onClose(); }}>
            <div class="spread"><h2 style="margin:0">Rename</h2><button type="button" onClick=${onClose} aria-label="Close">×</button></div>
            ${!info ? html`<p class="muted">${error ?? "Loading…"}</p>` : info.protected ? html`<p class="muted">${info.protected}.</p>` : html`
                ${withTitle && html`<label class="field"><span>Title</span><input value=${title} onInput=${(e) => setTitle(e.target.value)} /></label>`}
                <label class="field"><span>File name</span><input ref=${ref} value=${name ?? ""} onInput=${(e) => setName(e.target.value)} required /></label>
                <p class="muted small-note">${withTitle ? "The title is what the app shows; the file name is what links use. " : "The title stays as it is. "}
                    ${info.links ? `${info.links} note${info.links === 1 ? " links" : "s link"} here; their links follow the new name` : "No notes link here yet"}${info.pins ? `; pins on ${info.pins} map${info.pins === 1 ? "" : "s"} follow too` : ""}${info.map ? "; its map file is renamed with it" : ""}. File names must be unique in the vault.</p>`}
            ${err && html`<p class="error">${err}</p>`}
            <div class="row" style="justify-content:flex-end"><button type="button" onClick=${onClose}>Cancel</button>
                ${info && !info.protected && html`<button type="submit" class="primary" disabled=${busy || (!nameChanged && !titleChanged) || !name?.trim()}>${busy ? "Renaming…" : "Rename"}</button>`}</div>
        </form>
    </div>`;
}

/**
 * A note's fields as a document: short fields as a property list (click one to edit it; empty ones fold into
 * "+ N empty fields"), long text fields as sections that always show (a "-" when blank; the pencil or a double-click
 * edits them), small fields grouped under a section (`groups` in the schema, e.g. a character's eye colour under
 * Appearance) as a two-column list there. Technical and ledger-made fields are left to the Links & more tab. Edits
 * collect until Save changes (Ctrl+S); only changed keys are patched.
 */
const DEFAULT_GROUPS = { characters: { appearance: ["gender", "height", "weight", "eye-color", "hair-color", "hair-style", "facial-hair", "attractiveness"] } };
const PLAN_SECTIONS = { plots: ["plot"], volumes: ["description", "plan"], chapters: ["plan"] };
const TECH_KEYS = new Set(["type", "created-date", "facet", "images"]);
const SECTION_TITLES = { plot: "The plot" };
const sectionTitle = (k) => SECTION_TITLES[k] ?? fieldLabel(k);
/** The collection's summary spec: the schema's `summary`, else SUMMARY */
function summarySpec(page, index) {
    return index?.schema?.collections[page.collection]?.summary
        ?? SUMMARY[page.collection] ?? (page.collection?.startsWith("Taxonomy/") ? SUMMARY.taxonomy : page.fm.type === "character" ? SUMMARY.characters : null);
}
/** Fields the Page tab leaves out (shown on Links & more): technical keys, ledger-made ones, a character's synced relations */
const technicalField = (page, spec, k) => TECH_KEYS.has(k) || (spec?.generated ?? []).includes(k) || (page.fm.type === "character" && k.startsWith("relations/"));
/** Which fields are sections (long text) and which small fields sit under a section */
function docLayout(page, spec, index, keys, defs) {
    const kind = page.plan ? null : page.fm.type === "character" ? "characters" : page.collection;
    const fm = page.fm;
    const isText = (k) => { const d = defs.has(k) ? defs.get(k) : fm[k]; return linkTargetOf(spec, k, fm[k]) == null && !Array.isArray(d) && typeof d !== "boolean" && typeof d !== "number"; };
    const named = page.plan ? PLAN_SECTIONS[page.plan.kind] ?? [] : ["description", ...(summarySpec(page, index)?.sections ?? [])];
    const long = (k) => typeof fm[k] === "string" && !isLink(fm[k]) && (fm[k].length > 120 || fm[k].includes("\n"));
    const sections = [...new Set([...named.filter((k) => keys.includes(k)), ...keys.filter(long)])].filter((k) => isText(k) && !technicalField(page, spec, k));
    const grouped = new Map();   // small field -> the section it sits under
    for (const [sec, list] of Object.entries(spec?.groups ?? DEFAULT_GROUPS[kind] ?? {})) for (const k of asList(list)) if (keys.includes(k) && !sections.includes(k)) grouped.set(k, sec);
    // a group whose section isn't a text field of the note still gets a section of its own (just the small fields)
    for (const sec of new Set(grouped.values())) if (!sections.includes(sec)) sections.push(sec);
    return { sections, grouped };
}

function FieldsEditor({ page, index, spec, scope, linkOptions }) {
    const [edits, setEdits] = useState({});
    const [baseMtime, setBaseMtime] = useState(null);
    // values just saved, shown until the refetched page catches up
    const [saved, setSaved] = useState({ mtime: 0, fm: {} });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [open, setOpen] = useState(null);         // the property being edited
    const [openSec, setOpenSec] = useState(null);   // the section being edited
    const [showEmpty, setShowEmpty] = useState(false);
    const root = useRef();
    const fm = page.mtime >= saved.mtime ? page.fm : { ...page.fm, ...saved.fm };
    const mtime = Math.max(page.mtime, saved.mtime);
    const defs = new Map(spec?.fields ?? []);
    const generated = new Set(spec?.generated ?? []);
    // stat template fields of a character sheet / creature note get typed inputs in their own section
    const statsInfo = page.stats;
    const tplName = "stat-template" in edits ? edits["stat-template"] : fm["stat-template"] || statsInfo?.holder.template || "";
    const statTpl = statsInfo?.templates?.[tplName] ?? null;
    // stat values are never plain fields: without a template they don't show at all, with one they are its section
    const statKeys = new Set([...(statTpl?.fields ?? []), ...Object.values(statsInfo?.templates ?? {}).flatMap((t) => t?.fields ?? [])].map((f) => f.key));
    const keys = [...defs.keys(), ...Object.keys(fm).filter((k) => !defs.has(k))].filter((k) => k !== "images" && k !== "stat-template" && !statKeys.has(k));
    const changed = Object.keys(edits).filter((k) => !sameValue(edits[k], fm[k]));
    const dirty = changed.length > 0;
    useEffect(() => markDirty(scope, page.path, dirty), [dirty]);
    useEffect(() => () => markDirty(scope, page.path, false), []);
    // an opened property takes the focus
    useEffect(() => { if (open) requestAnimationFrame(() => root.current?.querySelector(".np-prop.open input:not([type=checkbox]), .np-prop.open textarea")?.focus()); }, [open]);
    const edit = (k, v) => { if (baseMtime == null) setBaseMtime(mtime); setEdits((s) => ({ ...s, [k]: v })); };
    const reset = () => { setEdits({}); setBaseMtime(null); setErr(""); setOpenSec(null); };
    const save = async () => {
        if (!dirty || busy) return;
        setBusy(true); setErr("");
        try {
            const set = Object.fromEntries(changed.map((k) => [k, coerce(edits[k])]));
            const r = await api.send("PATCH", "/api/note", { path: page.path, set, baseMtime: baseMtime ?? mtime });
            setSaved({ mtime: r.mtime, fm: { ...(page.mtime >= saved.mtime ? {} : saved.fm), ...set } });
            reset(); setOpen(null);
            toast("Saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const readOnly = (k) => READONLY_KEYS.has(k) || generated.has(k) || (fm[k] && typeof fm[k] === "object" && asList(fm[k]).some((x) => x && typeof x === "object"));
    const cur = (k) => (k in edits ? edits[k] : fm[k]);
    const def = (k) => (defs.has(k) ? defs.get(k) : Array.isArray(fm[k]) ? [] : typeof fm[k] === "boolean" ? false : "");
    const input = (k) => {
        const target = linkTargetOf(spec, k, fm[k]);
        return fieldInput({ key: k, def: def(k), target, value: cur(k), index, options: linkOptionsFor(target, index, linkOptions), onChange: (v) => edit(k, v) });
    };
    const { sections, grouped } = docLayout(page, spec, index, keys, defs);
    const props = keys.filter((k) => !sections.includes(k) && !grouped.has(k) && !technicalField(page, spec, k));
    const isFilled = (k) => filled(cur(k)) || k in edits || k === open;
    const emptyCount = props.filter((k) => !isFilled(k)).length;
    const blank = html`<span class="blank">-</span>`;
    // a property: its value as text, an input once clicked (booleans are always a switch); leaving the row closes it
    const row = (k) => {
        const bool = typeof def(k) === "boolean" && !readOnly(k);
        const editing = open === k && !readOnly(k);
        return html`<div key=${k} class=${`np-prop ${changed.includes(k) ? "changed" : ""} ${editing ? "open" : ""} ${readOnly(k) ? "ro" : ""}`}
            onClick=${(e) => { if (!readOnly(k) && !bool && !editing && !e.target.closest("a")) setOpen(k); }}
            onFocusOut=${(e) => { if (editing && !e.currentTarget.contains(e.relatedTarget)) setOpen((o) => (o === k ? null : o)); }}
            onKeyDown=${(e) => { if (e.key === "Escape" && editing) { e.stopPropagation(); setOpen(null); } }}>
            <span class="np-prop-k" title=${k}>${fieldLabel(k)}</span>
            <div class="np-prop-v">${editing || bool ? input(k) : filled(cur(k)) ? html`<${Value} v=${cur(k)} links=${page.links} index=${index} />` : blank}</div>
        </div>`;
    };
    const section = (k) => {
        const hasField = keys.includes(k);
        const sub = [...grouped].filter(([, s]) => s === k).map(([f]) => f);
        const editing = openSec === k;
        const v = cur(k);
        const toggle = () => setOpenSec(editing ? null : k);
        return html`<section key=${k} class=${`np-sec ${changed.includes(k) ? "changed" : ""}`} onDblClick=${hasField && !readOnly(k) ? dblToggle(toggle) : undefined}>
            <div class="np-sec-head"><h2>${sectionTitle(k)}</h2>
                ${hasField && !readOnly(k) && (editing ? html`<button class="small" onClick=${toggle}>Done</button>`
                    : html`<button class="icon" title=${`Edit ${sectionTitle(k)} (or double-click)`} aria-label=${`Edit ${sectionTitle(k)}`} onClick=${toggle}>${ICONS.edit}</button>`)}</div>
            ${hasField && (editing
                ? (k === "plan" ? html`<${PlanEditor} value=${v ?? ""} onChange=${(x) => edit(k, x)} />`
                    : html`<${AutoTextarea} class="np-sec-text" value=${v} autoFocus=${true} onInput=${(e) => edit(k, e.target.value)} aria-label=${sectionTitle(k)} />`)
                : !filled(v) ? html`<p class="np-prose blank">-</p>`
                : k === "plan" ? html`<${PlanView} text=${String(v)} />`
                : typeof v === "string" ? html`<p class="np-prose">${v}</p>` : html`<div class="np-prose"><${Value} v=${v} links=${page.links} index=${index} /></div>`)}
            ${sub.length > 0 && html`<div class="np-mini">${sub.map(row)}</div>`}
        </section>`;
    };
    return html`<div class="np-fields" ref=${root} onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } }}>
        <div class="np-props">
            ${props.filter((k) => showEmpty || isFilled(k)).map(row)}
            ${emptyCount > 0 && html`<button class="np-more" onClick=${() => setShowEmpty(!showEmpty)}>${showEmpty ? "Hide empty fields" : `+ ${emptyCount} empty field${emptyCount === 1 ? "" : "s"}`}</button>`}
        </div>
        ${sections.map(section)}
        ${statsInfo && statTpl && html`<section class="np-sec"><${SheetStats} info=${statsInfo} tpl=${statTpl} tplName=${tplName} fm=${fm} edits=${edits} edit=${edit} changed=${changed} index=${index} /></section>`}
        ${err && html`<p class="error">${err}</p>`}
        <div class=${`savebar ${dirty ? "dirty" : "quiet"}`}>
            <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save changes"}</button>
            ${dirty && html`<button onClick=${reset}>Discard</button><span class="muted">${changed.length} changed · Ctrl+S</span>`}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ note summary (drawer)

// What matters per collection: `facts` print as a compact row, `sections` as subheadings with their values.
// The description always leads. A schema collection's `summary: {facts, sections}` overrides these.
const SUMMARY = {
    Items: { facts: ["cat", "subcat", "rarity", "tier", "grade", "slot", "value", "power-system", "elements"], sections: ["applies-to", "teaches"] },
    Materials: { facts: ["cat", "rarity", "tier", "density", "power-system", "elements"], sections: ["usage", "sources"] },
    Recipes: { facts: ["item", "tier", "disciplines", "rarity"], sections: ["components", "materials"] },
    Abilities: { facts: ["cat", "subcat", "grade", "power-system", "elements", "parent-art"], sections: ["requirements", "reagents", "classes", "sub-arts"] },
    Races: { facts: ["parent-race", "sapient", "lifespan", "homeworld", "power-system"], sections: ["appearance", "culture", "traits"] },
    Creatures: { facts: ["cat", "subcat", "temperament", "intelligence", "potential", "potential-sub", "power-system"], sections: ["habitat", "drops"] },
    "Power Systems": { facts: ["parent", "energy-source", "tradition"], sections: [] },
    "Power Levels": { facts: ["power-system", "level-kind", "class"], sections: ["sub-levels"] },
    Worlds: { facts: ["power-system"], sections: ["races"] },
    Locations: { facts: ["scale", "parent", "world", "cat", "controlled-by", "population", "size", "climate"], sections: [] },
    Factions: { facts: ["cat", "world", "seat", "power-system"], sections: ["territory", "members", "relations/friendly", "relations/neutral", "relations/hostile"] },
    taxonomy: { facts: ["parent", "class"], sections: [] },
    characters: { facts: ["race", "gender", "alive", "age-current", "member-of", "character/power-system", "character/level", "character/sub-level", "character/talent"], sections: ["personality", "appearance"] },
};
const fieldLabel = (k) => { const t = k.split("/").pop().replace(/-/g, " "); return t[0].toUpperCase() + t.slice(1); };
const filled = (v) => !(v == null || v === "" || (Array.isArray(v) && !v.length));

/**
 * A character's relationships: friendly, neutral and hostile, each with the name and the current note. From the
 * ledger (page.relations, latest chapter) when it has relation lines, else the sheet's relations/<status> lists.
 * Long sections show the first few and fold out.
 */
const RELATION_SECTIONS = [["friendly", "Friendly"], ["neutral", "Neutral"], ["hostile", "Hostile"], ["unset", "No standing yet"]];
const RELATIONS_SHOWN = 5;
/** compute()'s relations [{with, withName, status, note, chapter, entry}] -> {friendly: [...], neutral, hostile, unset} */
function relationGroups(list, index) {
    const out = Object.fromEntries(RELATION_SECTIONS.map(([k]) => [k, []]));
    for (const r of list) {
        const n = index?.resolve(r.with);
        out[r.status || "unset"].push({ ...r, name: n?.fm.title || r.withName, path: r.path ?? n?.path ?? null });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
    return out;
}
function RelationsBox({ page, index, rel: given, title = "Relationships" }) {
    const [open, setOpen] = useState(() => new Set());
    const rel = given ?? page.relations ?? Object.fromEntries(RELATION_SECTIONS.map(([k]) => [k, asList(page.fm[`relations/${k}`]).filter(Boolean).map((v) => {
        const n = isLink(v) && index?.resolve(v);
        return { with: v, name: n?.fm.title || linkText(v), path: page.links?.[v]?.path ?? n?.path ?? null, note: "" };
    })]));
    const sections = RELATION_SECTIONS.filter(([k]) => rel[k]?.length);
    if (!sections.length) return null;
    const toggle = (k) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
    return html`<div class="panel note-summary relations-box"><h3>${title}</h3>
        ${sections.map(([k, label]) => {
            const list = rel[k], all = open.has(k), shown = all ? list : list.slice(0, RELATIONS_SHOWN);
            return html`<section class=${`rel-section rel-${k}`}>
                <h4>${label} <span class="muted small">${list.length}</span></h4>
                <ul class="rel-list">${shown.map((r) => html`<li>
                    ${r.path ? html`<a class="rel-name" href=${noteHref(r.path)}>${r.name}</a>` : html`<span class="rel-name">${r.name}</span>`}
                    <span class="rel-note">${r.note}</span>
                    ${r.chapter != null ? html`<span class="rel-ch muted small" title=${`Last changed in chapter ${r.chapter} (entry ${r.entry})`}>ch. ${r.chapter}</span>` : html`<span class="rel-ch"></span>`}</li>`)}</ul>
                ${list.length > RELATIONS_SHOWN && html`<button type="button" class="small rel-more" onClick=${() => toggle(k)}>${all ? "Show fewer" : `Show all ${list.length}`}</button>`}
            </section>`;
        })}</div>`;
}

// Ranked taxonomy notes (`ordered: true`) show every value of their facet in `class` order
const ranked = (n) => n.fm.ordered === true && n.fm.class !== "" && n.fm.class != null && !Number.isNaN(Number(n.fm.class));
function ClassStrip({ page, index }) {
    if (!page.collection?.startsWith("Taxonomy/") || !ranked(page)) return null;
    const sibs = (index?.inCollection(page.collection) ?? []).filter(ranked)
        .sort((a, b) => Number(a.fm.class) - Number(b.fm.class) || a.name.localeCompare(b.name));
    if (sibs.length < 2) return null;
    return html`<nav class="class-strip">${sibs.map((n) => html`<a href=${noteHref(n.path)} class=${n.path === page.path ? "on" : ""}>
        <span class="rank">${n.fm.class}</span>${n.fm.title || n.name}</a>`)}</nav>`;
}

/** A [[link]]'s target note name (no alias, heading or folders), lower case, for matching */
const linkKey = (v) => { const m = String(v ?? "").match(/^!?\[\[([^\]]+)\]\]$/); return (m ? m[1].split("|")[0].split("#")[0].split("/").pop() : String(v ?? "")).trim().toLowerCase(); };
const SIDE_SHOWN = 3;

/**
 * A note as a document: a header (path, title, tabs, actions), then the page in the middle and a narrow column beside
 * it, the two centred. Tabs: Page (fields, sections, text, images), for a novel's characters Relations, Inventory and
 * Ledger at the chapter of the column's slider, and Links & more (links both ways, technical fields). The column holds
 * what a note relates to: a character's stats, relations and inventory at a chapter; a plot's family (main plot and
 * subplots, the open one marked); who holds an item and where it is used.
 */
function NoteView({ index, path, scope = "page" }) {
    const { data: page, error } = useApi(`/api/note?${qs({ path })}`);
    const { data: plan } = useApi(page?.plan ? `/api/plan?${qs({ novel: page.plan.novel })}` : null);
    const linkOptions = useMemo(() => plan && {
        "@plots": plan.plots.map((p) => ({ label: p.name, hint: p.title !== p.name ? p.title : p.rating?.title ?? "" })),
        "@characters": plan.characters.map((c) => ({ label: c.name })),
    }, [plan]);
    const [renaming, setRenaming] = useState(false);
    const [tab, setTabState] = useState(() => (store.get("characterTab", "page") === "ledger" ? "ledger" : "page"));
    const setTab = (t) => { setTabState(t); if (t === "page" || t === "ledger") store.set("characterTab", t); };
    // a ledger entry being written or edited from a character's tabs: a tab of its own, kept while you look at the others
    const [entryTab, setEntryTab] = useState(null); // query string of the entry editor, or null
    const openEntry = (p) => { setEntryTab(qs(p)); setTab("entry"); };
    const closeEntry = () => { setEntryTab(null); setTab("ledger"); };
    const pick = useItemPick();
    const novel = page && index?.novels.find((n) => page.path.startsWith(`${n.folder}/`));
    const isChar = page?.fm.type === "character" && !!novel;
    // a character's relation fields pick from the characters of its own novel
    const novelLinks = useNovelLinks(page?.fm.type === "character" ? novel?.folder : null);
    // a character's ledgers at the column's chapter (null: the latest)
    const [at, setAt] = useState(null);
    const { data: owned } = useApi(isChar ? `/api/owner?${qs({ novel: novel.folder, owner: page.name, at })}` : null);
    const { data: stats } = useApi(isChar ? `/api/stats?${qs({ novel: novel.folder, owner: page.name, at })}` : null);
    if (!page) return html`<${Loading} error=${error} />`;
    const schema = index?.schema;
    const spec = page.plan?.spec ?? (page.collection ? schema?.collections[page.collection] : page.fm.type === "character" ? schema?.characters : null);
    const chapter = at ?? owned?.latestChapter ?? 0;
    const ledgersOf = (behaviour) => (owned?.ledgers ?? []).filter((l) => l.computed.behaviour === behaviour);
    const relLedger = ledgersOf("state").find((l) => l.computed.relations?.length) ?? owned?.ledgers.find((l) => /relation/i.test(l.type));
    const stockLedgers = ledgersOf("stock");
    const linkGroups = (groups) => Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([c, list]) => html`<div class="np-linkgroup"><b>${c === "Unresolved" ? c : collectionLabel(c)} <span class="muted">${list.length}</span></b><div>${list.slice(0, 60).map((b) => b.path ? html`<a class="chip" href=${noteHref(b.path)}>${b.name}</a>` : html`<span class="chip muted">${b.name}</span>`)}${list.length > 60 ? html`<span class="muted"> +${list.length - 60} more</span>` : ""}</div></div>`);
    const linkedFrom = Object.values(page.backlinks).reduce((n, l) => n + l.length, 0);
    const deletable = !page.path.startsWith("90. Templater/") && !["config", "ledger"].includes(page.fm.type);
    const del = async () => {
        try {
            const r = await api.send("DELETE", `/api/note?${qs({ path: page.path, baseMtime: page.mtime })}`);
            markDirty(scope, page.path, false);
            toast(`Moved to ${r.trashed}`);
            if (scope === "drawer") dropFromDrawer(noteHref(page.path));
            else if (scope === "left") closeLeftTab(noteHref(page.path));
            else go(page.collection ? `#/c/${encodeURIComponent(page.collection)}` : novel ? `#/novel/${encodeURIComponent(novel.folder)}` : "#/");
        } catch (e) { toast(e.message); }
    };
    const renamed = (r) => {
        setRenaming(false);
        if (!r.renamed) return;
        markDirty(scope, page.path, false);
        if (scope === "drawer") renameInDrawer(noteHref(page.path), noteHref(r.path));
        else if (scope === "left") renameLeftTab(noteHref(page.path), noteHref(r.path));
        else location.replace(noteHref(r.path));
    };
    const startRename = () => { if (!dirtyForms.has(`${scope}:${page.path}`) || confirm("Renaming reloads this note. Discard unsaved changes?")) setRenaming(true); };
    // opening another note from the page: in the drawer it becomes the drawer page, in a left tab that tab follows it
    const openNote = (p) => (scope === "drawer" ? openInDrawer(noteHref(p)) : scope === "left" ? renameLeftTab(noteHref(page.path), noteHref(p)) : go(noteHref(p)));
    const tabs = [["page", "Page"],
        ...(isChar ? [["relations", "Relations"], ["inventory", "Inventory"], ["ledger", "Ledger"]] : []),
        ...(entryTab ? [["entry", entryTabLabel(entryTab)]] : []),
        ["links", "Links & more"]];
    const tabNow = tabs.some(([k]) => k === tab) ? tab : "page";
    const family = page.plan?.kind === "plots" ? plotFamily(plan, page) : page.plan?.kind === "volumes" && plan ? volumePlots(plan, page.fm) : null;
    const usage = html`
        ${page.heldBy?.length > 0 && html`<div class="np-side-sec"><h4>Held by</h4>${page.heldBy.map((x) => html`<div class="np-side-row"><a href=${ownerHref(x.novel, x.owner)}>${x.owner}</a><span class="muted">${x.qtyText}${x.store !== "inventory" ? ` @ ${x.store}` : ""}</span></div>`)}</div>`}
        ${page.whereUsed?.length > 0 && html`<div class="np-side-sec"><h4>Used in</h4><${WhereUsed} uses=${page.whereUsed} /></div>`}
        ${page.collection === "Items" && !page.blueprint && html`<div class="np-side-sec"><h4>Recipe</h4><button class="small-link linkish" onClick=${() => { if (inDrawer(scope)) collapseDrawer(); go(`#/newrecipe/${encodeURIComponent(page.path)}`); }}>Create recipe</button></div>`}
        ${page.creatureStats && html`<${CreatureNovels} page=${page} index=${index} />`}`;
    const side = isChar ? html`<${CharacterSide} owned=${owned} stats=${stats} chapter=${chapter} setAt=${setAt} relLedger=${relLedger} stockLedgers=${stockLedgers} index=${index} goTab=${setTab} />`
        : family ? html`<${PlotFamily} family=${family} current=${page.path} open=${openNote} />`
        : (page.heldBy?.length || page.whereUsed?.length || (page.collection === "Items" && !page.blueprint) || page.creatureStats) ? usage : null;
    const content = blocksFor(page) ? html`<${NoteBlocks} key=${page.path} page=${page} scope=${scope} />` : html`
        ${page.blueprint && html`<${BlueprintPanel} page=${page} index=${index} />`}
        ${page.body.trim() && (page.plan
            ? html`<details class="np-sec"><summary class="muted">Note body (not used by the plan, edit it in Obsidian)</summary><${Html} html=${page.html} /></details>`
            : html`<div class="np-body"><${Html} html=${page.html} /></div>`)}`;
    const technical = Object.keys(page.fm).filter((k) => technicalField(page, spec, k));
    return html`<div class="np-note">
        ${renaming && html`<${RenameDialog} path=${page.path} onDone=${renamed} onClose=${() => setRenaming(false)} />`}
        <header class="np-head">
            <div class="np-crumbs">${page.collection ? html`<a href=${`#/c/${encodeURIComponent(page.collection)}`}>${collectionLabel(page.collection)}</a>` : page.path.split("/").slice(0, -1).join(" / ")}</div>
            <nav class="np-tabs" role="tablist">${tabs.map(([k, label]) => html`<button key=${k} role="tab" aria-selected=${tabNow === k} class=${`pill ${tabNow === k ? "on" : ""} ${k === "entry" ? "entry-tab" : ""}`} onClick=${() => setTab(k)}>${label}${k === "entry" && html`<span class="tab-x" role="button" title="Close without saving" aria-label="Close the entry" onClick=${(e) => { e.stopPropagation(); closeEntry(); }}>×</span>`}</button>`)}</nav>
            <h1 class="np-title">${page.fm.title && page.fm.title !== page.name ? html`${page.fm.title} <span class="muted np-filename">${page.name}</span>` : page.name}
                ${page.fm.status ? html` <span class="badge">${page.fm.status}</span>` : ""}</h1>
            <div class="np-actions">
                ${pickable(pick, page.collection) && html`<button class="primary" onClick=${() => pick.pick(page.name)}>Use this for ${pick.label}</button>`}
                ${["Items", "Materials"].includes(page.collection) && html`<button class="small" title="Copy as an item callout (like a game's item tooltip)" onClick=${() => copyText(itemCallout(page, spec), `Copied ${page.name} as a callout`)}>⧉ Copy callout</button>`}
                ${deletable && html`<button class="small" title="Rename the file; links to it in the vault follow" onClick=${startRename}>Rename file</button>`}
                ${deletable && html`<${ConfirmButton} class="small" onConfirm=${del}
                    title=${`Move to the vault's .trash folder${linkedFrom ? `. ${linkedFrom} note${linkedFrom > 1 ? "s" : ""} link here and will show it as unresolved` : ""}${page.heldBy?.length ? ". Ledger lines still name it" : ""}`}>Delete<//>`}
            </div>
        </header>
        ${page.fmError && html`<div class="warnbox">Frontmatter could not be read: ${page.fmError}</div>`}
        <div class=${`np-cols ${side ? "" : "single"}`}>
            <div class="np-main">
                <div hidden=${tabNow !== "page"}>
                    ${family?.parent && html`<div class="np-parent"><span class="muted">Subplot of</span><button class="linkish" onClick=${() => openNote(family.parent.path)}>${family.parent.title}</button></div>`}
                    <${ClassStrip} page=${page} index=${index} />
                    ${page.fmError ? html`<p class="muted">Fix the frontmatter in Obsidian to edit fields here.</p>`
                        : html`<${FieldsEditor} key=${page.path} page=${page} index=${index} spec=${spec} scope=${scope} linkOptions=${linkOptions ?? novelLinks} />`}
                    ${family && html`<${PagePlots} page=${page} plan=${plan} family=${family} open=${openNote} />`}
                    <${PowerLevels} page=${page} index=${index} />
                    ${content}
                    <section class="np-sec"><div class="np-sec-head"><h2>Images</h2></div><${Gallery} images=${page.images} /><${ImageDrop} path=${page.path} /></section>
                </div>
                ${isChar && tabNow === "relations" && html`<${CharacterRelations} ledger=${relLedger} chapter=${chapter} index=${index} onEntry=${() => openEntry({ owner: page.name, type: relLedger?.type ?? "Relationships", chapter })} />`}
                ${isChar && tabNow === "inventory" && html`<div class="np-tabpage">
                    <div class="spread"><h2 class="np-h2">Held at chapter ${chapter}</h2><button class="small" onClick=${() => openEntry({ owner: page.name, type: stockLedgers[0]?.type ?? "Inventory", chapter })}>+ Inventory entry</button></div>
                    ${stockLedgers.length ? stockLedgers.map((l) => html`${stockLedgers.length > 1 && html`<h3>${l.type}</h3>`}${holdingsTable(l.computed.stacks ?? [], index)}`) : html`<p class="muted">No inventory ledger yet.</p>`}</div>`}
                ${isChar && tabNow === "ledger" && html`<${OwnerView} key=${page.name} index=${index} folder=${novel.folder} owner=${page.name} params=${new URLSearchParams()} embedded=${true} onEntry=${openEntry} chapter=${chapter} onChapter=${setAt} />`}
                ${isChar && entryTab && html`<div hidden=${tabNow !== "entry"}><${EntryEditor} key=${entryTab} index=${index} folder=${novel.folder} params=${new URLSearchParams(entryTab)} embedded=${true} onDone=${closeEntry} /></div>`}
                ${tabNow === "links" && html`<div class="np-tabpage np-links">
                    <section><h2 class="np-h2">Linked from</h2>${linkedFrom ? linkGroups(page.backlinks) : html`<p class="muted">No notes link here.</p>`}</section>
                    <section><h2 class="np-h2">Links to</h2>${Object.keys(page.outlinks ?? {}).length ? linkGroups(page.outlinks) : html`<p class="muted">This note links nowhere.</p>`}</section>
                    <section><h2 class="np-h2">Technical fields</h2>
                        <div class="np-prop ro"><span class="np-prop-k">file</span><div class="np-prop-v mono">${page.path}</div></div>
                        ${technical.map((k) => html`<div class="np-prop ro" key=${k}><span class="np-prop-k mono" title=${k}>${k}</span><div class="np-prop-v">${filled(page.fm[k]) ? html`<${Value} v=${page.fm[k]} links=${page.links} index=${index} />` : html`<span class="blank">-</span>`}</div></div>`)}</section>
                </div>`}
            </div>
            ${side && html`<aside class="np-side">${side}</aside>`}
        </div>
    </div>`;
}

/** The column beside a character: the chapter slider, then stats, relations and what they carry at that chapter */
function CharacterSide({ owned, stats, chapter, setAt, relLedger, stockLedgers, index, goTab }) {
    if (!owned) return html`<div class="np-side-sec muted">Loading…</div>`;
    const max = owned.latestChapter ?? 0;
    const rel = relLedger?.computed.relations ?? [];
    const order = { friendly: 0, neutral: 1, hostile: 2 };
    const rels = [...rel].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || String(a.withName).localeCompare(String(b.withName)));
    const held = stockLedgers.flatMap((l) => l.computed.stacks ?? []);
    const t = stats?.template;
    const statFields = t ? t.fields.filter((f) => stats.display[f.key]) : [];
    const more = (n, label, tab) => n > SIDE_SHOWN && html`<button class="np-more" onClick=${() => goTab(tab)}>${label} →</button>`;
    return html`
        <div class="np-slider">
            <label for=${`ch-${owned.owner ?? ""}`} class="spread"><span>Chapter</span><span><b>${chapter}</b> / ${max}</span></label>
            <input id=${`ch-${owned.owner ?? ""}`} type="range" min="0" max=${max} value=${chapter} onInput=${(e) => setAt(Number(e.target.value))} aria-label="Chapter" />
        </div>
        ${statFields.length > 0 && html`<div class="np-side-sec"><h4>${t.name} stats</h4>
            ${statFields.slice(0, 6).map((f) => html`<div class="np-side-row"><span>${f.label}</span><span class="muted">${f.type === "link" || f.type === "links" ? linkLabel(String(stats.values[f.key] ?? "")) : stats.display[f.key]}</span></div>`)}
            ${statFields.length > 6 && html`<button class="np-more" onClick=${() => goTab("ledger")}>All ${statFields.length} stats →</button>`}</div>`}
        ${rels.length > 0 && html`<div class="np-side-sec"><h4>Relations</h4>
            ${rels.slice(0, SIDE_SHOWN).map((r) => html`<div class="np-side-row"><span class="linkish-text">${r.withName}</span><span class=${`muted rel-${r.status}`}>${r.status || "-"}</span></div>`)}
            ${more(rels.length, `All ${rels.length} relations`, "relations")}</div>`}
        ${held.length > 0 && html`<div class="np-side-sec"><h4>Carrying</h4>
            ${held.slice(0, SIDE_SHOWN).map((s) => html`<div class="np-side-row">${s.itemPath ? html`<a href=${noteHref(s.itemPath)}>${s.itemName}</a>` : html`<span>${s.itemName}</span>`}<span class="muted">${s.qtyText}</span></div>`)}
            ${more(held.length, `All ${held.length} items`, "inventory")}</div>`}
        ${!statFields.length && !rels.length && !held.length && html`<p class="muted small">Nothing in the ledgers at this chapter yet.</p>`}`;
}

/** A character's relations at a chapter: friendly, neutral, hostile, each with its latest note and how it got there */
function CharacterRelations({ ledger, chapter, index, onEntry }) {
    const head = html`<div class="spread"><h2 class="np-h2">Relations at chapter ${chapter}</h2><button class="small" onClick=${onEntry}>+ Relationship entry</button></div>`;
    const rel = ledger?.computed.relations ?? [];
    if (!rel.length) return html`<div class="np-tabpage">${head}<p class="muted">No relationships in the ledgers yet.</p></div>`;
    // every relation line up to the chapter, per person, in story order (for "2 earlier notes · neutral at ch. 3")
    const history = new Map();
    for (const e of [...(ledger.entries ?? [])].sort((a, b) => a.chapter - b.chapter)) {
        if (e.chapter > chapter) continue;
        for (const l of e.lines ?? []) if (l.with && /^relation/i.test(String(l.set ?? ""))) {
            const k = linkKey(l.with);
            if (!history.has(k)) history.set(k, []);
            history.get(k).push({ chapter: e.chapter, value: l.value, note: l.note });
        }
    }
    const groups = relationGroups(rel, index);
    return html`<div class="np-tabpage">${head}
        ${RELATION_SECTIONS.filter(([k]) => groups[k]?.length).map(([k, label]) => html`<section class=${`np-rel-group rel-${k}`}>
            <h3>${label} <span class="muted">${groups[k].length}</span></h3>
            ${groups[k].map((r) => {
                const h = history.get(linkKey(r.with)) ?? [];
                const prev = h.length > 1 ? h[h.length - 2] : null;
                return html`<div class="np-rel">
                    ${r.path ? html`<a class="np-rel-name" href=${noteHref(r.path)}>${r.name}</a>` : html`<span class="np-rel-name">${r.name}</span>`}
                    <div><div class="np-rel-note">${r.note || html`<span class="blank">-</span>`}</div>
                        ${prev && html`<div class="muted small">${h.length - 1} earlier note${h.length > 2 ? "s" : ""} · ${prev.value || "no standing"} at ch. ${prev.chapter}</div>`}</div>
                    <span class="muted small">${r.chapter != null ? `ch. ${r.chapter}` : ""}</span>
                </div>`;
            })}
        </section>`)}</div>`;
}

const byRating = (a, b) => (b.rating?.class ?? 0) - (a.rating?.class ?? 0) || a.title.localeCompare(b.title);
/** The plot a plot's `subplot-of` names (from the novel's plots), or null */
function parentPlot(plots, p) {
    const v = p.fm?.["subplot-of"];
    if (!v) return null;
    const k = linkKey(asList(v)[0]);
    return plots.find((x) => x.name.toLowerCase() === k) ?? null;
}
/** A plot's family from the novel's plots: its main plot (what its `subplot-of` names), the main plot's subplots, its own */
function plotFamily(plan, page) {
    const plots = plan?.plots ?? [];
    const me = plots.find((p) => p.path === page.path);
    if (!me) return null;
    const parent = parentPlot(plots, me);
    const main = parent ?? me;
    return {
        parent, main,
        subplots: plots.filter((p) => parentPlot(plots, p)?.path === main.path).sort(byRating),
        children: plots.filter((p) => parentPlot(plots, p)?.path === me.path).sort(byRating),
    };
}
/**
 * A volume's plots: its main plot (`plot`) and its subplots: the ones its `subplots` lists plus every plot whose
 * `subplot-of` names the main plot, so a subplot shows in the volume however it was linked
 */
function volumePlots(plan, fm) {
    const plots = plan?.plots ?? [];
    const main = fm.plot ? plotByLink(plan, asList(fm.plot)[0]) : null;
    const listed = asList(fm.subplots).map((v) => plotByLink(plan, v)).filter(Boolean);
    const derived = main ? plots.filter((p) => parentPlot(plots, p)?.path === main.path) : [];
    const subplots = [...new Map([...listed, ...derived].filter((p) => p.path !== main?.path).map((p) => [p.path, p])).values()].sort(byRating);
    return { main, subplots };
}

/** The column beside a plot or volume: the main plot and its subplots as titles, the open plot marked; a click opens one */
function PlotFamily({ family, current, open }) {
    const pill = (p) => html`<button key=${p.path} class=${`np-pill ${p.path === current ? "on" : ""}`} aria-current=${p.path === current ? "page" : undefined}
        onClick=${() => p.path !== current && open(p.path)}>${p.title}</button>`;
    return html`<div class="np-side-sec"><h4>Main plot</h4>${family.main ? pill(family.main) : html`<p class="muted small">None yet.</p>`}</div>
        <div class="np-side-sec"><h4>Subplots</h4>${family.subplots.length ? family.subplots.map(pill) : html`<p class="muted small">None yet.</p>`}</div>`;
}

/**
 * Plots shown on another note's page with their own text (a plot's subplots, a volume's main plot and subplots), each
 * edited here (pencil or double-click) and saved to that plot's note. `onAdd` adds one.
 */
function PlotTexts({ title, hint = "", plots, open, onAdd = null, addLabel = "+ Add a subplot", empty = "No subplots yet." }) {
    const [editing, setEditing] = useState(null);   // path
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const start = (p) => { setEditing(p.path); setDraft(String(p.fm.plot ?? "")); };
    const save = async (p) => {
        setBusy(true);
        try { await api.send("PATCH", "/api/note", { path: p.path, set: { plot: draft }, baseMtime: p.mtime }); setEditing(null); toast(`Saved ${p.title}`); }
        catch (e) { toast(e.message); }
        setBusy(false);
    };
    return html`<section class="np-sec">
        <div class="np-sec-head"><h2>${title}</h2>${hint && html`<span class="muted small">${hint}</span>`}</div>
        ${plots.map((p) => html`<div key=${p.path} class="np-sub" onDblClick=${editing === p.path ? undefined : dblToggle(() => start(p))}>
            <div class="spread"><div class="row"><button class="linkish np-sub-title" onClick=${() => open(p.path)}>${p.title}</button>${p.rating && html`<span class="chip">${p.rating.title}</span>`}
                ${asList(p.fm.characters).length > 0 && html`<span class="muted small">${asList(p.fm.characters).map(linkLabel).join(", ")}</span>`}</div>
                ${editing !== p.path && html`<button class="icon" aria-label=${`Edit the text of ${p.title}`} title="Edit (or double-click)" onClick=${() => start(p)}>${ICONS.edit}</button>`}</div>
            ${editing === p.path ? html`<${AutoTextarea} class="np-sec-text" value=${draft} autoFocus=${true} onInput=${(e) => setDraft(e.target.value)} aria-label=${`The plot of ${p.title}`}
                    onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); e.stopPropagation(); save(p); } if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
                <div class="row" style="margin-top:6px"><button class="primary" disabled=${busy} onClick=${() => save(p)}>${busy ? "Saving…" : "Save"}</button><button onClick=${() => setEditing(null)}>Cancel</button><span class="muted small">Saved to ${p.name}</span></div>`
                : html`<p class=${`np-prose ${filled(p.fm.plot) ? "" : "blank"}`}>${filled(p.fm.plot) ? String(p.fm.plot) : "-"}</p>`}
        </div>`)}
        ${!plots.length && html`<p class="muted">${empty}</p>`}
        ${onAdd && html`<button class="np-more" onClick=${onAdd}>${addLabel}</button>`}
    </section>`;
}

/** Make a plot (asks for its title), optionally a subplot of `parent`; resolves to its path */
async function newPlot(novel, parent = null) {
    const title = window.prompt(parent ? "Title of the new subplot" : "Plot title")?.trim();
    if (!title) return null;
    try {
        const r = await api.send("POST", "/api/plan/plot", { novel, title, fm: parent ? { "subplot-of": toLink(parent) } : {} });
        toast(`Added ${title}`);
        return r?.path ?? null;
    } catch (e) { toast(e.message); return null; }
}

/** The plot parts of a plot's or volume's page: a plot's subplots; a volume's main plot and subplots */
function PagePlots({ page, plan, family, open }) {
    if (page.plan?.kind === "plots") {
        if (!family.children.length && family.parent) return null;   // a subplot without subplots of its own
        return html`<${PlotTexts} title="Subplots" hint="plots whose “subplot of” is this one" plots=${family.children} open=${open}
            onAdd=${async () => { const p = await newPlot(page.plan.novel, page.name); if (p) open(p); }} />`;
    }
    // a volume: a new subplot is a subplot of its main plot, or, with no main plot yet, listed in the volume's subplots
    const addSub = async () => {
        const p = await newPlot(page.plan.novel, family.main?.name ?? null);
        if (!p) return;
        if (!family.main) {
            const name = p.split("/").pop().replace(/\.md$/, "");
            try { await api.send("PATCH", "/api/note", { path: page.path, set: { subplots: [...asList(page.fm.subplots), toLink(name)] } }); } catch (e) { toast(e.message); }
        }
    };
    return html`
        <${PlotTexts} title="Main plot" plots=${family.main ? [family.main] : []} open=${open} empty="No main plot yet: choose one in the Plot field above." />
        <${PlotTexts} title="Subplots" hint=${family.main ? `listed in the volume, or a subplot of ${family.main.title}` : "listed in the volume"} plots=${family.subplots} open=${open} onAdd=${addSub} />`;
}

/** A power system's levels: taxonomy values whose `power-system` is this note, per taxonomy, sub-levels indented, with their numbers */
function PowerLevels({ page, index }) {
    if (page.collection !== "Power Systems" || !index) return null;
    const me = page.name.toLowerCase();
    const notes = index.notes.filter((n) => n.collection?.startsWith("Taxonomy/") && n.fm["power-system"] && linkLabel(String(n.fm["power-system"])).toLowerCase() === me);
    if (!notes.length) return null;
    const facets = [...new Set(notes.map((n) => n.collection))];
    return html`<div class="panel note-summary power-levels"><h3>Levels</h3>
        ${facets.map((c) => {
            const own = notes.filter((n) => n.collection === c);
            const { options, noteThresholds } = facetChoice(own, "all", (l) => index.resolve(l)?.path ?? null);
            const byName = new Map(own.map((n) => [n.name, n]));
            return html`${facets.length > 1 && html`<h4>${collectionLabel(c)}</h4>`}
                <table class="levels-table"><tbody>${options.map((o) => { const n = byName.get(o); const sub = !!(n.fm.parent && index.resolve(String(n.fm.parent))); return html`<tr class=${sub ? "sub" : ""}>
                    <td><a href=${noteHref(n.path)}>${n.fm.title || n.name}</a></td><td class="num muted">${n.fm.threshold !== "" && n.fm.threshold != null ? n.fm.threshold : sub ? "" : noteThresholds[o] ?? ""}</td></tr>`; })}</tbody></table>
                <p class="muted small-note"><a href=${`#/c/${encodeURIComponent(c)}`}>${collectionLabel(c)}</a>: a stat template's choice can take these values and work them out from a stat.</p>`;
        })}</div>`;
}

// ------------------------------------------------------------------ note blocks (the body's "## " sections)

const ICONS = {
    edit: html`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>`,
    move: html`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12h18M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></svg>`,
    trash: html`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>`,
};

/**
 * While `active`, Escape pressed twice within 1.5 s calls `cancel` (the first press says so): discarding a new item
 * being made. Listens in the capture phase, so it also works from inside editors that use Escape themselves. Only the
 * form that holds the focus answers (or, with nothing focused, a visible one); dialogs keep Escape for themselves.
 */
export function useEscapeTwice(active, cancel, root) {
    const fn = useRef(cancel);
    fn.current = cancel;
    useEffect(() => {
        if (!active) return;
        let armed = 0;
        const k = (e) => {
            if (e.key !== "Escape" || e.repeat || document.querySelector(".modal-back, .lightbox, .pick-modal")) return;
            const el = root?.current, at = document.activeElement;
            if (el && !(el.contains(at) || ((!at || at === document.body) && el.offsetParent && !el.closest("[inert]")))) return;
            if (Date.now() - armed < 1500) { armed = 0; fn.current(); }
            else { armed = Date.now(); toast("Press Escape again to discard"); }
        };
        addEventListener("keydown", k, true);
        return () => removeEventListener("keydown", k, true);
    }, [active]);
}

/**
 * Double-click toggles editing on a panel that has an Edit button. Double-clicks on controls, links and (while editing)
 * text fields are left alone, so selecting a word in the editor still works.
 */
export function dblToggle(fn) {
    return (e) => {
        if (e.target.closest("button, a, input, textarea, select, [contenteditable], .be-page, .be-toolbar, .picker")) return;
        e.preventDefault();
        window.getSelection?.()?.removeAllRanges();
        fn(e);
    };
}

/**
 * A note's body as blocks: the text before the first heading, then one block per "## " section (the `## Images`
 * section stays where it is; the gallery shows it). Each block can be edited (writer's block editor), moved (↑↓ in move
 * mode, Enter or Escape to finish) or deleted; "+ Add block" offers titles other notes of the collection use.
 * Changes are saved at once, rewriting only the sections involved. `wholePage` adds "Edit as one page".
 */
function NoteBlocks({ page, scope = "page", callouts = true, wholePage = false, addLabel = "+ Add block", empty = "" }) {
    const [local, setLocal] = useState(null); // {mtime, pre, sections} just saved, until the refetched page catches up
    const doc = local && local.mtime > page.mtime ? local : { mtime: page.mtime, pre: page.pre, sections: page.sections };
    const [editing, setEditing] = useState(null); // "pre" | section index | "new" | "all"
    const [draft, setDraft] = useState(null);     // {title, text}
    const [moving, setMoving] = useState(null);   // {i, list}: the block being moved and the order so far
    const [adding, setAdding] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [busy, setBusy] = useState(false);
    const moveRef = useRef();
    const rootRef = useRef();
    const dirtyKey = `blocks:${page.path}`;
    const changed = !!draft && (editing === "new" || draft.changed);
    useEffect(() => markDirty(scope, dirtyKey, changed), [changed]);
    useEffect(() => () => markDirty(scope, dirtyKey, false), []);
    useLayoutEffect(() => { if (moving) moveRef.current?.focus({ preventScroll: false }); }, [moving?.i]);
    const body = (pre, sections) => joinSections(pre, sections);
    /** write a new body; edited sections are rendered here so they show before the page is fetched again */
    const save = async (preText, sections, msg) => {
        const text = body(preText, sections);
        if (text === joinSections(doc.pre.text, doc.sections)) return true;
        setBusy(true);
        try {
            const r = await api.send("PATCH", "/api/note", { path: page.path, body: text, baseMtime: Math.max(page.mtime, local?.mtime ?? 0) });
            const render = (md) => (md.trim() ? api.send("POST", "/api/render", { markdown: md }).then((x) => x.html) : "");
            const secs = await Promise.all(sections.map(async (x) => (x.html != null || x.images ? x : { ...x, html: await render(x.text) })));
            const preHtml = preText === doc.pre.text ? doc.pre.html : await render(preText);
            setLocal({ mtime: r.mtime, pre: { text: preText, html: preHtml }, sections: secs });
            toast(msg);
            setBusy(false);
            return true;
        } catch (e) { toast(e.message); setBusy(false); return false; }
    };
    const startEdit = (key, title, text) => { setMoving(null); setAdding(false); setEditing(key); setDraft({ title, text, changed: false }); };
    const stopEdit = () => { setEditing(null); setDraft(null); };
    useEscapeTwice(editing === "new", () => stopEdit(), rootRef);
    const saveEdit = async () => {
        const has = doc.sections.length > 0;
        let ok;
        if (editing === "all") {
            ok = await saveWhole(draft.text);
        } else if (editing === "pre") {
            ok = await save(preRaw(draft.text, has), doc.sections, "Saved");
        } else {
            const title = draft.title.trim();
            if (!title) return toast("A block needs a title");
            const fresh = { title, text: draft.text, raw: sectionRaw(title, draft.text), html: null };
            const list = [...doc.sections];
            if (editing === "new") { const img = list.findIndex((x) => x.images); list.splice(img < 0 ? list.length : img, 0, fresh); }
            else list[editing] = fresh;
            ok = await save(doc.pre.text, list, editing === "new" ? `Added ${title}` : `Saved ${title}`);
        }
        if (ok) stopEdit();
    };
    const saveWhole = async (text) => {
        setBusy(true);
        try {
            const r = await api.send("PATCH", "/api/note", { path: page.path, body: text, baseMtime: Math.max(page.mtime, local?.mtime ?? 0) });
            const parts = parseSections(text);
            const render = (md) => (md.trim() ? api.send("POST", "/api/render", { markdown: md }).then((x) => x.html) : "");
            const sections = await Promise.all(parts.sections.map(async (x) => ({ ...x, images: isImagesSection(x), html: isImagesSection(x) ? "" : await render(x.text) })));
            setLocal({ mtime: r.mtime, pre: { text: parts.pre, html: await render(parts.pre) }, sections });
            toast("Saved"); setBusy(false); return true;
        } catch (e) { toast(e.message); setBusy(false); return false; }
    };
    const remove = (i) => save(doc.pre.text, doc.sections.filter((_, k) => k !== i), `Deleted ${doc.sections[i].title}`);
    const removePre = () => save("", doc.sections, "Deleted");
    // move mode: the order changes locally; leaving move mode saves it
    const startMove = (i) => { stopEdit(); setAdding(false); setMoving({ i, list: doc.sections.map((x, k) => ({ ...x, k })) }); };
    const step = (by) => setMoving((m) => {
        const list = [...m.list];
        let j = m.i + by;
        while (list[j]?.images) j += by; // the images section stays put
        if (j < 0 || j >= list.length) return m;
        [list[m.i], list[j]] = [list[j], list[m.i]];
        return { i: j, list };
    });
    const finishMove = async () => {
        const m = moving;
        setMoving(null);
        if (!m || !m.list.some((x, k) => x.k !== k)) return;
        // a section that moved gets a blank line after it (the old last one may end without one)
        const list = m.list.map(({ k, ...x }, idx) => (k !== idx && idx < m.list.length - 1 && !/\n[ \t]*\n$/.test(x.raw) ? { ...x, raw: x.raw.replace(/\n*$/, "\n\n") } : x));
        await save(doc.pre.text, list, `Moved ${m.list[m.i].title}`);
    };
    const add = () => {
        const title = newTitle.trim();
        if (!title) return;
        if (doc.sections.some((x) => x.title.toLowerCase() === title.toLowerCase())) return toast(`There is a ${title} block already`);
        setAdding(false); setNewTitle("");
        startEdit("new", title, "");
    };
    const list = moving ? moving.list : doc.sections.map((x, k) => ({ ...x, k }));
    const tools = (i, title) => html`<span class="nblock-tools">
        <button class="icon" title=${`Edit ${title}`} aria-label=${`Edit ${title}`} disabled=${busy} onClick=${() => startEdit(i, title, doc.sections[i].text)}>${ICONS.edit}</button>
        <button class=${`icon ${moving?.i === i ? "on" : ""}`} title=${moving?.i === i ? "Done moving (Enter)" : `Move ${title} (then ↑ ↓)`} aria-label=${`Move ${title}`} aria-pressed=${moving?.i === i} disabled=${busy}
            onClick=${() => (moving?.i === i ? finishMove() : startMove(i))}>${ICONS.move}</button>
        <${ConfirmButton} class="icon danger" confirmLabel="Delete?" title=${`Delete ${title}`} aria-label=${`Delete ${title}`} disabled=${busy} onConfirm=${() => remove(i)}>${ICONS.trash}<//>
    </span>`;
    const editor = (withTitle) => html`<div class="nblock-edit" onDblClick=${dblToggle(() => (changed ? saveEdit() : stopEdit()))} onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); e.stopPropagation(); saveEdit(); } }}>
        ${withTitle && html`<input class="nblock-title-input" value=${draft.title} placeholder="Block title" aria-label="Block title"
            onInput=${(e) => setDraft({ ...draft, title: e.target.value, changed: true })} />`}
        <${BlockEditor} value=${draft.text} compact=${true} callouts=${callouts} sceneBreaks=${false} autoFocus=${true}
            onChange=${(text) => setDraft((d) => ({ ...d, text, changed: true }))} />
        <div class="row nblock-actions">
            <button class="primary" disabled=${busy} onClick=${saveEdit}>${busy ? "Saving…" : editing === "new" ? "Add" : "Save"}</button>
            <button onClick=${stopEdit}>Cancel</button><span class="muted">Ctrl+S</span>
        </div>
    </div>`;
    if (editing === "all") return html`<section class="panel nblock editing">
        <div class="nblock-head"><h3>Edit as one page</h3></div>${editor(false)}</section>`;
    const shown = list.filter((x) => !x.images);
    return html`<div class="note-blocks" ref=${rootRef}>
        ${(doc.pre.text.trim() || editing === "pre") && html`<section class="panel nblock pre" onDblClick=${editing != null ? undefined : dblToggle(() => startEdit("pre", "", doc.pre.text.replace(/^\s+/, "")))}>
            ${editing === "pre" ? editor(false) : html`<div class="nblock-head"><span />
                <span class="nblock-tools">
                    <button class="icon" title="Edit" aria-label="Edit the text above the blocks" onClick=${() => startEdit("pre", "", doc.pre.text.replace(/^\s+/, ""))}>${ICONS.edit}</button>
                    <${ConfirmButton} class="icon danger" confirmLabel="Delete?" title="Delete this text" aria-label="Delete the text above the blocks" onConfirm=${removePre}>${ICONS.trash}<//>
                </span></div><${Html} html=${doc.pre.html} />`}
        </section>`}
        ${shown.map((x) => {
            const i = list.indexOf(x);
            const isMoving = moving?.i === i;
            if (editing === i) return html`<section key=${`e${i}`} class="panel nblock editing">${editor(true)}</section>`;
            return html`<section key=${x.title} ref=${isMoving ? moveRef : null} class=${`panel nblock ${isMoving ? "moving" : ""}`} tabIndex=${isMoving ? 0 : -1}
                data-flip=${`nb|${x.title}`} title=${editing == null && !moving ? "Double-click to edit" : undefined}
                onDblClick=${editing == null && !moving && !busy ? dblToggle(() => startEdit(i, x.title, doc.sections[i].text)) : undefined}
                onKeyDown=${isMoving ? (e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(e.key === "ArrowUp" ? -1 : 1); }
                    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishMove(); }
                } : undefined}>
                <div class="nblock-head"><h3>${x.title}</h3>${tools(i, x.title)}</div>
                ${isMoving && html`<div class="nblock-movehint muted">↑ ↓ to move · Enter or Escape when done</div>`}
                ${x.html ? html`<${Html} html=${x.html} />` : html`<p class="muted">Empty.</p>`}
            </section>`;
        })}
        ${editing === "new" && html`<section class="panel nblock editing">${editor(true)}</section>`}
        ${!shown.length && !doc.pre.text.trim() && editing == null && empty && html`<p class="muted">${empty}</p>`}
        <div class="nblock-add row">
            ${adding ? html`<input autoFocus list=${`nb-titles-${page.path}`} value=${newTitle} placeholder="Block title, e.g. Calendar" aria-label="New block title"
                    onInput=${(e) => setNewTitle(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }} />
                <datalist id=${`nb-titles-${page.path}`}>${(page.sectionTitles ?? []).map((t) => html`<option value=${t} />`)}</datalist>
                <button class="primary" disabled=${!newTitle.trim()} onClick=${add}>Add</button><button onClick=${() => setAdding(false)}>Cancel</button>`
            : html`<button disabled=${busy || editing != null} onClick=${() => { setMoving(null); setAdding(true); }}>${addLabel}</button>
                ${!doc.pre.text.trim() && editing == null && html`<button class="small-link linkish" onClick=${() => startEdit("pre", "", "")}>Add text above the blocks</button>`}
                ${wholePage && html`<span class="grow" /><button disabled=${editing != null} onClick=${() => { setMoving(null); setEditing("all"); setDraft({ text: joinSections(doc.pre.text, doc.sections), changed: false }); }}>Edit as one page</button>`}`}
            ${!adding && (page.sectionTitles ?? []).length > 0 && html`<span class="muted nblock-suggest">${page.sectionTitles.slice(0, 6).map((t) => html`<button class="chip linkish" title=${`Add a ${t} block`}
                disabled=${editing != null} onClick=${() => startEdit("new", t, "")}>${t}</button>`)}</span>`}
        </div>
    </div>`;
}
/** Notes whose body is shown as blocks (recipes keep their body for the crafting scripts; plans, chapters and ledgers have their own pages) */
const blocksFor = (page) => !page.plan && !page.blueprint && page.collection !== "Recipes" && !["chapter", "ledger", "config"].includes(page.fm.type) && !page.path.startsWith("90. Templater/");

// ------------------------------------------------------------------ create / edit notes

/**
 * Sizes textareas to their content. Setting height to auto briefly shrinks the page, which clamps the
 * scroll position of the drawer or page, so scrolled ancestors are restored afterwards.
 */
function fitHeights(els, extra = 0) {
    els = els.filter(Boolean);
    if (!els.length) return;
    const scrolled = [];
    for (let n = els[0].parentElement; n; n = n.parentElement) if (n.scrollTop) scrolled.push([n, n.scrollTop]);
    const root = document.scrollingElement;
    if (root?.scrollTop && !scrolled.some(([n]) => n === root)) scrolled.push([root, root.scrollTop]);
    for (const el of els) el.style.height = "auto";
    for (const el of els) el.style.height = `${el.scrollHeight + extra}px`;
    for (const [n, top] of scrolled) n.scrollTop = top;
}

/** Textarea that grows with its content */
function AutoTextarea({ value, onInput, class: cls = "", ...rest }) {
    const ref = useRef();
    useLayoutEffect(() => fitHeights([ref.current], 2));
    return html`<textarea ref=${ref} class=${`auto ${cls}`} value=${value ?? ""} onInput=${onInput} ...${rest} />`;
}

/** Read-only plan outline: nested lists, extra space between top-level events */
function PlanView({ text, limit }) {
    const items = parseOutline(text);
    if (!items.length) return html`<p class="muted">No plan yet.</p>`;
    const shown = limit ? items.filter((it) => it.level === 0).slice(0, limit) : items;
    const tree = [];
    const stack = [{ level: -1, children: tree }];
    for (const it of shown) {
        while (stack.at(-1).level >= it.level) stack.pop();
        const node = { ...it, children: [] };
        stack.at(-1).children.push(node);
        stack.push(node);
    }
    const list = (nodes, depth) => html`<ul class=${`plan-list depth-${Math.min(depth, 3)}`}>${nodes.map((n) => html`<li>${n.text}${n.children.length > 0 && list(n.children, depth + 1)}</li>`)}</ul>`;
    const more = limit ? items.filter((it) => it.level === 0).length - shown.length : 0;
    return html`<div class=${`plan ${limit ? "compact" : ""}`}>${list(tree, 0)}${more > 0 && html`<div class="muted plan-more">+${more} more</div>`}</div>`;
}

/**
 * Outline editor for event plans. One item per line; its indent is the event level. Enter starts the next
 * item at the same level, Tab / Shift+Tab indent and outdent (with sub events), Backspace at the start
 * outdents or joins the previous item, Alt+↑/↓ moves an item, pasted text is split into items.
 * Emits markdown bullets (see outline.js).
 */
function PlanEditor({ value, onChange, placeholder = "First event…" }) {
    const fromValue = (v) => { const it = parseOutline(v); return it.length ? it : [{ level: 0, text: "" }]; };
    const [items, setItems] = useState(() => fromValue(value));
    const emitted = useRef(value ?? "");
    const refs = useRef([]);
    const focus = useRef(null);
    const box = useRef();
    // external changes (saved elsewhere, reloaded) replace the outline unless they are our own output
    useLayoutEffect(() => { if ((value ?? "") !== emitted.current) { emitted.current = value ?? ""; setItems(fromValue(value)); } }, [value]);
    const fit = () => fitHeights(refs.current);
    useLayoutEffect(() => {
        fit();
        if (focus.current) {
            const { i, pos } = focus.current;
            focus.current = null;
            const el = refs.current[i];
            if (el) { el.focus(); const p = Math.min(pos ?? el.value.length, el.value.length); el.setSelectionRange(p, p); }
        }
    });
    useEffect(() => {
        if (typeof ResizeObserver !== "function" || !box.current) return;
        const ro = new ResizeObserver(fit);
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);
    const commit = (next, f) => {
        if (f) focus.current = f;
        setItems(next);
        const md = serializeOutline(next);
        if (md !== emitted.current) { emitted.current = md; onChange(md); }
    };
    // an item and the sub events under it
    const subtree = (list, i) => { let j = i + 1; while (j < list.length && list[j].level > list[i].level) j++; return [i, j]; };
    const shift = (list, i, by) => {
        const [a, b] = subtree(list, i);
        return list.map((it, k) => (k >= a && k < b ? { ...it, level: Math.max(0, it.level + by) } : it));
    };
    const onKeyDown = (i) => (e) => {
        const el = e.target, it = items[i];
        const start = el.selectionStart, end = el.selectionEnd;
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (!it.text && it.level > 0) return commit(shift(items, i, -1), { i, pos: 0 });
            const next = [...items];
            next.splice(i, 1, { ...it, text: it.text.slice(0, start) }, { level: it.level, text: it.text.slice(end) });
            return commit(next, { i: i + 1, pos: 0 });
        }
        if (e.key === "Tab") {
            e.preventDefault();
            if (e.shiftKey) { if (it.level > 0) commit(shift(items, i, -1), { i, pos: start }); }
            else if (i > 0 && it.level <= items[i - 1].level) commit(shift(items, i, 1), { i, pos: start });
            return;
        }
        if (e.key === "Backspace" && start === 0 && end === 0) {
            if (it.level > 0) { e.preventDefault(); return commit(shift(items, i, -1), { i, pos: 0 }); }
            if (i > 0) {
                e.preventDefault();
                const prev = items[i - 1];
                const next = [...items];
                next.splice(i - 1, 2, { ...prev, text: prev.text + it.text });
                return commit(next, { i: i - 1, pos: prev.text.length });
            }
        }
        if (e.key === "Delete" && start === it.text.length && end === start && i < items.length - 1) {
            e.preventDefault();
            const next = [...items];
            next.splice(i, 2, { ...it, text: it.text + items[i + 1].text });
            return commit(next, { i, pos: start });
        }
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const j = e.key === "ArrowUp" ? i - 1 : i + 1;
            if (j < 0 || j >= items.length) return;
            const next = [...items];
            [next[i], next[j]] = [next[j], next[i]];
            return commit(next, { i: j, pos: start });
        }
        // move between items when the caret can't move further inside this one
        const oneRow = el.scrollHeight <= parseFloat(getComputedStyle(el).lineHeight || "0") * 1.5 + 8;
        if (e.key === "ArrowUp" && i > 0 && (start === 0 || oneRow)) { e.preventDefault(); focus.current = { i: i - 1, pos: start }; setItems([...items]); }
        if (e.key === "ArrowDown" && i < items.length - 1 && (start === it.text.length || oneRow)) { e.preventDefault(); focus.current = { i: i + 1, pos: start }; setItems([...items]); }
    };
    const onPaste = (i) => (e) => {
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text.includes("\n")) return;
        e.preventDefault();
        const it = items[i];
        const pasted = parseOutline(text).map((p) => ({ ...p, level: p.level + it.level }));
        if (!pasted.length) return;
        const next = [...items];
        const el = e.target;
        const before = it.text.slice(0, el.selectionStart), after = it.text.slice(el.selectionEnd);
        pasted[0] = { ...pasted[0], level: it.level, text: before + pasted[0].text };
        const last = pasted.length - 1;
        const caret = pasted[last].text.length;
        pasted[last] = { ...pasted[last], text: pasted[last].text + after };
        next.splice(i, 1, ...pasted);
        commit(next, { i: i + last, pos: caret });
    };
    refs.current.length = items.length;
    return html`<div class="plan-editor" ref=${box}>
        ${items.map((it, i) => html`<div class=${`plan-row lvl-${Math.min(it.level, 3)} ${it.level === 0 && i > 0 ? "top" : ""}`} style=${`--level:${it.level}`}>
            <span class="plan-bullet" aria-hidden="true" />
            <textarea ref=${(el) => { refs.current[i] = el; }} rows="1" value=${it.text} placeholder=${i === 0 ? placeholder : ""} spellcheck="true"
                onInput=${(e) => commit(items.map((x, k) => (k === i ? { ...x, text: e.target.value.replace(/\n/g, " ") } : x)))}
                onKeyDown=${onKeyDown(i)} onPaste=${onPaste(i)} />
        </div>`)}
        <div class="plan-hint muted">Enter: next event · Tab / Shift+Tab: sub event / back out · Alt+↑↓: move</div>
    </div>`;
}

/** "@characters" picker options: the characters of a novel (folder), for relation fields */
function useNovelLinks(folder) {
    const { data } = useApi(folder ? `/api/novel?${qs({ folder })}` : null);
    return useMemo(() => data && { "@characters": data.characters.map((c) => ({ label: c.name, hint: c.fm?.title && c.fm.title !== c.name ? c.fm.title : "Character" })) }, [data]);
}

/**
 * What a frontmatter key links to: the schema's `links` entry (a collection, an "@" folder of the novel, or a list of
 * them), else `relations/*` on characters link characters and factions, else "" (any note) when it already holds
 * links, else nothing (plain text)
 */
function linkTargetOf(spec, k, current) {
    if (spec?.links?.[k] != null) return spec.links[k];
    if (k.startsWith("relations/")) return ["@characters", "Factions"];
    return asList(current).some(isLink) ? "" : undefined;
}
/** Picker options for a target: "@" folders come from `linkOptions`, collections from the index, a list joins them */
function linkOptionsFor(target, index, linkOptions) {
    if (target == null || (typeof target === "string" && !target.startsWith("@"))) return undefined;
    return [].concat(target).flatMap((t) => (t.startsWith("@") ? linkOptions?.[t] ?? []
        : (index?.inCollection(t) ?? []).map((n) => ({ label: n.name, hint: n.fm.title !== n.name ? n.fm.title || collectionLabel(t) : collectionLabel(t) }))));
}

function fieldInput({ key, def, target, value, onChange, index, options }) {
    if (target != null) return html`<${LinkField} value=${value} multiple=${Array.isArray(def)} target=${target} index=${index} onChange=${onChange} options=${options} />`;
    if (typeof def === "boolean") return html`<input type="checkbox" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} style="width:auto" />`;
    if (Array.isArray(def)) return html`<input value=${asList(value).join(", ")} placeholder="comma separated" onChange=${(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />`;
    if (key === "plan") return html`<${PlanEditor} value=${value ?? ""} onChange=${onChange} />`;
    if (key === "plot") return html`<${AutoTextarea} class="prose" value=${value} onInput=${(e) => onChange(e.target.value)} placeholder="The plot idea…" />`;
    if (["description", "personality", "appearance"].includes(key)) return html`<${AutoTextarea} value=${value} onInput=${(e) => onChange(e.target.value)} style="font-family:inherit" />`;
    return html`<input value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} style="width:100%" />`;
}
const coerce = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

/** Create a data store note or a character (existing notes are edited in place on their page) */
function NoteForm({ index, collection, novel, scope = "page" }) {
    const pick = useItemPick();
    const formRef = useRef();
    const novelLinks = useNovelLinks(collection === "characters" ? novel : null);
    const schema = index?.schema;
    const spec = collection === "characters" ? schema?.characters : schema?.collections[collection];
    const [vals, setVals] = useState(null);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    useEffect(() => {
        if (!spec || vals) return;
        const init = {};
        for (const [k, def] of spec.fields) init[k] = Array.isArray(def) ? [...def] : def;
        start.current = JSON.stringify(init);
        setVals(init);
    }, [spec]);
    // a half-made note counts as unsaved: leaving the page (or the drawer page) asks first
    const start = useRef(null);
    const dirtyKey = `new:${collection}:${novel ?? ""}`;
    const dirty = !busy && (!!name.trim() || (vals != null && JSON.stringify(vals) !== start.current));
    useEffect(() => markDirty(scope, dirtyKey, dirty), [dirty]);
    useEffect(() => () => markDirty(scope, dirtyKey, false), []);
    if (!index || !vals || !spec) return html`<${Loading} />`;
    const generated = new Set(spec.generated ?? []);
    const save = async () => {
        setBusy(true); setErr("");
        try {
            if (collection === "characters") {
                const fm = Object.fromEntries(Object.entries(vals).filter(([k, v]) => v !== "" && !(Array.isArray(v) && !v.length) && !generated.has(k)).map(([k, v]) => [k, coerce(v)]));
                const r = await api.send("POST", "/api/character", { novel, name, fm });
                markDirty(scope, dirtyKey, false);
                if (inDrawer(scope)) openInDrawer(noteHref(r.path));
                else go(noteHref(r.path));
            } else {
                const fm = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, coerce(v)]));
                const r = await api.send("POST", "/api/note", { collection, name, fm });
                markDirty(scope, dirtyKey, false);
                const made = r.path.split("/").pop().replace(/\.md$/, "");
                // made while choosing an item: it is taken at once; otherwise it opens where the form was
                if (pickable(pick, collection)) pick.pick(made);
                else if (inDrawer(scope)) openInDrawer(noteHref(r.path));
                else go(noteHref(r.path));
            }
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const title = collection === "characters" ? "New character" : `New ${spec.label ?? collection}`;
    const cancel = () => {
        markDirty(scope, dirtyKey, false);
        if (scope === "left") closeLeftTab(collection === "characters" ? `#/newchar/${encodeURIComponent(novel)}` : `#/new/${encodeURIComponent(collection)}`);
        else if (scope === "drawer") drawer.recent.length > 1 ? openInDrawer(drawer.recent[1]) : collapseDrawer();
        else history.back();
    };
    useEscapeTwice(true, cancel, formRef);
    // data-drawer: notes linked from the form (chips in link fields) open in the side drawer, so the form stays
    return html`<div data-drawer ref=${formRef}>
        <h1>${title}</h1>
        <div class="panel"><div class="formgrid">
            <label>File name</label><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Unique note name" autoFocus style="width:100%" />
            ${spec.fields.filter(([k]) => !["type", "created-date", "images", "facet"].includes(k) && !generated.has(k)).map(([k, def]) => html`
                <label>${k}</label>
                ${fieldInput({ key: k, def, target: linkTargetOf(spec, k), value: vals[k], index, options: linkOptionsFor(linkTargetOf(spec, k), index, novelLinks), onChange: (v) => setVals((s) => ({ ...s, [k]: v })) })}`)}
        </div></div>
        ${err && html`<p class="error">${err}</p>`}
        <div class="row"><button class="primary" disabled=${busy || !name.trim()} onClick=${save}>Create</button>
            <button onClick=${cancel} title="Cancel (Escape twice)">Cancel</button></div>
        ${generated.size > 0 && html`<p class="muted">Generated from ledgers (not editable here): ${[...generated].join(", ")}</p>`}
    </div>`;
}

// ------------------------------------------------------------------ novels

const novelHref = (folder) => `#/novel/${encodeURIComponent(folder)}`;
const ownerHref = (folder, owner) => `#/owner/${encodeURIComponent(folder)}/${encodeURIComponent(owner)}`;
const chapterHref = (folder, n) => `#/chapter/${encodeURIComponent(folder)}/${n}`;
const entryHref = (folder, p) => `#/entry/${encodeURIComponent(folder)}?${qs(p)}`;

/** Stat fields on a character sheet or creature note: template choice and typed values */
function SheetStats({ info, tpl, tplName, fm, edits, edit, changed, index }) {
    const managed = new Set(info.managed ?? []);
    const def = Object.values(info.templates ?? {}).find((t) => t.default)?.name;
    const chosen = "stat-template" in edits ? edits["stat-template"] : fm["stat-template"] ?? "";
    const typed = (f) => fromText(f, f.key in edits ? edits[f.key] : fm[f.key]);
    const values = tpl ? Object.fromEntries(tpl.fields.map((f) => [f.key, managed.has(f.key) ? info.values?.[f.key] : typed(f)])) : {};
    // blank stats stay hidden unless the template says to show empty fields (or you ask for them, to fill them in)
    const [showAll, setShowAll] = useState(false);
    const isBlank = (f) => !(f.key in edits) && (managed.has(f.key) ? !displayValue(tpl, f, info.values ?? values) : !filled(fm[f.key]) && !(info.origin?.[f.key]?.from === "source"));
    const hiding = tpl && !tpl["show-empty"] && !showAll;
    const shown = tpl ? tpl.fields.filter((f) => !hiding || !isBlank(f)) : [];
    const hidden = tpl && !tpl["show-empty"] ? tpl.fields.filter(isBlank).length : 0;
    const sections = [...new Set(shown.map((f) => f.section))];
    return html`<div class="sheet-stats">
        <div class="spread"><h3 style="margin:0">Stats</h3>
            <label class=${`row muted ${changed.includes("stat-template") ? "changed" : ""}`}>Template
                <select value=${chosen} onChange=${(e) => edit("stat-template", e.target.value)}>
                    <option value="">${info.holder.kind === "character" && def ? `Novel default (${def})` : "None"}</option>
                    ${Object.keys(info.templates ?? {}).map((n) => html`<option value=${n}>${n}</option>`)}
                </select></label></div>
        ${!tpl ? html`<p class="muted">${Object.keys(info.templates ?? {}).length ? "Choose a template to give this note stats." : "This novel has no stat templates yet (novel page, Stats tab)."}</p>`
        : html`${info.problems?.length > 0 && html`<div class="warnbox">${info.problems.map((p) => html`<div>${p}</div>`)}</div>`}
            ${sections.map((s) => html`${s && html`<h4 class="stat-section">${s}</h4>`}<div class="formgrid">${shown.filter((f) => f.section === s).map((f) => {
                const o = info.origin?.[f.key];
                const err = !managed.has(f.key) && !isDerived(f) && statError(index, f, values[f.key]);
                return html`<label class=${changed.includes(f.key) ? "changed" : ""} title=${f.key}>${f.label}</label>
                    <div class="stat-cell">${managed.has(f.key)
                        ? html`<span>${displayValue(tpl, f, info.values ?? values) || "—"}</span> <span class="muted stat-was">set by the Stats ledger${o?.unlinked ? ", unlinked from its number" : ""}${o?.chapter != null ? ` (ch ${o.chapter})` : ""}; change it with a Stats entry</span>
                            ${driftText(tpl, f, info.values ?? {}) && html`<div class="stat-drift">${driftText(tpl, f, info.values ?? {})}</div>`}`
                        : html`<${StatInput} field=${f} value=${values[f.key]} onChange=${(v) => edit(f.key, v)} index=${index} template=${tpl} values=${values} />
                            ${o?.from === "source" && !(f.key in edits) && html`<span class="muted stat-was">prefilled from ${o.field}: ${displayValue(tpl, f, info.values ?? {})}</span>`}`}
                        ${err && html`<div class="error">${err}</div>`}</div>`;
            })}</div>`)}
            ${hidden > 0 && html`<button class="np-more" onClick=${() => setShowAll(!showAll)}>${showAll ? "Hide empty stats" : `+ ${hidden} empty stat${hidden === 1 ? "" : "s"}`}</button>`}`}
    </div>`;
}

// ------------------------------------------------------------------ stats: novel tab (templates and who uses them)

/**
 * A choice field's options in the template editor: typed options, or the values of a taxonomy facet (in class order,
 * stored as [[links]]); and optionally "follows" a number field, each option from its lowest value up
 * (Qi Condensation from 0, Foundation Establishment from 1000…), so the choice is worked out, never set.
 */
function ChoiceOptions({ f, t, facets, index, set }) {
    // a facet's values (and their own numbers) as the server fills them in
    const fromFacet = (facet, depth = f.depth) => (facet ? facetChoice(index.inCollection(`Taxonomy/${facet}`), depth, (l) => index.resolve(l)?.path ?? null) : { options: [], noteThresholds: {} });
    // the power system a facet's values belong to, to show beside its name
    const systemOf = (facet) => { const v = index.inCollection(`Taxonomy/${facet}`).map((n) => n.fm["power-system"]).find(Boolean); return v ? linkLabel(String(v)) : ""; };
    const numbers = t.fields.filter((x) => x !== f && ["number", "resource", "computed"].includes(x.type));
    const src = numbers.find((x) => x.key === f.from || x.id === f.from);
    const hasLevels = f.facet && index.inCollection(`Taxonomy/${f.facet}`).some((n) => n.fm.parent);
    return html`<div class="choice-opts">
        <div class="row">
            <label class="row">values from <select value=${f.facet ? "taxonomy" : "list"} onChange=${(e) => set(e.target.value === "list" ? { facet: "", options: [], noteThresholds: {} } : { facet: facets[0] ?? "", ...fromFacet(facets[0]) })}>
                <option value="list">options typed here</option><option value="taxonomy" disabled=${!facets.length}>a taxonomy</option></select></label>
            ${f.facet
                ? html`<label class="row">taxonomy <select value=${f.facet} onChange=${(e) => set({ facet: e.target.value, ...fromFacet(e.target.value) })}>${facets.map((x) => { const sys = systemOf(x); return html`<option value=${x}>${x}${sys ? ` (${sys})` : ""}</option>`; })}</select></label>
                    ${hasLevels && html`<label class="row">use <select value=${f.depth} onChange=${(e) => set({ depth: e.target.value, ...fromFacet(f.facet, e.target.value) })}>
                        <option value="all">every value</option><option value="top">top levels only (e.g. realms)</option><option value="bottom">sub-levels only (e.g. stages)</option></select></label>`}
                    <span class="muted">${f.options.length} values${f.options.length ? `: ${f.options.slice(0, 4).map((o) => f.optionTitles?.[o] ?? o).join(", ")}${f.options.length > 4 ? "…" : ""}` : ""}</span>`
                : html`<label class="row" style="flex:1">options <input style="flex:1" value=${f.options.join(", ")} placeholder="Common, Rare, Epic" onChange=${(e) => set({ options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>`}
        </div>
        <div class="row">
            <label class="row" title="Work the choice out from a number: each option applies from its lowest value up">follows <select value=${src?.key ?? ""} onChange=${(e) => set({ from: e.target.value })}>
                <option value="">nothing (set it in Stats entries)</option>${numbers.map((x) => html`<option value=${x.key}>${x.label}</option>`)}</select></label>
            ${src && html`<span class="muted">each option applies from its lowest ${src.label} up${f.facet ? " (the number on its taxonomy note, unless you give one here)" : ""}; Stats entries change ${src.label}, not this</span>`}
        </div>
        ${src && f.options.length > 0 && html`<table class="threshold-table"><thead><tr><th>${f.label || "option"}</th><th>from ${src.label}</th><th>up to</th></tr></thead><tbody>
            ${f.options.map((o) => { const row = thresholdRows(f).find((r) => r.option === o); const fromNote = f.noteThresholds?.[o]; return html`<tr><td>${f.optionTitles?.[o] ?? o}</td>
                <td><input type="number" value=${f.thresholds?.[o] ?? ""} placeholder=${fromNote ?? "—"} title=${fromNote != null ? `${fromNote} on the taxonomy note; type a number to use another here` : ""}
                    onInput=${(e) => { const th = { ...(f.thresholds ?? {}) }; if (e.target.value === "") delete th[o]; else th[o] = Number(e.target.value); set({ thresholds: th }); }} /></td>
                <td class="muted">${row ? (row.next != null ? `below ${row.next}` : "and above") : "not used"}</td></tr>`; })}</tbody></table>`}
    </div>`;
}

let uidSeq = 0;
const nextUid = () => `f${++uidSeq}`;
/** Callout types for a select: the designer's styles (not plain quotes / "any other"), plus the current one if it isn't there */
function calloutChoices(styles, current) {
    const list = Object.entries(styles ?? {}).filter(([k]) => k !== "quote" && k !== "default").map(([k, st]) => [k, st.label ? `${st.label} (${k})` : k]);
    if (!list.length) list.push(["status", "Status window (status)"], ["system", "System (system)"]);
    if (current && !list.some(([k]) => k === current)) list.push([current, `${current} (no style yet)`]);
    return list;
}

const blankTemplate = (name) => ({ name, description: "", default: false, callout: "status", layout: "status", "show-empty": false, panel: "", fields: [] });
const blankField = () => normalizeTemplates({ t: { fields: [{ label: "", type: "number" }] } }).t.fields[0];

function StatsTab({ folder, novel }) {
    const index = useIndex();
    const { data, error } = useApi(`/api/stats/novel?${qs({ novel: folder })}`);
    if (!data || !index) return html`<${Loading} error=${error} />`;
    return html`<div>
        <${TemplatesEditor} key=${folder} folder=${folder} data=${data} index=${index} />
        <${StatHolders} folder=${folder} data=${data} index=${index} novel=${novel} />
    </div>`;
}

function StatHolders({ folder, data, index }) {
    const [creature, setCreature] = useState("");
    const [tpl, setTpl] = useState("");
    const names = Object.keys(data.templates);
    const def = Object.values(data.templates).find((t) => t.default)?.name;
    const assign = async (h, name) => {
        const n = await api.get(`/api/note?${qs({ path: h.path })}`);
        try { await api.send("PATCH", "/api/note", name ? { path: h.path, set: { "stat-template": name }, baseMtime: n.mtime } : { path: h.path, unset: ["stat-template"], baseMtime: n.mtime }); toast(`${h.name}: ${name || "default"}`); }
        catch (e) { toast(e.message); }
    };
    const used = new Set(data.holders.filter((h) => h.kind === "creature").map((h) => h.creaturePath));
    const creatures = index.inCollection("Creatures").filter((c) => !used.has(c.path)).map((c) => ({ label: c.name, hint: c.fm.title !== c.name ? c.fm.title : "" }));
    const addCreature = async () => {
        try { const r = await api.send("POST", "/api/stats/creature", { novel: folder, creature: toLink(creature), template: tpl }); setCreature(""); openInDrawer(noteHref(r.path)); }
        catch (e) { toast(e.message); }
    };
    const row = (h) => html`<tr key=${h.path}>
        <td><a href=${noteHref(h.path)}>${h.name}</a>${h.kind === "creature" && h.creaturePath && html` <span class="muted">· <a href=${noteHref(h.creaturePath)}>data store</a></span>`}</td>
        <td><select value=${h.assigned ? h.template : ""} onChange=${(e) => assign(h, e.target.value)}>
            <option value="">${h.kind === "character" && def ? `Default (${def})` : "None"}</option>${names.map((n) => html`<option>${n}</option>`)}
            ${h.assigned && !names.includes(h.template) && html`<option value=${h.template}>${h.template} (missing)</option>`}</select></td>
        <td>${h.template && names.includes(h.template) && html`<a href=${ownerHref(folder, h.name)} data-page>Stats panel</a>`}</td>
    </tr>`;
    return html`<div class="grid2" style="margin-top:14px" data-drawer>
        <div class="panel"><h3>Characters</h3><table><tbody>${data.holders.filter((h) => h.kind === "character").map(row)}</tbody></table></div>
        <div class="panel"><h3>Creatures <span class="muted" style="font-weight:400;font-size:12px">base stats in this novel</span></h3>
            <table><tbody>${data.holders.filter((h) => h.kind === "creature").map(row)}</tbody></table>
            <div class="row" style="margin-top:10px">
                <div style="flex:1;min-width:180px"><${Picker} value=${creature} options=${creatures} allowFree=${false} placeholder="Add a creature from the data store…" onChange=${(o) => setCreature(o?.label ?? "")} /></div>
                <select value=${tpl} onChange=${(e) => setTpl(e.target.value)}><option value="">Template…</option>${names.map((n) => html`<option>${n}</option>`)}</select>
                <button class="primary small" disabled=${!creature || !tpl} onClick=${addCreature}>Add</button>
            </div></div>
    </div>`;
}

function TemplatesEditor({ folder, data, index }) {
    // fields carry a _uid (never saved) so folding follows a field when it is moved or renamed
    const initial = () => Object.values(data.templates).map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f, _uid: nextUid() })), orig: t.name }));
    const [list, setList] = useState(initial);
    const [sel, setSel] = useState(0);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [previewOwner, setPreviewOwner] = useState("");
    const [preview, setPreview] = useState(null);
    const plain = (ts) => JSON.stringify(ts.map(({ orig, ...t }) => ({ ...t, fields: t.fields.map(({ _uid, ...f }) => f) })));
    const saved = plain(initial());
    const dirty = plain(list) !== saved;
    // fields shown open (by _uid); the rest are folded to one line
    const [openFields, setOpenFields] = useState(() => new Set());
    const toggleField = (uid) => setOpenFields((o) => { const n = new Set(o); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
    const { data: calloutData } = useApi("/api/callout-styles");
    useEffect(() => markDirty("page", `stat-templates:${folder}`, dirty), [dirty]);
    useEffect(() => () => markDirty("page", `stat-templates:${folder}`, false), []);
    // after a save (or an edit in Obsidian) take the vault's version when there are no local edits
    useEffect(() => { if (!dirty) setList(initial()); }, [data.configMtime]);
    const t = list[sel];
    const setT = (patch) => setList(list.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
    const setField = (fi, patch) => setT({ fields: t.fields.map((f, i) => {
        if (i !== fi) return f;
        const next = { ...f, ...patch };
        // the key follows the label until it is edited by hand
        if ("label" in patch && f.key === defaultKey(f.label)) next.key = defaultKey(patch.label);
        next.id = fieldId(next.key);
        return next;
    }) });
    const moveField = (fi, by) => { const fs = [...t.fields]; const j = fi + by; if (j < 0 || j >= fs.length) return; [fs[fi], fs[j]] = [fs[j], fs[fi]]; setT({ fields: fs }); };
    const problems = t ? checkTemplate(normalizeTemplates({ [t.name || "x"]: t })[t.name || "x"]) : [];
    const holders = data.holders.filter((h) => h.template && (h.template === t?.orig || !t?.orig));
    const previewWith = previewOwner || holders[0]?.name || data.holders[0]?.name || "";
    useEffect(() => {
        if (!t || !previewWith) { setPreview(null); return; }
        const tm = setTimeout(() => api.send("POST", "/api/stats/view", { novel: folder, owner: previewWith, template: { ...t, name: t.name || "Draft" } }).then(setPreview).catch((e) => setPreview({ error: e.message })), 350);
        return () => clearTimeout(tm);
    }, [JSON.stringify(t), previewWith]);
    const charFields = useMemo(() => [...new Set([...(index.schema.characters?.fields.map(([k]) => k) ?? [])])], [index]);
    const sections = t ? [...new Set(t.fields.map((f) => f.section).filter(Boolean))] : [];
    const collections = Object.keys(index.schema.collections);
    // taxonomy facets a choice can take its values from (schema collections and folders that have notes)
    const facets = useMemo(() => [...new Set([...collections, ...index.notes.map((n) => n.collection ?? "")].filter((c) => c?.startsWith("Taxonomy/")).map((c) => c.slice(9)))].sort(), [index]);
    const save = async () => {
        setBusy(true); setErr("");
        try {
            const renames = Object.fromEntries(list.filter((x) => x.orig && x.orig !== x.name).map((x) => [x.orig, x.name]));
            await api.send("POST", "/api/stats/templates", { novel: folder, templates: list.map(({ orig, ...x }) => x), renames, baseMtime: data.configMtime });
            setList(list.map((x) => ({ ...x, orig: x.name })));
            toast("Templates saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const addTemplate = () => { const name = prompt("Template name", list.length ? "" : "Character"); if (!name?.trim()) return; setList([...list, blankTemplate(name.trim())]); setSel(list.length); };
    const templateUsers = data.holders.filter((h) => h.assigned && h.template === t?.orig).map((h) => h.name);
    const removeTemplate = () => {
        setList(list.filter((_, i) => i !== sel)); setSel(0);
    };
    return html`<div class="panel templates-editor">
        <div class="spread"><h2 style="margin:0">Stat templates</h2>
            <div class="row">${dirty && html`<span class="muted">unsaved changes</span>`}<button onClick=${addTemplate}>+ Template</button>
                <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save templates"}</button></div></div>
        ${err && html`<pre class="error" style="white-space:pre-wrap">${err}</pre>`}
        ${!list.length ? html`<p class="muted">No templates yet. A template lists the stats a character or creature has in this novel (Level, HP, Skills…) and how its stats panel looks.</p>`
        : html`<div class="tabs" style="margin-top:10px">${list.map((x, i) => html`<button class=${i === sel ? "on" : ""} onClick=${() => setSel(i)}>${x.name || "Untitled"}${x.default ? " ★" : ""}</button>`)}</div>
        <div class="formgrid template-meta">
            <label>Name</label><input value=${t.name} onInput=${(e) => setT({ name: e.target.value })} />
            <label>Description</label><input value=${t.description} onInput=${(e) => setT({ description: e.target.value })} placeholder="What this template is for" />
            <label>Options</label><div class="row">
                <label class="row"><input type="checkbox" style="width:auto" checked=${t.default} onChange=${(e) => setList(list.map((x, i) => ({ ...x, default: i === sel ? e.target.checked : e.target.checked ? false : x.default })))} /> default for characters</label>
                <label class="row"><input type="checkbox" style="width:auto" checked=${t["show-empty"]} onChange=${(e) => setT({ "show-empty": e.target.checked })} /> show empty fields in panels</label>
                <label class="row muted" title="The built-in stats panel: a status window (a table per section, bars for current / max) or the classic list">panel
                    <select value=${t.layout ?? "status"} onChange=${(e) => setT({ layout: e.target.value, callout: e.target.value === "status" && t.callout === "system" ? "status" : e.target.value === "classic" && t.callout === "status" ? "system" : t.callout })}>
                        <option value="status">status window</option><option value="classic">classic list</option></select></label>
                <label class="row muted" title="The callout type the stats panel is written as; its look is set in the callout designer">callout
                    <select value=${t.callout} onChange=${(e) => setT({ callout: e.target.value })}>
                        ${calloutChoices(calloutData?.styles, t.callout).map(([v, label]) => html`<option value=${v}>${label}</option>`)}</select>
                    <a class="small-link" href="#/callout-design" title="Change how callouts look">designer</a></label>
                <${ConfirmButton} onConfirm=${removeTemplate}
                    title=${templateUsers.length ? `${templateUsers.length} notes use it: ${templateUsers.slice(0, 5).join(", ")}${templateUsers.length > 5 ? "…" : ""}` : "No notes use it"}>Delete template<//></div>
        </div>
        <div class="spread" style="margin-top:14px"><h3 style="margin:0">Fields <span class="muted" style="font-weight:400">${t.fields.length}</span></h3>
            <div class="row"><button class="small" onClick=${() => setOpenFields(new Set(t.fields.map((f) => f._uid)))}>Expand all</button>
                <button class="small" onClick=${() => setOpenFields(new Set())}>Collapse all</button></div></div>
        <datalist id="stat-sections">${sections.map((s) => html`<option value=${s} />`)}</datalist>
        <datalist id="char-fields">${charFields.map((k) => html`<option value=${k} />`)}</datalist>
        <div class="field-list">${t.fields.map((f, fi) => !openFields.has(f._uid) ? html`<div class="field-row folded" key=${f._uid ?? fi}>
            <button class="fold-btn" aria-expanded="false" title="Show this field's settings" onClick=${() => toggleField(f._uid)}>▸</button>
            <button class="field-summary" onClick=${() => toggleField(f._uid)}><b>${f.label || "Untitled field"}</b>
                <span class="muted">${FIELD_TYPES[f.type] ?? f.type}${f.type === "choice" && f.facet ? ` · ${f.facet}` : ""}${f.from ? ` · follows ${t.fields.find((x) => x.key === f.from || x.id === f.from)?.label ?? f.from}` : ""}${f.section ? ` · ${f.section}` : ""}</span>
                <span class="mono muted small-key">${f.key}</span></button>
            <span class="row"><button class="small" title="Move up" onClick=${() => moveField(fi, -1)}>↑</button><button class="small" title="Move down" onClick=${() => moveField(fi, 1)}>↓</button>
                <${ConfirmButton} title="Remove field" confirmLabel="Confirm" onConfirm=${() => setT({ fields: t.fields.filter((_, i) => i !== fi) })}>×<//></span>
        </div>` : html`<div class="field-row" key=${f._uid ?? fi}>
            <div class="field-main">
                <button class="fold-btn" aria-expanded="true" title="Fold this field" onClick=${() => toggleField(f._uid)}>▾</button>
                <input aria-label="Label" placeholder="Label" value=${f.label} onInput=${(e) => setField(fi, { label: e.target.value })} />
                <select aria-label="Type" value=${f.type} onChange=${(e) => setField(fi, { type: e.target.value })}>${Object.entries(FIELD_TYPES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
                <input aria-label="Section" placeholder="Section (optional)" list="stat-sections" value=${f.section} onInput=${(e) => setField(fi, { section: e.target.value })} />
                <input aria-label="Frontmatter key" class="mono" title="Frontmatter key on the sheet" value=${f.key} onInput=${(e) => setField(fi, { key: e.target.value })} />
                <span class="row"><button class="small" title="Move up" onClick=${() => moveField(fi, -1)}>↑</button><button class="small" title="Move down" onClick=${() => moveField(fi, 1)}>↓</button>
                    <${ConfirmButton} title="Remove field" confirmLabel="Confirm" onConfirm=${() => setT({ fields: t.fields.filter((_, i) => i !== fi) })}>×<//></span>
            </div>
            <div class="field-opts">
                ${(f.type === "number" || f.type === "resource") && html`
                    <label class="row"><input type="checkbox" style="width:auto" checked=${f.integer} onChange=${(e) => setField(fi, { integer: e.target.checked })} /> whole numbers</label>
                    <label class="row">min <input type="number" style="width:80px" value=${f.min ?? ""} onInput=${(e) => setField(fi, { min: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                    <label class="row">${f.type === "resource" ? "fixed max" : "max"} <input type="number" style="width:80px" value=${f.max ?? ""} onInput=${(e) => setField(fi, { max: e.target.value === "" ? null : Number(e.target.value) })} /></label>`}
                ${f.type === "resource" && html`<label class="row">max from <select value=${f["max-field"]} onChange=${(e) => setField(fi, { "max-field": e.target.value })}><option value="">its own value (80/100)</option>
                    ${t.fields.filter((x) => x !== f && (x.type === "number" || x.type === "computed")).map((x) => html`<option value=${x.key}>${x.label}</option>`)}</select></label>`}
                ${f.type === "choice" && html`<${ChoiceOptions} f=${f} t=${t} facets=${facets} index=${index} set=${(patch) => setField(fi, patch)} />`}
                ${(f.type === "link" || f.type === "links") && html`
                    <label class="row">from <select value=${f.collection} onChange=${(e) => setField(fi, { collection: e.target.value })}><option value="">any note</option>${collections.map((c) => html`<option value=${c}>${collectionLabel(c)}</option>`)}</select></label>
                    <label class="row"><input type="checkbox" style="width:auto" checked=${f.describe} onChange=${(e) => setField(fi, { describe: e.target.checked })} /> show descriptions in panels</label>`}
                ${f.type === "computed" && html`<label class="row" style="flex:1">formula <input class="mono" style="flex:1" value=${f.formula} placeholder="strength * 2 + floor(level / 5)" onInput=${(e) => setField(fi, { formula: e.target.value })} /></label>
                    <span class="muted">names: ${t.fields.filter((x) => x !== f).map((x) => x.id).join(", ") || "—"}</span>`}
                ${(f.type === "number" || f.type === "resource" || f.type === "computed") && html`<label class="row">unit <input style="width:70px" value=${f.unit} onInput=${(e) => setField(fi, { unit: e.target.value })} /></label>`}
                ${f.type !== "computed" && html`<label class="row" title="Use this character frontmatter field as the value until a Stats entry sets one">prefill from <input class="mono" style="width:150px" list="char-fields" value=${f.source} placeholder="sheet field" onInput=${(e) => setField(fi, { source: e.target.value })} /></label>`}
            </div>
        </div>`)}</div>
        <button class="small" onClick=${() => { const f = { ...blankField(), _uid: nextUid() }; setT({ fields: [...t.fields, f] }); setOpenFields((o) => new Set([...o, f._uid])); }}>+ Field</button>
        ${problems.length > 0 && html`<div class="warnbox" style="margin-top:10px">${problems.map((p) => html`<div>${p}</div>`)}</div>`}
        <div class="grid2" style="margin-top:14px">
            <details open=${!!t.panel}><summary><b>Custom panel layout</b> <span class="muted">(optional; the default is built from the sections)</span></summary>
                <textarea class="mono" style="min-height:160px;margin-top:6px" value=${t.panel} onInput=${(e) => setT({ panel: e.target.value })}
                    placeholder=${`[!${t.callout}] {{ownerName}}\n**Level:** {{stat.level}}\n{{#sections}}\n#### {{name}}\n{{#fields}}\n**{{label}}:** {{value}}\n{{/fields}}\n{{/sections}}`} />
                <p class="muted" style="font-size:12px">Values: ${t.fields.map((f) => `{{stat.${f.id}}}`).join(" ") || "add fields first"}. Lists of links: ${"{{#list.<name>}}{{title}} {{description}}{{/list.<name>}}"}. Written without "> ".</p>
            </details>
            <div><div class="spread"><b>Preview</b>
                <select value=${previewWith} onChange=${(e) => setPreviewOwner(e.target.value)}>${data.holders.map((h) => html`<option value=${h.name}>${h.name}</option>`)}</select></div>
                ${preview?.error ? html`<p class="error">${preview.error}</p>` : preview?.panel ? html`<${CalloutRender} text=${preview.panel} />` : html`<p class="muted">${data.holders.length ? "…" : "No characters to preview with."}</p>`}
            </div>
        </div>`}
    </div>`;
}

const NOVEL_TABS = [["plan", "Grand plan"], ["plots", "Plots"], ["people", "Characters & ledgers"], ["stats", "Stats"], ["scratch", "Scratchpad"]];

function NovelView({ folder }) {
    const { data: novel, error } = useApi(`/api/novel?${qs({ folder })}`);
    const { data: plan } = useApi(`/api/plan?${qs({ novel: folder })}`);
    const [tab, setTabState] = useState(store.get("novelTab", "plan"));
    const setTab = (t) => { setTabState(t); store.set("novelTab", t); };
    if (!novel) return html`<${Loading} error=${error} />`;
    return html`<div>
        <div class="spread">
            <div><div class="muted">${novel.folder}</div><h1>${novel.name}</h1></div>
            <div class="row">
                <${NovelColour} novel=${novel} />
                <button class="primary" onClick=${() => go(entryHref(folder, {}))}>New entry</button>
                <button onClick=${() => go(`#/newchar/${encodeURIComponent(folder)}`)}>New character</button>
                <button onClick=${() => go(`#/callouts/${encodeURIComponent(folder)}`)}>Callouts</button>
                <button onClick=${async () => { const r = await api.send("POST", `/api/sync-sheets?${qs({ novel: folder })}`); toast(`Synced ${r.filter((x) => x.changed.length).length} sheets`); }}>Sync sheets</button>
            </div>
        </div>
        <div class="tabs">${NOVEL_TABS.map(([k, label]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>${label}</button>`)}</div>
        <div class="tab-body" key=${tab}>
            ${tab === "people" ? html`<${NovelPeople} folder=${folder} novel=${novel} />`
                : tab === "stats" ? html`<${StatsTab} folder=${folder} novel=${novel} />`
                : tab === "scratch" ? html`<div data-drawer><${Scratchpad} folder=${folder} novel=${novel} /></div>`
                : !plan ? html`<${Loading} />`
                : tab === "plots" ? html`<${PlotBoard} folder=${folder} plan=${plan} />`
                : html`<${GrandPlan} folder=${folder} plan=${plan} />`}
        </div>
    </div>`;
}

/** The novel's accent colour, saved as `accent` in its config.md */
function NovelColour({ novel }) {
    const index = useIndex();
    const current = novelColour(index, novel.folder) ?? "#6a4fc4";
    const save = async (set, unset = []) => {
        try { await api.send("PATCH", "/api/note", { path: novel.configPath, set, unset, baseMtime: novel.configMtime }); toast("Novel colour saved"); }
        catch (e) { toast(e.message); }
    };
    return html`<label class="novel-colour muted" title="Saved as accent in config.md">Colour
        <input type="color" value=${current} onChange=${(e) => save({ accent: e.target.value })} />
        ${novel.config.accent && html`<button class="small" onClick=${(e) => { e.preventDefault(); save({}, ["accent"]); }}>Default</button>`}
    </label>`;
}

function NovelPeople({ folder, novel }) {
    const characterNames = new Set(novel.characters.map((c) => c.name.toLowerCase()));
    const otherOwners = [...new Set(novel.ledgers.map((l) => l.owner))].filter((o) => !characterNames.has(o.toLowerCase()));
    const ledgersOf = (o) => novel.ledgers.filter((l) => l.owner.toLowerCase() === o.toLowerCase());
    return html`<div>
        <h2 style="margin-top:0">Characters</h2>
        <div class="cards">${novel.characters.map((c) => html`<a class="card" href=${ownerHref(folder, c.name)}>
            ${c.cover && html`<div class="cover" style=${`background-image:url("${c.cover}")`} />`}
            <div class="body"><h3>${c.name}</h3>
                <div>${ledgersOf(c.name).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}</div>
                <p>${c.fm.personality ?? ""}</p></div></a>`)}</div>
        ${otherOwners.length > 0 && html`<h2>Other ledger owners</h2><div class="cards">${otherOwners.map((o) => html`<a class="card" href=${ownerHref(folder, o)}><div class="body"><h3>${o}</h3><div>${ledgersOf(o).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}</div></div></a>`)}</div>`}
        <h2>Ledger types</h2>
        <div class="panel"><table><tbody>${Object.values(novel.ledgerTypes).map((t) => html`<tr><td><b>${t.name}</b></td><td><span class="badge">${t.behaviour}</span></td><td class="muted">${t.description ?? ""}</td><td>${Object.keys(t.callouts).map((c) => html`<span class="chip">${c}</span>`)}</td></tr>`)}</tbody></table></div>
    </div>`;
}

/** Link value -> plot of this novel (by name, alias-free like the rest of the vault) */
const plotByLink = (plan, v) => plan.plots.find((p) => p.name.toLowerCase() === linkTarget(v).toLowerCase()) ?? null;
const linkTarget = (v) => String(v ?? "").replace(/^!?\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
const ratingLink = (r) => (r.name === r.title ? toLink(r.name) : `[[${r.name}|${r.title}]]`);

function PlotChip({ plan, value, main }) {
    const p = plotByLink(plan, value);
    const label = p?.title ?? linkLabel(value);
    if (!p) return html`<span class="chip unresolved" title="No plot note with this name">${label}</span>`;
    return html`<a class=${`chip plot-chip ${main ? "main" : ""}`} href=${noteHref(p.path)} title=${main ? "Main plot" : "Subplot"}>${main ? "★ " : ""}${label}</a>`;
}

function ChapterRow({ folder, c }) {
    return html`<a class="chapter-row" href=${chapterHref(folder, c.number)} data-flip=${`ch|${c.number}`}>
        <div class="chapter-head">
            <span class="badge">${c.number}</span>
            <b>${c.title || html`<span class="muted">Untitled</span>`}</b>
            ${c.written ? html`<span class="badge ok">written</span>` : c.notePath ? html`<span class="badge" title="The chapter note has no text yet">empty note</span>` : html`<span class="badge">planned</span>`}
            ${c.draft && html`<span class="badge">draft</span>`}
            ${!c.plan.trim() && html`<span class="badge warn">no plan</span>`}
            ${c.entries > 0 && html`<span class="chip">${c.entries} entries</span>`}
        </div>
        ${c.plan.trim() && html`<${PlanView} text=${c.plan} limit=${3} />`}
    </a>`;
}

function GrandPlan({ folder, plan }) {
    const flip = useFlip();
    const nonDraft = plan.chapters.filter((c) => !c.draft);
    const inVolume = (v) => nonDraft.filter((c) => c.volume === v.path);
    const loose = nonDraft.filter((c) => !c.volume);
    const drafts = plan.chapters.filter((c) => c.draft);
    const lastChapter = Math.max(0, ...nonDraft.map((c) => c.number));
    const newVolume = async () => {
        const title = prompt("Volume title");
        if (!title?.trim()) return;
        const prev = plan.volumes.at(-1);
        const start = (prev?.end ?? lastChapter) + 1;
        try {
            const r = await api.send("POST", "/api/plan/volume", { novel: folder, title: title.trim(), fm: { number: (prev?.number ?? 0) + 1, "chapter-start": start } });
            openInDrawer(noteHref(r.path));
        } catch (e) { toast(e.message); }
    };
    const nextIn = (v, list) => {
        const n = Math.max((v.start ?? 1) - 1, ...list.map((c) => c.number)) + 1;
        return v.end == null || n <= v.end ? n : null;
    };
    return html`<div ref=${flip} data-drawer>
        <div class="spread" style="margin-bottom:12px">
            <p class="muted" style="margin:0">${plan.volumes.length} volumes · ${nonDraft.length} chapters · ${nonDraft.filter((c) => c.plan.trim()).length} planned</p>
            <div class="row">
                <a class="button" href=${chapterHref(folder, lastChapter + 1)}>Plan chapter ${lastChapter + 1}</a>
                <button class="primary" onClick=${newVolume}>New volume</button>
            </div>
        </div>
        ${!plan.volumes.length && html`<p class="muted">No volumes yet. A volume groups a chapter range and the plots it covers.</p>`}
        ${plan.volumes.map((v) => {
            const list = inVolume(v);
            const next = nextIn(v, list);
            return html`<section class="panel volume" key=${v.path} data-flip=${`vol|${v.path}`}>
                <div class="spread">
                    <h2><a href=${noteHref(v.path)}>${v.number != null ? html`<span class="muted">Volume ${v.number} · </span>` : ""}${v.title}</a></h2>
                    <span class="muted">Chapters ${v.start ?? "?"}–${v.end ?? "…"} · ${list.length} listed</span>
                </div>
                <div class="volume-plots">
                    ${v.fm.plot && html`<${PlotChip} plan=${plan} value=${v.fm.plot} main=${true} />`}
                    ${volumePlots(plan, v.fm).subplots.map((sp) => html`<${PlotChip} plan=${plan} value=${toLink(sp.name)} />`)}
                </div>
                ${v.fm.description && html`<p>${v.fm.description}</p>`}
                ${String(v.fm.plan ?? "").trim() && html`<details class="volume-outline"><summary>Volume outline</summary><${PlanView} text=${v.fm.plan} /></details>`}
                <div class="chapter-list">${list.map((c) => html`<${ChapterRow} key=${c.number} folder=${folder} c=${c} />`)}</div>
                ${next != null && html`<a class="add-chapter" href=${chapterHref(folder, next)}>+ Plan chapter ${next}</a>`}
            </section>`;
        })}
        ${loose.length > 0 && html`<section class="panel volume" data-flip="vol|loose"><h2>Not in a volume</h2>
            <p class="muted">Set a volume's chapter range to include these.</p>
            <div class="chapter-list">${loose.map((c) => html`<${ChapterRow} key=${c.number} folder=${folder} c=${c} />`)}</div></section>`}
        ${drafts.length > 0 && html`<section class="panel volume" data-flip="vol|drafts"><h2>Drafts <span class="muted" style="font-size:13px">chapter ${plan.draftFrom}+</span></h2>
            <div class="chapter-list">${drafts.map((c) => html`<${ChapterRow} key=${c.number} folder=${folder} c=${c} />`)}</div></section>`}
    </div>`;
}

function PlotBoard({ folder, plan }) {
    const flip = useFlip();
    const usage = (p) => plan.volumes.flatMap((v) => [
        ...(plotByLink(plan, v.fm.plot)?.path === p.path ? [{ v, main: true }] : []),
        ...volumePlots(plan, v.fm).subplots.filter((sp) => sp.path === p.path).map(() => ({ v, main: false })),
    ]);
    const groups = [...plan.ratings.map((r) => [r, plan.plots.filter((p) => p.rating?.path === r.path)]), [null, plan.plots.filter((p) => !p.rating)]]
        .filter(([r, list]) => list.length || r);
    const newPlot = async () => {
        const title = prompt("Plot title");
        if (!title?.trim()) return;
        try { const r = await api.send("POST", "/api/plan/plot", { novel: folder, title: title.trim() }); openInDrawer(noteHref(r.path)); }
        catch (e) { toast(e.message); }
    };
    const grade = async (p, path) => {
        const r = plan.ratings.find((x) => x.path === path);
        try { await api.send("PATCH", "/api/note", { path: p.path, set: { rating: r ? ratingLink(r) : "" }, baseMtime: p.mtime }); toast(`${p.title}: ${r?.title ?? "unrated"}`); }
        catch (e) { toast(e.message); }
    };
    return html`<div ref=${flip} data-drawer>
        <div class="spread" style="margin-bottom:12px">
            <p class="muted" style="margin:0">${plan.plots.length} plot ideas, graded by Rating</p>
            <button class="primary" onClick=${newPlot}>New plot</button>
        </div>
        ${groups.map(([r, list]) => html`<section class="plot-grade" key=${r?.path ?? "none"}>
            <h2>${r ? r.title : "Unrated"} <span class="muted" style="font-size:13px">${list.length}</span></h2>
            ${list.length ? html`<div class="plot-cards">${list.map((p) => html`<div class="plot-card" key=${p.path} data-flip=${`plot|${p.path}`}>
                <div class="spread">
                    <a class="plot-title" href=${noteHref(p.path)}>${p.title}</a>
                    <select value=${p.rating?.path ?? ""} onChange=${(e) => grade(p, e.target.value)} title="Grade">
                        <option value="">Unrated</option>
                        ${plan.ratings.map((x) => html`<option value=${x.path}>${x.title}</option>`)}
                    </select>
                </div>
                <div>${usage(p).map((u) => html`<span class=${`chip ${u.main ? "on" : ""}`}>${u.main ? "★ " : ""}Vol ${u.v.number ?? "?"} ${u.main ? "main" : "sub"}</span>`)}
                    ${p.fm.mood && html`<span class="chip">${p.fm.mood}</span>`}
                    ${asList(p.fm.characters).map((c) => html`<span class="chip">${linkLabel(c)}</span>`)}</div>
                <p class="plot-text">${String(p.fm.plot ?? "").trim() || html`<span class="muted">No plot text yet.</span>`}</p>
            </div>`)}</div>` : html`<p class="muted">None.</p>`}
        </section>`)}
    </div>`;
}

function EntryCard({ e, folder, behaviour, future, showOwner, onEdit = null }) {
    const [showText, setShowText] = useState(false);
    const del = async () => {
        try { await api.send("DELETE", `/api/ledger/entry?${qs({ ledger: e.ledger, key: e.key })}`); toast("Deleted"); } catch (x) { toast(x.message); }
    };
    const copyLinked = async () => { const r = await api.get(`/api/callout?${qs({ ledger: e.ledger, key: e.key, linked: 1 })}`); copyText(r.text, `Copied ${r.count} linked callouts`); };
    const edit = () => { const p = { owner: e.owner, type: e.type, ledger: e.ledger, key: e.key }; onEdit ? onEdit(p) : go(entryHref(folder, p)); };
    return html`<div class=${`entry ${future ? "future" : ""}`} onDblClick=${e.fields["mirror-of"] ? undefined : dblToggle(edit)}>
        <div class="spread">
            <h4><span class="badge">${e.key}</span> ${e.title || html`<span class="muted">untitled</span>`}
                ${showOwner && html` <span class="muted">· <a href=${ownerHref(folder, e.owner)}>${e.owner}</a> · ${e.type}</span>`}</h4>
            <div class="row">
                ${e.placed ? html`<span class="badge ok" title=${`Marker found in ${e.placed}`}>in chapter text</span>` : e.fields["mirror-of"] ? html`<span class="badge">mirror</span>` : html`<span class="badge warn">not in text yet</span>`}
                <button class="small" onClick=${() => copyText(e.callout)}>⧉ Copy</button>
                ${e.fields.ref && html`<button class="small" onClick=${copyLinked}>⧉ Linked</button>`}
                <button class="small" onClick=${() => setShowText(!showText)}>${showText ? "Hide" : "Callout"}</button>
                ${!e.fields["mirror-of"] && html`<button class="small" title="Edit (or double-click the entry)" onClick=${edit}>Edit</button>`}
                <${ConfirmButton} title=${`Delete ${e.key} ${e.title}`} onConfirm=${del}>Delete<//>
            </div>
        </div>
        ${Object.entries(e.fields).filter(([k]) => !["id", "ref", "mirror-of"].includes(k)).map(([k, v]) => html`<span class="chip"><b>${k}</b> ${v}</span>`)}
        ${e.lines.length > 0 && html`<ul style="margin:6px 0 0;padding-left:18px">${e.lines.map((l) => html`<li>${behaviour === "state"
            ? html`<b>${l.set}</b>${l.with ? html` (${linkLabel(l.with)})` : ""}${l.value ? html` → ${linkLabel(l.value)}` : ""}${l.add != null && l.add !== "" ? html` ${Number(l.add) >= 0 ? "+" : ""}${l.add}` : ""}${l.note ? html` <span class="muted">· ${l.note}</span>` : ""}`
            : html`<span class="badge">${l.action ?? "add"}</span> ${l.qty ?? 1}${l.unit ? ` ${l.unit}` : ""} ${isLink(l.item) ? html`<${Chip} value=${l.item} />` : html`<span class="chip unresolved" title="Misc item, no data note">${l.item}</span>`}
                ${l.to ? html` → ${linkLabel(l.to)}` : ""}${l["to-store"] ? html` → ${l["to-store"]}` : ""}${l.from ? html` ← ${linkLabel(l.from)}` : ""}${l.store && l.store !== "inventory" ? html` <span class="muted">@ ${l.store}</span>` : ""}${l.note ? html` <span class="muted">(${l.note})</span>` : ""}`}</li>`)}</ul>`}
        ${e.body && behaviour === "log" && html`<div class="md" style="margin-top:6px;white-space:pre-wrap">${e.body}</div>`}
        ${showText && html`<pre>${e.callout}</pre>`}
    </div>`;
}

/** An owner's ledgers and holdings at a chapter. `embedded`: inside a character's drawer page (its Ledger tab), without the heading and sheet */
function OwnerView({ index, folder, owner, params, embedded = false, onEntry = null, chapter: given = undefined, onChapter = null }) {
    // entries open in the drawer's entry tab when embedded there, else on their own page
    const toEntry = (p) => (onEntry ? onEntry(p) : go(entryHref(folder, p)));
    // the chapter comes from outside when a note page's slider sets it (`chapter` + `onChapter`)
    const [ownAt, setOwnAt] = useState(params.get("at") ? Number(params.get("at")) : null);
    const controlled = given !== undefined && !!onChapter;
    const at = controlled ? given : ownAt;
    const setAt = controlled ? onChapter : setOwnAt;
    const [compare, setCompare] = useState(null);
    const [tab, setTab] = useState(params.get("type") ?? null);
    const [q, setQ] = useState("");
    const { data, error } = useApi(`/api/owner?${qs({ novel: folder, owner, at, compare })}`);
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    if (!data || !novel) return html`<${Loading} error=${error} />`;
    const chapter = at ?? data.latestChapter;
    const types = data.ledgers.map((l) => l.type);
    const current = data.ledgers.find((l) => l.type === (tab ?? types[0]));
    const behaviour = current?.computed.behaviour;
    const missingTypes = Object.keys(novel.ledgerTypes).filter((t) => !types.includes(t));
    const sheet = data.sheet;
    // the filter: every word must appear in what a row shows (entries, holdings, changes, values, relationships, stats)
    const hit = matcher(q);
    const entryHit = (e) => hit(e.key, e.title, Object.values(e.fields), e.lines.map((l) => Object.values(l)), e.body);
    const stackHit = (x) => hit(x.itemName, x.store, x.condition, x.rarity, x.mods);
    const shownEntries = current ? [...current.entries].reverse().filter(entryHit) : [];
    const stacks = current?.computed.stacks?.filter(stackHit) ?? [];
    const diff = current?.computed.diff?.filter(stackHit) ?? null;
    const relations = current?.computed.relations?.filter((r) => hit(r.withName, r.status, r.note)) ?? [];
    const values = current?.computed.values?.filter((v) => !v.with && hit(v.field, v.value)) ?? [];
    return html`<div>
        <div class="spread">
            ${embedded ? html`<span />` : html`<div><div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div><h1>${owner}</h1></div>`}
            <div class="row">
                ${sheet && !embedded && html`<button onClick=${() => go(noteHref(sheet.path))}>Sheet</button>`}
                <button class="primary" onClick=${() => toEntry({ owner, type: current?.type ?? "Inventory" })}>New ${current?.type ?? ""} entry</button>
            </div>
        </div>
        ${sheet && !embedded && html`<div class="panel"><div class="row" style="align-items:flex-start">
            ${sheet.images[0] && html`<img src=${sheet.images[0]} style="height:110px;border-radius:6px" />`}
            <div style="flex:1"><dl class="fields">${["race", "member-of", "character/power-system", "character/level", "character/sub-level", "character/talent", "alive", "age-current"].filter((k) => sheet.fm[k] != null && sheet.fm[k] !== "").map((k) => html`<dt>${k}</dt><dd><${Value} v=${sheet.fm[k]} links=${sheet.links} /></dd>`)}</dl></div>
        </div></div>`}
        <div class=${controlled ? "row compare-row" : "panel slider"}>
            ${!controlled && html`<b>Chapter</b>
            <input type="range" min="0" max=${data.latestChapter} value=${chapter} onInput=${(e) => setAt(Number(e.target.value))} />
            <input type="number" min="0" value=${chapter} style="width:70px" onInput=${(e) => setAt(Number(e.target.value))} />`}
            <label class="row muted"><input type="checkbox" style="width:auto" checked=${compare != null} onChange=${(e) => setCompare(e.target.checked ? Math.max(0, chapter - 1) : null)} /> compare with</label>
            ${compare != null && html`<input type="number" min="0" value=${compare} style="width:70px" onInput=${(e) => setCompare(Number(e.target.value))} />`}
        </div>
        <div class="row ledger-filter"><input class="grow" type="search" placeholder="Filter ledgers: items, names, notes, entries…" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Filter ledgers" /></div>
        <${StatsPanel} folder=${folder} owner=${owner} at=${chapter} filter=${q} onEntry=${onEntry} />
        <div class="tabs">
            ${data.ledgers.map((l) => html`<button class=${l === current ? "on" : ""} onClick=${() => setTab(l.type)}>${l.type} <span class="muted">${q.trim() ? `${l.entries.filter(entryHit).length}/${l.entries.length}` : l.entries.length}</span></button>`)}
            ${missingTypes.length > 0 && html`<select onChange=${(e) => e.target.value && toEntry({ owner, type: e.target.value })} style="margin-left:8px"><option value="">+ start a ledger…</option>${missingTypes.map((t) => html`<option>${t}</option>`)}</select>`}
        </div>
        ${!current ? html`<p class="muted">No ledgers yet.</p>` : html`
            ${current.computed.warnings.length > 0 && html`<div class="warnbox">${current.computed.warnings.map((w) => html`<div>${w.entry}: ${w.message}</div>`)}</div>`}
            ${behaviour === "stock" && html`<div class="grid2">
                <div class="panel"><h3>Held at chapter ${chapter}</h3>${q.trim() && !stacks.length && current.computed.stacks.length ? html`<p class="muted">Nothing held matches.</p>` : holdingsTable(stacks, index)}</div>
                ${diff && html`<div class="panel"><h3>Changes from chapter ${compare} to ${chapter}</h3>
                    <table><tbody>${diff.map((d) => html`<tr><td>${d.itemPath ? html`<a href=${noteHref(d.itemPath)}>${d.itemName}</a>` : d.itemName}</td><td class="muted">${d.store}</td><td class="num" style=${`color:var(${d.change > 0 ? "--ok" : "--bad"})`}>${d.changeText}</td></tr>`)}</tbody></table></div>`}
            </div>`}
            ${behaviour === "state" && relations.length > 0 && html`<${RelationsBox} title=${`Relationships at chapter ${chapter}`} rel=${relationGroups(relations, index)} />`}
            ${behaviour === "state" && (q.trim() ? values.length > 0 : !current.computed.relations?.length || values.length > 0) && html`<div class="panel"><h3>Values at chapter ${chapter}</h3>
                <table><tbody>${values.map((v) => html`<tr><td><b>${v.field}</b></td><td>${linkLabel(v.value)}</td><td class="muted">since ${v.entry}</td></tr>`)}</tbody></table></div>`}
            <h3>Entries${q.trim() ? html` <span class="muted" style="font-weight:400">${shownEntries.length} of ${current.entries.length}</span>` : ""}</h3>
            ${q.trim() && !shownEntries.length && html`<p class="muted">No entries match “${q.trim()}”.</p>`}
            ${shownEntries.map((e) => html`<${EntryCard} e=${e} folder=${folder} behaviour=${behaviour} future=${e.chapter > chapter} onEdit=${onEntry} />`)}
        `}
    </div>`;
}

/** The drawer's entry tab: "New Stats entry", "Edit 13.2" */
const entryTabLabel = (q) => { const p = new URLSearchParams(q); return p.get("key") ? `Edit ${p.get("key")}` : `New ${p.get("type") ?? ""} entry`.replace("  ", " "); };

/** A filter box's text -> (...parts) => does every word appear in them (any case; lists and [[links]] searched as text) */
function matcher(q) {
    const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return () => true;
    return (...parts) => { const text = parts.flat(Infinity).map((x) => (x == null ? "" : String(x))).join(" ").toLowerCase(); return words.every((w) => text.includes(w)); };
}

// ------------------------------------------------------------------ stats: panels on owner and note pages

const originText = (o) => (!o ? "" : o.unlinked ? `unlinked${o.chapter != null ? `, ch ${o.chapter}` : ""}` : o.from === "ledger" ? `ch ${o.chapter}` : o.from === "source" ? `from ${o.field}` : "sheet");
/** "Qi 1500 is 301 over Foundation Establishment (Early) (1000–1199)" for an unlinked level outside its range */
function driftText(template, f, values) {
    const d = driftOf(template, f, values);
    if (!d) return "";
    const src = sourceOf(template, f);
    return `${d.dir === "over" ? "Overflow" : "Underflow"}: ${src?.label ?? f.from} ${d.number} is ${d.by} ${d.dir} the range of ${d.option} (${d.min}${d.next != null ? `–${d.next - (Number.isInteger(d.next) ? 1 : 0)}` : "+"})`;
}

/** Stat values at a chapter as a table plus the stats panel callout */
function StatsPanel({ folder, owner, at, filter = "", onEntry = null }) {
    const { data, error } = useApi(`/api/stats?${qs({ novel: folder, owner, at })}`);
    const [showCallout, setShowCallout] = useState(() => store.get("statsShowCallout", true));
    if (error || !data) return null;
    const hit = matcher(filter);
    const t0 = data.template;
    if (t0 && filter.trim() && !t0.fields.some((f) => hit(f.section, f.label, data.display[f.key]))) return null;
    if (!data.template) return html`<div class="panel muted">No stat template for ${owner}. Assign one on the novel's Stats tab${data.templates.length ? "" : " (create a template first)"}.</div>`;
    const t = data.template;
    const toggleCallout = () => { const v = !showCallout; setShowCallout(v); store.set("statsShowCallout", v); };
    // the stats as a table (section · label, value, where it came from), the panel callout beside it when shown
    const fields = t.fields.filter((f) => hit(f.section, f.label, data.display[f.key]));
    const table = html`<table class="stats-table"><tbody>${fields.map((f) => { const o = data.origin[f.key]; const drift = driftText(t, f, data.values); return html`<tr><td class="muted">${f.section ? `${f.section} · ` : ""}${f.label}</td>
        <td>${f.type === "link" || f.type === "links" ? html`<${Value} v=${data.values[f.key]} />` : data.display[f.key] || html`<span class="muted">—</span>`}${drift && html`<div class="stat-drift">${drift}</div>`}</td>
        <td class="muted" style="font-size:12px">${f.type === "computed" ? "computed" : f.from && !o?.unlinked ? `from ${sourceOf(t, f)?.label ?? f.from}` : originText(o)}</td></tr>`; })}</tbody></table>`;
    return html`<div class="panel stats-panel">
        <div class="spread"><h3 style="margin:0">${t.name} stats${data.chapter != null ? html` <span class="muted" style="font-weight:400">at chapter ${data.chapter}</span>` : ""}</h3>
            <div class="row">${onEntry ? html`<button onClick=${() => onEntry({ owner, type: "Stats", chapter: data.chapter ?? "" })}>Change stats</button>` : html`<a class="button" href=${entryHref(folder, { owner, type: "Stats", chapter: data.chapter ?? "" })}>Change stats</a>`}
                <button class="small" aria-pressed=${showCallout} onClick=${toggleCallout}>${showCallout ? "Hide callout" : "Show callout"}</button>
                <button class="small" onClick=${() => copyText(data.panel, "Copied stats panel")}>⧉ Copy panel</button></div></div>
        ${data.problems.length > 0 && html`<div class="warnbox">${data.problems.map((p) => html`<div>${p}</div>`)}</div>`}
        ${showCallout ? html`<div class="grid2" style="margin-top:8px">${table}<div><${CalloutRender} text=${data.panel} /></div></div>` : html`<div style="margin-top:8px">${table}</div>`}
    </div>`;
}

/** Data store creature: its base stats in each novel, and adding it to another novel */
function CreatureNovels({ page, index }) {
    const [novel, setNovel] = useState("");
    const [tpl, setTpl] = useState("");
    const { data: ns } = useApi(novel ? `/api/stats/novel?${qs({ novel })}` : null);
    const used = new Set(page.creatureStats.map((u) => u.novel));
    const add = async () => {
        try { const r = await api.send("POST", "/api/stats/creature", { novel, creature: toLink(page.name), template: tpl }); openInDrawer(noteHref(r.path)); }
        catch (e) { toast(e.message); }
    };
    const names = ns ? Object.keys(ns.templates) : [];
    return html`<div class="panel" data-drawer><h3>Stats in novels</h3>
        ${page.creatureStats.length ? page.creatureStats.map((u) => html`<div><a href=${noteHref(u.path)}>${u.novelName}</a> <span class="muted">${u.template ?? "no template"}</span></div>`) : html`<p class="muted">Not used in any novel yet.</p>`}
        <div class="row" style="margin-top:8px">
            <select value=${novel} onChange=${(e) => { setNovel(e.target.value); setTpl(""); }}><option value="">Add to novel…</option>
                ${(index?.novels ?? []).filter((n) => !used.has(n.folder)).map((n) => html`<option value=${n.folder}>${n.name}</option>`)}</select>
            ${novel && html`<select value=${tpl} onChange=${(e) => setTpl(e.target.value)}><option value="">${names.length ? "Template…" : "No templates in this novel"}</option>${names.map((n) => html`<option>${n}</option>`)}</select>
                <button class="primary small" disabled=${!tpl} onClick=${add}>Add</button>`}
        </div>
    </div>`;
}

function holdingsTable(stacks, index) {
    if (!stacks.length) return html`<p class="muted">Nothing held.</p>`;
    const byStore = new Map();
    for (const s of stacks) { if (!byStore.has(s.store)) byStore.set(s.store, []); byStore.get(s.store).push(s); }
    // a held item's callout: the item's own info plus this copy's condition, rarity and modifiers
    const copy = async (s) => {
        const note = s.itemPath ? index?.notes.find((n) => n.path === s.itemPath) : null;
        // a held recipe copies as its blueprint
        if (note?.collection === "Recipes") {
            try {
                const page = await api.get(`/api/note?${qs({ path: note.path })}`);
                if (page.blueprint) return copyText(blueprintCallout(page.blueprint, page, 1, index), `Copied the ${s.itemName} blueprint as a callout`);
            } catch { /* falls back to an item callout */ }
        }
        copyText(itemCallout(note, note ? index.schema.collections[note.collection] : null, { name: s.itemName, qtyText: s.qtyText, condition: s.condition, rarity: s.rarity, qty: s.qty, mods: s.mods ?? [] }), `Copied ${s.itemName} as a callout`);
    };
    return html`${[...byStore.entries()].map(([st, list]) => html`<div style="margin-bottom:8px"><b class="muted">${st}</b>
        <table class="holdings"><tbody>${list.map((s) => html`<tr><td>${s.itemPath ? html`<a href=${noteHref(s.itemPath)}>${s.itemName}</a>` : html`<span title="Misc item">${s.itemName} <span class="badge">misc</span></span>`}${heldDetails(s)}</td>
            <td class="num" style=${s.qty < 0 ? "color:var(--bad)" : ""}>${s.qtyText}</td>
            <td class="copy-cell"><button class="small" title="Copy as an item callout" aria-label=${`Copy ${s.itemName} as a callout`} onClick=${() => copy(s)}>⧉</button></td></tr>`)}</tbody></table></div>`)}`;
}
/** condition, rarity and modifiers of a held stack, after its name */
const heldDetails = (s) => {
    const kind = [s.condition, s.rarity].filter(Boolean).join(", "), mods = (s.mods ?? []).map(linkText).join(", ");
    return kind || mods ? html` <span class="muted">(${[kind, mods].filter(Boolean).join("; ")})</span>` : "";
};
/** a [[link]] as its label, other text as it is */
const linkText = (v) => (isLink(v) ? linkLabel(v) : String(v));

// ------------------------------------------------------------------ item callouts

// Fields an item callout handles itself (or leaves out)
const ITEM_OWN = new Set(["title", "aliases", "type", "images", "novels", "created-date", "tags", "description", "rarity", "energy-source", "elements", "status", "recipe", "system-item", "facet", "cover", "cat", "subcat"]);
const shownValue = (v) => asList(v).filter((x) => x !== "" && x != null && x !== false).map((x) => (x === true ? "yes" : String(x).replace(/\s*\n\s*/g, " "))).join(", ");
// The stat groups of an item callout, in order (fields of an item that no group names go in a last group)
const ITEM_GROUPS = [
    ["quantity", "category", "rarity", "grade", "tier"],
    ["energy-source", "elements", "power-system", "tradition", "heritage", "teaches"],
    ["condition", "modifiers"],
    ["slot", "applies-to", "uom", "density", "usage", "sources"],
    ["value", "currency"],
];
/**
 * An item (or material) as a callout, like a game's item information: the name as its title, the description, then
 * its stats one per line in groups of like things (what it is; its power; this copy's condition and modifiers; how it
 * is used; its worth; the rest), a blank callout line (">") before each group that has anything in it, so each group
 * is its own paragraph and the theme decides the gap. Rarity, energy source and
 * elements are always there ("-" when blank), as is the description.
 * extra: {name, qty, qtyText, condition, rarity (overrides the item's), mods: [text or [[link]]]}
 */
function itemCallout(note, spec, extra = {}) {
    const fm = note?.fm ?? {};
    const dash = (v) => shownValue(v) || "-";
    // every stat this item has: key -> [label, value]
    const stats = new Map();
    if (extra.qtyText && !(extra.qty === 1 && /^1\s*[x×]?$/i.test(extra.qtyText))) stats.set("quantity", ["Quantity", extra.qtyText]);
    const kind = [shownValue(fm.cat), shownValue(fm.subcat)].filter(Boolean).join(" › ");
    if (kind) stats.set("category", ["Category", kind]);
    stats.set("rarity", ["Rarity", dash(extra.rarity || fm.rarity)]);
    stats.set("energy-source", ["Energy source", dash(fm["energy-source"])]);
    stats.set("elements", ["Elements", dash(fm.elements)]);
    if (extra.condition) stats.set("condition", ["Condition", extra.condition]);
    if (extra.mods?.length) stats.set("modifiers", ["Modifiers", extra.mods.join(", ")]);
    for (const k of spec?.fields?.map(([k]) => k) ?? Object.keys(fm)) if (!ITEM_OWN.has(k) && !stats.has(k) && shownValue(fm[k])) stats.set(k, [fieldLabel(k), shownValue(fm[k])]);
    const grouped = new Set(ITEM_GROUPS.flat());
    const groups = [...ITEM_GROUPS, [...stats.keys()].filter((k) => !grouped.has(k))]
        .map((keys) => keys.filter((k) => stats.has(k)).map((k) => `**${stats.get(k)[0]}:** ${stats.get(k)[1]}`)).filter((g) => g.length);
    const lines = [`[!item] ${fm.title || note?.name || extra.name || "Item"}`, shownValue(fm.description) || "-"];
    for (const g of groups) lines.push("", ...g);
    return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
}

/** A chapter's plan (and working title while there's no chapter note); saved with "Save changes" */
function ChapterPlan({ folder, n, plan, hasNote, scope }) {
    const server = { plan: String(plan?.fm.plan ?? ""), title: String(plan?.fm.title ?? "") };
    const mtime = plan?.mtime ?? 0;
    const [edits, setEdits] = useState({});
    const [baseMtime, setBaseMtime] = useState(null);
    const [saved, setSaved] = useState({ mtime: 0, vals: {} });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const cur = mtime >= saved.mtime ? server : { ...server, ...saved.vals };
    const val = (k) => (k in edits ? edits[k] : cur[k]);
    const changed = Object.keys(edits).filter((k) => edits[k] !== cur[k]);
    const dirty = changed.length > 0;
    const key = `plan:${folder}:${n}`;
    useEffect(() => markDirty(scope, key, dirty), [dirty]);
    useEffect(() => () => markDirty(scope, key, false), []);
    const edit = (k, v) => { if (baseMtime == null) setBaseMtime(mtime); setEdits((s) => ({ ...s, [k]: v })); };
    const reset = () => { setEdits({}); setBaseMtime(null); setErr(""); };
    const save = async () => {
        if (!dirty || busy) return;
        setBusy(true); setErr("");
        try {
            const set = Object.fromEntries(changed.map((k) => [k, edits[k]]));
            const r = await api.send("POST", "/api/plan/chapter", { novel: folder, n, set, baseMtime: plan ? baseMtime ?? mtime : undefined });
            setSaved({ mtime: r.mtime, vals: { ...(mtime >= saved.mtime ? {} : saved.vals), ...set } });
            reset();
            toast("Plan saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    return html`<div class="panel chapter-plan" onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } }}>
        <div class="spread"><h2 style="margin:0">Plan</h2>${plan && html`<a class="muted" href=${noteHref(plan.path)} title="The plan note in the vault">${plan.path.split("/").pop().replace(/\.md$/, "")}</a>`}</div>
        ${!hasNote && html`<label class="row muted" style="margin:8px 0">Working title
            <input style="flex:1" value=${val("title")} onInput=${(e) => edit("title", e.target.value)} placeholder="Chapter title" /></label>`}
        <${PlanEditor} value=${val("plan")} onChange=${(v) => edit("plan", v)} />
        ${err && html`<p class="error">${err}</p>`}
        <div class=${`savebar ${dirty ? "dirty" : ""}`}>
            <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save changes"}</button>
            ${dirty && html`<button onClick=${reset}>Discard</button><span class="muted">Ctrl+S</span>`}
        </div>
    </div>`;
}

function ChapterView({ folder, n, scope = "page" }) {
    const num = Number(n);
    const { data, error } = useApi(`/api/chapter?${qs({ novel: folder, n: num })}`);
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    const [type, setType] = useState("");
    if (!data || !novel) return html`<${Loading} error=${error} />`;
    const entries = data.entries.filter((e) => !type || e.type === type);
    const types = [...new Set(data.entries.map((e) => e.type))];
    const beh = (t) => novel.ledgerTypes[t]?.behaviour;
    const title = data.chapter?.title || data.plan?.fm.title || "";
    const unplaced = data.entries.filter((e) => !e.placed && !e.fields["mirror-of"]).length;
    return html`<div>
        <div class="spread">
            <div><div class="muted"><a href=${novelHref(folder)} data-page>${novel.name}</a>${data.volume && html` · <a href=${noteHref(data.volume.path)}>${data.volume.label}</a>`}</div>
                <h1>Chapter ${num}${title ? `: ${title}` : ""}</h1></div>
            <div class="row">
                ${data.prev != null && html`<a class="button" href=${chapterHref(folder, data.prev)}>← ${data.prev}</a>`}
                ${html`<a class="button" href=${chapterHref(folder, data.next ?? num + 1)}>${data.next ?? num + 1} →</a>`}
            </div>
        </div>
        <p class="row">
            <button class="primary" onClick=${() => openWriter(folder, num, { withPlan: scope !== "drawer" })} title="Write in the chapter writer (left); the plan stays on the right">✎ ${data.chapter ? "Write" : "Start writing"}</button>
            ${!data.chapter && html`<span class="badge">not written yet</span>`}
            ${data.entries.length > 0 && html`<span class="muted">${unplaced} ${unplaced === 1 ? "entry" : "entries"} not yet in the chapter text</span>`}
        </p>
        <${ChapterPlan} key=${`${folder}:${num}`} folder=${folder} n=${num} plan=${data.plan} hasNote=${!!data.chapter} scope=${scope} />
        <div class="spread" style="margin-top:18px">
            <h2 style="margin:0">Ledger entries <span class="muted" style="font-size:13px">${data.entries.length}</span></h2>
            <div class="row">
                <button class="primary" onClick=${() => (inDrawer(scope) ? openInDrawer : go)(entryHref(folder, { chapter: num }))}>New entry</button>
                <button disabled=${!entries.length} onClick=${() => copyText(entries.map((e) => e.callout).join("\n\n"), `Copied ${entries.length} callouts`)}>⧉ Copy all</button>
            </div>
        </div>
        ${types.length > 1 && html`<div class="row" style="margin:10px 0">${[["", "All"], ...types.map((t) => [t, t])].map(([t, label]) => html`<a class=${`chip ${type === t ? "on" : ""}`} href="javascript:" onClick=${() => setType(t)}>${label}</a>`)}</div>`}
        <div style="margin-top:10px">${entries.length ? entries.map((e) => html`<${EntryCard} e=${e} folder=${folder} behaviour=${beh(e.type)} showOwner=${true}
            onEdit=${inDrawer(scope) ? (p) => openInDrawer(entryHref(folder, { ...p, chapter: num })) : null} />`) : html`<p class="muted">No entries in this chapter.</p>`}</div>
    </div>`;
}

// ------------------------------------------------------------------ entry editor

const ACTIONS = ["add", "remove", "move", "transfer-out"];
const UNITS = ["ea", "g", "kg", "t"];

function ItemPicker({ value, index, onChange, onCreate }) {
    // (recipes are held like items and materials: a character can learn or carry one)
    const options = useMemo(() => [...(index?.inCollection("Items") ?? []), ...(index?.inCollection("Materials") ?? []), ...(index?.inCollection("Recipes") ?? [])]
        .map((n) => ({ label: n.name, hint: n.collection === "Materials" ? "material" : n.collection === "Recipes" ? "recipe" : linkLabel(asList(n.fm.cat)[0] ?? "") })), [index]);
    return html`<${Picker} value=${linkLabel(value ?? "")} options=${options} placeholder="Item, material, recipe or misc text"
        onChange=${(o) => onChange(o ? (o.free ? o.label : toLink(o.label)) : "")} onCreate=${onCreate} createLabel="Create data entry for" />`;
}

function CreateItemForm({ name, index, onSave, onCancel }) {
    const [collection, setCollection] = useState("Items");
    const [fm, setFm] = useState({ cat: [], rarity: "", description: "" });
    const target = collection === "Items" ? "Taxonomy/Item Categories" : "Taxonomy/Material Categories";
    return html`<div class="panel" style="background:var(--panel-2)">
        <b>New data entry: ${name}</b>
        <div class="formgrid" style="margin-top:8px">
            <label>Collection</label><select value=${collection} onChange=${(e) => setCollection(e.target.value)}><option>Items</option><option>Materials</option></select>
            <label>Category</label><${LinkField} value=${fm.cat} multiple=${true} target=${target} index=${index} onChange=${(v) => setFm({ ...fm, cat: v })} />
            <label>Rarity</label><${LinkField} value=${fm.rarity} multiple=${false} target="Taxonomy/Rarity" index=${index} onChange=${(v) => setFm({ ...fm, rarity: v })} />
            <label>Description</label><textarea style="font-family:inherit" value=${fm.description} onInput=${(e) => setFm({ ...fm, description: e.target.value })} />
        </div>
        <div class="row" style="margin-top:8px"><button class="primary" onClick=${() => onSave({ collection, name, fm })}>Add with entry</button><button onClick=${onCancel}>Cancel</button></div>
        <p class="muted">The note is created when you save the entry.</p>
    </div>`;
}

/** A taxonomy facet's values for a dropdown, in rank order (`class`, then title): [{value: note name, label: title}] */
function rankedOptions(index, facet) {
    return (index?.inCollection(facet) ?? []).slice()
        .sort((a, b) => (Number(a.fm.class) || 0) - (Number(b.fm.class) || 0) || String(a.fm.title ?? a.name).localeCompare(String(b.fm.title ?? b.name)))
        .map((n) => ({ value: n.name, label: n.fm.title ?? n.name }));
}
/**
 * A dropdown over ranked options for a line field holding a [[link]]: shows the stored link's value (matched by name,
 * ignoring case; a value the facet doesn't have stays listed so it is never shown as blank), and gives back a
 * [[link]] (or "" for the empty choice)
 */
function rankedSelect(options, current, emptyLabel, onChange) {
    const cur = current ? linkLabel(current) : "";
    const hit = options.find((o) => o.value.toLowerCase() === cur.toLowerCase() || o.label.toLowerCase() === cur.toLowerCase());
    const list = cur && !hit ? [...options, { value: cur, label: cur }] : options;
    return html`<select value=${hit ? hit.value : cur} onChange=${(e) => onChange(e.target.value ? toLink(e.target.value) : "")}>
        <option value="">${emptyLabel}</option>${list.map((o) => html`<option value=${o.value}>${o.label}</option>`)}</select>`;
}

/** Modifiers of a held item (attachments, modifications, enchantments…): items from the data store or free text,
 * kept as one line field "a; b" */
function ModsField({ value, index, onChange }) {
    const mods = String(value ?? "").split(";").map((m) => m.trim()).filter(Boolean);
    const options = useMemo(() => (index?.inCollection("Items") ?? []).map((n) => ({ label: n.name, hint: linkLabel(asList(n.fm.cat)[0] ?? "") })), [index]);
    const set = (list) => onChange(list.join("; "));
    const add = (o) => {
        if (!o) return;
        const name = o.label.replace(/;/g, ",");
        const m = !o.free || index?.resolve(name) ? toLink(name) : name;
        set([...mods.filter((x) => linkText(x).toLowerCase() !== name.toLowerCase()), m]);
    };
    // one modifier per line, the box to add another below them
    return html`<div class="mods-field">
        ${mods.length > 0 && html`<ul class="mods-list">${mods.map((m) => { const note = isLink(m) && index?.resolve(m); return html`<li><span>${note ? html`<a href=${noteHref(note.path)} data-page>${linkText(m)}</a>` : linkText(m)}</span>
            <button type="button" class="chip-x" title="Remove" aria-label=${`Remove ${linkText(m)}`} onClick=${() => set(mods.filter((x) => x !== m))}>×</button></li>`; })}</ul>`}
        <${Picker} value="" clearOnPick options=${options} placeholder="Add a modifier: an item, or text like +2 sharpness" onChange=${add} /></div>`;
}

function LinesEditor({ behaviour, lines, setLines, index, novel, owner, createNotes, setCreateNotes, withTarget }) {
    const [creating, setCreating] = useState(null); // {row, name}
    const [details, setDetails] = useState(() => new Set()); // rows showing rarity and modifiers
    // (an item chosen in the drawer arrives later: it goes into the lines as they are then)
    const latest = useRef({ lines, setLines });
    latest.current = { lines, setLines };
    const rarities = useMemo(() => rankedOptions(index, "Taxonomy/Rarity"), [index]);
    const owners = useMemo(() => [...new Set([...novel.characters.map((c) => c.name), ...novel.ledgers.map((l) => l.owner)])].filter((o) => o !== owner).map((o) => ({ label: o })), [novel, owner]);
    const conditions = useMemo(() => rankedOptions(index, "Taxonomy/Item Condition"), [index]);
    // relationships can be with characters or forces (factions, sects)
    const relTargets = useMemo(() => [...owners, ...(index?.inCollection("Factions") ?? []).map((n) => ({ label: n.name, hint: "faction" }))], [owners, index]);
    const upd = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const remove = (i) => setLines(lines.filter((_, j) => j !== i));
    if (behaviour === "state" && withTarget) {
        // relationships: who, where the owner stands with them, and a short note on why / how things are now
        // (older lines, a status word and text in one value or separate note lines, are shown the same way and
        // written as one line `[set:: relation] [with:: X] [value:: friendly] [note:: …]` once edited)
        const view = (l) => {
            const statusField = !/^(notes?|why|reason)$/i.test(l.set ?? "");
            const m = statusField ? /^([A-Za-z]+)\s*(?:[:;,—–-]\s*|\s+|$)(.*)$/s.exec(String(l.value ?? "").trim()) : null;
            const st = m && ["friendly", "neutral", "hostile"].includes(m[1].toLowerCase()) ? m[1].toLowerCase() : "";
            return { status: st, note: l.note ?? (st ? m[2].trim() : String(l.value ?? "")) };
        };
        const put = (i, patch) => { const v = { ...view(lines[i]), ...patch }; setLines(lines.map((l, j) => (j === i ? { set: "relation", with: l.with ?? "", value: v.status, note: v.note } : l))); };
        return html`<table class="lines-editor"><thead><tr><th>with</th><th style="width:130px">standing</th><th>note (why, or how things are now)</th><th></th></tr></thead><tbody>
            ${lines.map((l, i) => { const v = view(l); return html`<tr>
                <td><${Picker} value=${linkLabel(l.with ?? "")} options=${relTargets} onChange=${(o) => upd(i, { with: o ? toLink(o.label) : "" })} /></td>
                <td><select value=${v.status} onChange=${(e) => put(i, { status: e.target.value })}>
                    <option value="">(unchanged)</option><option value="friendly">Friendly</option><option value="neutral">Neutral</option><option value="hostile">Hostile</option></select></td>
                <td><input value=${v.note} onInput=${(e) => put(i, { note: e.target.value })} placeholder="e.g. blames him for his mother's death" /></td>
                <td><${ConfirmButton} confirmLabel="Confirm" onConfirm=${() => remove(i)}>×<//></td></tr>`; })}
            </tbody></table>
            <button class="small" onClick=${() => setLines([...lines, { set: "relation", with: "", value: "", note: "" }])}>+ Line</button>`;
    }
    if (behaviour === "state") {
        return html`<table class="lines-editor"><thead><tr><th>field</th>${withTarget && html`<th>with</th>`}<th>value</th><th></th></tr></thead><tbody>
            ${lines.map((l, i) => html`<tr>
                <td><input list="setfields" value=${l.set ?? ""} onInput=${(e) => upd(i, { set: e.target.value })} /></td>
                ${withTarget && html`<td><${Picker} value=${linkLabel(l.with ?? "")} options=${owners} onChange=${(o) => upd(i, { with: o ? toLink(o.label) : "" })} /></td>`}
                <td><input value=${l.value ?? ""} onInput=${(e) => upd(i, { value: e.target.value })} placeholder="value or [[link]]" /></td>
                <td><${ConfirmButton} confirmLabel="Confirm" onConfirm=${() => remove(i)}>×<//></td></tr>`)}
            </tbody></table>
            <datalist id="setfields">${[...new Set([...(novel.setFields ?? []), ...(index?.schema.characters?.fields.map(([k]) => k) ?? [])])].map((f) => html`<option value=${f} />`)}</datalist>
            <button class="small" onClick=${() => setLines([...lines, withTarget ? { set: "relation", with: "", value: "" } : { set: "", value: "" }])}>+ Line</button>`;
    }
    const browse = (i) => browseItems({ label: `line ${i + 1}`, pick: (name) => { const { lines: ls, setLines: set } = latest.current; set(ls.map((l, j) => (j === i ? { ...l, item: toLink(name) } : l))); } });
    const toggleDetails = (i) => setDetails((d) => { const n = new Set(d); n.has(i) ? n.delete(i) : n.add(i); return n; });
    return html`<table class="lines-editor"><thead><tr><th style="width:110px">action</th><th>item</th><th style="width:70px">qty</th><th style="width:64px">unit</th><th style="width:110px">condition</th><th>store</th><th>to</th><th>note</th><th></th><th></th></tr></thead><tbody>
        ${lines.map((l, i) => { const showDetails = details.has(i) || !!l.rarity || !!l.mods; return html`<tr>
            <td><select value=${l.action ?? "add"} onChange=${(e) => upd(i, { action: e.target.value })}>${ACTIONS.map((a) => html`<option>${a}</option>`)}</select></td>
            <td><div class="item-cell"><${ItemPicker} value=${l.item} index=${index} onChange=${(v) => upd(i, { item: v })} onCreate=${(name) => setCreating({ row: i, name })} />
                <button type="button" class="small" title="Browse the items (and materials) in the side drawer: filter, open, or create one, then add it" onClick=${() => browse(i)}>Browse</button></div>
                ${createNotes.some((c) => toLink(c.name) === l.item) && html`<span class="badge ok">new entry</span>`}</td>
            <td><input value=${l.qty ?? "1"} onInput=${(e) => upd(i, { qty: e.target.value })} /></td>
            <td><select value=${l.unit ?? "ea"} onChange=${(e) => upd(i, { unit: e.target.value === "ea" ? "" : e.target.value })}>${UNITS.map((u) => html`<option>${u}</option>`)}</select></td>
            <td>${rankedSelect(conditions, l.condition, "", (v) => upd(i, { condition: v }))}</td>
            <td><input list="stores" value=${l.store ?? ""} placeholder="inventory" onInput=${(e) => upd(i, { store: e.target.value })} /></td>
            <td>${l.action === "transfer-out" ? html`<${Picker} value=${linkLabel(l.to ?? "")} options=${owners} placeholder="receiver" onChange=${(o) => upd(i, { to: o ? toLink(o.label) : "" })} />`
                : l.action === "move" ? html`<input list="stores" value=${l["to-store"] ?? ""} placeholder="to store" onInput=${(e) => upd(i, { "to-store": e.target.value })} />` : ""}</td>
            <td><input value=${l.note ?? ""} onInput=${(e) => upd(i, { note: e.target.value })} /></td>
            <td><button type="button" class=${`small ${showDetails ? "on" : ""}`} title="Rarity and modifiers of this item" aria-expanded=${showDetails} onClick=${() => toggleDetails(i)}>${l.rarity || l.mods ? "Details ●" : "Details"}</button></td>
            <td><${ConfirmButton} confirmLabel="Confirm" onConfirm=${() => remove(i)}>×<//></td></tr>
            ${showDetails && html`<tr class="line-details"><td></td><td colspan="9"><div class="details-grid">
                <span class="muted">Rarity</span><div>${rankedSelect(rarities, l.rarity, "as the item", (v) => upd(i, { rarity: v }))}</div>
                <span class="muted">Modifiers</span><${ModsField} value=${l.mods} index=${index} onChange=${(v) => upd(i, { mods: v })} />
            </div></td></tr>`}`; })}
        </tbody></table>
        <datalist id="stores">${["inventory", ...(novel.stores ?? [])].map((s) => html`<option value=${s} />`)}</datalist>
        <button class="small" onClick=${() => setLines([...lines, { action: "add", item: "", qty: "1" }])}>+ Line</button>
        ${creating && html`<${CreateItemForm} name=${creating.name} index=${index} onCancel=${() => setCreating(null)}
            onSave=${(c) => { setCreateNotes([...createNotes.filter((x) => x.name !== c.name), c]); upd(creating.row, { item: toLink(c.name) }); setCreating(null); }} />`}`;
}

function EntryFields({ type, entry, setEntry }) {
    const fields = Object.entries(type?.fields ?? {}).filter(([k]) => k !== "callout");
    const variants = Object.keys(type?.callouts ?? {});
    return html`
        ${fields.map(([k, f]) => html`<label>${f.label ?? k}</label><input value=${entry.fields[k] ?? ""} onInput=${(e) => setEntry({ ...entry, fields: { ...entry.fields, [k]: e.target.value } })} />`)}
        ${variants.length > 1 && html`<label>Callout</label><select value=${entry.fields.callout ?? ""} onChange=${(e) => setEntry({ ...entry, fields: { ...entry.fields, callout: e.target.value } })}>
            <option value="">default (${type["default-callout"] ?? "default"})</option>${variants.map((v) => html`<option>${v}</option>`)}</select>`}`;
}

// ------------------------------------------------------------------ stats: inputs

/** Comma separated list input that keeps what you type until you leave it */
function ListInput({ value, onChange, placeholder = "comma separated" }) {
    const [text, setText] = useState(asList(value).join(", "));
    useEffect(() => { if (document.activeElement?.dataset?.listInput !== "1") setText(asList(value).join(", ")); }, [JSON.stringify(value)]);
    return html`<input data-list-input="1" value=${text} placeholder=${placeholder} onInput=${(e) => { setText(e.target.value); onChange(fromText({ type: "list" }, e.target.value)); }}
        onBlur=${() => setText(asList(value).join(", "))} />`;
}

/** Typed input for one stat field; values are typed (numbers, booleans, arrays of links...) */
function StatInput({ field, value, onChange, index, template, values }) {
    const f = field;
    switch (f.type) {
        case "number":
            return html`<input type="number" step=${f.integer ? 1 : "any"} min=${f.min ?? undefined} max=${f.max ?? undefined} value=${value ?? ""}
                onInput=${(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />`;
        case "boolean":
            return html`<select value=${value === true ? "yes" : value === false ? "no" : ""} onChange=${(e) => onChange(e.target.value === "" ? "" : e.target.value === "yes")}>
                <option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>`;
        case "choice": {
            // a choice that follows a number is worked out from it
            if (f.from) return html`<span class="muted" title=${`From ${f.from}`}>${template && values ? displayValue(template, f, computeValues(template, values)) || "—" : `follows ${f.from}`}</span>`;
            const cur = value ? optionOf(f, value) : "";
            const shown = value ? linkLabel(String(value)) : "";
            return html`<select value=${cur ?? shown} onChange=${(e) => onChange(e.target.value === "" ? "" : f.facet ? `[[${e.target.value}]]` : e.target.value)}><option value="">—</option>
                ${f.options.map((o) => html`<option value=${o}>${f.optionTitles?.[o] ?? o}</option>`)}${value && !cur && html`<option value=${shown}>${shown} (not an option)</option>`}</select>`;
        }
        case "list": return html`<${ListInput} value=${value} onChange=${onChange} />`;
        case "link": case "links":
            return html`<${LinkField} value=${f.type === "links" ? asList(value) : value || ""} multiple=${f.type === "links"} target=${f.collection || ""} index=${index} onChange=${onChange} />`;
        case "longtext": return html`<${AutoTextarea} value=${value} onInput=${(e) => onChange(e.target.value)} style="font-family:inherit" />`;
        case "resource": {
            const r = parseResource(value) ?? { cur: "", max: null };
            const fixedMax = f["max-field"] || f.max != null;
            const set = (cur, max) => onChange(cur === "" ? "" : fixedMax || max === "" || max == null ? String(cur) : `${cur}/${max}`);
            return html`<span class="resource-input">
                <input type="number" aria-label=${`${f.label} current`} value=${r.cur} onInput=${(e) => set(e.target.value, r.max ?? "")} />
                <span class="muted">/</span>
                ${fixedMax ? html`<span class="muted" title=${f["max-field"] ? `Max from ${f["max-field"]}` : "Fixed max"}>${template && values ? displayValue(template, f, { ...values, [f.key]: String(r.cur || 0) }).split("/")[1] ?? "?" : f.max ?? "max"}</span>`
                    : html`<input type="number" aria-label=${`${f.label} max`} value=${r.max ?? ""} placeholder="max" onInput=${(e) => set(r.cur, e.target.value)} />`}
            </span>`;
        }
        case "computed": return html`<span class="muted" title=${f.formula}>${template && values ? displayValue(template, f, computeValues(template, values)) || "—" : "computed"}</span>`;
        default: return html`<input value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} />`;
    }
}

const statError = (index, f, v) => checkValue(f, v, { resolve: (x) => { const n = index?.resolve(x); return n ? { path: n.path, collection: n.collection } : null; } });

/**
 * Stats entry lines as a form over the owner's template: every field starts at its previous value; only the
 * fields you change become `set` lines. Lines for other fields stay in the generic editor below.
 */
/** "+50" / "-20": keeps what is typed ("+", "-") while the line follows it */
function ChangeBy({ value, onChange }) {
    const ref = useRef(null);
    const [text, setText] = useState(value);
    useEffect(() => { if (document.activeElement !== ref.current) setText(value); }, [value]);
    return html`<input ref=${ref} type="text" inputmode="decimal" placeholder="+50" value=${text} onInput=${(e) => { setText(e.target.value); onChange(e.target.value); }} onBlur=${() => setText(value)} />`;
}

function StatLinesEditor({ template, before, lines, setLines, index }) {
    const lineFor = (f) => lines.find((l) => !l.with && namesField(f, l.set));
    // the values this entry comes to: its lines replayed on the values before it, as the server does (changes by an
    // amount, levels set or unlinked)
    const current = useMemo(() => { const st = stateFrom(template, before); for (const l of lines) replayLine(template, st, l); return valuesFromState(template, st); }, [template, before, lines]);
    const beforeAll = useMemo(() => computeValues(template, before), [template, before]);
    const setChange = (f, text) => {
        const rest = lines.filter((l) => l !== lineFor(f));
        const n = Number(String(text).replace(/^\s*\+\s*/, ""));
        setLines(String(text).trim() === "" || !Number.isFinite(n) || n === 0 ? rest : [...rest, { set: f.key, add: String(n) }]);
    };
    const setField = (f, v) => {
        const rest = lines.filter((l) => l !== lineFor(f));
        const same = JSON.stringify(v ?? "") === JSON.stringify(before[f.key] ?? "") || (Array.isArray(v) && !v.length && (before[f.key] == null || before[f.key] === ""));
        setLines(same ? rest : [...rest, { set: f.key, value: toText(f, v) }]);
    };
    // a level that follows a number: one line {set, value?, link?}; nothing left to say -> no line
    const linkedBefore = (f) => !asList(before[UNLINKED]).includes(f.key);
    const setLevel = (f, patch) => {
        const rest = lines.filter((l) => l !== lineFor(f));
        const next = { ...(lineFor(f) ?? { set: f.key }), ...patch };
        if (next.link === "on" && linkedBefore(f)) delete next.link;
        if (next.link === "off" && !linkedBefore(f)) delete next.link;
        if (!next.value) delete next.value;
        if (next.value && !next.link && optionOf(f, next.value) === optionOf(f, beforeAll[f.key] ?? "")) delete next.value;
        setLines(next.value || next.link ? [...rest, next] : rest);
    };
    const sections = [...new Set(template.fields.map((f) => f.section))];
    return html`<div class="stat-lines">
        <div class="spread"><b>${template.name} <span class="muted" style="font-weight:400">stats</span></b>
            <span class="muted">${lines.filter((l) => fieldNamed(template, l.set)).length} changed</span></div>
        ${sections.map((s) => html`${s && html`<h4 class="stat-section">${s}</h4>`}
            <div class="formgrid">${template.fields.filter((f) => f.section === s).map((f) => {
                const line = lineFor(f);
                const level = f.type === "choice" && !!f.from;
                const shownNow = displayValue(template, f, current), shownBefore = displayValue(template, f, beforeAll);
                const changed = !!line || (isDerived(f) && shownNow !== shownBefore) || (!isDerived(f) && JSON.stringify(current[f.key] ?? "") !== JSON.stringify(before[f.key] ?? ""));
                const err = !isDerived(f) && statError(index, f, current[f.key]);
                const amount = (f.type === "number" || f.type === "resource");
                if (level) {
                    const src = sourceOf(template, f);
                    const linked = !asList(current[UNLINKED]).includes(f.key);
                    const drift = driftOf(template, f, current);
                    return html`<label class=${changed ? "changed" : ""} title=${f.key}>${f.label}</label>
                        <div class="stat-cell">
                            <select aria-label=${f.label} value=${optionOf(f, current[f.key] ?? "") ?? ""} onChange=${(e) => setLevel(f, { value: e.target.value ? (f.facet ? `[[${e.target.value}]]` : e.target.value) : "" })}>
                                <option value="">—</option>${f.options.map((o) => html`<option value=${o}>${f.optionTitles?.[o] ?? o}</option>`)}</select>
                            <label class="link-switch" title=${linked ? `The level follows ${src?.label ?? f.from}. Unlink it for an overflow, a special constitution or a deficiency: then the level and ${src?.label ?? f.from} change on their own` : `Unlinked: the level stays as set while ${src?.label ?? f.from} moves. Link it again to work it out from ${src?.label ?? f.from}`}>
                                <input type="checkbox" role="switch" checked=${linked} onChange=${(e) => setLevel(f, { link: e.target.checked ? "on" : "off" })} />
                                <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
                                <span class="muted">${linked ? `follows ${src?.label ?? f.from}` : `unlinked from ${src?.label ?? f.from}`}</span></label>
                            <span class="muted stat-was">${changed ? `was ${shownBefore || "—"}${linkedBefore(f) !== linked ? (linkedBefore(f) ? ", linked" : ", unlinked") : ""}` : linked ? `setting a level moves ${src?.label ?? f.from} to its lowest value` : ""}
                                ${line && html` <button class="small" onClick=${() => setLines(lines.filter((l) => l !== line))}>undo</button>`}</span>
                            ${drift && html`<div class="stat-drift">${src?.label ?? f.from} ${drift.number} is ${drift.by} ${drift.dir === "over" ? "over" : "under"} the range of ${drift.option} (${drift.min}${drift.next != null ? `–${drift.next - (Number.isInteger(drift.next) ? 1 : 0)}` : "+"}): ${drift.dir === "over" ? "overflow" : "underflow"}</div>`}
                        </div>`;
                }
                return html`<label class=${changed ? "changed" : ""} title=${f.key}>${f.label}</label>
                    <div class="stat-cell">
                        <${StatInput} field=${f} value=${current[f.key]} onChange=${(v) => setField(f, v)} index=${index} template=${template} values=${current} />
                        ${amount && html`<label class="stat-change muted" title="Change it by an amount instead (a reward: +50, a cost: -20); written as [add:: …]">change by
                            <${ChangeBy} value=${line && isChange(line) ? (Number(line.add) > 0 ? `+${line.add}` : String(line.add)) : ""} onChange=${(text) => setChange(f, text)} /></label>`}
                        <span class="muted stat-was">${f.type === "computed" ? (changed ? `was ${shownBefore || "—"}` : "") : changed ? html`was ${displayValue(template, f, beforeAll) || "—"}${line ? html` <button class="small" onClick=${() => setField(f, before[f.key])}>undo</button>` : ""}` : "unchanged"}</span>
                        ${err && html`<div class="error">${err}</div>`}
                    </div>`;
            })}</div>`)}
    </div>`;
}

function EntryEditor({ index, folder, params, embedded = false, onDone = null }) {
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    // leaving the entry ends any item choosing it started in the drawer
    useEffect(() => () => { if (itemPick) setItemPick(null); }, []);
    const editKey = params.get("key");
    const rootRef = useRef();
    const cancelEntry = () => { if (embedded) markDirty("drawer", "ledger-entry", false); onDone ? onDone() : history.back(); };
    useEscapeTwice(!editKey, cancelEntry, rootRef);
    const [owner, setOwner] = useState(params.get("owner") ?? "");
    const [typeName, setTypeName] = useState(params.get("type") ?? "Inventory");
    const { data: ownerData } = useApi(editKey && owner ? `/api/owner?${qs({ novel: folder, owner })}` : null);
    const [entry, setEntry] = useState(null);
    const [lines, setLines] = useState([]);
    const [createNotes, setCreateNotes] = useState([]);
    const [linked, setLinked] = useState(null); // {type, entry:{title, fields, body}, lines}
    const [preview, setPreview] = useState(null);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    const [baseMtime, setBaseMtime] = useState(null);

    useEffect(() => {
        if (!novel || entry) return;
        if (editKey) {
            if (!ownerData) return;
            const l = ownerData.ledgers.find((x) => x.path === params.get("ledger"));
            const e = l?.entries.find((x) => x.key === editKey);
            if (!e) { setErr("Entry not found"); return; }
            setEntry({ chapter: e.chapter, title: e.title, fields: e.fields, body: e.body });
            setLines(e.lines);
            setBaseMtime(l.mtime);
        } else {
            setEntry({ chapter: Number(params.get("chapter") ?? novel.latestChapter), title: "", fields: {}, body: "" });
            setLines(novel.ledgerTypes[typeName]?.behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : []);
        }
    }, [novel, ownerData]);

    // in the drawer, an entry with something in it counts as unsaved (switching drawer pages asks first)
    const started = !!entry && (!!entry.title?.trim() || lines.some((l) => l.item || l.set || l.with) || !!entry.body?.trim());
    useEffect(() => { if (embedded) markDirty("drawer", "ledger-entry", started); }, [started]);
    useEffect(() => () => { if (embedded) markDirty("drawer", "ledger-entry", false); }, []);
    const type = novel?.ledgerTypes[typeName];
    const payload = useMemo(() => entry && ({
        novel: folder, owner, type: typeName, replaceKey: editKey ?? undefined, baseMtime: baseMtime ?? undefined,
        entry: { ...entry, lines: lines.filter((l) => l.item || l.set) }, createNotes,
        linked: linked ? [{ type: linked.type, entry: { ...linked.entry, lines: linked.lines.filter((l) => l.item || l.set) } }] : [],
    }), [entry, lines, createNotes, linked, owner, typeName]);

    useEffect(() => {
        if (!payload || !owner || !type) return;
        const t = setTimeout(() => api.send("POST", "/api/ledger/preview", payload).then(setPreview).catch((e) => setPreview({ error: e.message })), 300);
        return () => clearTimeout(t);
    }, [payload]);

    if (!novel || !entry) return html`<${Loading} error=${err} />`;
    const owners = [...new Set([...novel.characters.map((c) => c.name), ...novel.ledgers.map((l) => l.owner)])].map((o) => ({ label: o }));
    const save = async (copy) => {
        setBusy(true); setErr("");
        try {
            const r = await api.send("POST", "/api/ledger/entry", payload);
            if (copy) await copyText(r.linkedCallout || r.callout, "Saved and copied callout");
            else toast("Saved");
            if (embedded) markDirty("drawer", "ledger-entry", false);
            if (onDone) onDone(); else go(ownerHref(folder, owner) + `?type=${encodeURIComponent(typeName)}`);
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const linkedType = linked && novel.ledgerTypes[linked.type];
    const withTarget = typeName === "Relationships" || !!type?.["with-target"];
    // a state ledger for an owner with a stat template edits as a form prefilled with the previous values
    const statTemplate = type?.behaviour === "state" && !withTarget && preview?.stats?.template ? preview.stats.template : null;
    const otherLines = statTemplate ? lines.filter((l) => !fieldNamed(statTemplate, l.set)) : [];
    return html`<div class=${embedded ? "entry-embedded" : ""} ref=${rootRef}>
        ${!embedded && html`<div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div>`}
        ${embedded ? html`<h2 style="margin:4px 0 10px">${editKey ? `Edit ${typeName} entry ${editKey}` : `New ${typeName} entry`}</h2>` : html`<h1>${editKey ? `Edit entry ${editKey}` : "New entry"}</h1>`}
        <div class="grid2" style="grid-template-columns: minmax(0,1.4fr) minmax(0,1fr)">
            <div>
                <div class="panel"><div class="formgrid">
                    <label>Owner</label>${editKey ? html`<b style="padding-top:5px">${owner}</b>` : html`<${Picker} value=${owner} options=${owners} placeholder="Character or other owner" onChange=${(o) => setOwner(o?.label ?? "")} autoFocus=${!owner} />`}
                    <label>Ledger</label>${editKey ? html`<b style="padding-top:5px">${typeName}</b>` : html`<select value=${typeName} onChange=${(e) => { setTypeName(e.target.value); setLines(novel.ledgerTypes[e.target.value]?.behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : []); }}>${Object.values(novel.ledgerTypes).map((t) => html`<option value=${t.name}>${t.name} (${t.behaviour})</option>`)}</select>`}
                    <label>Chapter</label><input type="number" min="0" value=${entry.chapter} onInput=${(e) => setEntry({ ...entry, chapter: Number(e.target.value) })} style="width:90px" />
                    <label>Title</label><input value=${entry.title} onInput=${(e) => setEntry({ ...entry, title: e.target.value })} placeholder="Short summary of the event" />
                    <${EntryFields} type=${type} entry=${entry} setEntry=${setEntry} />
                </div></div>
                ${type?.behaviour === "log" ? html`<div class="panel"><b>Text</b><textarea style="min-height:220px;font-family:inherit;font-size:14px" value=${entry.body} onInput=${(e) => setEntry({ ...entry, body: e.target.value })} /></div>`
                : statTemplate ? html`<div class="panel"><${StatLinesEditor} template=${statTemplate} before=${preview.stats.before} lines=${lines} setLines=${setLines} index=${index} /></div>
                    <details class="panel" open=${otherLines.length > 0}><summary class="muted">Other fields (not in the ${statTemplate.name} template)</summary>
                        <div style="overflow-x:auto;margin-top:8px"><${LinesEditor} behaviour="state" lines=${otherLines} setLines=${(ls) => setLines([...lines.filter((l) => !otherLines.includes(l)), ...ls])} index=${index} novel=${novel} owner=${owner}
                            createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${false} /></div></details>`
                : html`<div class="panel" style="overflow-x:auto"><${LinesEditor} behaviour=${type?.behaviour} lines=${lines} setLines=${setLines} index=${index} novel=${novel} owner=${owner}
                    createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${withTarget} /></div>`}
                ${!editKey && html`<div class="panel">
                    ${!linked ? html`<div class="row"><b>Linked entry</b><span class="muted">for another ledger of the same owner, e.g. a journal entry's reward</span>
                        <select onChange=${(e) => e.target.value && setLinked({ type: e.target.value, entry: { title: "", fields: {}, body: "" }, lines: novel.ledgerTypes[e.target.value].behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : [] })}>
                            <option value="">+ add…</option>${Object.keys(novel.ledgerTypes).filter((t) => t !== typeName).map((t) => html`<option>${t}</option>`)}</select></div>`
                    : html`<div class="spread"><b>Linked ${linked.type} entry</b><${ConfirmButton} onConfirm=${() => setLinked(null)}>Remove<//></div>
                        <div class="formgrid" style="margin-top:8px"><label>Title</label><input value=${linked.entry.title} onInput=${(e) => setLinked({ ...linked, entry: { ...linked.entry, title: e.target.value } })} />
                            <${EntryFields} type=${linkedType} entry=${linked.entry} setEntry=${(en) => setLinked({ ...linked, entry: en })} /></div>
                        ${linkedType.behaviour === "log" ? html`<textarea style="margin-top:8px;font-family:inherit" value=${linked.entry.body} onInput=${(e) => setLinked({ ...linked, entry: { ...linked.entry, body: e.target.value } })} />`
                        : html`<div style="margin-top:8px;overflow-x:auto"><${LinesEditor} behaviour=${linkedType.behaviour} lines=${linked.lines} setLines=${(ls) => setLinked({ ...linked, lines: ls })} index=${index} novel=${novel} owner=${owner} createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${linked.type === "Relationships"} /></div>`}`}
                </div>`}
                ${err && html`<p class="error">${err}</p>`}
                <div class="row">
                    <button class="primary" disabled=${busy || !owner} onClick=${() => save(true)}>Save & copy callout</button>
                    <button disabled=${busy || !owner} onClick=${() => save(false)}>Save</button>
                    <button onClick=${cancelEntry} title=${editKey ? "Cancel" : "Cancel (Escape twice)"}>Cancel</button>
                </div>
            </div>
            <div>
                <div class="panel"><b>Callout preview</b>
                    ${preview?.error ? html`<p class="error">${preview.error}</p>` : preview ? html`<pre class="callout-text">${preview.callout}</pre><${CalloutRender} text=${preview.callout} />` : html`<p class="muted">Choose an owner to preview.</p>`}
                </div>
                ${preview?.warnings?.length > 0 && html`<div class="warnbox">${preview.warnings.map((w) => html`<div>${w.message}</div>`)}</div>`}
                ${preview?.after && html`<div class="panel"><b>Held after this entry (chapter ${entry.chapter})</b>${holdingsTable(preview.after, index)}</div>`}
                ${preview?.stats?.panel && html`<div class="panel"><div class="spread"><b>Stats panel after this entry</b><button class="small" onClick=${() => copyText(preview.stats.panel, "Copied stats panel")}>⧉ Copy</button></div>
                    <${CalloutRender} text=${preview.stats.panel} /></div>`}
            </div>
        </div>
    </div>`;
}

function CalloutRender({ text }) {
    const [out, setOut] = useState("");
    useEffect(() => {
        const t = setTimeout(() => api.send("POST", "/api/render", { markdown: text }).then((r) => setOut(r.html)).catch(() => {}), 200);
        return () => clearTimeout(t);
    }, [text]);
    return html`<${Html} html=${out} />`;
}

// ------------------------------------------------------------------ callout settings

function CalloutSettings({ folder }) {
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    const [draft, setDraft] = useState(null);
    const [err, setErr] = useState("");
    useEffect(() => { if (novel && !draft) setDraft(JSON.parse(JSON.stringify(novel.config["ledger-types"] ?? {}))); }, [novel]);
    if (!novel || !draft) return html`<${Loading} />`;
    const setCallout = (type, name, text) => setDraft((d) => ({ ...d, [type]: { ...(d[type] ?? {}), callouts: { ...(d[type]?.callouts ?? {}), [name]: text } } }));
    const removeCallout = (type, name) => setDraft((d) => { const c = { ...(d[type]?.callouts ?? {}) }; delete c[name]; return { ...d, [type]: { ...d[type], callouts: c } }; });
    const setDefault = (type, name) => setDraft((d) => ({ ...d, [type]: { ...(d[type] ?? {}), "default-callout": name || undefined } }));
    const save = async () => {
        setErr("");
        const clean = {};
        for (const [t, def] of Object.entries(draft)) {
            const x = { ...def };
            if (x.callouts && !Object.keys(x.callouts).length) delete x.callouts;
            if (!x["default-callout"]) delete x["default-callout"];
            if (Object.keys(x).length) clean[t] = x;
        }
        try {
            await api.send("PATCH", "/api/note", Object.keys(clean).length ? { path: novel.configPath, set: { "ledger-types": clean }, baseMtime: novel.configMtime } : { path: novel.configPath, unset: ["ledger-types"], baseMtime: novel.configMtime });
            toast("Saved to config.md");
            setDraft(null);
        } catch (e) { setErr(e.message); }
    };
    return html`<div>
        <div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div>
        <div class="spread"><h1>Callout templates</h1><a class="button" href="#/callout-design">Callout designer (how they look)</a></div>
        <p class="muted">Overrides are saved under <code>ledger-types</code> in <code>${novel.configPath}</code>. Shared defaults live in <code>90. Templater/Ledger Types.md</code>.</p>
        ${Object.values(novel.ledgerTypes).map((t) => {
            const own = draft[t.name]?.callouts ?? {};
            const names = [...new Set([...Object.keys(t.sharedCallouts), ...Object.keys(own)])];
            return html`<div class="panel">
                <div class="spread"><h2 style="margin:0">${t.name} <span class="badge">${t.behaviour}</span></h2>
                    <label class="row muted">Default variant <select value=${draft[t.name]?.["default-callout"] ?? ""} onChange=${(e) => setDefault(t.name, e.target.value)}>
                        <option value="">inherit (${t.sharedCallouts && t["default-callout"] ? t["default-callout"] : "default"})</option>${names.map((n) => html`<option>${n}</option>`)}</select></label></div>
                ${names.map((n) => html`<div style="margin-top:10px">
                    <div class="spread"><b>${n}</b>${n in own ? html`<span class="row"><span class="badge ok">novel override</span><${ConfirmButton} onConfirm=${() => removeCallout(t.name, n)}>Use shared<//></span>` : html`<span class="row"><span class="badge">shared</span><button class="small" onClick=${() => setCallout(t.name, n, t.sharedCallouts[n])}>Override for this novel</button></span>`}</div>
                    ${n in own ? html`<textarea value=${own[n]} onInput=${(e) => setCallout(t.name, n, e.target.value)} />` : html`<pre class="callout-text">${t.sharedCallouts[n]}</pre>`}
                </div>`)}
                <button class="small" style="margin-top:8px" onClick=${() => { const n = prompt("Variant name"); if (n) setCallout(t.name, n.trim(), "[!note] {{title}}\n{{body}}\n{{eventLink}}"); }}>+ New variant</button>
            </div>`;
        })}
        ${err && html`<p class="error">${err}</p>`}
        <div class="row"><button class="primary" onClick=${save}>Save</button><button onClick=${() => setDraft(null)}>Discard changes</button></div>
    </div>`;
}

// ------------------------------------------------------------------ QA

function QAView() {
    const { data, error } = useApi("/api/qa");
    if (!data) return html`<${Loading} error=${error} />`;
    const promote = async (m) => {
        const collection = prompt(`Create a data note for “${m.item}” in which collection? (Items or Materials)`, "Items");
        if (!collection) return;
        try { const r = await api.send("POST", "/api/promote-misc", { novel: m.novel, item: m.item, collection }); toast(`Created and relinked ${r.changed} lines`); }
        catch (e) { toast(e.message); }
    };
    const misc = new Map();
    for (const m of data.misc) { const k = `${m.novel}|${m.item.toLowerCase()}`; if (!misc.has(k)) misc.set(k, { ...m, count: 0 }); misc.get(k).count++; }
    const section = (title, list, row) => html`<div class="panel"><h3>${title} <span class="badge ${list.length ? "warn" : "ok"}">${list.length}</span></h3>${list.length ? html`<table><tbody>${list.slice(0, 300).map(row)}</tbody></table>` : html`<p class="muted">None.</p>`}</div>`;
    return html`<div>
        <h1>Quality checks</h1>
        ${section("Ledger problems", data.ledgers, (x) => html`<tr><td><a href=${noteHref(x.ledger)}>${x.ledger.split("/").pop()}</a></td><td>${x.entry}</td><td>${x.message}</td></tr>`)}
        ${section("Stat problems", data.stats ?? [], (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.name}</a></td><td class="muted">${x.novel}</td><td>${x.message}</td></tr>`)}
        ${section("Misc items (no data note)", [...misc.values()], (m) => html`<tr><td>${m.item}</td><td class="muted">${m.novel} · ${m.count} line${m.count > 1 ? "s" : ""}</td><td><button class="small" onClick=${() => promote(m)}>Create entry & relink</button></td></tr>`)}
        ${section("Unresolved links", data.unresolved, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path.split("/").pop()}</a></td><td>${x.field}</td><td>${x.value}</td></tr>`)}
        ${section("Name collisions", data.collisions, (x) => html`<tr><td>${x.name}</td><td>${x.paths.map((p) => html`<div><a href=${noteHref(p)}>${p}</a></div>`)}</td></tr>`)}
        ${section("Untitled notes", data.untitled, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path}</a></td></tr>`)}
        ${section("Unreadable frontmatter", data.fmErrors, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path}</a></td><td class="muted">${x.error}</td></tr>`)}
    </div>`;
}

// ------------------------------------------------------------------ settings

/** The vault folder: shown, typed or picked from a folder browser; switching reloads the app on the new vault */
/** How a speech colour shows in each theme: "Aa" on the light and the dark page */
function ThemeSwatches({ hex }) {
    const p = themePair(hex);
    return html`<span class="theme-swatches" title="Light mode / dark mode (the other theme gets the same colour with its brightness inverted)">
        <span style=${`background:#ffffff;color:${p.light}`}>Aa</span><span style=${`background:#1f1e23;color:${p.dark}`}>Aa</span></span>`;
}

/** Accent, fonts and sizes for this device; each change shows at once and is saved */
function AppearancePanel({ saved: raw }) {
    // a column width saved as a share of the writer (under 400, an earlier version) counts as unset
    const saved = raw?.writerWidth < 400 ? (({ writerWidth, ...rest }) => rest)(raw) : raw;
    const [a, setA] = useState(saved);
    const cur = useRef(saved); // the latest values, so quick changes in a row build on each other
    useEffect(() => { setA(saved); cur.current = saved; }, [JSON.stringify(saved)]);
    const timer = useRef();
    const change = (patch) => {
        const next = { ...cur.current, ...patch };
        cur.current = next;
        for (const k of Object.keys(patch)) if (patch[k] == null) delete next[k];
        setA(next);
        applyAppearance(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => api.send("POST", "/api/settings/appearance", next).catch((e) => toast(e.message)), 300);
    };
    const range = (k, min, max, step, def, fmt) => html`<div class="appearance-range">
        <input type="range" min=${min} max=${max} step=${step} value=${a[k] ?? def} onInput=${(e) => change({ [k]: Number(e.target.value) })} aria-label=${k} />
        <span>${fmt(a[k] ?? def)}</span>${a[k] != null && a[k] !== def ? html`<button class="small" onClick=${() => change({ [k]: null })}>Default</button>` : ""}</div>`;
    // buttons, not a slider: zooming the window moved a slider away from the pointer mid-drag
    const stepper = (k, min, max, step, def, fmt) => {
        const v = a[k] ?? def;
        const to = (x) => change({ [k]: Math.round(Math.min(max, Math.max(min, x)) * 100) / 100 });
        return html`<div class="appearance-range appearance-stepper">
            <button type="button" aria-label="Smaller" title="Smaller" disabled=${v <= min} onClick=${() => to(v - step)}>−</button>
            <span class="stepper-value">${fmt(v)}</span>
            <button type="button" aria-label="Larger" title="Larger" disabled=${v >= max} onClick=${() => to(v + step)}>+</button>
            ${a[k] != null && a[k] !== def ? html`<button class="small" onClick=${() => change({ [k]: null })}>Default</button>` : ""}</div>`;
    };
    return html`<div class="panel">
        <h3>Appearance <span class="muted" style="font-weight:400;font-size:13px">on this device</span></h3>
        <div class="appearance-grid">
            <label>App colour</label>
            <div class="accent-swatches" role="group" aria-label="App colour">
                ${ACCENTS.map((c) => html`<button type="button" style=${`--sw:${c}`} class=${(a.accent ?? "#6a4fc4").toLowerCase() === c ? "on" : ""} title=${c} aria-label=${`Colour ${c}`} onClick=${() => change({ accent: c === "#6a4fc4" ? null : c })} />`)}
                <input type="color" value=${a.accent ?? "#6a4fc4"} onInput=${(e) => change({ accent: e.target.value })} aria-label="Pick any colour" />
                <span class="muted small-note">Selections, buttons and highlights outside a novel (a novel's own colour wins on its pages)</span>
            </div>
            <label>Interface font</label>
            <select value=${a.uiFont ?? "system"} onChange=${(e) => change({ uiFont: e.target.value === "system" ? null : e.target.value })}>${Object.entries(UI_FONTS).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select>
            <label>Reading and writing font</label>
            <select value=${a.readFont ?? "serif"} onChange=${(e) => change({ readFont: e.target.value === "serif" ? null : e.target.value })}>${Object.entries(READ_FONTS).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select>
            <label>Interface size</label>${stepper("uiScale", 0.8, 1.4, 0.1, 1, (v) => `${Math.round(v * 100)}%`)}
            <label>Notes and docs text size</label>${range("readSize", 12, 22, 0.5, 15, (v) => `${v}px`)}
        </div>
        <div class="appearance-preview"><button class="primary">A button</button><span class="chip on">Selected</span><a href="#/settings">A link</a></div>
    </div>
    <div class="panel">
        <h3>Chapter text <span class="muted" style="font-weight:400;font-size:13px">the chapter writer, on this device</span></h3>
        <div class="appearance-grid">
            <label>Text size</label>${range("writerSize", 13, 28, 1, 18, (v) => `${v}px`)}
            <label>Paragraph spacing</label>${range("writerPara", 0, 2.5, 0.05, 0.55, (v) => `${Number(v).toFixed(2)} em`)}
            <label>Column width</label>
${range("writerWidth", 480, 1600, 20, 760, (v) => `${v}px`)}
            <label>Speech colour</label>
            <div class="appearance-range speech-colours">
                <label class="check"><input type="checkbox" checked=${!!a.speechColor} onChange=${(e) => change(e.target.checked ? { speechColor: "#2f6fb0" } : { speechColor: null })} /> Colour speech in quotes</label>
                ${a.speechColor && html`<input type="color" value=${a.speechColor} onInput=${(e) => change({ speechColor: e.target.value })} aria-label="Speech colour" /><${ThemeSwatches} hex=${a.speechColor} />`}
            </div>
            ${a.speechColor && [["speechSingle", "In 'single' quotes"], ["speechItalic", "All in italics"], ["speechBold", "All in bold"], ["speechBoldItalic", "All in bold italics"]].map(([k, l]) => html`
                <label>${l}</label>
                <div class="appearance-range speech-colours">
                    <label class="check"><input type="checkbox" checked=${!!a[k]} onChange=${(e) => change({ [k]: e.target.checked ? a.speechColor : null })} /> Own colour</label>
                    ${a[k] ? html`<input type="color" value=${a[k]} onInput=${(e) => change({ [k]: e.target.value })} aria-label=${l} /><${ThemeSwatches} hex=${a[k]} />` : html`<span class="muted small-note">${k === "speechBoldItalic" ? "as bold, else italics, else speech" : k === "speechSingle" ? "same as \"double\" quotes" : "same as speech"}</span>`}
                </div>`)}
            <label>Your own groupings</label>
            <div class="speech-groups">
                ${(a.speechGroups ?? []).map((g, k) => {
                    const set = (patch) => change({ speechGroups: (a.speechGroups ?? []).map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                    const mark = (key, label) => html`<input class="sg-mark" value=${g[key]} maxlength="4" aria-label=${label} title=${label} onInput=${(e) => set({ [key]: e.target.value.replace(/\s/g, "") })} />`;
                    return html`<div class="appearance-range speech-colours" key=${k}>
                        ${mark("open", "Opens with")}<span class="muted">text</span>${mark("close", "Closes with")}
                        <input type="color" value=${g.color} onInput=${(e) => set({ color: e.target.value })} aria-label="Colour" /><${ThemeSwatches} hex=${g.color} />
                        <button class="small" title="Remove this grouping" onClick=${() => change({ speechGroups: (a.speechGroups ?? []).filter((_, j) => j !== k) })}>×</button>
                    </div>`;
                })}
                ${(a.speechGroups ?? []).length < SPEECH_GROUPS && html`<div><button class="small" onClick=${() => change({ speechGroups: [...(a.speechGroups ?? []), { open: "[", close: "]", color: "#8a4fb8" }] })}>+ Add a grouping</button>
                    <span class="muted small-note">Text between your own marks, e.g. <code>[System notice]</code>, in its own colour (links and fields are left alone)</span></div>`}
            </div>
        </div>
        <div class="appearance-preview chapter-sample" style="font-family: var(--font-read, var(--serif)); font-size: var(--writer-size, 18px); line-height: 1.7">
            <p dangerouslySetInnerHTML=${{ __html: inlineHtml("The kettle had gone cold. \"You're late,\" Mara said, without looking up. *\"Again.\"*") }} />
            ${(a.speechGroups ?? []).some((g) => g.open && g.close) && html`<p dangerouslySetInnerHTML=${{ __html: inlineHtml(`The screen flickered. ${(a.speechGroups ?? []).filter((g) => g.open && g.close).map((g) => `${g.open}Level up!${g.close}`).join(" ")} "Finally," she breathed.`) }} />`}
            <p dangerouslySetInnerHTML=${{ __html: inlineHtml("'I know,' he said, and the dogs' leads tangled. **\"It won't happen twice.\"** ***\"Promise.\"***") }} />
        </div>
    </div>`;
}

function SettingsView({ settings }) {
    const [path, setPath] = useState(settings?.vault ?? "");
    const [browse, setBrowse] = useState(settings?.vault ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const { data: dir, error: dirError } = useApi(`/api/settings/folders?${qs({ path: browse })}`);
    useEffect(() => { if (settings?.vault && !path) { setPath(settings.vault); setBrowse(settings.vault); } }, [settings?.vault]);
    if (!settings) return html`<${Loading} />`;
    const use = async (folder) => {
        setBusy(true); setError(null);
        try {
            await api.send("POST", "/api/settings", { vault: folder });
            location.hash = "#/";
            location.reload();
        } catch (e) { setError(e.message); setBusy(false); }
    };
    const SOURCES = { settings: "chosen here", BOOKS_VAULT: "from the service settings (BOOKS_VAULT)", "--vault": "from the --vault option" };
    return html`<div class="settings">
        <h1>Settings</h1>
        <${AppearancePanel} saved=${settings.appearance ?? {}} />
        <${AiSettingsPanel} />
        <div class="panel">
            <h3>Vault folder</h3>
            ${settings.vault
                ? html`<p><code>${settings.vault}</code></p>
                    <p class="muted">${settings.notes} notes · ${SOURCES[settings.source] ?? settings.source}${settings.looksLikeVault ? "" : " · no .obsidian folder here, so Obsidian hasn't opened it as a vault"}</p>
                    ${!settings.hasSchema && html`<p class="muted">This vault has no <code>90. Templater/Data Store Schema.md</code> yet. <a href="#/import">Import a dataset</a> (for example the Novel Craft starter data) to add the schema, ledger types and a basic taxonomy.</p>`}
                    ${settings.overridden && html`<p class="muted">The app was started with <code>--vault</code>, which wins over a folder chosen here when it restarts.</p>`}`
                : html`<p>${settings.problem ?? "No vault folder chosen yet."} Choose your Obsidian vault below.</p>`}
            <div class="row settings-path">
                <input type="text" value=${path} placeholder="/path/to/Obsidian/vault" aria-label="Vault folder" onInput=${(e) => setPath(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && path.trim() && use(path.trim())} />
                <button class="primary" disabled=${busy || !path.trim() || path.trim() === settings.vault} onClick=${() => use(path.trim())}>${busy ? "Opening…" : "Use this folder"}</button>
            </div>
            ${error && html`<p class="error">${error}</p>`}
            <p class="muted">Saved in <code>${settings.settingsFile}</code>, so it is kept when the app restarts.</p>
        </div>
        <div class="panel folder-picker">
            <h3>Browse</h3>
            ${dirError && html`<p class="error">${dirError}</p>`}
            ${dir && html`<div class="row">
                    <button class="small" disabled=${!dir.parent} onClick=${() => setBrowse(dir.parent)}>↑ Up</button>
                    <button class="small" onClick=${() => setBrowse(dir.home)}>Home</button>
                    <code class="picker-here">${dir.path}</code>
                    <button class="small" onClick=${() => setPath(dir.path)}>Choose this folder</button>
                </div>
                <ul class="folders">
                    ${dir.folders.map((f) => html`<li><button class="link" onClick=${() => setBrowse(f.path)}>${f.name}</button>${f.vault && html` <span class="badge ok">vault</span>`}
                        ${f.vault && html` <button class="small" onClick=${() => setPath(f.path)}>Choose</button>`}</li>`)}
                    ${!dir.folders.length && html`<li class="muted">No folders here.</li>`}
                </ul>`}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ app

function App() {
    const route = useRoute();
    const { data: settings } = useApi("/api/settings");
    const noVault = settings && !settings.vault;
    const index = useIndex(!noVault);
    useEffect(() => { if (settings) applyAppearance(settings.appearance); }, [settings]);
    useCalloutStyles(!!settings && !noVault);
    const [novelFilter, setNovelFilter] = useState(store.get("novelFilter", ""));
    const setNF = (v) => { setNovelFilter(v); store.set("novelFilter", v); };
    const [a, b] = route.args;
    const writer = useWriter();
    // a new page collapses both drawers, but not the first one: that is where you were when the app closed
    const firstRoute = useRef(true);
    useScrollMemory(window, `page:${location.hash}`, { restore: onStartPage() });
    useEffect(() => {
        try { localStorage.setItem("lastHash", location.hash); } catch { /* private window */ }
        if (firstRoute.current) { firstRoute.current = false; return; }
        collapseDrawer(); collapseWriter();
    }, [location.hash]);
    const d = useDrawer();
    // the novel you're in tints the app; data store pages follow the novel filter
    const novelFolder = !index ? null
        : ["novel", "owner", "chapter", "entry", "callouts", "newchar"].includes(route.name) ? a
        : route.name === "note" || route.name === "edit" ? index.novels.find((n) => a?.startsWith(`${n.folder}/`))?.folder ?? null
        : index.novels.find((n) => n.name === novelFilter)?.folder ?? null;
    // the drawer's novel tab: the novel the page belongs to (not the data store filter), else the chapter being written
    const inNovel = !index ? null
        : ["novel", "owner", "chapter", "entry", "callouts", "newchar"].includes(route.name) ? (index.novels.some((n) => n.folder === a) ? a : null)
        : route.name === "note" || route.name === "edit" ? index.novels.find((n) => a?.startsWith(`${n.folder}/`))?.folder ?? null
        : null;
    const drawerNovel = inNovel ?? (writer.folder && (writer.open || d.open) ? writer.folder : null);
    const accent = novelColour(index, novelFolder ?? (writer.open ? writer.folder : null));
    useEffect(() => applyNovelAccent(accent), [accent]);
    let view;
    switch (route.name) {
        case "c": view = html`<${CollectionView} index=${index} collection=${a} novelFilter=${novelFilter} />`; break;
        case "edit": // old edit links: notes are editable on their page
        case "note": view = html`<${NoteView} key=${a} index=${index} path=${a} />`; break;
        case "new": view = html`<${NoteForm} key=${a} index=${index} collection=${a} />`; break;
        case "newrecipe": view = html`<${RecipeCreator} key=${a} index=${index} item=${a} />`; break;
        case "newchar": view = html`<${NoteForm} key=${a} index=${index} collection="characters" novel=${a} />`; break;
        case "novel": view = html`<${NovelView} key=${a} folder=${a} />`; break;
        case "owner": view = html`<${OwnerView} key=${a + b} index=${index} folder=${a} owner=${b} params=${route.params} />`; break;
        case "chapter": view = html`<${ChapterView} key=${a + b} folder=${a} n=${b} />`; break;
        case "entry": view = html`<${EntryEditor} key=${location.hash} index=${index} folder=${a} params=${route.params} />`; break;
        case "callouts": view = html`<${CalloutSettings} key=${a} folder=${a} />`; break;
        case "qa": view = html`<${QAView} />`; break;
        case "callout-design": view = html`<${CalloutDesigner} />`; break;
        case "import": view = html`<${ImportView} />`; break;
        case "map-assets": view = html`<${MapAssetsView} />`; break;
        case "proposal": view = html`<${ProposalView} id=${a} />`; break;
        case "docs": view = html`<${DocsView} page=${a ?? null} section=${route.params.get("s")} />`; break;
        case "settings": view = html`<${SettingsView} settings=${settings} />`; break;
        case "world": view = html`<${WorldView} key=${a ?? ""} index=${index} world=${a ?? null} params=${route.params} />`; break;
        case "map": view = html`<${MapEditor} key=${a} index=${index} location=${a} />`; break;
        default: view = html`<${Home} index=${index} />`;
    }
    // no vault folder yet: the Settings page is all there is
    if (noVault && route.name !== "docs") view = html`<${SettingsView} settings=${settings} />`;
    // the writer sits beside the open drawer; while the writer slides away it keeps the width it had
    const beside = useRef(false);
    if (writer.open) beside.current = d.open;
    // while a drawer covers the page, the page behind it doesn't scroll (its scrollbar would move nothing you can see)
    useEffect(() => { document.documentElement.classList.toggle("covered", d.open || writer.open); }, [d.open, writer.open]);
    return html`<div class=${`layout ${writer.open ? "writing" : ""} ${d.open ? "drawer-open" : ""} ${beside.current ? "writer-beside" : ""}`}>
        <${Sidebar} index=${index} novelFolder=${novelFolder} />
        <main class="main">
            ${route.name === "docs" ? "" : TOOL_PAGES.has(route.name)
                // the Tools pages have nothing to search or filter by novel: only the assistant's button, in the corner
                ? html`<div class="topbar-float"><button class="bot-button" title="AI assistant" aria-label="AI assistant" onClick=${toggleAi}><${BotIcon} /></button></div>`
                : html`<div class="topbar"><${Search} index=${index} /><${NovelFilter} index=${index} value=${novelFilter} onChange=${setNF} /><span class="grow" /><button class="bot-button" title="AI assistant" aria-label="AI assistant" onClick=${toggleAi}><${BotIcon} /></button></div>`}
            <div class=${`view view-${route.name}`} key=${route.name === "docs" ? "docs" : route.name + (a ?? "")}><${ErrorBoundary} reset=${location.hash}>${view}<//></div>
        </main>
        ${!noVault && html`<div class=${`drawer-backdrop ${d.open || writer.open ? "on" : ""}`} onClick=${() => { collapseDrawer(); collapseWriter(); }} />
        <${WriterDrawer} index=${index} />
        <${Drawer} index=${index} novel=${drawerNovel} />`}
    </div>`;
}

render(html`<${App} />`, document.getElementById("app"));

// shared with world.js and map-editor.js (used only inside components, so the import cycle is safe)
export { api, useApi, qs, toast, store, go, noteHref, linkLabel, isLink, asList, openInDrawer, openDrawerTab, renameInDrawer, ConfirmButton, markDirty, confirmDiscard, Loading, useRoute, RenameDialog, Html, fieldInput, useNovelLinks, copyText };
