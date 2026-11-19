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
        ["font", "Font", "choice", Object.keys(FONTS)], ["fontSize", "Font size (em)", "range", [0.7, 1.4, 0.01]],
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

// The look of the vault's DeezThing theme
const GAME = {
    font: "mono", width: 90, align: "center", radius: 8, padding: 0, background: "#1a1a1a", background2: "#2d2d2d",
    shadowColor: "#b6b6b6", shadowSize: 12, shadowOpacity: 0.15, titleColor: "#d8d8d8", titleWeight: "700", titleSpacing: 1,
    textColor: "#c2c2c2", contentBackground: "#000000", contentOpacity: 0.1, boldColor: "#4a9eff", linkColor: "#aa5b02",
    grid: true, gridColor: "#4a9eff", gridOpacity: 0.03, gridSize: 20, lineHeight: 1.5,
};
const FRAMED = (bg, bg2, border, glow, glowA, title) => ({
    ...GAME, width: 92, radius: 6, background: bg, background2: bg2, borderColor: border, borderWidth: 1,
    shadowColor: glow, shadowSize: 20, shadowOpacity: glowA, titleBackground: title, titleFade: true, titleWeight: "300", titleSize: 0.85, titleSpacing: 1,
});
export const DEFAULT_STYLES = {
    default: { label: "Any other callout", barColor: "#6a4fc4", barWidth: 4, background: "#6a4fc4", contentOpacity: 0, css: "& { background: color-mix(in srgb, #6a4fc4 12%, transparent); }" },
    quote: { label: "Plain quote (> text)", width: 80, align: "center", padding: 16, radius: 15, margin: 2, borderWidth: 1, borderColor: "#c2c2c2", background: "#646464",
        css: "& { background: rgba(100, 100, 100, .1); }", dark: { borderColor: "#6f6a60" } },
    system: { label: "System", ...GAME, titleBackground: "#003775", titleFade: true, titleCase: "uppercase", titleSize: 0.9,
        h4Color: "#7321dd", h4Underline: "#4a9eff", h4Case: "uppercase", h5Color: "#27abbd", padding: 0,
        dark: { background: "#0a0a0a", background2: "#1a1a1a", textColor: "#f0f0f0", contentOpacity: 0.5 } },
    sysnotify: { label: "System notification", ...GAME, titleBackground: "#3e4042", titleFade: true, titleWeight: "300", titleSize: 0.85,
        h4Color: "#7321dd", h4Underline: "#4a9eff", h4Case: "uppercase", h5Color: "#27abbd",
        dark: { background: "#0a0a0a", background2: "#1a1a1a", textColor: "#f0f0f0", contentOpacity: 0.5 } },
    inventory: { label: "Inventory", ...FRAMED("#06282e", "#0a4452", "#025d79", "#147179", 0.2, "#233744"), h4Color: "#848485", boldColor: "" },
    item: { label: "Item", ...FRAMED("#1e2226", "#2b3135", "#6b747c", "#96a0aa", 0.14, "#3a4046"), boldColor: "#a9b3bc" },
    blueprint: { label: "Blueprint", ...FRAMED("#1b2430", "#283748", "#6f8db3", "#82a0c8", 0.14, "#3f5573"), boldColor: "#b2c3d8",
        titlePrefix: "Blueprint ·", titlePrefixColor: "#a9bddb" },
    journal: {
        label: "Journal", font: "serif", width: 85, align: "center", padding: 22, radius: 6, margin: 2, background: "#fbf6ea", background2: "#f1e8d4", gradientAngle: 180,
        titlePosition: "bottom", titleAlign: "right", titleWeight: "400", titleCase: "small-caps", titleSize: 0.9, titleColor: "#8a6a3b", titleSpacing: 0.5, titlePrefix: "—",
        textColor: "#3b3226", italic: true, lineHeight: 1.8, paragraphGap: 0, indent: 1.5, ruled: true, ruleColor: "#b08d57", ruleOpacity: 0.22,
        quoteMark: true, quoteMarkColor: "#8a6a3b", inset: true, shadowColor: "#000000", shadowSize: 10, shadowOpacity: 0.35,
        dark: { background: "#2b251e", background2: "#211c16", textColor: "#e4d8c3", titleColor: "#b08d57", titlePrefixColor: "#b08d57", quoteMarkColor: "#b08d57" },
        css: "& { border-radius: 3px 10px 10px 3px; }",
    },
    pencil: {
        label: "Pencil note", font: "hand", width: 85, align: "center", padding: 4, radius: 0, margin: 0.4, rotate: -0.5, fontSize: 0.92,
        titleColor: "#6c675f", titleWeight: "400", titleSize: 0.92, textColor: "#6c675f", highlight: "underline", lineHeight: 1.5, barColor: "#6c675f", barWidth: 1,
        dark: { titleColor: "#bcb5b1", textColor: "#bcb5b1", barColor: "#bcb5b1" },
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
export function calloutCss(styles, { scope = "" } = {}) {
    const out = [];
    const pre = scope ? `${scope} ` : "";
    for (const [type, s] of Object.entries(styles)) {
        const sel = `${pre}${typeSel(type)}`;
        const blockquote = type === "quote";
        out.push(`${sel} { ${colorVars(s, false)} }`);
        // the designer's preview can show either mode whatever the app's theme
        if (scope) out.push(`${scope}.co-force-light ${typeSel(type)} { ${colorVars(s, false).replace(/;/g, " !important;")} !important }`,
            `${scope}.co-force-dark ${typeSel(type)} { ${colorVars(s, true).replace(/;/g, " !important;")} !important }`);
        out.push(`:root[data-theme="dark"] ${sel} { ${colorVars(s, true)} }`);
        out.push(`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ${sel} { ${colorVars(s, true)} } }`);
        const shadows = [s.shadowSize ? `0 0 ${s.shadowSize}px var(--co-shadow)` : "", s.inset ? "inset 0 0 40px rgba(0,0,0,.18)" : ""].filter(Boolean).join(", ") || "none";
        const grid = s.grid ? `linear-gradient(var(--co-grid) 1px, transparent 1px), linear-gradient(90deg, var(--co-grid) 1px, transparent 1px), ` : "";
        out.push(`${sel} { position: relative; box-sizing: border-box; font-family: ${FONTS[s.font] ?? "inherit"}; font-size: ${s.fontSize}em;
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
            if (s.titlePrefix) out.push(`${sel} > .callout-title::before { content: "${cssEsc(s.titlePrefix)} "; color: var(--co-prefix); }`);
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
    }
    return out.join("\n");
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
