// Code-side enforcement of the two things language models are structurally
// bad at: not inventing numbers, and counting characters. The prompt asks;
// this file guarantees. Anything that fails here is either sent back for one
// corrective turn or surfaced to the user as a flagged error — never silently
// accepted.

import type { Memory } from "../memory/types";
import type { ResumeDoc } from "../resume/model";

/** "1,200" → "1200", "$2.5M" → "2.5", "90%" → "90". */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((m) => m.replace(/,/g, ""));
}

export interface Failure {
  where: string;
  text: string;
  issues: string[];
}

/**
 * Every number in every bullet must trace to a cited fact, to the bullet's own
 * previous wording, or to the original resume text. Years and small ordinals
 * that appear anywhere in memory are allowed through as dates.
 */
export function auditDoc(args: {
  doc: ResumeDoc;
  memory: Memory;
  originalText: string;
  charLimit: number;
}): Failure[] {
  const { doc, memory, originalText, charLimit } = args;

  const factText = new Map<string, string>();
  for (const e of memory.entities) {
    for (const f of e.facts) factText.set(f.id, `${f.text} ${f.metrics.join(" ")}`);
    for (const i of e.items) factText.set(i.id, i.text);
  }

  // Numbers anywhere in memory or on the original resume are "already claimed"
  // by this person — a tailoring can move them around but not conjure new ones.
  const claimed = new Set<string>();
  for (const value of factText.values()) {
    for (const n of extractNumbers(value)) claimed.add(n);
  }
  for (const e of memory.entities) {
    for (const n of extractNumbers(
      [e.dates ?? "", e.title, e.role ?? "", e.org ?? ""].join(" ")
    )) {
      claimed.add(n);
    }
  }
  for (const n of extractNumbers(originalText)) claimed.add(n);

  const failures: Failure[] = [];

  for (const section of doc.sections) {
    for (const entry of section.entries) {
      const label = [entry.org, entry.role].filter(Boolean).join(" — ") || section.title;

      for (const bullet of entry.bullets) {
        const issues: string[] = [];

        if (bullet.text.length > charLimit * 1.15) {
          issues.push(`${bullet.text.length} chars — over the ${charLimit} budget`);
        }

        const unknownRefs = bullet.factRefs.filter((id) => !factText.has(id));
        if (unknownRefs.length > 0) {
          issues.push(`cites unknown id(s): ${unknownRefs.join(", ")}`);
        }

        const allowed = new Set(claimed);
        for (const id of bullet.factRefs) {
          for (const n of extractNumbers(factText.get(id) ?? "")) allowed.add(n);
        }
        if (bullet.originalText) {
          for (const n of extractNumbers(bullet.originalText)) allowed.add(n);
        }
        const unsourced = extractNumbers(bullet.text).filter((n) => !allowed.has(n));
        if (unsourced.length > 0) {
          issues.push(`number(s) not found in memory or the original: ${unsourced.join(", ")}`);
        }

        if (issues.length > 0) {
          failures.push({ where: `${section.title} / ${label}`, text: bullet.text, issues });
        }
      }
    }
  }

  return failures;
}

/** Attach audit failures to the bullets they came from, for UI flagging. */
export function markFailures(doc: ResumeDoc, failures: Failure[]): ResumeDoc {
  const byText = new Map(failures.map((f) => [f.text, f.issues]));
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      for (const bullet of entry.bullets) {
        const issues = byText.get(bullet.text);
        if (issues) {
          bullet.why = `⚠ FAILED AUDIT: ${issues.join("; ")}${bullet.why ? ` — ${bullet.why}` : ""}`;
        }
      }
    }
  }
  return doc;
}

/** Terms present verbatim on the page — the literal half of coverage. */
export function literallyContains(haystack: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i").test(haystack);
}
