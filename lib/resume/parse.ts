// .docx → ResumeDoc. READ-ONLY: the source file is never modified.
//
// Why HTML rather than extractRawText: Word bullets are list items, and raw
// text flattens them into ordinary paragraphs with no marker at all, so a real
// resume arrives as undifferentiated prose. convertToHtml preserves <li>, plus
// the bold/italic structure resume templates encode meaning in (bold = section
// heading or organization, italic = role and dates) and the tabs that push a
// second column to the right margin.

import mammoth from "mammoth";
import type { Entry, InlineList, ResumeDoc, Section } from "./model";

export interface Block {
  kind: "list-item" | "paragraph";
  text: string;
  bold: boolean;
  italic: boolean;
  columns: string[];
}

export interface ExtractedResume {
  blocks: Block[];
  plainText: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

function tidy(s: string): string {
  return s.replace(/[  ]+/g, " ").replace(/\s*\t\s*/g, "\t").trim();
}

/**
 * Templates bold a whole org line but may also bold two words inside a
 * bullet, so "contains <strong>" misreads bullets as headings. Require the
 * emphasis to cover most of the line.
 */
function emphasisRatio(html: string, tag: "strong" | "em"): number {
  const plain = stripTags(html).trim();
  if (!plain) return 0;
  const inner = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))]
    .map((m) => stripTags(m[1]))
    .join("");
  return inner.trim().length / plain.length;
}

export async function extractBlocks(filePath: string): Promise<ExtractedResume> {
  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const blocks: Block[] = [];

  for (const m of html.matchAll(/<(li|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const inner = m[2];
    const text = tidy(stripTags(inner));
    if (!text) continue;
    blocks.push({
      kind: m[1] === "li" ? "list-item" : "paragraph",
      text,
      bold: emphasisRatio(inner, "strong") > 0.6,
      italic: emphasisRatio(inner, "em") > 0.6,
      columns: text.split("\t").map((c) => c.trim()).filter(Boolean),
    });
  }

  // Fallback for files convertToHtml can't structure (text boxes, tables).
  if (blocks.length === 0) {
    const { value: raw } = await mammoth.extractRawText({ path: filePath });
    for (const line of raw.split(/\n+/)) {
      const text = tidy(line);
      if (!text) continue;
      blocks.push({
        kind: "paragraph",
        text,
        bold: false,
        italic: false,
        columns: text.split("\t").map((c) => c.trim()).filter(Boolean),
      });
    }
  }

  return {
    blocks,
    plainText: blocks.map((b) => b.text.replace(/\t/g, "  ")).join("\n"),
  };
}

/** Structure made explicit for the model — labels beat guessing from prose. */
export function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      const marks = [b.bold ? "bold" : null, b.italic ? "italic" : null]
        .filter(Boolean)
        .join(",");
      const tag = b.kind === "list-item" ? "BULLET" : "LINE";
      const cols = b.columns.length > 1 ? ` | columns: ${b.columns.join(" ¦ ")}` : "";
      return `[${i}] <${tag}${marks ? ` ${marks}` : ""}> ${b.text.replace(/\t/g, " ¦ ")}${cols}`;
    })
    .join("\n");
}

// ---------- blocks → ResumeDoc (deterministic, no model involved) ----------

const DATE_RE =
  /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bpresent\b/i;
const CONTACT_RE = /@|\bhttps?:\/\/|linkedin|github|\+?\d[\d ()-]{7,}/i;

/**
 * Section names come from a small, near-universal vocabulary. Matching on it
 * rather than on "is it shouty" matters because organizations are often
 * all-caps too (TEJA, IEEE, NASA) — treating one as a heading silently
 * swallows the section it belongs to.
 */
const SECTION_WORDS =
  /\b(education|experience|employment|work history|projects?|skills?|leadership|awards?|honors?|publications?|research|certifications?|activities|extracurriculars?|volunteering|volunteer|interests|summary|objective|profile|additional information|references|languages|coursework)\b/i;

function looksLikeHeading(b: Block): boolean {
  if (b.kind !== "paragraph") return false;
  const t = b.text.replace(/\t/g, " ").trim();
  if (!t || t.length > 40 || /[.;]/.test(t)) return false;
  return t === t.toUpperCase() && /[A-Z]{3,}/.test(t);
}

function isSectionHeading(b: Block, strict: boolean): boolean {
  if (!looksLikeHeading(b)) return false;
  return strict ? SECTION_WORDS.test(b.text) : true;
}

const INLINE_RE =
  /^(coursework|relevant coursework|skills?|technologies|tools|languages|frameworks|awards?|extracurriculars?|activities|interests)\b[^:]*:\s*(.+)$/i;

function parseInline(text: string): InlineList | null {
  const m = text.match(INLINE_RE);
  if (!m) return null;
  const label = text.slice(0, text.indexOf(":")).trim();
  return {
    label,
    values: m[2]
      .split(/,(?![^(]*\))/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => ({ text: v, origin: "kept" as const, why: null })),
    dropped: [],
  };
}

let counter = 0;
const uid = (p: string) => `${p}${++counter}`;

/**
 * Build the baseline document from the file. Everything is origin "kept" —
 * this is the reference the tailored version is diffed against.
 */
export function blocksToDoc(blocks: Block[]): ResumeDoc {
  counter = 0;
  // Prefer vocabulary-matched headings; fall back to the loose "all caps"
  // rule only for resumes that name their sections unconventionally.
  const strict = blocks.filter((b) => isSectionHeading(b, true)).length >= 2;
  const doc: ResumeDoc = {
    header: { name: null, contactLine: null },
    sections: [],
  };

  let section: Section | null = null;
  let entry: Entry | null = null;
  let sawHeading = false;

  const pushEntry = () => {
    if (entry && section) section.entries.push(entry);
    entry = null;
  };
  const pushSection = () => {
    pushEntry();
    if (section) doc.sections.push(section);
    section = null;
  };
  const ensureEntry = (): Entry => {
    if (!entry) {
      entry = {
        id: uid("en"),
        entityId: null,
        org: null,
        role: null,
        location: null,
        dates: null,
        bullets: [],
        inlineLists: [],
        origin: "kept",
        movedFrom: null,
        why: null,
      };
    }
    return entry;
  };

  for (const b of blocks) {
    if (isSectionHeading(b, strict)) {
      pushSection();
      section = { id: uid("s"), title: b.text, entries: [], origin: "kept", why: null };
      sawHeading = true;
      continue;
    }

    // Anything before the first section heading is the header block.
    if (!sawHeading && b.kind === "paragraph") {
      if (!doc.header.name && !CONTACT_RE.test(b.text)) doc.header.name = b.text;
      else if (CONTACT_RE.test(b.text)) {
        doc.header.contactLine = [doc.header.contactLine, b.text]
          .filter(Boolean)
          .join(" · ");
      }
      continue;
    }

    if (!section) {
      section = { id: uid("s"), title: "Experience", entries: [], origin: "kept", why: null };
      sawHeading = true;
    }

    if (b.kind === "list-item") {
      const inline = parseInline(b.text);
      const target = ensureEntry();
      if (inline) target.inlineLists.push(inline);
      else
        target.bullets.push({
          id: uid("b"),
          text: b.text.replace(/\t/g, " ").trim(),
          origin: "kept",
          originalText: null,
          factRefs: [],
          why: null,
        });
      continue;
    }

    // Paragraph inside a section: org line, role/date line, or an inline list.
    const inline = parseInline(b.text);
    if (inline) {
      ensureEntry().inlineLists.push(inline);
      continue;
    }

    const hasDate = DATE_RE.test(b.text);
    const first = b.columns[0] ?? b.text;

    if (b.italic && hasDate) {
      const target = ensureEntry();
      target.role = first.replace(DATE_RE, "").replace(/[–—-]\s*$/, "").trim() || target.role;
      target.dates = b.columns[1] ?? (b.text.replace(first, "").trim() || null);
      continue;
    }
    if (b.bold) {
      pushEntry();
      const target = ensureEntry();
      target.org = first.trim();
      target.location = b.columns[1] ?? null;
      continue;
    }

    // Un-emphasized standalone line (project entries live here).
    pushEntry();
    const target = ensureEntry();
    target.org = b.text;
  }
  pushSection();

  // Drop empty scaffolding.
  doc.sections = doc.sections
    .map((s) => ({
      ...s,
      entries: s.entries.filter(
        (e) => e.bullets.length || e.inlineLists.length || e.org || e.role
      ),
    }))
    .filter((s) => s.entries.length > 0);

  return doc;
}

export async function parseResume(filePath: string): Promise<{
  doc: ResumeDoc;
  blocks: Block[];
  plainText: string;
}> {
  const { blocks, plainText } = await extractBlocks(filePath);
  return { doc: blocksToDoc(blocks), blocks, plainText };
}
