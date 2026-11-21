// Callout designer (#/callout-design): how each callout type looks in the app (the writer, notes, previews), saved
// in `90. Templater/Callout Styles.md`. Also keeps the generated stylesheet in the page up to date.
import { h } from "preact";
import { useState, useEffect, useMemo } from "preact/hooks";
import htm from "htm";
import { api, useApi, toast, store, Loading, ConfirmButton, markDirty, copyText } from "./app.js";
import { STYLE_GROUPS, TEXT_ELEMENTS, COLOR_KEYS, DEFAULT_STYLES, BASE_STYLE, calloutCss, compactStyles, sampleFor, richSampleFor, obsidianCss } from "./callout-style.js";

const html = htm.bind(h);

/** Put a stylesheet in the page under an id (replacing the previous one) */
export function setStyleSheet(id, css) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
    if (el.textContent !== css) el.textContent = css;
}

/** The saved callout styles as the page's stylesheet (call once, in the app) */
export function useCalloutStyles(enabled = true) {
    const { data } = useApi(enabled ? "/api/callout-styles" : null);
    useEffect(() => { if (data) setStyleSheet("callout-styles", calloutCss(data.styles)); }, [data]);
}

const PARA_BEFORE = "The corridor smelled of oil and old smoke. Wade stopped at the door, listening for anything beyond the hum of the lamps, then pushed it open.";
const PARA_AFTER = "He read it twice before the words settled. Somewhere behind him a pipe knocked, once, and fell silent.";
const clone = (v) => JSON.parse(JSON.stringify(v));

export function CalloutDesigner() {
    const { data, error } = useApi("/api/callout-styles");
    const [draft, setDraft] = useState(null);
    const [base, setBase] = useState(null); // what was loaded, to tell changes
    const [type, setType] = useState(store.get("coType", "system"));
    const [mode, setMode] = useState("light");
    const [busy, setBusy] = useState(false);
    const [find, setFind] = useState("");
    const [element, setElementState] = useState(() => store.get("coElement", "p"));
    const setElement = (e) => { setElementState(e); store.set("coElement", e); };
    const [openGroups, setOpenGroups] = useState(() => new Set(store.get("coGroups", ["Box", "Title", "Text elements"])));
    const toggleGroup = (g) => setOpenGroups((o) => { const n = new Set(o); n.has(g) ? n.delete(g) : n.add(g); store.set("coGroups", [...n]); return n; });
    useEffect(() => { if (data && !draft) { setDraft(clone(data.styles)); setBase(JSON.stringify(data.styles)); } }, [data]);
    const dirty = !!draft && JSON.stringify(draft) !== base;
    useEffect(() => markDirty("page", "callout-design", dirty), [dirty]);
    useEffect(() => () => markDirty("page", "callout-design", false), []);
    const previewCss = useMemo(() => (draft ? calloutCss(draft, { scope: ".co-preview" }) : ""), [draft]);
    if (!draft) return html`<${Loading} error=${error} />`;
    const types = Object.keys(draft).sort((a, b) => (a === "default" ? -1 : b === "default" ? 1 : a === "quote" ? -1 : b === "quote" ? 1 : a.localeCompare(b)));
    const cur = draft[type] ? type : types[0];
    const st = draft[cur];
    const pick = (t) => { setType(t); store.set("coType", t); };
    const set = (k, v) => setDraft((d) => {
        const s = { ...d[cur] };
        if (mode === "dark" && COLOR_KEYS.has(k)) s.dark = { ...s.dark, [k]: v };
        else s[k] = v;
        return { ...d, [cur]: s };
    });
    const clearDark = (k) => setDraft((d) => { const dark = { ...d[cur].dark }; delete dark[k]; return { ...d, [cur]: { ...d[cur], dark } }; });
    const valueOf = (k) => (mode === "dark" && COLOR_KEYS.has(k) && st.dark?.[k] ? st.dark[k] : st[k]);
    const addType = () => {
        const name = prompt("Callout type (the word in > [!type])")?.trim().toLowerCase().replace(/[^\w-]/g, "");
        if (!name) return;
        if (draft[name]) return pick(name);
        setDraft({ ...draft, [name]: { ...clone(st), label: name[0].toUpperCase() + name.slice(1) } });
        pick(name);
        toast(`New type ${name}, starting from ${st.label || cur}`);
    };
    const duplicate = () => {
        const name = prompt("Name of the copy (callout type)", `${cur}-2`)?.trim().toLowerCase().replace(/[^\w-]/g, "");
        if (!name || draft[name]) return;
        setDraft({ ...draft, [name]: { ...clone(st), label: `${st.label || cur} (copy)` } });
        pick(name);
    };
    const reset = () => setDraft({ ...draft, [cur]: { ...clone(BASE_STYLE), ...clone(DEFAULT_STYLES[cur]), dark: clone(DEFAULT_STYLES[cur].dark ?? {}) } });
    const remove = () => { const d = { ...draft }; delete d[cur]; setDraft(d); pick("default"); };
    const save = async () => {
        setBusy(true);
        try {
            await api.send("POST", "/api/callout-styles", { styles: compactStyles(draft), baseMtime: data.mtime ?? undefined });
            setBase(JSON.stringify(draft));
            toast("Callout styles saved");
        } catch (e) { toast(e.message); }
        setBusy(false);
    };
    const sampleKey = `coSample:${cur}`;
    // the list: built-in looks, then your own types; the filter matches names and type words
    const q = find.trim().toLowerCase();
    const shown = types.filter((t) => !q || t.includes(q) || String(draft[t].label ?? "").toLowerCase().includes(q));
    const groups = [["Built in", shown.filter((t) => DEFAULT_STYLES[t])], ["Your types", shown.filter((t) => !DEFAULT_STYLES[t])]].filter(([, ts]) => ts.length);
    const swatch = (t) => { const x = draft[t], c = (k) => (mode === "dark" && x.dark?.[k]) || x[k]; return `background:${c("background") ? `linear-gradient(135deg, ${c("background")}, ${c("background2") || c("background")})` : "transparent"};border-color:${c("barColor") || c("borderColor") || "var(--line)"}`; };
    return html`<div class="co-shell" onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) save(); } }}>
        <style>${previewCss}</style>
        <nav class="co-nav" aria-label="Callout types">
            <div class="co-nav-head">Callouts <span class="muted">${types.length}</span></div>
            <label class="docs-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input type="search" placeholder="Find a callout" value=${find} onInput=${(e) => setFind(e.target.value)} aria-label="Find a callout" /></label>
            ${groups.map(([g, ts]) => html`<div class="docs-group" key=${g}>
                <div class="docs-group-head">${g}<span class="n">${ts.length}</span></div>
                ${ts.map((t) => html`<button key=${t} class=${`co-type ${t === cur ? "on" : ""}`} onClick=${() => pick(t)}>
                    <span class="co-swatch" style=${swatch(t)} aria-hidden="true" />
                    <span class="co-type-name">${draft[t].label || t}</span><code>${t === "default" ? "any" : t === "quote" ? ">" : t}</code></button>`)}
            </div>`)}
            ${!groups.length && html`<p class="muted small-note">No callout matches.</p>`}
            <button class="co-add" onClick=${addType}>+ New type</button>
        </nav>
        <div class="co-main">
            <div class="co-head">
                <h1>Callout designer</h1>
                <p class="muted" style="margin-top:0">How callouts look in the writer, notes and previews. Saved in <code>${data.note}</code>. Colours can differ in dark mode; text sizes are multiples of the chapter text size (Settings → Chapter text).</p>
                <div class="row co-actions">
                    <button title="These looks as an Obsidian CSS snippet: save it in the vault's .obsidian/snippets folder and turn it on under Settings → Appearance → CSS snippets"
                        onClick=${() => copyText(obsidianCss(draft), "Copied the Obsidian snippet: save it as .obsidian/snippets/world-builder-callouts.css")}>Copy Obsidian snippet</button>
                    <span class="grow" />
                    <button disabled=${!dirty} onClick=${() => setDraft(JSON.parse(base))}>Discard</button>
                    <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save styles"}</button>
                </div>
            </div>
            <div class="co-work">
                <section class="co-form panel">
                    <div class="co-form-head">
                        <div><h2 style="margin:0">${st.label || cur}</h2><code class="muted">${cur === "default" ? "any other callout" : cur === "quote" ? "> plain quote" : `> [!${cur}]`}</code></div>
                        <div class="co-seg" role="group" aria-label="Edit colours for">${[["light", "Light"], ["dark", "Dark"]].map(([m, l]) => html`<button class=${mode === m ? "on" : ""} aria-pressed=${mode === m} onClick=${() => setMode(m)}>${l}</button>`)}</div>
                    </div>
                    ${mode === "dark" && html`<p class="muted small-note co-dark-note">Editing dark mode colours. Colours you leave alone use the light mode ones.</p>`}
                    <div class="co-field"><span>Name</span><input value=${st.label ?? ""} onInput=${(e) => set("label", e.target.value)} /></div>
                    ${STYLE_GROUPS.map(([group, fields]) => html`<section class=${`co-group ${openGroups.has(group) ? "open" : ""}`} key=${group}>
                        <button class="co-group-head" aria-expanded=${openGroups.has(group)} onClick=${() => toggleGroup(group)}><span class="caret" aria-hidden="true">▸</span>${group}<span class="muted n">${group === "Text elements" ? `${TEXT_ELEMENTS.length} kinds` : fields.length}</span></button>
                        ${openGroups.has(group) && html`<div class="co-group-body">
                            ${group === "Text elements" && html`<div class="co-tabs" role="tablist" aria-label="Text element">${TEXT_ELEMENTS.map(([e, label]) => html`<button role="tab" aria-selected=${element === e} class=${element === e ? "on" : ""} onClick=${() => setElement(e)}>${label}</button>`)}</div>`}
                            ${(group === "Text elements" ? (TEXT_ELEMENTS.find(([e]) => e === element) ?? TEXT_ELEMENTS[0])[2] : fields).map(([k, label, kind, opt]) => html`<${StyleField} key=${k} k=${k} label=${label} kind=${kind} opt=${opt} value=${valueOf(k)}
                            overridden=${mode === "dark" && COLOR_KEYS.has(k) && !!st.dark?.[k]} dark=${mode === "dark" && COLOR_KEYS.has(k)}
                            onChange=${(v) => set(k, v)} onClearDark=${() => clearDark(k)} />`)}</div>`}
                    </section>`)}
                    <section class=${`co-group ${openGroups.has("Advanced CSS") ? "open" : ""}`}>
                        <button class="co-group-head" aria-expanded=${openGroups.has("Advanced CSS")} onClick=${() => toggleGroup("Advanced CSS")}><span class="caret" aria-hidden="true">▸</span>Advanced CSS</button>
                        ${openGroups.has("Advanced CSS") && html`<div class="co-group-body">
                            <p class="muted small-note">Extra rules for effects the settings don't cover. <code>&</code> is the callout; rules without it apply inside it.
                                Parts: <code>.callout-title</code>, <code>.callout-content</code>, <code>strong</code>, <code>mark</code>, <code>h4</code>, <code>img</code>, <code>table</code>.</p>
                            <textarea class="co-css" rows="8" spellcheck="false" value=${st.css ?? ""} onInput=${(e) => set("css", e.target.value)}
                                placeholder=${"& .callout-content::after { content: '…'; }"} /></div>`}
                    </section>
                    <div class="row" style="margin-top:14px">
                        <button onClick=${duplicate}>Duplicate</button>
                        ${DEFAULT_STYLES[cur] ? html`<${ConfirmButton} class="" onConfirm=${reset}>Reset to the default look</${ConfirmButton}>`
                            : html`<${ConfirmButton} class="" onConfirm=${remove}>Delete this type</${ConfirmButton}>`}
                    </div>
                </section>
                <${PreviewPane} type=${cur} sampleKey=${sampleKey} />
            </div>
        </div>
    </div>`;
}

/**
 * One setting: colours as a swatch and hex, numbers as a slider with its value, short choices as a row of buttons
 * (longer ones a list), on/off as a switch
 */
function StyleField({ label, kind, opt, value, onChange, dark, overridden, onClearDark }) {
    let input;
    if (kind === "color") {
        input = html`<span class="co-color">
            <label class="co-swatch-input" style=${`--c:${/^#[0-9a-f]{3,8}$/i.test(value ?? "") ? value : "transparent"}`} title="Pick a colour">
                <input type="color" value=${/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#000000"} onInput=${(e) => onChange(e.target.value)} aria-label=${label} /></label>
            <input class="co-hex" value=${value ?? ""} placeholder="none" onChange=${(e) => onChange(e.target.value.trim())} aria-label=${`${label} (hex)`} />
            ${dark ? (overridden ? html`<button class="small" title="Use the light mode colour" onClick=${onClearDark}>Use light</button>` : html`<span class="muted small-note">as light</span>`)
                : value ? html`<button class="small co-clear" title="No colour" aria-label=${`Clear ${label}`} onClick=${() => onChange("")}>×</button>` : ""}
        </span>`;
    } else if (kind === "range") {
        const [min, max, step] = opt;
        const pct = ((Number(value) - min) / (max - min)) * 100;
        input = html`<span class="co-range"><input type="range" min=${min} max=${max} step=${step} value=${value} style=${`--p:${Math.max(0, Math.min(100, pct))}%`} onInput=${(e) => onChange(Number(e.target.value))} aria-label=${label} />
            <input type="number" min=${min} max=${max} step=${step} value=${value} onChange=${(e) => onChange(Number(e.target.value))} aria-label=${`${label} (number)`} /></span>`;
    } else if (kind === "choice") {
        input = opt.length <= 4
            ? html`<span class="co-seg" role="group" aria-label=${label}>${opt.map((o) => html`<button class=${String(value) === String(o) ? "on" : ""} aria-pressed=${String(value) === String(o)} onClick=${() => onChange(o)}>${o}</button>`)}</span>`
            : html`<select value=${value} onChange=${(e) => onChange(e.target.value)} aria-label=${label}>${opt.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
    } else if (kind === "bool") {
        input = html`<label class="co-switch"><input type="checkbox" role="switch" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} aria-label=${label} />
            <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span><span class="muted">${value ? "On" : "Off"}</span></label>`;
    } else {
        input = html`<input value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} aria-label=${label} />`;
    }
    return html`<div class=${`co-field ${overridden ? "dark-set" : ""}`}><span>${label}</span>${input}</div>`;
}

/** The callout between two chapter paragraphs, in light and dark, from an editable sample */
function PreviewPane({ type, sampleKey }) {
    const [sample, setSampleState] = useState(() => store.get(sampleKey, "") || sampleFor(type));
    useEffect(() => setSampleState(store.get(sampleKey, "") || sampleFor(type)), [type]);
    const setSample = (v) => { setSampleState(v); store.set(sampleKey, v === sampleFor(type) ? "" : v); };
    const [out, setOut] = useState("");
    useEffect(() => {
        let live = true;
        const t = setTimeout(() => api.send("POST", "/api/render", { markdown: `${PARA_BEFORE}\n\n${sample}\n\n${PARA_AFTER}` }).then((r) => live && setOut(r.html)).catch(() => {}), 150);
        return () => { live = false; clearTimeout(t); };
    }, [sample]);
    return html`<section class="co-preview-pane">
        ${["light", "dark"].map((m) => html`<div key=${m} class=${`co-preview co-force-${m}`}>
            <div class="co-mode muted">${m === "light" ? "Light" : "Dark"}</div>
            <div class="md writer-preview" dangerouslySetInnerHTML=${{ __html: out }} />
        </div>`)}
        <details class="co-sample panel" open>
            <summary>Sample text</summary>
            <textarea rows="7" spellcheck="false" value=${sample} onInput=${(e) => setSample(e.target.value)} />
            <div class="row"><button class="small" onClick=${() => setSample(sampleFor(type))}>Reset sample</button>
                <button class="small" title="A sample with every heading level and both kinds of list" onClick=${() => setSample(richSampleFor(type))}>Headings and lists</button></div>
        </details>
    </section>`;
}
