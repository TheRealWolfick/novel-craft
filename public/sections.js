// A note body as blocks: the text before the first "## " heading (`pre`) and one section per "## Title" up to the next
// one (### sub headings stay inside). Shared by the server (renders each section) and the browser (edits, reorders and
// deletes them). Untouched sections keep their exact text (`raw`), so only what was edited changes in the file.

const HEADING = /^##[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;
const FENCE = /^\s*(```|~~~)/;

/** body -> {pre, sections: [{title, raw, text}]} */
export function parseSections(body) {
    const src = String(body ?? "");
    const lines = src.split("\n");
    const starts = []; // [offset, title]
    let offset = 0, fence = null;
    for (const line of lines) {
        const f = FENCE.exec(line);
        if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
        else if (!fence) { const m = HEADING.exec(line); if (m) starts.push([offset, m[1]]); }
        offset += line.length + 1;
    }
    const pre = src.slice(0, starts[0]?.[0] ?? src.length);
    const sections = starts.map(([at, title], i) => {
        const raw = src.slice(at, starts[i + 1]?.[0] ?? src.length);
        const nl = raw.indexOf("\n");
        return { title, raw, text: nl < 0 ? "" : raw.slice(nl + 1) };
    });
    return { pre, sections };
}

/** A section written fresh: heading, text, and a blank line before whatever follows */
export const sectionRaw = (title, text) => `## ${String(title).replace(/\s*\n\s*/g, " ").trim()}\n${String(text ?? "").replace(/\s+$/, "")}\n\n`;
/** The text before the first heading, written fresh */
export const preRaw = (text, hasSections) => { const t = String(text ?? "").replace(/\s+$/, ""); return t ? `${t}\n${hasSections ? "\n" : ""}` : ""; };

/** {pre, sections} -> body; a chunk that doesn't end its line (the old last section, moved up) gets a blank line before the next heading */
export function joinSections(pre, sections) {
    let out = pre ?? "";
    for (const s of sections) {
        if (out && !out.endsWith("\n")) out += "\n\n";
        out += s.raw;
    }
    return out;
}

/** The `## Images` section holds the image embeds the gallery shows; it isn't edited as a block */
export const isImagesSection = (s) => /^images$/i.test(String(s?.title ?? "").trim());
