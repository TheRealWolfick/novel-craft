// Callout designer (#/callout-design): how each callout type looks in the app (the writer, notes, previews), saved
// in `90. Templater/Callout Styles.md`. Also keeps the generated stylesheet in the page up to date.
import { h } from "preact";
import { useState, useEffect, useMemo } from "preact/hooks";
import htm from "htm";
import { api, useApi, toast, store, Loading, ConfirmButton, markDirty } from "./app.js";
import { STYLE_GROUPS, COLOR_KEYS, DEFAULT_STYLES, BASE_STYLE, calloutCss, compactStyles, sampleFor } from "./callout-style.js";

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
    return html`<div class="co-designer" onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) save(); } }}>
        <style>${previewCss}</style>
        <div class="spread">
            <div><h1>Callout designer</h1>
                <p class="muted" style="margin-top:0">How callouts look in the writer, notes and previews. Saved in <code>${data.note}</code>. Colours can differ in dark mode.</p></div>
            <div class="row">
                ${dirty && html`<button onClick=${() => setDraft(JSON.parse(base))}>Discard</button>`}
                <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save styles"}</button>
            </div>
        </div>
        <div class="co-layout">
            <nav class="co-types panel" aria-label="Callout types">
                ${types.map((t) => html`<button key=${t} class=${t === cur ? "on" : ""} onClick=${() => pick(t)}>
                    <span>${draft[t].label || t}</span><code>${t === "default" ? "any" : t === "quote" ? ">" : t}</code></button>`)}
                <button class="co-add" onClick=${addType}>+ New type</button>
            </nav>
            <section class="co-form panel">
                <div class="spread">
                    <h2 style="margin:0">${st.label || cur}</h2>
                    <div class="theme-switch" role="group" aria-label="Edit colours for">${[["light", "Light"], ["dark", "Dark"]].map(([m, l]) => html`<button class=${mode === m ? "on" : ""} aria-pressed=${mode === m} onClick=${() => setMode(m)}>${l}</button>`)}</div>
                </div>
                <label class="co-field"><span>Name</span><input value=${st.label ?? ""} onInput=${(e) => set("label", e.target.value)} /></label>
                ${STYLE_GROUPS.map(([group, fields]) => html`<details class="co-group" open=${group === "Box" || group === "Title"}>
                    <summary>${group}</summary>
                    ${fields.map(([k, label, kind, opt]) => html`<${StyleField} key=${k} k=${k} label=${label} kind=${kind} opt=${opt} value=${valueOf(k)}
                        overridden=${mode === "dark" && COLOR_KEYS.has(k) && !!st.dark?.[k]} dark=${mode === "dark" && COLOR_KEYS.has(k)}
                        onChange=${(v) => set(k, v)} onClearDark=${() => clearDark(k)} />`)}
                </details>`)}
                <details class="co-group">
                    <summary>Advanced CSS</summary>
                    <p class="muted small-note">Extra rules for effects the settings don't cover. <code>&</code> is the callout; rules without it apply inside it.
                        Parts: <code>.callout-title</code>, <code>.callout-content</code>, <code>strong</code>, <code>mark</code>, <code>h4</code>, <code>img</code>.</p>
                    <textarea class="co-css" rows="6" spellcheck="false" value=${st.css ?? ""} onInput=${(e) => set("css", e.target.value)}
                        placeholder=${"& .callout-content::after { content: '…'; }"} />
                </details>
                <div class="row" style="margin-top:12px">
                    <button onClick=${duplicate}>Duplicate</button>
                    ${DEFAULT_STYLES[cur] ? html`<${ConfirmButton} class="" onConfirm=${reset}>Reset to the default look</${ConfirmButton}>`
                        : html`<${ConfirmButton} class="" onConfirm=${remove}>Delete this type</${ConfirmButton}>`}
                </div>
            </section>
            <${PreviewPane} type=${cur} sampleKey=${sampleKey} />
        </div>
    </div>`;
}

function StyleField({ label, kind, opt, value, onChange, dark, overridden, onClearDark }) {
    let input;
    if (kind === "color") {
        input = html`<span class="row co-color">
            <input type="color" value=${/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#000000"} onInput=${(e) => onChange(e.target.value)} aria-label=${label} />
            <input class="co-hex" value=${value ?? ""} placeholder="none" onChange=${(e) => onChange(e.target.value.trim())} aria-label=${`${label} (hex)`} />
            ${dark ? (overridden ? html`<button class="small" title="Use the light mode colour" onClick=${onClearDark}>× dark</button>` : html`<span class="muted small-note">as light</span>`)
                : value ? html`<button class="small" title="None" onClick=${() => onChange("")}>×</button>` : ""}
        </span>`;
    } else if (kind === "range") {
        const [min, max, step] = opt;
        input = html`<span class="row co-range"><input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onChange(Number(e.target.value))} aria-label=${label} />
            <input type="number" min=${min} max=${max} step=${step} value=${value} onChange=${(e) => onChange(Number(e.target.value))} aria-label=${`${label} (number)`} /></span>`;
    } else if (kind === "choice") {
        input = html`<select value=${value} onChange=${(e) => onChange(e.target.value)} aria-label=${label}>${opt.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
    } else if (kind === "bool") {
        return html`<label class="co-field co-bool"><input type="checkbox" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} /><span>${label}</span></label>`;
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
            <button class="small" onClick=${() => setSample(sampleFor(type))}>Reset sample</button>
        </details>
    </section>`;
}
