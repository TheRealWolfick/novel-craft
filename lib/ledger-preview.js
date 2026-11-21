// What a ledger entry would do before it is saved: its callout, the holdings before and after it (stock ledgers), the
// warnings it would add, and the stats panel with it applied (state ledgers). Used by the ledger editor's preview
// (POST /api/ledger/preview) and by the assistant's proposed ledger entries.
import { asCallout, renderTemplate } from "./template.js";
import { foldStock } from "./ledger.js";
import { stateFrom, replayLine, valuesFromState } from "../public/stats-core.js";

/** @param ctx {vault, novels, stats}; @param body {owner, type, entry: {chapter, title, fields, lines, body}, replaceKey} */
export function previewEntry({ vault, novels, stats }, novel, body) {
    const type = novels.ledgerTypes(novel)[body.type];
    if (!type) throw Object.assign(new Error(`Unknown ledger type ${body.type}`), { status: 400 });
    const existing = novels.ownerLedgers(novel, body.owner).find((l) => l.type === body.type);
    const ledger = existing ?? { path: "", name: `${body.owner} - ${body.type}`, owner: body.owner, type: body.type, entries: [] };
    const chapter = Number(body.entry.chapter);
    const seq = body.replaceKey ? Number(String(body.replaceKey).split(".")[1]) : novels.nextSeq(novel, chapter);
    const draft = { chapter, seq, key: `${chapter}.${seq}`, title: body.entry.title ?? "", fields: body.entry.fields ?? {}, lines: (body.entry.lines ?? []).filter((l) => l.item || l.set), body: body.entry.body ?? "", warnings: [] };
    const others = ledger.entries.filter((e) => e.key !== body.replaceKey);
    const out = { behaviour: type.behaviour, callout: asCallout(renderTemplate(novels.templateFor(novel, ledger, draft), novels.entryView(novel, ledger, draft))) };
    if (type.behaviour === "stock") {
        out.before = foldStock(vault, others, { until: chapter }).stacks;
        out.after = foldStock(vault, [...others, draft], { until: chapter }).stacks;
        out.warnings = foldStock(vault, [...others, draft]).warnings.filter((w) => !foldStock(vault, others).warnings.some((x) => x.message === w.message));
    }
    if (type.behaviour === "state") {
        out.warnings = stats.checkLines(novel, body.owner, body.type, draft.lines).map((message) => ({ message }));
        // previous values at this chapter (for prefilling) and the stats panel with this entry applied
        const holder = stats.holder(novel, body.owner);
        const template = holder && stats.templates(novel)[holder.template];
        if (template) {
            const before = stats.valuesAt(novel, holder, template, chapter - 1e-9);
            // this entry's lines replayed on the values before it (levels set, unlinked, numbers changed)
            const st = stateFrom(template, before.values);
            for (const l of draft.lines) replayLine(template, st, l);
            const after = valuesFromState(template, st);
            out.stats = { template, before: before.values, panel: stats.panel(novel, holder, template, after, chapter) };
        }
    }
    return out;
}
