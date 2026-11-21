// Docs (Tools → Docs, #/docs and #/docs/<page>?s=<section>): grouped contents that fold like the sidebar, with the open
// page's sections under it (B), and a search that turns the contents into matches with snippets, split into guides and
// references (C). Pages render on the server (lib/docs.js); a reference link opens the page beside this one, in the drawer.
import { h } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";
import { useApi, store, go, Loading, openInDrawer } from "./app.js";

const html = htm.bind(h);
const pageHref = (id, s) => `#/docs/${id}${s ? `?s=${s}` : ""}`;
const KIND = { guide: "Guide", reference: "Reference" };

export function DocsView({ page, section }) {
    const { data: idx, error } = useApi("/api/docs");
    const [active, setActive] = useState(section ?? null);
    useEffect(() => setActive(section ?? null), [page, section]);
    if (!idx) return html`<${Loading} error=${error} />`;
    return html`<div class="docs-layout">
        <${DocsNav} idx=${idx} current=${page} active=${active} />
        <main class="docs-main">
            ${page ? html`<${DocArticle} key=${page} id=${page} section=${section} onActive=${setActive} idx=${idx} />` : html`<${DocsHome} idx=${idx} />`}
        </main>
    </div>`;
}

/** "a b" -> text with every word marked */
function Marked({ text, words }) {
    if (!words.length || !text) return text ?? "";
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((part, i) => (i % 2 ? html`<mark>${part}</mark>` : part));
}

function DocsNav({ idx, current, active }) {
    const [q, setQ] = useState("");
    const [term, setTerm] = useState("");
    const [kind, setKind] = useState("guide");
    const [closed, setClosedState] = useState(() => new Set(store.get("docsClosed", [])));
    const setClosed = (s) => { setClosedState(s); store.set("docsClosed", [...s]); };
    const input = useRef();
    useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 180); return () => clearTimeout(t); }, [q]);
    const { data: found } = useApi(term ? `/api/docs/search?q=${encodeURIComponent(term)}` : null);
    // "/" anywhere on the docs page (not while typing) goes to the search
    useEffect(() => {
        const f = (e) => { if (e.key === "/" && !e.target.closest?.("input, textarea, select, [contenteditable]")) { e.preventDefault(); input.current?.focus(); } };
        addEventListener("keydown", f);
        return () => removeEventListener("keydown", f);
    }, []);
    const curPage = idx.pages.find((p) => p.id === current);
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    const results = (found?.results ?? []).filter((r) => r.kind === kind);
    const other = (found?.results ?? []).length - results.length;
    return html`<nav class="docs-nav" aria-label="Docs contents">
        <label class="docs-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input ref=${input} type="search" value=${q} placeholder="Search the docs" aria-label="Search the docs"
                onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); setQ(""); } if (e.key === "Enter" && results[0]) go(pageHref(results[0].id, results[0].section?.id)); }} />
            <kbd>/</kbd>
        </label>
        ${term ? html`<div class="docs-results">
            <div class="docs-kinds" role="group" aria-label="Show">${["guide", "reference"].map((k) => html`<button type="button" class=${kind === k ? "on" : ""} aria-pressed=${kind === k} onClick=${() => setKind(k)}>${k === "guide" ? "Guides" : "Reference"}</button>`)}</div>
            <div class="docs-count">${!found ? "Searching…" : `${results.length} ${results.length === 1 ? "page matches" : "pages match"} “${term}”${other ? ` · ${other} in ${kind === "guide" ? "reference" : "guides"}` : ""}`}</div>
            ${results.map((r) => html`<a key=${r.id + (r.section?.id ?? "")} class=${`docs-hit ${r.id === current ? "on" : ""}`} href=${pageHref(r.id, r.section?.id)}>
                <b><${Marked} text=${r.title} words=${words} /></b>
                ${r.section && html`<span class="where">${r.section.text}</span>`}
                <span class="snip"><${Marked} text=${r.snippet} words=${words} /></span>
            </a>`)}
        </div>` : html`
            <a class=${`docs-home-link ${current ? "" : "on"}`} href="#/docs" aria-current=${current ? undefined : "page"}>Docs home</a>
            ${idx.groups.map((g) => {
                const pages = idx.pages.filter((p) => p.group === g);
                const open = curPage?.group === g || !closed.has(g);
                return html`<div class="docs-group" key=${g}>
                    <button type="button" class="docs-group-head" aria-expanded=${open}
                        onClick=${() => { const s = new Set(closed); if (open) s.add(g); else s.delete(g); setClosed(s); }}>
                        <span class="caret" aria-hidden="true">▸</span>${g}<span class="n">${pages.length}</span></button>
                    ${open && pages.map((p) => html`<div key=${p.id}>
                        <a class=${`docs-page ${p.id === current ? "on" : ""}`} href=${pageHref(p.id)} aria-current=${p.id === current ? "page" : undefined}>
                            ${p.title}${p.kind === "reference" ? html`<span class="ref">REF</span>` : ""}</a>
                        ${p.id === current && p.sections.length > 0 && html`<ul class="docs-sections">${p.sections.map((s) => html`<li key=${s.id} class=${`h${s.level}`}>
                            <a class=${active === s.id ? "on" : ""} href=${pageHref(p.id, s.id)}>${s.text}</a></li>`)}</ul>`}
                    </div>`)}
                </div>`;
            })}`}
    </nav>`;
}

function DocsHome({ idx }) {
    const byId = useMemo(() => new Map(idx.pages.map((p) => [p.id, p])), [idx]);
    return html`<article class="doc-prose doc-home">
        <p class="doc-kicker">Novel Craft docs</p>
        <h1>How to use Novel Craft</h1>
        <p class="doc-lead">Guides walk through a task from start to finish with screenshots. References list every field, option and shortcut of one part of the app. Pick a topic, or search with <kbd>/</kbd>.</p>
        ${idx.start.length > 0 && html`<h2>Start here</h2>
            <div class="doc-cards three">${idx.start.map((id, i) => { const p = byId.get(id); return p && html`<a key=${id} class="doc-card start" href=${pageHref(id)}>
                <span class="step">Step ${i + 1}</span><b>${p.title}</b><span>${p.blurb}</span></a>`; })}</div>`}
        ${idx.groups.map((g) => html`<section key=${g}>
            <h2>${g}</h2>
            <div class="doc-cards">${idx.pages.filter((p) => p.group === g).map((p) => html`<a key=${p.id} class="doc-card" href=${pageHref(p.id)}>
                <b>${p.title}<span class=${`kind ${p.kind}`}>${KIND[p.kind]}</span></b><span>${p.blurb}</span></a>`)}</div>
        </section>`)}
    </article>`;
}

/**
 * One docs page. On the docs page it scrolls to `section` and reports the section being read (`onActive`); in the drawer
 * (`scope="drawer"`) links to other pages stay in the drawer. Reference links open beside the page, in the drawer.
 */
export function DocArticle({ id, section, onActive, scope = "page", idx }) {
    const { data: p, error } = useApi(`/api/docs/page?id=${encodeURIComponent(id)}`);
    const ref = useRef();
    const [big, setBig] = useState(null);
    useEffect(() => {
        if (!p || !ref.current) return;
        const el = section && [...ref.current.querySelectorAll("[id]")].find((x) => x.id === section);
        if (el) el.scrollIntoView?.({ block: "start" });
        else if (scope === "page") ref.current.closest(".main, .docs-main")?.scrollTo?.(0, 0);
    }, [p, section]);
    // which section is being read: the last heading above the upper third of the view
    useEffect(() => {
        if (!p || !onActive || typeof IntersectionObserver !== "function" || !ref.current) return;
        const heads = [...ref.current.querySelectorAll("h2[id], h3[id]")];
        const seen = new Map();
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) seen.set(e.target.id, e.isIntersecting);
            const first = heads.find((hd) => seen.get(hd.id));
            if (first) onActive(first.id);
        }, { rootMargin: "0px 0px -66% 0px" });
        heads.forEach((hd) => io.observe(hd));
        return () => io.disconnect();
    }, [p]);
    if (!p) return html`<${Loading} error=${error} />`;
    const onClick = (e) => {
        const img = e.target.closest?.(".doc-fig img");
        if (img) { setBig(img.getAttribute("src")); return; }
        const a = e.target.closest?.("a[href^='#/docs/']");
        if (!a || e.ctrlKey || e.metaKey || e.button) return;
        if (a.hasAttribute("data-ref") || scope === "drawer") { e.preventDefault(); openInDrawer(a.getAttribute("href")); }
    };
    const pageInfo = idx?.pages.find((x) => x.id === id);
    return html`<article class=${`doc-prose ${scope === "drawer" ? "in-drawer" : ""}`} ref=${ref} onClick=${onClick}>
        <div class="doc-head">
            <p class=${`doc-kicker ${p.kind}`}>${KIND[p.kind]} · ${p.group}</p>
            ${scope === "page" ? html`<button class="doc-pill" onClick=${() => openInDrawer(pageHref(id))} title="Keep this page open beside the app">Open in the drawer</button>`
                : html`<a class="doc-pill" href=${pageHref(id)} data-page>Open in the docs</a>`}
        </div>
        <h1>${p.title}</h1>
        <p class="doc-byline">${p.minutes} minute${p.minutes === 1 ? "" : "s"}${pageInfo?.kind === "guide" || p.kind === "guide" ? " · screenshots use the sample novels" : ""}</p>
        ${p.blurb && html`<p class="doc-lead">${p.blurb}</p>`}
        <div class="doc-body" dangerouslySetInnerHTML=${{ __html: p.html }} />
        ${big && html`<div class="lightbox" onClick=${() => setBig(null)}><img src=${big} alt="" /></div>`}
    </article>`;
}
