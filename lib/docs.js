// The app's own docs (Tools → Docs): markdown pages in docs/ with frontmatter {title, group, kind: guide|reference,
// blurb, order}, screenshots in docs/img/. Rendered here with the docs' link kinds:
//   [text](docs:page#section)  another page          [text](ref:page#section)  a reference, opens beside the page
//   [text](app:#/import)       a place in the app    [text](https://…)         the web
// A paragraph that is only an image becomes a numbered figure with its alt text as the caption.
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import YAML from "yaml";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, "").replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export class Docs {
    constructor(dir) { this.dir = dir; this.cache = new Map(); this.meta = null; }

    /** docs/index.json: {groups: [names in order], start: [page ids for "Start here"]} */
    index() {
        let idx = { groups: [], start: [] };
        try { idx = JSON.parse(fs.readFileSync(path.join(this.dir, "index.json"), "utf8")); } catch { /* none */ }
        const pages = fs.existsSync(this.dir) ? fs.readdirSync(this.dir).filter((f) => f.endsWith(".md")).map((f) => this.page(f.slice(0, -3), false)) : [];
        const rank = (g) => { const i = idx.groups.indexOf(g); return i < 0 ? 99 : i; };
        pages.sort((a, b) => rank(a.group) - rank(b.group) || (a.order ?? 50) - (b.order ?? 50) || a.title.localeCompare(b.title));
        const groups = [...new Set([...idx.groups, ...pages.map((p) => p.group)])].filter((g) => pages.some((p) => p.group === g));
        return { groups, start: (idx.start ?? []).filter((id) => pages.some((p) => p.id === id)), pages };
    }

    /** One page: frontmatter, sections (h2/h3) and, with `withHtml`, its rendered body and plain text */
    page(id, withHtml = true) {
        if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error("No such page"), { status: 404 });
        const file = path.join(this.dir, `${id}.md`);
        let st;
        try { st = fs.statSync(file); } catch { throw Object.assign(new Error(`No docs page ${id}`), { status: 404 }); }
        const hit = this.cache.get(id);
        if (hit && hit.mtime === st.mtimeMs) return withHtml ? hit.page : hit.meta;
        const text = fs.readFileSync(file, "utf8");
        const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
        const fm = m ? YAML.parse(m[1]) ?? {} : {};
        const body = m ? text.slice(m[0].length) : text;
        const { html, sections, plain } = render(body);
        const meta = { id, title: fm.title ?? id, group: fm.group ?? "Other", kind: fm.kind === "reference" ? "reference" : "guide", blurb: fm.blurb ?? "", order: fm.order, minutes: Math.max(1, Math.round(plain.split(/\s+/).length / 220)), sections };
        const page = { ...meta, html, plain };
        this.cache.set(id, { mtime: st.mtimeMs, meta, page });
        return withHtml ? page : meta;
    }

    /** Pages (and the section within them) whose text has every word, with a snippet around the first */
    search(q) {
        const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        const out = [];
        for (const meta of this.index().pages) {
            const p = this.page(meta.id);
            const hay = `${p.title} ${p.blurb} ${p.plain}`.toLowerCase();
            if (!words.every((w) => hay.includes(w))) continue;
            // the section the first word is in
            const at = p.plain.toLowerCase().indexOf(words[0]);
            const section = at < 0 ? null : [...p.sections].reverse().find((s) => s.at <= at) ?? null;
            const a = Math.max(0, at - 70), b = Math.min(p.plain.length, at + 110);
            const snippet = at < 0 ? p.blurb : `${a > 0 ? "…" : ""}${p.plain.slice(a, b).replace(/\s+/g, " ").trim()}${b < p.plain.length ? "…" : ""}`;
            const score = (p.title.toLowerCase().includes(words.join(" ")) ? 100 : 0) + (`${p.title} ${p.blurb}`.toLowerCase().includes(words[0]) ? 20 : 0) + Math.min(10, hay.split(words[0]).length);
            out.push({ id: p.id, title: p.title, group: p.group, kind: p.kind, section: section && { id: section.id, text: section.text }, snippet, score });
        }
        return out.sort((x, y) => y.score - x.score).slice(0, 30);
    }
}

function render(md) {
    const sections = [];
    let plain = "";
    let figure = 0;
    const renderer = new marked.Renderer();
    renderer.heading = function ({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        const id = slug(text);
        if (depth === 2 || depth === 3) sections.push({ id, text: inner.replace(/<[^>]+>/g, ""), level: depth, at: plain.length });
        plain += `\n${text.replace(/[`*_]/g, "")}\n`;
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    };
    renderer.link = function ({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const t = title ? ` title="${esc(title)}"` : "";
        let m;
        if ((m = /^docs:([\w-]+)(?:#([\w-]+))?$/.exec(href))) return `<a class="doc-link" href="#/docs/${m[1]}${m[2] ? `?s=${m[2]}` : ""}"${t}>${inner}</a>`;
        if ((m = /^ref:([\w-]+)(?:#([\w-]+))?$/.exec(href))) return `<a class="ref-link" data-ref href="#/docs/${m[1]}${m[2] ? `?s=${m[2]}` : ""}"${t} title="Opens beside this page">${inner}</a>`;
        if ((m = /^app:(#\/.*)$/.exec(href))) return `<a class="app-link" href="${esc(m[1])}" data-page${t}>${inner}</a>`;
        if (/^https?:/.test(href)) return `<a class="ext-link" href="${esc(href)}" target="_blank" rel="noopener"${t}>${inner}</a>`;
        return `<a href="${esc(href)}"${t}>${inner}</a>`;
    };
    renderer.paragraph = function ({ tokens }) {
        // a paragraph that is only an image: a numbered figure
        if (tokens.length === 1 && tokens[0].type === "image") {
            const img = tokens[0];
            figure++;
            const src = img.href.startsWith("img/") ? `/docs/${img.href}` : img.href;
            plain += `\n${img.text}\n`;
            return `<figure class="doc-fig"><img src="${esc(src)}" alt="${esc(img.text)}" loading="lazy"><figcaption><b>${figure}</b> · ${esc(img.text)}</figcaption></figure>\n`;
        }
        const inner = this.parser.parseInline(tokens);
        plain += `\n${inner.replace(/<[^>]+>/g, "")}\n`;
        return `<p>${inner}</p>\n`;
    };
    renderer.listitem = function (item) {
        const inner = this.parser.parse(item.tokens, !!item.loose);
        plain += `\n${inner.replace(/<[^>]+>/g, "")}\n`;
        return `<li>${inner}</li>\n`;
    };
    renderer.tablecell = function (token) {
        const inner = this.parser.parseInline(token.tokens);
        plain += ` ${inner.replace(/<[^>]+>/g, "")}`;
        const tag = token.header ? "th" : "td";
        return `<${tag}${token.align ? ` style="text-align:${token.align}"` : ""}>${inner}</${tag}>\n`;
    };
    // > [!tip] / [!note] / [!warning] Title  ->  a note box
    const pre = md.replace(/^> \[!(tip|note|warning)\][ \t]*(.*)\n((?:>.*\n?)*)/gm, (_w, kind, title, rest) => {
        const text = rest.split("\n").map((l) => l.replace(/^> ?/, "")).join("\n").trim();
        return `<div class="doc-note ${kind}"><b>${esc(title || kind[0].toUpperCase() + kind.slice(1))}.</b> ${marked.parseInline(text, { renderer })}</div>\n\n`;
    });
    const html = marked.parse(pre, { renderer, gfm: true });
    return { html, sections, plain };
}
