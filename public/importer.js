// Import data (#/import): a dataset from a GitHub repository (or a folder on this computer) into the vault.
// Check downloads it and compares every file; identical files are skipped without asking, conflicts are decided one by
// one (overwrite / skip, or all remaining at once), then Import writes the new files and the chosen overwrites.
import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";
import { api, toast, store, Loading } from "./app.js";

const html = htm.bind(h);
export const STARTER_DATA = "https://github.com/TheRealWolfick/world-builder-data";

export function ImportView() {
    const [source, setSource] = useState(() => store.get("importSource", ""));
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [check, setCheck] = useState(null);      // result of /api/import/check
    const [decisions, setDecisions] = useState({}); // conflict path -> "overwrite" | "skip"
    const [step, setStep] = useState(0);           // index of the conflict on screen
    const [skipClashes, setSkipClashes] = useState(true);
    const [done, setDone] = useState(null);
    const conflicts = check?.files.filter((f) => f.status === "conflict") ?? [];
    const undecided = conflicts.filter((f) => !decisions[f.path]);
    const run = async () => {
        setBusy(true); setErr(""); setCheck(null); setDone(null); setDecisions({}); setStep(0);
        try { store.set("importSource", source.trim()); setCheck(await api.send("POST", "/api/import/check", { source: source.trim() })); }
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
            const r = await api.send("POST", "/api/import/apply", { id: check.id, overwrite: conflicts.filter((f) => decisions[f.path] === "overwrite").map((f) => f.path), skipClashes });
            setDone(r); setCheck(null);
            toast(`Imported ${r.added + r.overwritten} files`);
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const writes = check ? check.counts.new - (skipClashes ? check.counts.clash : 0) + conflicts.filter((f) => decisions[f.path] === "overwrite").length : 0;
    return html`<div class="import-page">
        <h1>Import data</h1>
        <p class="muted" style="margin-top:0">Add a dataset (notes, taxonomy, templates, attachments at their vault paths) from a GitHub repository to this vault.
            Files you already have with the same content are skipped; for files that differ you choose what happens.</p>
        <div class="panel">
            <label class="import-source">
                <span>GitHub repository</span>
                <input value=${source} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL"
                    onInput=${(e) => setSource(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter" && source.trim()) run(); }} />
                <button class="primary" disabled=${busy || !source.trim()} onClick=${run}>${busy && !check ? "Downloading…" : "Check"}</button>
            </label>
            <p class="muted small-note">A branch or folder works too: <code>https://github.com/owner/repo/tree/branch/folder</code>. A folder on this computer can be given as a path (<code>~/datasets/mine</code>).
                ${" "}<button class="linkish" onClick=${() => setSource(STARTER_DATA)}>Use the World Builder starter data</button> (schema, ledger types, basic taxonomy).</p>
        </div>
        ${err && html`<p class="error">${err}</p>`}
        ${done && html`<div class="panel import-done">
            <h2 style="margin-top:0">Imported from ${done.source}</h2>
            <p>${done.added} new file${done.added === 1 ? "" : "s"}, ${done.overwritten} overwritten, ${done.skipped} skipped${done.folders ? `, ${done.folders} collection folders made` : ""}.</p>
            <a class="button" href="#/">Open the data store</a>
        </div>`}
        ${check && html`<div class="panel">
            <div class="spread"><div>
                <h2 style="margin:0">${check.name || check.source}</h2>
                ${check.name && html`<div class="muted">${check.source}</div>`}
                ${check.description && html`<p>${check.description}</p>`}
            </div></div>
            <div class="import-counts">
                <span class="chip">${check.counts.new - check.counts.clash} new</span>
                <span class="chip" title="Byte for byte the same, or notes with the same fields and text (created dates and empty fields written differently are ignored)">${check.counts.same} identical (skipped)</span>
                <span class=${`chip ${check.counts.conflict ? "warn" : ""}`}>${check.counts.conflict} different</span>
                ${check.counts.clash > 0 && html`<span class="chip warn">${check.counts.clash} name already used</span>`}
            </div>
            ${conflicts.length > 0 && html`<${ConflictStep} check=${check} conflicts=${conflicts} step=${step} setStep=${setStep} decisions=${decisions} decide=${decide} decideRest=${decideRest} undecided=${undecided.length} />`}
            ${check.counts.clash > 0 && html`<details class="import-list"><summary><b>${check.counts.clash}</b> new notes have a name another note in the vault already uses</summary>
                <p class="muted small-note">Obsidian links notes by name, so two notes with one name make links ambiguous.</p>
                <ul>${check.files.filter((f) => f.clash).map((f) => html`<li><code>${f.path}</code>${typeof f.clash === "string" ? html` <span class="muted">(you have ${f.clash})</span>` : ""}</li>`)}</ul>
                <label class="row"><input type="checkbox" style="width:auto" checked=${skipClashes} onChange=${(e) => setSkipClashes(e.target.checked)} /> Skip these</label>
            </details>`}
            <${FileList} title="New files" files=${check.files.filter((f) => f.status === "new" && !f.clash)} />
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
    const lines = (a, b) => { const other = new Set(b.split("\n")); return a.split("\n").map((l, i) => html`<div key=${i} class=${other.has(l) ? "" : "diff"}>${l || " "}</div>`); };
    return html`<div class="import-conflict">
        <div class="spread">
            <h3 style="margin:0">Different files <span class="muted">${conflicts.length - undecided} of ${conflicts.length} decided</span></h3>
            <span class="row">
                <button class="small" disabled=${step === 0} onClick=${() => setStep(step - 1)}>←</button>
                <span class="muted">${step + 1} / ${conflicts.length}</span>
                <button class="small" disabled=${step >= conflicts.length - 1} onClick=${() => setStep(step + 1)}>→</button>
            </span>
        </div>
        <p><code>${f.path}</code> ${decisions[f.path] && html`<span class=${`badge ${decisions[f.path] === "overwrite" ? "warn" : ""}`}>${decisions[f.path] === "overwrite" ? "will overwrite" : "will skip"}</span>`}</p>
        ${!pv ? html`<${Loading} />` : pv.error ? html`<p class="error">${pv.error}</p>` : pv.binary ? html`<p class="muted">Not a text file (${f.currentSize} bytes now, ${f.size} bytes incoming).</p>` : html`<div class="import-diff">
            <div><div class="muted">In your vault</div><pre>${lines(pv.current, pv.incoming)}</pre></div>
            <div><div class="muted">Incoming</div><pre>${lines(pv.incoming, pv.current)}</pre></div>
        </div>`}
        <div class="row import-decide">
            <button class="primary" onClick=${() => decide(f.path, "overwrite")}>Overwrite</button>
            <button onClick=${() => decide(f.path, "skip")}>Skip</button>
            <span class="grow" />
            <button onClick=${() => decideRest("overwrite")} title="Every file not decided yet">Overwrite all remaining</button>
            <button onClick=${() => decideRest("skip")} title="Every file not decided yet">Skip all remaining</button>
        </div>
    </div>`;
}
