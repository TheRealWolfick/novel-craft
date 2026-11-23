// Chapters as units of a novel: changing a chapter's number (its note, its plan, its ledger entries and everything that
// links to them follow), and the archive (a chapter and its plan moved out of the novel's folders together, and back;
// archived ones can be deleted). A chapter and its plan have one title, and every plan has a chapter note (made empty
// with the plan). A live and an archived chapter never have the same number and title: every way of making, naming or
// numbering one is checked. Everything is checked before the first file is touched.
import fsp from "node:fs/promises";
import path from "node:path";
import { ConflictError, atomicWrite, patchNote, sanitizeName, trashNote } from "./write.js";
import { padChapter } from "./plans.js";
import { LINK } from "./rename.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const LEADING = /^(\d+(?:\.\d+)?)/;
const numberOf = (n) => { const x = Number(n.fm.chapter ?? LEADING.exec(n.name)?.[1]); return Number.isFinite(x) ? x : null; };
const restOf = (name) => name.replace(/^\d+(\.\d+)?\s*-?\s*/, "");
const unarchived = (name) => name.replace(/ \(Archived(?: \d+)?\)/g, "");
const same = (a, b) => sanitizeName(a).toLowerCase() === sanitizeName(b).toLowerCase();
const named = (n, title) => `chapter ${n}${title ? ` “${title}”` : " without a title"}`;
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export class Chapters {
    constructor(vault, novels, plans, renamer) { this.vault = vault; this.novels = novels; this.plans = plans; this.renamer = renamer; }

    archiveFolders(novel) {
        const base = `${novel.folder}/${String(novel.config["archive-folder"] ?? "").replace(/^\/+|\/+$/g, "") || "Archive"}`;
        return { chapters: `${base}/Chapters`, plans: `${base}/Chapter Plans` };
    }

    /** {number: {note, plan, title}} of the novel's chapters (notes and plans) */
    byNumber(novel) {
        return new Map(this.plans.chapters(novel).map((c) => [c.number, c]));
    }

    entryCount(novel, n) {
        return this.novels.ledgers(novel).reduce((s, l) => s + l.entries.filter((e) => e.chapter === n).length, 0);
    }

    // ------------------------------------------------------------ titles, notes, and the archive's names

    /** What a path is: {novel, kind: "chapter" | "plan", archived} or null */
    kindOf(p) {
        const novel = this.novels.get(p.split("/")[0]);
        if (!novel) return null;
        const folder = path.posix.dirname(p), a = this.archiveFolders(novel);
        if (folder === novel.chaptersFolder) return { novel, kind: "chapter", archived: false };
        if (folder === this.plans.folders(novel).chapters) return { novel, kind: "plan", archived: false };
        if (folder === a.chapters) return { novel, kind: "chapter", archived: true };
        if (folder === a.plans) return { novel, kind: "plan", archived: true };
        return null;
    }

    /** Refuse a live chapter that would have an archived one's number and title (`except`: the archived one being restored) */
    assertNotArchived(novel, n, title, except = null) {
        if (this.archive(novel).some((a) => a.id !== except && a.number === n && same(a.title, title)))
            throw fail(409, `The archive has ${named(n, title)}. Give this one another title or number, or restore the archived one`);
    }

    /** The chapter note's path for a chapter that has none yet: made empty, with the plan's title */
    async ensureNote(novel, n) {
        const c = this.byNumber(novel).get(n);
        if (c?.notePath) return c.notePath;
        this.assertNotArchived(novel, n, c?.title ?? "");
        // (two open copies of a plan may ask at once: the second finds the first one's note)
        try { return await this.novels.createChapter(novel, n, c?.title ?? ""); }
        catch (e) { const now = this.byNumber(novel).get(n)?.notePath; if (e.status === 409 && now) return now; throw e; }
    }

    /** A chapter note made from the writer: its title (default the plan's) is the plan's too */
    async createChapter(novel, n, title = "") {
        const c = this.byNumber(novel).get(n);
        const t = String(title ?? "").trim() || c?.title || "";
        if (!c?.notePath) this.assertNotArchived(novel, n, t);
        const rel = await this.novels.createChapter(novel, n, t);
        if (c?.planPath && String(this.vault.notes.get(c.planPath).fm.title ?? "") !== t) await patchNote(this.vault, c.planPath, { set: { title: t } });
        return rel;
    }

    /** Create or update the plan of chapter n; its title is the chapter's, and the chapter gets a note. {path, mtime, title, chapterPath, files} */
    async savePlan(novel, n, { set = {}, baseMtime } = {}) {
        const c = this.byNumber(novel).get(n), planNote = this.plans.chapterPlans(novel).get(n);
        const title = "title" in set ? String(set.title ?? "").trim() : c?.title ?? "";
        if (!c?.notePath || !same(title, c.title)) this.assertNotArchived(novel, n, title);
        if (planNote && baseMtime != null && Math.abs(planNote.mtime - Number(baseMtime)) > 1) throw new ConflictError(planNote.path);
        let chapterPath = c?.notePath ?? null, files = [];
        if (chapterPath && title !== c.title) { const r = await this.setTitle(chapterPath, title); chapterPath = r.path; files = r.files; }
        const r = await this.plans.saveChapterPlan(novel, n, { set: { ...set, title }, baseMtime });
        if (!chapterPath) chapterPath = await this.ensureNote(novel, n);
        return { ...r, title, chapterPath, files };
    }

    /** The path a chapter note's file gets with another title: only names made of the number and the old title follow it */
    titled(note, title) {
        const m = /^(\d+(?:\.\d+)?)(\s*-\s*|\s+)?(.*)$/.exec(note.name);
        if (!m) return note.path;
        const old = note.fm["chapter title"] || restOf(note.name);
        if (m[3] && !same(m[3], old)) return note.path;
        const clean = sanitizeName(title);
        return `${note.folder}/${m[1]}${clean ? `${m[2] || " - "}${clean}` : ""}.md`;
    }

    /** Set a chapter note's title, in its frontmatter (when it has any) and its file name. {path, files} */
    async setTitle(p, title) {
        const note = this.vault.notes.get(p), to = this.titled(note, title);
        const files = to === p ? [] : [{ from: p, to }];
        await this.checkFree(files);
        if (note.fmText != null && String(note.fm["chapter title"] ?? "") !== title) await patchNote(this.vault, p, { set: { "chapter title": title } });
        if (files.length) await this.renamer.move(p, to);
        return { path: to, files };
    }

    /** Before any edit of a chapter or plan note's fields: numbers are changed on the plan, and no clash with the archive */
    checkPatch(p, { set = {}, unset = [] } = {}) {
        const k = this.kindOf(p), note = this.vault.notes.get(p);
        if (!k || !note) return;
        const n = numberOf(note);
        if (("chapter" in set && Number(set.chapter) !== n) || (unset.includes("chapter") && note.fm.chapter != null))
            throw fail(400, k.archived ? "An archived chapter's number changes when it is restored" : "Change a chapter's number on its plan (Change number), so the chapter, plan and ledger entries move together");
        const key = k.kind === "chapter" ? "chapter title" : "title";
        if (!(key in set) && !unset.includes(key)) return;
        const t = String(set[key] ?? "").trim() || (k.kind === "chapter" ? this.titleLeft(note) : "");
        this.assertTitle(k, p, n, t);
    }

    /** A live or archived chapter note's title now (null for other notes) */
    titleOf(p) { const n = this.vault.notes.get(p); return n && this.kindOf(p)?.kind === "chapter" ? n.fm["chapter title"] || restOf(unarchived(n.name)) : null; }

    /** What a chapter note is called with its title field emptied: what its file name then says */
    titleLeft(note) { return restOf(unarchived(path.posix.basename(this.titled(note, ""), ".md"))); }

    assertTitle(k, p, n, title) {
        if (!k.archived) {
            if (!same(title, this.byNumber(k.novel).get(n)?.title ?? "")) this.assertNotArchived(k.novel, n, title);
            return;
        }
        const row = this.archive(k.novel).find((a) => a.chapterPath === p || a.planPath === p);
        if (k.kind === "plan" && row?.chapterPath) return;   // the chapter's own title names it
        const live = this.byNumber(k.novel).get(n);
        if (live && same(live.title, title)) throw fail(409, `${named(n, title).replace(/^c/, "C")} exists outside the archive`);
        if (row && this.archive(k.novel).some((a) => a.id !== row.id && a.number === n && same(a.title, title))) throw fail(409, `The archive already has ${named(n, title)}`);
    }

    /** Before a chapter note's file is renamed by hand: its name may hold its number and title */
    checkRename(p, name) {
        const k = this.kindOf(p), note = this.vault.notes.get(p);
        if (!k || k.kind !== "chapter" || !note) return;
        const base = sanitizeName(name ?? note.name), n = numberOf(note);
        if (note.fm.chapter == null && Number(LEADING.exec(base)?.[1] ?? NaN) !== n) throw fail(400, "This file's name holds the chapter's number; change it on the plan (Change number)");
        if (!note.fm["chapter title"]) this.assertTitle(k, p, n, restOf(unarchived(base)));
    }

    /**
     * After an edit of a live chapter or plan note (`keys`: the fields changed, "@name" = its file name; `before`: the
     * chapter's title until then): the other one takes its title. {path (its file may follow its title), files}
     */
    async afterPatch(p, keys, before = null) {
        const k = this.kindOf(p), note = this.vault.notes.get(p);
        if (!k || k.archived || !note) return { path: p, files: [] };
        const n = numberOf(note), c = this.byNumber(k.novel).get(n);
        if (k.kind === "chapter") {
            if (c?.notePath !== p) return { path: p, files: [] };
            let r = { path: p, files: [] };
            if (keys.includes("chapter title")) {
                const to = this.titled({ ...note, fm: { ...note.fm, "chapter title": before ?? note.fm["chapter title"] } }, String(note.fm["chapter title"] ?? "").trim());
                const there = to !== p && await fsp.access(this.vault.abs(to)).then(() => true, () => false);
                if (to !== p && !there) { await this.renamer.move(p, to); r = { path: to, files: [{ from: p, to }] }; }   // (a taken file name: the note keeps its own)
            }
            // (the note's own title, also when it was emptied: not one the plan still has)
            const title = String(this.titleOf(r.path) ?? "");
            if (c.planPath && (keys.includes("chapter title") || keys.includes("@name")) && String(this.vault.notes.get(c.planPath).fm.title ?? "") !== title) await patchNote(this.vault, c.planPath, { set: { title } });
            return r;
        }
        if (c?.planPath !== p || !keys.includes("title")) return { path: p, files: [] };
        const title = String(note.fm.title ?? "").trim();
        if (!c.notePath) { await this.ensureNote(k.novel, n); return { path: p, files: [] }; }
        return { path: p, files: title === c.title ? [] : (await this.setTitle(c.notePath, title)).files };
    }

    // ------------------------------------------------------------ numbers

    /**
     * What changing a chapter's number would do. `mode` when the number is taken: "swap" (the two change places) or
     * "insert" (the chapters in between move one along, up to the first gap). Returns {moves: [{from, to, title}],
     * occupied: {number, title} | null, modes, entries (ledger entries that would move), blocked}.
     */
    preview(novel, from, to, { mode = null, ledgers = true } = {}) {
        const all = this.byNumber(novel);
        if (!all.has(from)) throw fail(404, `There is no chapter ${from}`);
        const out = { from, to, moves: [], occupied: null, modes: [], entries: 0, blocked: null };
        if (!Number.isFinite(to) || to < 0) return { ...out, blocked: "Give the new chapter number" };
        if (to === from) return out;
        const map = new Map([[from, to]]);
        if (all.has(to)) {
            out.occupied = { number: to, title: all.get(to).title };
            const chain = this.chain(novel, all, from, to);
            out.modes = ["swap", ...(chain ? ["insert"] : [])];
            if (!mode) return { ...out, blocked: `Chapter ${to} exists${out.occupied.title ? ` (${out.occupied.title})` : ""}` };
            if (mode === "swap") map.set(to, from);
            else if (mode === "insert" && chain) for (const [a, b] of chain) map.set(a, b);
            else return { ...out, blocked: "The chapters can't be moved along there; swap them instead" };
        }
        out.moves = [...map].map(([a, b]) => ({ from: a, to: b, title: all.get(a).title }));
        const counts = out.moves.map((m) => this.entryCount(novel, m.from));
        out.entries = counts.reduce((a, b) => a + b, 0);
        // ledger headings are "## <chapter>.<n>": only whole chapter numbers can hold entries
        const part = out.moves.find((m, i) => counts[i] && !Number.isInteger(m.to));
        if (ledgers && part) out.blocked = `Ledger entries need a whole chapter number (chapter ${part.from} has ${count(this.entryCount(novel, part.from), "entry", "entries")})`;
        const archive = this.archive(novel), hit = out.moves.find((m) => archive.some((a) => a.number === m.to && same(a.title, m.title)));
        if (hit) out.blocked = `The archive has ${named(hit.to, hit.title)}`;
        const targets = out.moves.map((m) => m.to);
        if (new Set(targets).size !== targets.length || targets.some((t) => all.has(t) && !map.has(t))) out.blocked = "Two chapters would get the same number";
        return out;
    }

    /** Making room at `to`: [[from, to], …] for the chapters that move one along, towards `from`, up to the first gap; null when it can't */
    chain(novel, all, from, to) {
        if (!Number.isInteger(to)) return null;
        const limit = this.novels.draftFrom(novel);
        const step = from > to || (from >= limit) !== (to >= limit) ? 1 : -1;
        const out = [];
        for (let k = to; all.has(k) && k !== from; k += step) {
            if (k + step < 0 || (k >= limit) !== (k + step >= limit)) return null;   // never into or out of the drafts
            out.push([k, k + step]);
        }
        return out;
    }

    /** The file name of a chapter note / plan with another number (names without a number stay) */
    numbered(name, n, kind) {
        return kind === "plan" ? name.replace(/^Plan \d+(?:\.\d+)?/, `Plan ${padChapter(n)}`) : name.replace(LEADING, padChapter(n));
    }

    /** Change a chapter's number; returns what preview says, done: {moves, entries} */
    async renumber(novel, from, to, { mode = null, ledgers = true } = {}) {
        const p = this.preview(novel, from, to, { mode, ledgers });
        if (p.blocked) throw fail(409, p.blocked);
        if (!p.moves.length) return p;
        const all = this.byNumber(novel);
        const files = [], patches = [];
        for (const m of p.moves) for (const [kind, rel] of [["chapter", all.get(m.from).notePath], ["plan", all.get(m.from).planPath]]) {
            if (!rel) continue;
            const n = this.vault.notes.get(rel);
            const target = `${n.folder}/${this.numbered(n.name, m.to, kind)}.md`;
            if (target !== rel) files.push({ from: rel, to: target });
            if (kind === "plan" || n.fm.chapter != null) patches.push({ path: target, chapter: m.to });
        }
        await this.checkFree(files);
        await this.moveAll(files);
        for (const x of patches) await patchNote(this.vault, x.path, { set: { chapter: x.chapter } });
        if (ledgers && p.entries) await this.renumberEntries(novel, new Map(p.moves.map((m) => [m.from, m.to])));
        await this.plans.syncVolumes(novel);
        return { ...p, files };
    }

    /** Every target must be free, or a file that itself moves away */
    async checkFree(files) {
        const leaving = new Set(files.map((f) => f.from.toLowerCase())), seen = new Set();
        for (const f of files) {
            const key = f.to.toLowerCase();
            const there = await fsp.access(this.vault.abs(f.to)).then(() => true, () => false);
            if (seen.has(key) || (there && !leaving.has(key))) throw fail(409, `${f.to} already exists`);
            seen.add(key);
        }
    }

    /** Move files whose targets may be each other's places: a free target first, through a spare name when they go round in a circle */
    async moveAll(files) {
        let left = files.map((f) => ({ ...f }));
        while (left.length) {
            const taken = new Set(left.map((f) => f.from.toLowerCase()));
            const i = left.findIndex((f) => f.to.toLowerCase() === f.from.toLowerCase() || !taken.has(f.to.toLowerCase()));
            if (i >= 0) {
                await this.renamer.move(left[i].from, left[i].to);
                left.splice(i, 1);
            } else {
                const spare = left[0].to.replace(/\.md$/, ` ~moving ${Date.now().toString(36)}.md`);
                await this.renamer.move(left[0].from, spare);
                left[0].from = spare;
            }
        }
    }

    /** Ledger entries of renumbered chapters ("## 14.2 …" becomes "## 15.2 …") and the links to them, vault-wide */
    async renumberEntries(novel, map) {
        // entries already at a target that stays keep their numbers: the arriving ones go after them
        const all = this.novels.ledgers(novel);
        const offset = new Map();
        for (const to of map.values()) if (!map.has(to)) offset.set(to, Math.max(0, ...all.flatMap((l) => l.entries.filter((e) => e.chapter === to).map((e) => e.seq))));
        const keys = new Map();   // ledger path -> Map(old key -> new key)
        for (const l of all) {
            const changed = new Map();
            for (const e of l.entries) {
                if (!map.has(e.chapter)) continue;
                const to = map.get(e.chapter), seq = e.seq + (offset.get(to) ?? 0);
                changed.set(e.key, `${to}.${seq}`);
                Object.assign(e, { chapter: to, seq, raw: e.raw.replace(/^##\s+\d+\.\d+/, `## ${to}.${seq}`) });
            }
            if (!changed.size) continue;
            await this.novels.writeLedger(l, l.entries);
            keys.set(l.path, changed);
        }
        const names = [...keys.keys()].map((p) => path.posix.basename(p, ".md").toLowerCase());
        for (const n of [...this.vault.notes.values()]) {
            const hay = `${n.fmText ?? ""}\n${n.body}`.toLowerCase();
            if (!names.some((x) => hay.includes(`${x}#`) || hay.includes(`${x}.md#`))) continue;
            const text = await fsp.readFile(this.vault.abs(n.path), "utf8");
            const next = text.replace(LINK, (whole, open, target, esc, rest) => {
                const m = /^#(\d+\.\d+)(?=[\s|]|$)/.exec(rest);
                const to = m && keys.get(this.vault.resolve(target.trim()))?.get(m[1]);
                return to ? `${open}${target}${esc}#${to}${rest.slice(m[0].length)}]]` : whole;
            });
            if (next !== text) await atomicWrite(this.vault, n.path, next);
        }
        for (const owner of new Set(all.filter((l) => keys.has(l.path)).map((l) => l.owner))) await this.novels.syncSheet(novel, owner);
    }

    // ------------------------------------------------------------ archive

    /** Archived chapters: [{id, number, title, chapterPath, planPath, plan, words, archived}] in chapter order */
    archive(novel) {
        const f = this.archiveFolders(novel);
        const plans = this.vault.inFolder(f.plans), used = new Set();
        const chapters = this.vault.inFolder(f.chapters);
        // a plan names its archived chapter; one put there by hand goes with the only chapter of its number
        const own = new Map(plans.map((p) => [p.fm["archived-chapter"] ? this.vault.resolve(String(p.fm["archived-chapter"])) : null, p]));
        const row = (c, p) => ({
            id: (c ?? p).path, number: numberOf(c ?? p) ?? (p ? numberOf(p) : null), title: String(c?.fm["chapter title"] || (c && restOf(unarchived(c.name))) || p?.fm.title || ""),
            chapterPath: c?.path ?? null, planPath: p?.path ?? null, plan: String(p?.fm.plan ?? ""), words: c ? c.body.split(/\s+/).filter(Boolean).length : 0, archived: p?.fm.archived ? String(p.fm.archived) : null,
        });
        const out = chapters.map((c) => {
            let p = own.get(c.path) ?? null;
            if (!p && chapters.filter((x) => numberOf(x) === numberOf(c)).length === 1) {
                const loose = plans.filter((x) => !x.fm["archived-chapter"] && numberOf(x) === numberOf(c));
                if (loose.length === 1) p = loose[0];
            }
            if (p) used.add(p.path);
            return row(c, p);
        });
        for (const p of plans) if (!used.has(p.path)) out.push(row(null, p));
        return out.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.id.localeCompare(b.id));
    }

    /** A free path in a folder: the name, else "<name> (Archived)", "(Archived 2)"… */
    async freePath(folder, name, label) {
        const free = async (x) => !(await fsp.access(this.vault.abs(`${folder}/${x}.md`)).then(() => true, () => false));
        let x = name;
        for (let i = 1; !(await free(x)); i++) x = `${name} (${label}${i > 1 ? ` ${i}` : ""})`;
        return `${folder}/${x}.md`;
    }

    /** Move chapter n and its plan (whichever exist) to the archive; its ledger entries stay. The number is free afterwards. */
    async archiveChapter(novel, n) {
        const c = this.byNumber(novel).get(n);
        if (!c) throw fail(404, `There is no chapter ${n}`);
        const twin = this.archive(novel).find((a) => a.number === n && same(a.title, c.title));
        if (twin) throw fail(409, `The archive already has ${named(n, c.title)}`);
        const f = this.archiveFolders(novel);
        const base = (p) => path.posix.basename(p, ".md");
        const chapterTo = c.notePath && await this.freePath(f.chapters, base(c.notePath), "Archived");
        // plans are named after their number, so the name is left free for a new plan of this chapter
        const planTo = c.planPath && await this.freePath(f.plans, `${base(c.planPath)} (Archived)`, "Archived");
        for (const x of [chapterTo && f.chapters, planTo && f.plans].filter(Boolean)) await fsp.mkdir(this.vault.abs(x), { recursive: true });
        if (chapterTo) await this.renamer.move(c.notePath, chapterTo);
        if (planTo) {
            await this.renamer.move(c.planPath, planTo);
            await patchNote(this.vault, planTo, { set: { archived: new Date().toISOString().slice(0, 10), ...(chapterTo ? { "archived-chapter": `[[${chapterTo.replace(/\.md$/, "")}]]` } : {}) } });
        }
        return { chapterPath: chapterTo || null, planPath: planTo || null, entries: this.entryCount(novel, n), files: [{ from: c.notePath, to: chapterTo }, { from: c.planPath, to: planTo }].filter((x) => x.from) };
    }

    archived(novel, id) {
        const a = this.archive(novel).find((x) => x.id === id);
        if (!a) throw fail(404, "That chapter is not in the archive any more");
        return a;
    }

    /** Back from the archive, as chapter n (default its own number), which must be free */
    async restore(novel, id, n = null) {
        const a = this.archived(novel, id);
        const number = n ?? a.number;
        if (!Number.isFinite(number) || number < 0) throw fail(400, "Give the chapter number to restore it as");
        const there = this.byNumber(novel).get(number);
        if (there) throw fail(409, `Chapter ${number} exists${there.title ? ` (${there.title})` : ""}; choose another number`);
        this.assertNotArchived(novel, number, a.title, id);
        const plain = (p) => unarchived(path.posix.basename(p, ".md"));
        const files = [];
        if (a.chapterPath) files.push({ kind: "chapter", from: a.chapterPath, to: `${novel.chaptersFolder}/${this.numbered(plain(a.chapterPath), number, "chapter")}.md` });
        if (a.planPath) files.push({ kind: "plan", from: a.planPath, to: `${this.plans.folders(novel).chapters}/${this.numbered(plain(a.planPath), number, "plan")}.md` });
        await this.checkFree(files);
        for (const f of files) {
            await fsp.mkdir(path.dirname(this.vault.abs(f.to)), { recursive: true });
            const had = this.vault.notes.get(f.from).fm.chapter != null;
            await this.renamer.move(f.from, f.to);
            if (f.kind === "plan") await patchNote(this.vault, f.to, { set: { chapter: number }, unset: ["archived", "archived-chapter"] });
            else if (had && number !== a.number) await patchNote(this.vault, f.to, { set: { chapter: number } });
        }
        await this.plans.syncVolumes(novel);
        await this.ensureNote(novel, number);
        return { number, chapterPath: files.find((f) => f.kind === "chapter")?.to ?? null, planPath: files.find((f) => f.kind === "plan")?.to ?? null, files: files.map(({ from, to }) => ({ from, to })) };
    }

    /** Delete an archived chapter: its note and plan go to the vault's .trash */
    async remove(novel, id) {
        const a = this.archived(novel, id), trashed = [];
        for (const p of [a.chapterPath, a.planPath].filter(Boolean)) trashed.push(await trashNote(this.vault, p));
        return { trashed };
    }
}
