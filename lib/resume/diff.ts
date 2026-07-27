// Word-level diff so a rewritten bullet can show exactly which words moved,
// rather than lighting up the whole line. Also the reconciliation pass that
// stamps origins onto a tailored doc by comparing it to the original — the
// model proposes content, but "did this actually change?" is decided in code.

import { diffWords } from "diff";
import type { Bullet, Origin, ResumeDoc } from "./model";

export interface WordPart {
  text: string;
  kind: "same" | "added" | "removed";
}

export function wordDiff(before: string, after: string): WordPart[] {
  return diffWords(before, after).map((p) => ({
    text: p.value,
    kind: p.added ? "added" : p.removed ? "removed" : "same",
  }));
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Compare the tailored document against the original and set every origin
 * from evidence. A model that claims it rewrote a bullet but returned the
 * same words gets corrected to "kept"; a bullet whose text matches one from a
 * different section is marked "moved" with its old home recorded.
 */
export function reconcileOrigins(tailored: ResumeDoc, original: ResumeDoc): ResumeDoc {
  const originalBullets = new Map<string, string>(); // normalized text → section
  const originalEntries = new Map<string, string>(); // normalized org/role → section
  const originalInline = new Set<string>();

  for (const s of original.sections) {
    for (const e of s.entries) {
      const key = normalize([e.org, e.role].filter(Boolean).join(" "));
      if (key) originalEntries.set(key, s.title);
      for (const b of e.bullets) originalBullets.set(normalize(b.text), s.title);
      for (const list of e.inlineLists) {
        for (const v of list.values) {
          originalInline.add(`${normalize(list.label)}::${normalize(v.text)}`);
        }
      }
    }
  }

  for (const s of tailored.sections) {
    for (const e of s.entries) {
      const entryKey = normalize([e.org, e.role].filter(Boolean).join(" "));
      const previousSection = originalEntries.get(entryKey);
      if (!entryKey) {
        // Nothing identifying to compare on (e.g. a bare skills block) — we
        // can't prove it's new, so don't accuse it of being new.
        e.origin = "kept";
        e.movedFrom = null;
      } else if (previousSection === undefined) {
        e.origin = "added";
        e.movedFrom = null;
      } else if (normalize(previousSection) !== normalize(s.title)) {
        e.origin = "moved";
        e.movedFrom = previousSection;
      } else {
        e.origin = "kept";
        e.movedFrom = null;
      }

      for (const b of e.bullets) {
        const here = normalize(b.text);
        if (originalBullets.has(here)) {
          // Identical wording exists on the original — nothing was rewritten.
          b.origin = "kept";
          b.originalText = null;
        } else if (b.originalText && normalize(b.originalText) !== here) {
          b.origin = "rewritten";
        } else {
          b.origin = "added";
          b.originalText = null;
        }
      }

      for (const list of e.inlineLists) {
        for (const v of list.values) {
          const key = `${normalize(list.label)}::${normalize(v.text)}`;
          v.origin = originalInline.has(key) ? "kept" : "added";
        }
      }
    }
  }

  return tailored;
}

/**
 * Inline values that existed on the original resume but are absent from the
 * tailored one — recorded per list so the UI can show what was cut and why.
 */
export function collectDropped(tailored: ResumeDoc, original: ResumeDoc): ResumeDoc {
  for (const ts of tailored.sections) {
    for (const te of ts.entries) {
      for (const list of te.inlineLists) {
        if (list.dropped.length > 0) continue;
        const present = new Set(list.values.map((v) => normalize(v.text)));
        for (const os of original.sections) {
          for (const oe of os.entries) {
            for (const ol of oe.inlineLists) {
              if (normalize(ol.label) !== normalize(list.label)) continue;
              for (const v of ol.values) {
                if (!present.has(normalize(v.text))) {
                  list.dropped.push({
                    text: v.text,
                    why: "cut — lower relevance to this posting",
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return tailored;
}

/** Bullets whose origin is a change, with their word-level diff precomputed. */
export function bulletDiff(b: Bullet): WordPart[] | null {
  if (b.origin !== "rewritten" || !b.originalText) return null;
  return wordDiff(b.originalText, b.text);
}

export function originLabel(origin: Origin | "dropped"): string {
  switch (origin) {
    case "kept":
      return "unchanged";
    case "rewritten":
      return "rewritten";
    case "added":
      return "added";
    case "moved":
      return "moved";
    case "reordered":
      return "reordered";
    default:
      return "dropped";
  }
}
