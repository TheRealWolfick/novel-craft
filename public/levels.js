// A pasted list of taxonomy values (levels of a power system, ranks…) -> the notes to create, in order.
// Shared by the new-taxonomy dialog and the tests.
//
//   Qi Refining (Layer 1 - 9)                  a value with sub-levels "Qi Refining Layer 1" … "Qi Refining Layer 9"
//   Foundation Establishment (Early, Mid, Late, Peak)
//   Golden Core = 5000                         "= n" or ": n" at the end: the value's number (threshold)
//   Nascent Soul                               indented lines below a value are its sub-levels, as written
//   	Early = 20000
//
// Sub-levels get the parent's name in front ("Foundation Establishment Early", shown as "Foundation Establishment
// (Early)"), since note names are unique across the vault.

const NUM = /\s*(?:=|:)\s*(-?\d[\d,_]*(?:\.\d+)?)\s*$/;
const RANGE = /^(.*?)\s*(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*$/i;

const number = (s) => Number(String(s).replace(/[,_]/g, ""));
const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** "Layer 1 - 9" -> ["Layer 1", …, "Layer 9"]; "Early, Mid" -> ["Early", "Mid"] */
export function expandLabels(spec) {
    return spec.split(/\s*,\s*/).flatMap((part) => {
        const m = RANGE.exec(part.trim());
        if (!m) return [tidy(part)];
        const [a, b] = [Number(m[2]), Number(m[3])];
        if (b < a || b - a > 200) return [tidy(part)];
        return Array.from({ length: b - a + 1 }, (_, i) => tidy(`${m[1]} ${a + i}`));
    }).filter(Boolean);
}

/**
 * The list -> [{name, title, parent, threshold}] in order (a parent before its sub-levels). `parent` is the
 * parent's name in this list; threshold a number or null.
 */
export function parseLevels(text) {
    const out = [];
    let top = null;
    for (const raw of String(text ?? "").split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const indented = /^(\t| {2,}|\s*[-*•]\s)/.test(raw) && top;
        let line = raw.replace(/^\s*[-*•]\s+/, "").trim();
        let threshold = null;
        const n = NUM.exec(line);
        if (n) { threshold = number(n[1]); line = line.slice(0, n.index).trim(); }
        if (!line) continue;
        if (indented) {
            const label = tidy(line);
            // a sub-level the brackets already made ("Golden Core (Early, Mid)" then "	Early = 5000") gets the number
            const known = out.find((v) => v.parent === top.name && v.name.toLowerCase() === `${top.name} ${label}`.toLowerCase());
            if (known) { if (threshold != null) known.threshold = threshold; continue; }
            out.push({ name: `${top.name} ${label}`, title: `${top.name} (${label})`, parent: top.name, threshold });
            continue;
        }
        const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(line);
        const name = tidy(m ? m[1] : line);
        top = { name, title: name, parent: null, threshold };
        out.push(top);
        if (m) for (const label of expandLabels(m[2])) out.push({ name: `${name} ${label}`, title: `${name} (${label})`, parent: name, threshold: null });
    }
    return out;
}
