// Callout styles: how each callout type ([!system], [!journal]…) looks in the app, configured in the callout designer
// and saved in `90. Templater/Callout Styles.md` frontmatter `callout-styles: {<type>: {...}}`. Shared by the browser
// (designer, generated stylesheet) and the server (defaults when the note has none).
//
// A style holds plain settings (colours, sizes, switches; `dark: {...}` overrides colours in dark mode) and optional
// `css`: extra rules where "&" is the callout element, e.g. "& .callout-content::before { content: '“' }".
// "default" applies to callout types without a style of their own, "quote" to plain "> " quotes.

export const CALLOUT_STYLES_NOTE = "90. Templater/Callout Styles.md";

export const FONTS = {
    inherit: "inherit",
    serif: '"Newsreader", Georgia, "Iowan Old Style", serif',
    sans: 'system-ui, "Cantarell", "Segoe UI", sans-serif',
    mono: '"Consolas", "Monaco", "Courier New", monospace',
    hand: '"Kalam", "Segoe Print", "Bradley Hand", cursive',
};

// the designer's form: [key, label, type, options] in groups; colour keys can differ in dark mode
export const STYLE_GROUPS = [
    ["Box", [
        ["font", "Font", "choice", Object.keys(FONTS)], ["fontSize", "Text size (× chapter text)", "range", [0.6, 1.4, 0.01]],
        ["width", "Width (%)", "range", [40, 100, 1]], ["align", "Position", "choice", ["center", "left"]],
        ["padding", "Padding (px)", "range", [0, 40, 1]], ["radius", "Corner radius (px)", "range", [0, 24, 1]],
        ["margin", "Space above and below (em)", "range", [0, 4, 0.1]], ["rotate", "Tilt (degrees)", "range", [-3, 3, 0.1]],
        ["background", "Background", "color"], ["background2", "Gradient to (blank: flat)", "color"], ["gradientAngle", "Gradient angle", "range", [0, 360, 5]],
        ["borderColor", "Border", "color"], ["borderWidth", "Border width (px)", "range", [0, 6, 1]], ["borderStyle", "Border style", "choice", ["solid", "dashed", "dotted", "double"]],
        ["barColor", "Left bar", "color"], ["barWidth", "Left bar width (px)", "range", [0, 10, 1]],
        ["shadowColor", "Glow / shadow", "color"], ["shadowSize", "Glow size (px)", "range", [0, 40, 1]], ["shadowOpacity", "Glow strength", "range", [0, 1, 0.01]],
    ]],
    ["Title", [
        ["titleShow", "Show the title", "bool"], ["titlePosition", "Title position", "choice", ["top", "bottom"]],
        ["titleBackground", "Title background", "color"], ["titleFade", "Fade the title background out to the right", "bool"],
        ["titleColor", "Title text", "color"], ["titleSize", "Title size (em)", "range", [0.6, 1.6, 0.01]],
        ["titleWeight", "Title weight", "choice", ["300", "400", "600", "700"]], ["titleCase", "Title case", "choice", ["none", "uppercase", "small-caps"]],
        ["titleAlign", "Title alignment", "choice", ["left", "center", "right"]], ["titleSpacing", "Letter spacing (px)", "range", [0, 4, 0.1]],
        ["titlePrefix", "Text before the title", "text"], ["titlePrefixColor", "Colour of that text", "color"],
    ]],
    ["Text", [
        ["textColor", "Text", "color"], ["contentBackground", "Body background", "color"], ["contentOpacity", "Body background strength", "range", [0, 1, 0.01]],
        ["italic", "Italic", "bool"], ["lineHeight", "Line height", "range", [1, 2.4, 0.05]], ["paragraphGap", "Gap between paragraphs (em)", "range", [0, 2, 0.05]],
        ["textAlign", "Alignment", "choice", ["left", "justify", "center"]], ["indent", "Indent later paragraphs (em)", "range", [0, 3, 0.1]],
        ["boldColor", "Bold text and labels", "color"], ["linkColor", "Links", "color"], ["highlight", "==Highlights==", "choice", ["mark", "underline"]],
        ["h4Color", "#### headings", "color"], ["h4Underline", "#### underline", "color"], ["h4Case", "#### case", "choice", ["none", "uppercase"]],
        ["h5Color", "##### headings", "color"],
    ]],
    ["Effects", [
        ["grid", "Grid pattern", "bool"], ["gridColor", "Grid colour", "color"], ["gridOpacity", "Grid strength", "range", [0, 0.3, 0.005]], ["gridSize", "Grid size (px)", "range", [6, 60, 1]],
        ["ruled", "Ruled lines (one per line of text)", "bool"], ["ruleColor", "Rule colour", "color"], ["ruleOpacity", "Rule strength", "range", [0, 0.6, 0.01]],
        ["quoteMark", "Big faded opening quote mark", "bool"], ["quoteMarkColor", "Quote mark colour", "color"],
        ["inset", "Paper shading (inner shadow)", "bool"],
    ]],
];
export const COLOR_KEYS = new Set(STYLE_GROUPS.flatMap(([, fs]) => fs.filter((f) => f[2] === "color").map((f) => f[0])));

/** Settings every style starts from */
export const BASE_STYLE = {
    font: "inherit", fontSize: 1, width: 100, align: "left", padding: 12, radius: 6, margin: 0.8, rotate: 0,
    background: "", background2: "", gradientAngle: 135, borderColor: "", borderWidth: 0, borderStyle: "solid", barColor: "", barWidth: 0,
    shadowColor: "", shadowSize: 0, shadowOpacity: 0.15,
    titleShow: true, titlePosition: "top", titleBackground: "", titleFade: false, titleColor: "", titleSize: 1, titleWeight: "600", titleCase: "none",
    titleAlign: "left", titleSpacing: 0, titlePrefix: "", titlePrefixColor: "",
    textColor: "", contentBackground: "", contentOpacity: 0, italic: false, lineHeight: 1.55, paragraphGap: 0.6, textAlign: "left", indent: 0,
    boldColor: "", linkColor: "", highlight: "mark", h4Color: "", h4Underline: "", h4Case: "none", h5Color: "",
    grid: false, gridColor: "#4a9eff", gridOpacity: 0.03, gridSize: 20, ruled: false, ruleColor: "#b08d57", ruleOpacity: 0.13,
    quoteMark: false, quoteMarkColor: "", inset: false, css: "", dark: {},
};

/**
 * The modern card most callouts share: a white card (deep slate in dark mode) with a thin border and a soft shadow,
 * a small uppercase label in the type's accent colour over the title, #### headings as small accent headers.
 * accent / accentDark colour the label, bold text, links and headings; tint / tintDark the card's lower edge.
 */
const cardCss = (tag) => [
    "& > .callout-title { padding: 11px 16px 9px; border-bottom: 1px solid var(--co-border); border-radius: 0; }",
    tag ? `& > .callout-title::before { content: '${tag}'; display: block; margin-bottom: 1px; font-size: .62em; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--co-prefix); }` : "",
    "& > .callout-content { padding: 8px 16px 12px; }",
    "& h4 { font-size: .74em; letter-spacing: .14em; margin: 12px 0 4px; padding-bottom: 3px; border-bottom-color: color-mix(in srgb, var(--co-h4-line) 35%, transparent); }",
    "& h5 { margin: 10px 0 2px; }",
    "& ul { margin: 4px 0; padding-left: 1.2em; } & li::marker { color: var(--co-bold); }",
    "& code { font-size: .88em; padding: 1px 5px; border-radius: 5px; background: color-mix(in srgb, var(--co-text) 8%, transparent); }",
].filter(Boolean).join(" ");
const CARD = ({ label, tag, accent, accentDark, tint, tintDark, extra = {}, dark = {}, css = "" }) => ({
    label, font: "inherit", width: 88, align: "center", padding: 0, radius: 12, margin: 1.1, lineHeight: 1.5,
    background: "#ffffff", background2: tint, gradientAngle: 180, borderColor: "#dfe3ea", borderWidth: 1,
    shadowColor: "#1d2b4a", shadowSize: 16, shadowOpacity: 0.09,
    titleColor: "#1b2333", titleSize: 1.05, titleWeight: "700", titleSpacing: 0.1, titlePrefixColor: accent,
    textColor: "#2a3140", boldColor: accent, linkColor: accent, h4Color: accent, h4Underline: accent, h4Case: "uppercase", h5Color: "#1b2333",
    ...extra,
    dark: { background: "#181c24", background2: tintDark, borderColor: "#2b3240", shadowColor: "#000000", titleColor: "#eef2f8", titlePrefixColor: accentDark,
        textColor: "#d8dee9", boldColor: accentDark, linkColor: accentDark, h4Color: accentDark, h4Underline: accentDark, h5Color: "#eef2f8", ...dark },
    css: [cardCss(tag), css].filter(Boolean).join(" "),
});

export const DEFAULT_STYLES = {
    // any other callout: a soft tint of its bar colour, which follows the theme
    default: { label: "Any other callout", barColor: "#6a4fc4", barWidth: 3, radius: 8, padding: 0, titleColor: "#4b36a8", titleWeight: "700", textColor: "",
        dark: { barColor: "#a594f9", titleColor: "#c4b8ff" },
        css: "& { background: color-mix(in srgb, var(--co-bar) 9%, transparent); } & > .callout-title { padding: 8px 14px 2px; } & > .callout-content { padding: 4px 14px 10px; }" },
    // a plain > quote: a quiet card, set off from the text around it
    quote: { label: "Plain quote (> text)", width: 80, align: "center", padding: 14, radius: 12, margin: 1.6, borderWidth: 1, borderColor: "#e3dfd6", barColor: "#b9ab8f", barWidth: 3,
        textColor: "#4a4438", italic: true, lineHeight: 1.65,
        dark: { borderColor: "#3a3730", barColor: "#8a7c60", textColor: "#d6cfbf" },
        css: "& { background: color-mix(in srgb, var(--co-bar) 7%, transparent); }" },
    system: CARD({ label: "System", tag: "System", accent: "#5a48d0", accentDark: "#a99cff", tint: "#f5f3fe", tintDark: "#16141f",
        extra: { grid: true, gridColor: "#5a48d0", gridOpacity: 0.035, gridSize: 18 }, dark: { gridColor: "#a99cff" } }),
    // the stats panel's status window: a card that follows the theme (a light page in light mode, deep slate in dark),
    // a small "STATUS" label over the name, a table per section, bars in their own column in the accent colour
    status: {
        label: "Status window (stats)", font: "inherit", width: 86, align: "center", padding: 0, radius: 12, margin: 1.2,
        background: "#ffffff", background2: "#f4f7fc", gradientAngle: 180, borderColor: "#dde3ee", borderWidth: 1,
        shadowColor: "#1d2b4a", shadowSize: 18, shadowOpacity: 0.1,
        titleColor: "#1b2436", titleSize: 1.1, titleWeight: "700", titleSpacing: 0.2, titlePrefixColor: "#3461c4",
        textColor: "#263042", boldColor: "#3461c4", h4Color: "#3461c4", lineHeight: 1.45,
        css: "& > .callout-title { padding: 12px 16px 10px; border-bottom: 1px solid var(--co-border); border-radius: 0; }"
            + " & > .callout-title::before { content: 'Status'; display: block; margin-bottom: 1px; font-size: .6em; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: var(--co-prefix); }"
            + " & > .callout-content { padding: 4px 16px 12px; }"
            + " & > .callout-content > p:first-child { margin: 6px 0 2px; font-size: .78em; letter-spacing: .04em; color: color-mix(in srgb, var(--co-text) 58%, transparent); }"
            + " & table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 10px 0 2px; font-variant-numeric: tabular-nums; }"
            + " & th { padding: 4px 8px; text-align: left; font-size: .68em; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--co-bold); background: none; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--co-bold) 35%, transparent); }"
            + " & td { padding: 4px 8px; background: none; border: 0; }"
            + " & tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--co-text) 4.5%, transparent); }"
            + " & td:first-child { color: color-mix(in srgb, var(--co-text) 70%, transparent); }"
            + " & td:nth-child(2) { color: var(--co-bold); white-space: nowrap; font-size: .8em; letter-spacing: -.5px; text-align: right; }"
            + " & td:last-child { text-align: right; font-weight: 600; white-space: nowrap; }"
            + " & h4 { font-size: .72em; letter-spacing: .16em; text-transform: uppercase; margin: 12px 0 4px; }",
        dark: { background: "#181d27", background2: "#10141c", borderColor: "#2a3343", shadowColor: "#000000", titleColor: "#eef2f8",
            titlePrefixColor: "#86a8ff", textColor: "#d9e0ec", boldColor: "#86a8ff", h4Color: "#86a8ff" },
    },
    // a notification: a slimmer card with an accent bar, like a toast
    sysnotify: CARD({ label: "System notification", tag: "Notification", accent: "#0d8a84", accentDark: "#4fd1c5", tint: "#f2fbfa", tintDark: "#121c1e",
        extra: { width: 80, radius: 10, barColor: "#0d8a84", barWidth: 4, titleSize: 0.98, shadowSize: 22, shadowOpacity: 0.12 }, dark: { barColor: "#4fd1c5" } }),
    inventory: CARD({ label: "Inventory", tag: "Inventory", accent: "#0f7a5f", accentDark: "#5fd3a9", tint: "#f1faf6", tintDark: "#121d19" }),
    item: CARD({ label: "Item", tag: "Item", accent: "#9a5b0c", accentDark: "#e8b25c", tint: "#fdf8f0", tintDark: "#1f1a12",
        extra: { width: 84 } }),
    // a blueprint: drafting-paper blue with a fine grid
    blueprint: CARD({ label: "Blueprint", tag: "Blueprint", accent: "#1f5fae", accentDark: "#7fb2ff", tint: "#eef4fd", tintDark: "#0f1a2b",
        extra: { grid: true, gridColor: "#1f5fae", gridOpacity: 0.07, gridSize: 16, borderColor: "#cddcf2" }, dark: { gridColor: "#7fb2ff", borderColor: "#24364f" } }),
    // a journal page: warm paper, ruled lines, the writer's name signed at the bottom
    journal: {
        label: "Journal", font: "serif", width: 85, align: "center", padding: 22, radius: 10, margin: 2, background: "#fdf9ef", background2: "#f4ecdb", gradientAngle: 180,
        borderColor: "#eadfca", borderWidth: 1,
        titlePosition: "bottom", titleAlign: "right", titleWeight: "400", titleCase: "small-caps", titleSize: 0.9, titleColor: "#8a6a3b", titleSpacing: 0.5, titlePrefix: "—",
        textColor: "#3b3226", italic: true, lineHeight: 1.8, paragraphGap: 0, indent: 1.5, ruled: true, ruleColor: "#b08d57", ruleOpacity: 0.2,
        quoteMark: true, quoteMarkColor: "#8a6a3b", shadowColor: "#5a4320", shadowSize: 16, shadowOpacity: 0.12,
        dark: { background: "#2a241d", background2: "#201b15", borderColor: "#3d3428", textColor: "#e6dac5", titleColor: "#c39a5f", titlePrefixColor: "#c39a5f", quoteMarkColor: "#c39a5f",
            ruleColor: "#c39a5f", shadowColor: "#000000" },
        css: "& { border-radius: 4px 12px 12px 4px; }",
    },
    // a note in the margin, in pencil
    pencil: {
        label: "Pencil note", font: "hand", width: 85, align: "center", padding: 6, radius: 0, margin: 0.4, rotate: -0.5, fontSize: 0.92,
        titleColor: "#5f5a52", titleWeight: "400", titleSize: 0.92, textColor: "#5f5a52", highlight: "underline", lineHeight: 1.5, barColor: "#8d867b", barWidth: 2,
        dark: { titleColor: "#c2bbb5", textColor: "#c2bbb5" },   // the bar's graphite reads on both
        css: "& .callout-title { text-decoration: underline wavy color-mix(in srgb, currentColor 60%, transparent) 1px; text-underline-offset: .25em; }\n& { border-radius: .45em 0 0 .45em / 40% 0 0 40%; }",
    },
};

/** Saved styles over the defaults: each type's settings over BASE_STYLE and, for built-in types, their defaults */
export function mergeStyles(saved = {}) {
    const out = {};
    for (const k of new Set([...Object.keys(DEFAULT_STYLES), ...Object.keys(saved ?? {})])) {
        const d = DEFAULT_STYLES[k] ?? {}, s = saved[k] && typeof saved[k] === "object" ? saved[k] : {};
        out[k] = { ...BASE_STYLE, ...d, ...s, dark: { ...(s.dark ?? d.dark ?? {}) } };
    }
    return out;
}

/** Only what differs from the defaults, per type (what the note stores); unchanged built-in types are left out */
export function compactStyles(styles) {
    const out = {};
    for (const [k, st] of Object.entries(styles)) {
        const base = { ...BASE_STYLE, ...(DEFAULT_STYLES[k] ?? {}) };
        const diff = {};
        for (const [key, v] of Object.entries(st)) {
            if (key === "dark") continue;
            if (JSON.stringify(v) !== JSON.stringify(base[key])) diff[key] = v;
        }
        const dark = Object.fromEntries(Object.entries(st.dark ?? {}).filter(([, v]) => v !== "" && v != null));
        if (JSON.stringify(dark) !== JSON.stringify(base.dark ?? {})) diff.dark = dark;
        if (Object.keys(diff).length || !DEFAULT_STYLES[k]) out[k] = diff;
    }
    return out;
}

const hexA = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
    if (!m) return hex || "transparent";
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
};
const cssEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
const typeSel = (t) => (t === "quote" ? "blockquote" : t === "default" ? ".callout" : `.callout[data-callout="${cssEsc(t).toLowerCase()}"]`);

/** Colour values of a style in a mode, as custom properties */
function colorVars(s, dark) {
    const c = (k) => (dark && s.dark?.[k] ? s.dark[k] : s[k]);
    const bg = c("background"), bg2 = c("background2");
    return [
        // always an image, so it can sit under the grid and rule layers
        `--co-bg: ${bg ? `linear-gradient(${s.gradientAngle}deg, ${bg} 0%, ${bg2 || bg} 100%)` : "linear-gradient(transparent, transparent)"}`,
        `--co-border: ${c("borderColor") || "transparent"}`, `--co-bar: ${c("barColor") || "transparent"}`,
        `--co-shadow: ${c("shadowColor") ? hexA(c("shadowColor"), s.shadowOpacity) : "transparent"}`,
        `--co-title-bg: ${c("titleBackground") ? (s.titleFade ? `linear-gradient(90deg, ${c("titleBackground")} 0%, ${hexA(c("titleBackground"), 0.32)} 60%, ${hexA(c("titleBackground"), 0)} 80%)` : c("titleBackground")) : "none"}`,
        `--co-title: ${c("titleColor") || "inherit"}`, `--co-prefix: ${c("titlePrefixColor") || "inherit"}`,
        `--co-text: ${c("textColor") || "inherit"}`, `--co-body: ${c("contentBackground") ? hexA(c("contentBackground"), s.contentOpacity) : "transparent"}`,
        `--co-bold: ${c("boldColor") || "inherit"}`, `--co-link: ${c("linkColor") || "var(--accent)"}`,
        `--co-h4: ${c("h4Color") || "inherit"}`, `--co-h4-line: ${c("h4Underline") || "transparent"}`, `--co-h5: ${c("h5Color") || "inherit"}`,
        `--co-grid: ${hexA(c("gridColor"), s.gridOpacity)}`, `--co-rule: ${hexA(c("ruleColor"), s.ruleOpacity)}`, `--co-qmark: ${c("quoteMarkColor") || "currentColor"}`,
    ].join("; ");
}

/**
 * A stylesheet for the styles. `scope` prefixes every selector (the designer's preview uses a scope so drafts beat the
 * saved styles there); `chapter` adds the chapter text rules (justified, indented paragraphs, centred images).
 */
export function calloutCss(styles, { scope = "", obsidian = false } = {}) {
    const out = [];
    const pre = scope ? `${scope} ` : "";
    for (const [type, s] of Object.entries(styles)) {
        const sel = `${pre}${typeSel(type)}`;
        const blockquote = type === "quote";
        out.push(`${sel} { ${colorVars(s, false)} }`);
        // the designer's preview can show either mode whatever the app's theme
        if (scope) out.push(`${scope}.co-force-light ${typeSel(type)} { ${colorVars(s, false).replace(/;/g, " !important;")} !important }`,
            `${scope}.co-force-dark ${typeSel(type)} { ${colorVars(s, true).replace(/;/g, " !important;")} !important }`);
        if (obsidian) out.push(`.theme-dark ${sel} { ${colorVars(s, true)} }`);
        else {
            out.push(`:root[data-theme="dark"] ${sel} { ${colorVars(s, true)} }`);
            out.push(`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ${sel} { ${colorVars(s, true)} } }`);
        }
        const shadows = [s.shadowSize ? `0 0 ${s.shadowSize}px var(--co-shadow)` : "", s.inset ? "inset 0 0 40px rgba(0,0,0,.18)" : ""].filter(Boolean).join(", ") || "none";
        const grid = s.grid ? `linear-gradient(var(--co-grid) 1px, transparent 1px), linear-gradient(90deg, var(--co-grid) 1px, transparent 1px), ` : "";
        out.push(`${sel} { position: relative; box-sizing: border-box; font-family: ${FONTS[s.font] ?? "inherit"}; font-size: ${obsidian ? `calc(var(--font-text-size, 16px) * ${s.fontSize})` : `calc(var(--writer-size, 18px) * ${s.fontSize})`};
            width: ${s.width}%; margin: ${s.margin}em ${s.align === "center" ? "auto" : "0"}; padding: ${s.padding}px; border-radius: ${s.radius}px;
            background: ${grid}var(--co-bg); ${s.ruled ? `background-image: ${grid}linear-gradient(to bottom, transparent calc(100% - 1px), var(--co-rule) calc(100% - 1px)), var(--co-bg); background-size: ${s.grid ? `${s.gridSize}px ${s.gridSize}px, ${s.gridSize}px ${s.gridSize}px, ` : ""}100% ${s.lineHeight}em, 100% 100%; background-position: ${s.grid ? "0 0, 0 0, " : ""}0 ${-(s.lineHeight * 0.3).toFixed(2)}em, 0 0;`
                : s.grid ? `background-size: ${s.gridSize}px ${s.gridSize}px, ${s.gridSize}px ${s.gridSize}px, 100% 100%;` : ""}
            border: ${s.borderWidth}px ${s.borderStyle} var(--co-border); border-left: ${s.barWidth ? `${s.barWidth}px solid var(--co-bar)` : `${s.borderWidth}px ${s.borderStyle} var(--co-border)`};
            box-shadow: ${shadows}; color: var(--co-text); text-indent: 0; text-align: ${s.textAlign}; line-height: ${s.lineHeight};
            ${s.rotate ? `transform: rotate(${s.rotate}deg);` : "transform: none;"} ${s.italic && blockquote ? "font-style: italic;" : "font-style: normal;"} overflow: visible; }`);
        if (blockquote) {
            out.push(`${sel} p { margin: 0; text-indent: 0; } ${sel} p + p { margin-top: ${s.paragraphGap}em; ${s.indent ? `text-indent: ${s.indent}em;` : ""} }`);
        } else {
            out.push(`${sel} { display: flex; flex-direction: ${s.titlePosition === "bottom" ? "column-reverse" : "column"}; }`);
            out.push(`${sel} > .callout-title { ${s.titleShow ? "display: block;" : "display: none;"} margin: 0; padding: ${s.titleBackground || s.background ? "5px 10px" : "0"};
                background: var(--co-title-bg); color: var(--co-title); font-size: ${s.titleSize}em; font-weight: ${s.titleWeight}; text-align: ${s.titleAlign};
                text-transform: ${s.titleCase === "uppercase" ? "uppercase" : "none"}; font-variant: ${s.titleCase === "small-caps" ? "small-caps" : "normal"};
                letter-spacing: ${s.titleSpacing}px; border-radius: ${Math.max(0, s.radius - 2)}px; font-style: normal; }`);
            if (s.titlePrefix) out.push(`${sel} > .callout-title::before { content: "${cssEsc(s.titlePrefix)} "; color: var(--co-prefix);${obsidian ? " margin-right: .3em;" : ""} }`);
            out.push(`${sel} > .callout-content { position: relative; padding: ${s.padding ? 0 : "10px 15px"}; background: var(--co-body); border-radius: 0 0 ${Math.max(0, s.radius - 2)}px ${Math.max(0, s.radius - 2)}px;
                ${s.italic ? "font-style: italic;" : ""} }`);
            out.push(`${sel} > .callout-content p { margin: 0; text-indent: 0; } ${sel} > .callout-content p + p, ${sel} > .callout-content ul + p, ${sel} > .callout-content p + ul { margin-top: ${s.paragraphGap}em; }`);
            if (s.indent) out.push(`${sel} > .callout-content p + p { text-indent: ${s.indent}em; }`);
            if (s.quoteMark) out.push(`${sel} > .callout-content::before { content: "\\201C"; position: absolute; top: -0.3em; left: -0.32em; font-size: 4em; line-height: 1; font-style: normal; color: var(--co-qmark); opacity: .3; pointer-events: none; }`);
        }
        out.push(`${sel} strong { color: var(--co-bold); } ${sel} a { color: var(--co-link); text-decoration: none; }`);
        out.push(`${sel} h4 { color: var(--co-h4); font-size: 1.1em; margin: 1em 0 .4em; text-transform: ${s.h4Case}; ${s.h4Underline ? "border-bottom: 1px solid var(--co-h4-line); padding-bottom: 4px;" : ""} } ${sel} h5 { color: var(--co-h5); font-size: 1em; margin: .8em 0 .2em; }`);
        out.push(`${sel} img { display: block; margin: 1em auto; max-width: 80%; }`);
        if (s.highlight === "underline") out.push(`${sel} mark { background: none; color: inherit; text-decoration: underline currentColor 1.5px; text-underline-offset: .2em; }`);
        if (s.css?.trim()) out.push(scopeCss(s.css, sel));
        if (obsidian && !blockquote) out.push(obsidianFixes(sel, s));
    }
    return out.join("\n");
}

/**
 * What Obsidian's callouts need on top: its icon hidden, its title a flex row (icon, title, fold) that wraps so a
 * label drawn before the title sits above it, its own colour, blend and table rules switched off, internal links
 * in the link colour.
 */
function obsidianFixes(sel, s) {
    const justify = { left: "flex-start", center: "center", right: "flex-end" }[s.titleAlign] ?? "flex-start";
    return [
        `${sel} { --callout-color: 106, 79, 196; mix-blend-mode: normal; --callout-padding: 0; --table-border-width: 0; --table-header-border-width: 0; --table-header-background: transparent; --table-header-background-hover: transparent; --table-row-background-hover: transparent; --table-row-alt-background: transparent; --table-row-alt-background-hover: transparent; }`,
        `${sel} > .callout-title .callout-icon { display: none; }`,
        `${sel} > .callout-title { ${s.titleShow ? "display: flex;" : "display: none;"} flex-wrap: wrap; align-items: baseline; justify-content: ${justify}; gap: 0; }`,
        `${sel} > .callout-title .callout-title-inner { color: inherit; font-weight: inherit; }`,
        s.titlePrefix ? "" : `${sel} > .callout-title::before { flex-basis: 100%; }`,
        `${sel} .internal-link, ${sel} .external-link { color: var(--co-link); text-decoration: none; }`,
        `${sel} .callout-content { color: var(--co-text); }`,
    ].filter(Boolean).join("\n");
}

/**
 * An Obsidian CSS snippet for callout styles (all but "any other callout" and plain quotes, which would restyle
 * every callout and quote in the vault). Sizes follow Obsidian's text size the way World Builder's follow the
 * chapter text size.
 */
export function obsidianCss(styles, { skip = ["default", "quote"] } = {}) {
    const picked = Object.fromEntries(Object.entries(styles).filter(([k]) => !skip.includes(k)));
    return [
        "/*",
        " * World Builder callouts for Obsidian, made by World Builder's callout designer.",
        " * Put this file in your vault's .obsidian/snippets/ folder and turn it on under",
        " * Settings → Appearance → CSS snippets. Light and dark follow Obsidian's theme;",
        " * text sizes are multiples of your editor text size.",
        ` * Types: ${Object.keys(picked).join(", ")}`,
        " */",
        calloutCss(picked, { obsidian: true }),
        "",
    ].join("\n");
}

/** "& .x { … }" -> "<sel> .x { … }"; rules without "&" apply inside the callout */
function scopeCss(css, sel) {
    return String(css).replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((rule) => {
        const i = rule.indexOf("{");
        if (i < 0) return "";
        const sels = rule.slice(0, i).split(",").map((x) => x.trim()).filter(Boolean)
            .map((x) => (x.includes("&") ? x.replace(/&/g, sel) : `${sel} ${x}`));
        return sels.length ? `${sels.join(", ")} {${rule.slice(i + 1)}}` : "";
    }).join("\n");
}

/** Example markdown for the designer's preview */
export function sampleFor(type) {
    if (type === "quote") return "> The rain had not stopped for three days.\n> Nobody in the village remembered a summer like it.";
    if (type === "journal") return "> [!journal] Wade's journal\n> I found the clearing again today. The stones were warm, though the sun had long set.\n>\n> Tomorrow I will bring Hilda.";
    if (type === "pencil") return "> [!pencil] Margin note\n> Check the timeline: Hilda reaches the second layer **before** the hunt, not after. ==Fix in ch 12==";
    if (type === "item" || type === "inventory" || type === "blueprint") return `> [!${type}] Steel Sword\n> A plain blade, well kept.\n>\n> **Rarity:** Common\n> **Condition:** Worn\n>\n> **Value:** 40 silver`;
    return `> [!${type}] ${type === "default" ? "Note" : type[0].toUpperCase() + type.slice(1)}\n> #### Status\n> **Level:** 4 → 5\n> ##### Skill gained\n> A short description of what happened, with a [[link]].`;
}
