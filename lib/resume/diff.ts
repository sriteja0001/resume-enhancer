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
/** Tokens that carry no identifying weight when matching an organization. */
const STOPWORDS = new Set([
  "the", "of", "and", "at", "in", "for", "a", "an",
  "university", "school", "inc", "llc", "ltd", "co", "company", "channel",
]);

function tokens(s: string | null): Set<string> {
  return new Set(
    normalize(s ?? "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

/** Jaccard overlap — symmetric, so it won't match a short name into a long one. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Overlap coefficient — shared tokens over the smaller set. Unlike Jaccard this
 * survives abbreviation, where one side is deliberately much shorter than the
 * other ("… (Data Structures & Algorithms)" vs "… (DS&A)").
 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

interface OriginalEntry {
  section: string;
  orgTokens: Set<string>;
  bulletKeys: Set<string>;
  claimed: boolean;
}

/**
 * How many original entries each token appears in. A token belonging to
 * exactly one entry ("wellnest") identifies it on its own; a token shared by
 * several ("stanford") identifies nothing.
 */
function tokenFrequency(originals: OriginalEntry[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const o of originals) {
    for (const t of o.orgTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}

/**
 * Find which original entry a tailored entry came from. Exact string matching
 * is not enough: tailoring legitimately rewrites the label itself ("Stanford
 * University School of Medicine: Sonnenburg Lab" becomes "Stanford School of
 * Medicine — Sonnenburg Lab"), and treating that as a brand-new entry would
 * paint the whole resume as "added" and make the highlighting meaningless.
 */
function matchOriginal(
  entry: ResumeDoc["sections"][number]["entries"][number],
  originals: OriginalEntry[],
  freq: Map<string, number>
): OriginalEntry | null {
  // Strongest signal: a bullet that names the wording it replaced. Independent
  // of how the organization got relabelled.
  const provenance = new Set(
    entry.bullets
      .map((b) => (b.originalText ? normalize(b.originalText) : null))
      .filter((v): v is string => v !== null)
  );
  if (provenance.size > 0) {
    for (const candidate of originals) {
      if (candidate.claimed) continue;
      for (const key of provenance) {
        if (candidate.bulletKeys.has(key)) return candidate;
      }
    }
  }

  // Otherwise fall back to fuzzy organization identity, best match wins.
  const orgTokens = tokens(entry.org);
  let best: OriginalEntry | null = null;
  let bestScore = 0;
  for (const candidate of originals) {
    if (candidate.claimed) continue;
    const score = similarity(orgTokens, candidate.orgTokens);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (bestScore >= 0.5) return best;

  // Last resort: a token unique to one original entry. This catches a project
  // whose original "organization" was the entire line ("Wellnest • AI health
  // platform • Python, LangGraph, …") and is now just its name, where token
  // overlap is low but "wellnest" still points at exactly one entry.
  const unique = originals.filter(
    (candidate) =>
      !candidate.claimed &&
      [...orgTokens].some((t) => candidate.orgTokens.has(t) && freq.get(t) === 1)
  );
  return unique.length === 1 ? unique[0] : null;
}

export function reconcileOrigins(tailored: ResumeDoc, original: ResumeDoc): ResumeDoc {
  const originalBullets = new Map<string, string>(); // normalized text → section
  const originalInline = new Set<string>();
  const originals: OriginalEntry[] = [];

  for (const s of original.sections) {
    for (const e of s.entries) {
      originals.push({
        section: s.title,
        orgTokens: tokens(e.org),
        bulletKeys: new Set(e.bullets.map((b) => normalize(b.text))),
        claimed: false,
      });
      for (const b of e.bullets) originalBullets.set(normalize(b.text), s.title);
      for (const list of e.inlineLists) {
        for (const v of list.values) {
          originalInline.add(`${normalize(list.label)}::${normalize(v.text)}`);
        }
      }
    }
  }

  const freq = tokenFrequency(originals);

  for (const s of tailored.sections) {
    for (const e of s.entries) {
      const hasIdentity = Boolean(normalize([e.org, e.role].filter(Boolean).join(" ")));
      const match = hasIdentity ? matchOriginal(e, originals, freq) : null;
      if (match) match.claimed = true;
      const previousSection = match?.section;

      if (!hasIdentity) {
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
        const kept = list.values.map((v) => tokens(v.text));

        for (const os of original.sections) {
          for (const oe of os.entries) {
            for (const ol of oe.inlineLists) {
              if (normalize(ol.label) !== normalize(list.label)) continue;
              for (const v of ol.values) {
                // Abbreviating a value is not deleting it. Exact matching
                // reported "Programming Abstractions (Data Structures &
                // Algorithms)" as cut when it was kept as "(DS&A)", so the same
                // course rendered twice — once normally, once struck through.
                const before = tokens(v.text);
                const survives = kept.some((k) => overlap(before, k) >= 0.6);
                if (!survives) {
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
