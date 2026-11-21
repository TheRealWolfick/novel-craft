#!/usr/bin/env node
// Write the Obsidian CSS snippet for Novel Craft's callouts (system, status, sysnotify, inventory, item, blueprint,
// journal, pencil): the built-in looks, or with --vault the looks as saved in that vault's callout designer.
//
//   node scripts/obsidian-snippets.js [--vault <vault folder>] [--out <file>]
//
// Without --out it writes obsidian/world-builder-callouts.css in this repo. The snippet goes in the vault's
// .obsidian/snippets/ folder (turn it on under Settings → Appearance → CSS snippets).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { mergeStyles, obsidianCss } from "../public/callout-style.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const vault = arg("--vault");
const out = arg("--out") ?? path.join(here, "..", "obsidian", "world-builder-callouts.css");

let saved = {};
if (vault) {
    const file = path.join(vault, "90. Templater", "Callout Styles.md");
    if (fs.existsSync(file)) {
        const fm = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1];
        saved = (fm && YAML.parse(fm)?.["callout-styles"]) || {};
    }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, obsidianCss(mergeStyles(saved)));
console.log(`wrote ${out}${vault ? ` (with the styles saved in ${vault})` : ""}`);
