// A resume as a structured document, not text. Everything downstream — the
// on-screen mockup, the highlight colours, the change log, the .docx export —
// is a projection of this one object.
//
// `origin` is the whole highlighting mechanism: "kept" renders black, anything
// else renders highlighted. It is recorded at three levels (section, entry,
// bullet/item) because a change can happen at any of them: a whole entry can
// move from Leadership to Experience, a single bullet can be rewritten, one
// course can be swapped out of an inline list.

export type Origin = "kept" | "rewritten" | "added" | "moved" | "reordered";

export interface Bullet {
  id: string;
  text: string;
  origin: Origin;
  /** The original wording, when this bullet replaced one. Drives word diff. */
  originalText: string | null;
  /** Fact ids from master.md that license this bullet's content and numbers. */
  factRefs: string[];
  /** One line on why this change was made — shown in the change log. */
  why: string | null;
}

/** One value inside an inline list (a course, a skill). Individually swappable. */
export interface InlineValue {
  text: string;
  origin: Origin;
  why: string | null;
}

/** "Coursework: A, B, C" — a labelled inline list whose members can change. */
export interface InlineList {
  label: string;
  values: InlineValue[];
  /** Values present on the original resume that were deliberately dropped. */
  dropped: { text: string; why: string }[];
}

export interface Entry {
  id: string;
  /** Entity id in master.md when this entry came from memory. */
  entityId: string | null;
  org: string | null;
  role: string | null;
  location: string | null;
  dates: string | null;
  bullets: Bullet[];
  inlineLists: InlineList[];
  origin: Origin;
  /** Section title this entry sat under on the original resume, if it moved. */
  movedFrom: string | null;
  why: string | null;
}

export interface Section {
  id: string;
  title: string;
  entries: Entry[];
  origin: Origin;
  why: string | null;
}

export interface ResumeHeader {
  name: string | null;
  contactLine: string | null;
}

export interface ResumeDoc {
  header: ResumeHeader;
  sections: Section[];
}

// ---------- change accounting ----------

export interface ChangeCounts {
  kept: number;
  rewritten: number;
  added: number;
  moved: number;
  dropped: number;
}

export function countChanges(doc: ResumeDoc): ChangeCounts {
  const counts: ChangeCounts = { kept: 0, rewritten: 0, added: 0, moved: 0, dropped: 0 };
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      if (entry.origin === "moved") counts.moved += 1;
      for (const b of entry.bullets) {
        if (b.origin === "kept") counts.kept += 1;
        else if (b.origin === "rewritten") counts.rewritten += 1;
        else if (b.origin === "added") counts.added += 1;
      }
      for (const list of entry.inlineLists) {
        for (const v of list.values) {
          if (v.origin === "kept") counts.kept += 1;
          else if (v.origin === "added") counts.added += 1;
          else if (v.origin === "rewritten") counts.rewritten += 1;
        }
        counts.dropped += list.dropped.length;
      }
    }
  }
  return counts;
}

export interface ChangeLogRow {
  section: string;
  entry: string;
  kind: "bullet" | "entry" | "inline" | "dropped";
  origin: Origin | "dropped";
  text: string;
  originalText: string | null;
  why: string | null;
}

/** Flat, ordered list of every change — the analytical view of a tailoring. */
export function changeLog(doc: ResumeDoc): ChangeLogRow[] {
  const rows: ChangeLogRow[] = [];
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      const entryLabel = [entry.role, entry.org].filter(Boolean).join(" @ ") || entry.id;
      if (entry.origin === "moved" || entry.origin === "added") {
        rows.push({
          section: section.title,
          entry: entryLabel,
          kind: "entry",
          origin: entry.origin,
          text: entryLabel,
          originalText: entry.movedFrom,
          why: entry.why,
        });
      }
      for (const b of entry.bullets) {
        if (b.origin === "kept") continue;
        rows.push({
          section: section.title,
          entry: entryLabel,
          kind: "bullet",
          origin: b.origin,
          text: b.text,
          originalText: b.originalText,
          why: b.why,
        });
      }
      for (const list of entry.inlineLists) {
        for (const v of list.values) {
          if (v.origin === "kept") continue;
          rows.push({
            section: section.title,
            entry: entryLabel,
            kind: "inline",
            origin: v.origin,
            text: `${list.label}: ${v.text}`,
            originalText: null,
            why: v.why,
          });
        }
        for (const d of list.dropped) {
          rows.push({
            section: section.title,
            entry: entryLabel,
            kind: "dropped",
            origin: "dropped",
            text: `${list.label}: ${d.text}`,
            originalText: null,
            why: d.why,
          });
        }
      }
    }
  }
  return rows;
}

/** Plain text of the whole document — for copy-out and for keyword checks. */
export function docToText(doc: ResumeDoc): string {
  const out: string[] = [];
  if (doc.header.name) out.push(doc.header.name);
  if (doc.header.contactLine) out.push(doc.header.contactLine);
  for (const section of doc.sections) {
    out.push("", section.title.toUpperCase());
    for (const entry of section.entries) {
      const head = [entry.org, entry.location].filter(Boolean).join("  ");
      const sub = [entry.role, entry.dates].filter(Boolean).join("  ");
      if (head) out.push(head);
      if (sub) out.push(sub);
      for (const list of entry.inlineLists) {
        out.push(`${list.label}: ${list.values.map((v) => v.text).join(", ")}`);
      }
      for (const b of entry.bullets) out.push(`• ${b.text}`);
    }
  }
  return out.join("\n");
}
