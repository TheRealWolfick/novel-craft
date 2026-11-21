// Import data (#/import): a dataset from a GitHub repository (or a folder on this computer) into the vault.
// Check downloads it and compares every file; identical files are skipped without asking, conflicts are decided one by
// one (overwrite / skip, or all remaining at once), names already used are kept (links go to your note) or imported under a
// new name (links follow), then Import writes it all and records it, so a later import tells updates from your own edits.
import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";
import { api, toast, store, Loading } from "./app.js";

const html = htm.bind(h);
export const STARTER_DATA = "https://github.com/TheRealWolfick/world-builder-data";

export function ImportView() {
    const [source, setSource] = useState(() => store.get("importSource", ""));
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [check, setCheck] = useState(null);      // result of /api/import/check
    const [decisions, setDecisions] = useState({}); // conflict / removed path -> "overwrite" | "skip"
    const [step, setStep] = useState(0);           // index of the conflict on screen
    const [clashes, setClashes] = useState({});     // new note whose name is taken -> "mine" | "rename"
    const [skipUpdates, setSkipUpdates] = useState(new Set());
    const [done, setDone] = useState(null);
    const conflicts = check?.files.filter((f) => f.status === "conflict" || f.status === "removed") ?? [];
    const clashing = check?.files.filter((f) => f.status === "new" && f.clash) ?? [];
    const updates = check?.files.filter((f) => f.status === "update") ?? [];
    const undecided = conflicts.filter((f) => !decisions[f.path]);
    const [extract, setExtract] = useState(true);
    const [texChoice, setTexChoice] = useState({});  // texture id -> "add" | "skip" | "mine" | "overwrite" | "rename"
    const [over, setOver] = useState(false);
    const fileInput = useRef();
    const reset = () => { setBusy(true); setErr(""); setCheck(null); setDone(null); setDecisions({}); setStep(0); setClashes({}); setSkipUpdates(new Set()); setTexChoice({}); setExtract(true); };
    const run = async () => {
        reset();
        try { store.set("importSource", source.trim()); setCheck(await api.send("POST", "/api/import/check", { source: source.trim() })); }
        catch (e) { setErr(e.message); }
        setBusy(false);
    };
    /** a world export or any dataset as a .zip / .tar.gz file */
    const upload = async (file) => {
        if (!file) return;
        reset();
        try { setCheck(await api.send("POST", `/api/import/upload?filename=${encodeURIComponent(file.name)}`, null, file)); }
        catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const decide = (path, what) => {
        const next = { ...decisions, [path]: what };
        setDecisions(next);
        const i = conflicts.findIndex((f) => !next[f.path]);
        if (i > -1) setStep(i);
    };
    const decideRest = (what) => setDecisions(Object.fromEntries(conflicts.map((f) => [f.path, decisions[f.path] ?? what])));
    const apply = async () => {
        setBusy(true); setErr("");
        try {
            const r = await api.send("POST", "/api/import/apply", {
                id: check.id, overwrite: conflicts.filter((f) => decisions[f.path] === "overwrite").map((f) => f.path),
                skip: [...skipUpdates], clashes: Object.fromEntries(clashing.map((f) => [f.path, clashes[f.path] ?? "mine"])), extractStamps: extract, textures: texChoice,
            });
            setDone(r); setCheck(null);
            toast(`Imported ${r.added + r.overwritten + r.renamed} files`);
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const writes = check ? check.files.filter((f) => f.status === "new" && !f.clash).length + clashing.filter((f) => clashes[f.path] === "rename").length
        + updates.filter((f) => !skipUpdates.has(f.path)).length + conflicts.filter((f) => decisions[f.path] === "overwrite").length : 0;
    const c = check?.counts;
    return html`<div class="import-page">
        <h1>Import data</h1>
        <p class="muted" style="margin-top:0">Add a dataset (notes, taxonomy, templates, attachments at their vault paths) from a GitHub repository to this vault.
            Files you already have with the same content are skipped; for files that differ you choose what happens. Importing the same dataset again later brings in its updates and keeps your own edits.</p>
        <div class="panel">
            <label class="import-source">
                <span>GitHub repository</span>
                <input value=${source} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL"
                    onInput=${(e) => setSource(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter" && source.trim()) run(); }} />
                <button class="primary" disabled=${busy || !source.trim()} onClick=${run}>${busy && !check ? "Downloading…" : "Check"}</button>
            </label>
            <p class="muted small-note">A branch or folder works too: <code>https://github.com/owner/repo/tree/branch/folder</code>. A folder on this computer can be given as a path (<code>~/datasets/mine</code>).
                ${" "}<button class="linkish" onClick=${() => setSource(STARTER_DATA)}>Use the Novel Craft starter data</button> (schema, ledger types, basic taxonomy).</p>
            <div class=${`drop import-drop ${over ? "over" : ""}`} onClick=${() => fileInput.current.click()}
                onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
                onDrop=${(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files?.[0]); }}>
                Or drop a <b>.zip</b> (a world export, or a repository downloaded as a zip) or <b>.tar.gz</b> here, or click to choose one
                <input ref=${fileInput} type="file" accept=".zip,.gz,.tgz,application/zip,application/gzip" style="display:none" onChange=${(e) => upload(e.target.files?.[0])} />
            </div>
        </div>
        ${err && html`<p class="error">${err}</p>`}
        ${done && html`<div class="panel import-done">
            <h2 style="margin-top:0">Imported from ${done.source}</h2>
            <p>${done.added} new, ${done.overwritten} updated or overwritten${done.renamed ? `, ${done.renamed} imported under a new name` : ""}, ${done.skipped} skipped${done.stamps ? `, ${done.stamps} stamps added to your library` : ""}${done.folders ? `, ${done.folders} collection folders made` : ""}.</p>
            <a class="button" href="#/">Open the data store</a>
        </div>`}
        ${check && html`<div class="panel">
            <h2 style="margin:0">${check.name || check.source}</h2>
            ${check.name && html`<div class="muted">${check.source}${check.imported ? ` · last imported ${new Date(check.imported).toLocaleString()}` : ""}</div>`}
            ${check.description && html`<p>${check.description}</p>`}
            <div class="import-counts">
                <span class="chip">${c.new - c.clash} new</span>
                <span class="chip" title="Byte for byte the same, or notes with the same fields and text (created dates and blank fields written differently are ignored)">${c.same} identical (skipped)</span>
                ${c.update > 0 && html`<span class="chip">${c.update} updated in the dataset</span>`}
                ${c.local > 0 && html`<span class="chip" title="You changed these since the last import and the dataset did not: yours are kept">${c.local} changed by you (kept)</span>`}
                ${c.conflict + c.removed > 0 && html`<span class="chip warn">${c.conflict + c.removed} to decide</span>`}
                ${c.clash > 0 && html`<span class="chip warn">${c.clash} name already used</span>`}
                ${c.library > 0 && html`<span class="chip" title="Stamp images you already have elsewhere in your library: the maps use yours">${c.library} stamps you already have</span>`}
                ${c.kept > 0 && html`<span class="chip" title="Name clashes you chose to keep your own note for in an earlier import">${c.kept} kept yours (earlier choice)</span>`}
            </div>
            ${check.assets && (check.assets.maps > 0 || check.assets.textures.length > 0) && html`<${AssetsStep} a=${check.assets} extract=${extract} setExtract=${setExtract} texChoice=${texChoice} setTexChoice=${setTexChoice} />`}
            ${conflicts.length > 0 && html`<${ConflictStep} check=${check} conflicts=${conflicts} step=${step} setStep=${setStep} decisions=${decisions} decide=${decide} decideRest=${decideRest} undecided=${undecided.length} />`}
            ${clashing.length > 0 && html`<div class="import-conflict">
                <h3 style="margin:0">Names already used <span class="muted">${clashing.length}</span></h3>
                <p class="muted small-note">Obsidian links notes by name, so these new notes can't keep their names. <b>Use mine</b> skips the incoming note, and its links point at your note.
                    <b>Import renamed</b> brings it in under a new name and changes the links in the imported notes to match. Your choice is remembered for later imports.</p>
                <div class="row" style="margin-bottom:8px">
                    <button class="small" onClick=${() => setClashes(Object.fromEntries(clashing.map((f) => [f.path, "mine"])))}>Use mine for all</button>
                    <button class="small" onClick=${() => setClashes(Object.fromEntries(clashing.map((f) => [f.path, "rename"])))}>Import all renamed</button>
                </div>
                <table class="import-clashes"><tbody>${clashing.map((f) => html`<tr key=${f.path}>
                    <td><code>${f.path}</code>${typeof f.clash === "string" ? html`<div class="muted small-note">yours: ${f.clash}</div>` : ""}</td>
                    <td class="row">
                        <label class="row"><input type="radio" style="width:auto" name=${`cl-${f.path}`} checked=${(clashes[f.path] ?? "mine") === "mine"} onChange=${() => setClashes({ ...clashes, [f.path]: "mine" })} /> Use mine</label>
                        <label class="row"><input type="radio" style="width:auto" name=${`cl-${f.path}`} checked=${clashes[f.path] === "rename"} onChange=${() => setClashes({ ...clashes, [f.path]: "rename" })} /> Import as <b>${f.renameTo}</b></label>
                    </td></tr>`)}</tbody></table>
            </div>`}
            ${updates.length > 0 && html`<details class="import-list" open><summary><b>${updates.length}</b> updated in the dataset since your last import (you haven't changed them here)</summary>
                <ul>${updates.map((f) => html`<li><label class="row"><input type="checkbox" style="width:auto" checked=${!skipUpdates.has(f.path)}
                    onChange=${(e) => { const n = new Set(skipUpdates); if (e.target.checked) n.delete(f.path); else n.add(f.path); setSkipUpdates(n); }} /> <code>${f.target}</code></label></li>`)}</ul>
            </details>`}
            ${check.unresolved?.length > 0 && html`<details class="import-list"><summary><b>${check.unresolved.length}</b> links point to notes neither the dataset nor your vault has</summary>
                <p class="muted small-note">They import as they are and show as unresolved links until such notes exist.</p>
                <ul>${check.unresolved.map((u) => html`<li><code>[[${u.target}]]</code> <span class="muted">in ${u.from.slice(0, 3).map((x) => x.split("/").pop().replace(/\.md$/, "")).join(", ")}${u.from.length > 3 ? ` +${u.from.length - 3}` : ""}</span></li>`)}</ul>
            </details>`}
            <${FileList} title="New files" files=${check.files.filter((f) => f.status === "new" && !f.clash)} />
            <${FileList} title="Changed by you (kept)" files=${check.files.filter((f) => f.status === "local")} />
            <${FileList} title="Identical files (skipped)" files=${check.files.filter((f) => f.status === "same")} />
            <div class="savebar">
                <button class="primary" disabled=${busy || undecided.length > 0 || !writes} onClick=${apply}>${busy ? "Importing…" : `Import ${writes} file${writes === 1 ? "" : "s"}`}</button>
                ${undecided.length > 0 && html`<span class="muted">Decide the ${undecided.length} different file${undecided.length === 1 ? "" : "s"} first</span>`}
                ${!writes && !undecided.length && html`<span class="muted">Nothing to write: you have all of it already.</span>`}
                <button onClick=${() => setCheck(null)}>Cancel</button>
            </div>
        </div>`}
    </div>`;
}

/** What the maps need: stamps found in your library, ones only the maps carry, missing built-ins, textures to add or reconcile */
function AssetsStep({ a, extract, setExtract, texChoice, setTexChoice }) {
    const newTex = a.textures.filter((t) => t.status === "new"), clash = a.textures.filter((t) => t.status === "conflict");
    return html`<div class="import-conflict import-assets">
        <h3 style="margin:0">Maps, stamps and textures</h3>
        <ul>
            <li>${a.maps} map${a.maps === 1 ? "" : "s"}.${a.reused ? ` ${a.reused} stamp${a.reused === 1 ? "" : "s"} you already have are used from your library.` : ""}${a.deduped.length ? ` ${a.deduped.length} stamp file${a.deduped.length === 1 ? " is" : "s are"} not copied: you have the same image${a.deduped.length === 1 ? "" : "s"} already.` : ""}</li>
            ${a.embedded.length > 0 && html`<li><label class="row"><input type="checkbox" style="width:auto" checked=${extract} onChange=${(e) => setExtract(e.target.checked)} />
                Add the ${a.embedded.length} stamp${a.embedded.length === 1 ? "" : "s"} only the maps carry to your library (<i>${a.embedded.slice(0, 4).map((e) => e.name).join(", ")}${a.embedded.length > 4 ? "…" : ""}</i>)</label>
                <div class="muted small-note">Without them the maps still show these stamps, but you can't place them elsewhere.</div></li>`}
            ${a.missingBuiltin.length > 0 && html`<li class="warn-text">${a.missingBuiltin.length} built-in stamp${a.missingBuiltin.length === 1 ? " is" : "s are"} missing from this version of Novel Craft (${a.missingBuiltin.slice(0, 4).map((x) => x.name).join(", ")}): the maps show their saved copies.</li>`}
            ${newTex.length > 0 && html`<li>${newTex.length} texture${newTex.length === 1 ? "" : "s"} new to you (${newTex.map((t) => t.name).join(", ")}) ${newTex.every((t) => (texChoice[t.id] ?? "add") === "add") ? "are added to your textures" : ""}.
                <button class="linkish" onClick=${() => setTexChoice({ ...texChoice, ...Object.fromEntries(newTex.map((t) => [t.id, (texChoice[t.id] ?? "add") === "add" ? "skip" : "add"])) })}>${newTex.every((t) => (texChoice[t.id] ?? "add") === "add") ? "Don't add them" : "Add them"}</button></li>`}
        </ul>
        ${clash.length > 0 && html`<p class="small-note"><b>Textures with the same name but a different look</b> (the maps keep their look unless you choose yours):</p>
            <table class="import-clashes"><tbody>${clash.map((t) => html`<tr key=${t.id}><td><b>${t.name}</b> <code>${t.id}</code><div class="muted small-note">used by ${t.maps.length} map${t.maps.length === 1 ? "" : "s"}</div></td>
                <td class="row">${[["rename", `Import as ${t.newId}`], ["overwrite", "Replace mine"], ["mine", "Maps use mine"]].map(([v, l]) => html`<label class="row"><input type="radio" style="width:auto" name=${`tx-${t.id}`}
                    checked=${(texChoice[t.id] ?? "rename") === v} onChange=${() => setTexChoice({ ...texChoice, [t.id]: v })} /> ${l}</label>`)}</td></tr>`)}</tbody></table>`}
    </div>`;
}

function FileList({ title, files }) {
    if (!files.length) return null;
    const folders = new Map();
    for (const f of files) { const d = f.path.split("/").slice(0, -1).join("/") || "(vault root)"; folders.set(d, [...(folders.get(d) ?? []), f]); }
    return html`<details class="import-list"><summary><b>${files.length}</b> ${title.toLowerCase()}</summary>
        ${[...folders].map(([d, list]) => html`<div class="import-folder"><div class="muted">${d} <span>(${list.length})</span></div>
            <div>${list.map((f) => html`<span class="chip">${f.path.split("/").pop()}</span>`)}</div></div>`)}
    </details>`;
}

/** One conflicting file at a time: current and incoming side by side, Overwrite / Skip, or all remaining at once */
function ConflictStep({ check, conflicts, step, setStep, decisions, decide, decideRest, undecided }) {
    const f = conflicts[Math.min(step, conflicts.length - 1)];
    const [pv, setPv] = useState(null);
    useEffect(() => {
        let live = true;
        setPv(null);
        api.get(`/api/import/preview?id=${encodeURIComponent(check.id)}&path=${encodeURIComponent(f.path)}`).then((r) => live && setPv(r)).catch((e) => live && setPv({ error: e.message }));
        return () => { live = false; };
    }, [f.path]);
    // a blank field is blank however it is written (key:, key: "", key: [], key: null), so those lines never show as changed
    const norm = (l) => l.replace(/^(\s*[^:#\s][^:]*):\s*(""|''|\[\]|null|~)?\s*$/, "$1:").trimEnd();
    const lines = (a, b) => { const other = new Set(b.split("\n").map(norm)); return a.split("\n").map((l, i) => html`<div key=${i} class=${other.has(norm(l)) ? "" : "diff"}>${l || "\u00a0"}</div>`); };
    return html`<div class="import-conflict">
        <div class="spread">
            <h3 style="margin:0">Different files <span class="muted">${conflicts.length - undecided} of ${conflicts.length} decided</span></h3>
            <span class="row">
                <button class="small" disabled=${step === 0} onClick=${() => setStep(step - 1)}>←</button>
                <span class="muted">${step + 1} / ${conflicts.length}</span>
                <button class="small" disabled=${step >= conflicts.length - 1} onClick=${() => setStep(step + 1)}>→</button>
            </span>
        </div>
        <p><code>${f.target}</code>${f.status === "removed" ? html` <span class="badge warn">you deleted it after the last import</span>` : ""} ${decisions[f.path] && html`<span class=${`badge ${decisions[f.path] === "overwrite" ? "warn" : ""}`}>${decisions[f.path] === "overwrite" ? "will overwrite" : "will skip"}</span>`}</p>
        ${!pv ? html`<${Loading} />` : pv.error ? html`<p class="error">${pv.error}</p>` : pv.binary ? html`<p class="muted">Not a text file (${f.currentSize} bytes now, ${f.size} bytes incoming).</p>` : html`<div class="import-diff">
            <div><div class="muted">In your vault</div><pre>${lines(pv.current, pv.incoming)}</pre></div>
            <div><div class="muted">Incoming</div><pre>${lines(pv.incoming, pv.current)}</pre></div>
        </div>`}
        <div class="row import-decide">
            <button class="primary" onClick=${() => decide(f.path, "overwrite")}>${f.status === "removed" ? "Restore" : "Overwrite"}</button>
            <button onClick=${() => decide(f.path, "skip")}>Skip</button>
            <span class="grow" />
            <button onClick=${() => decideRest("overwrite")} title="Every file not decided yet">Overwrite all remaining</button>
            <button onClick=${() => decideRest("skip")} title="Every file not decided yet">Skip all remaining</button>
        </div>
    </div>`;
}
