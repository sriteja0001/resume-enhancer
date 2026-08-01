// Code-side craft checks on bullets.
//
// The number audit already proves a bullet is TRUE. This proves it is WORTH
// READING: dense, outcome-first, and actually using the space it was given.
// Prompts ask for that; this is what checks, and its findings are what the
// polish pass is told to fix — the same ask-then-verify shape the number
// audit uses.

import type { ResumeDoc } from "../resume/model";

/** Openers that describe attendance or effort rather than an accomplishment. */
const WEAK_OPENERS =
  /^(completed|participated|assisted|helped|worked|contributed|involved|responsible|started|attended|supported|used|utilized|learned|studied|gained|performed|conducted|handled)\b/i;

/** Filler that consumes budget without adding information. */
const FILLER =
  /\b(various|numerous|several|successfully|effectively|efficiently|responsible for|in order to|utilizing|leveraged|spearheaded|amassed|worked to|helped to|a variety of|as well as)\b/i;

/** A measurable outcome: a number, or an explicit before/after. */
const HAS_OUTCOME = /\d|\bfrom\s+\S+\s+to\s+\S+/i;

/** Three or more comma-joined verbs with no result — a list of activities. */
function isActivityList(text: string): boolean {
  const verbs = text.match(/\b\w+(ed|ing)\b/g) ?? [];
  return verbs.length >= 3 && !HAS_OUTCOME.test(text);
}

export interface BulletIssue {
  where: string;
  text: string;
  problems: string[];
}

export interface QualityReport {
  issues: BulletIssue[];
  bulletCount: number;
  /** Mean fraction of the character budget used, 0-1. */
  density: number;
}

/**
 * `charLimit` is a target, not just a ceiling: a bullet at half the budget
 * means detail was left in memory that there was room for.
 */
export function reviewBullets(doc: ResumeDoc, charLimit: number): QualityReport {
  const issues: BulletIssue[] = [];
  let count = 0;
  let used = 0;

  for (const section of doc.sections) {
    for (const entry of section.entries) {
      const label = [entry.org, entry.role].filter(Boolean).join(" — ") || section.title;

      for (const bullet of entry.bullets) {
        const text = bullet.text.trim();
        count += 1;
        used += Math.min(1, text.length / charLimit);
        const problems: string[] = [];

        if (text.length < charLimit * 0.7) {
          problems.push(
            `only ${text.length} of ${charLimit} characters — thin; fold in a related fact or restore detail`
          );
        }
        if (WEAK_OPENERS.test(text)) {
          problems.push(
            `opens with "${text.split(/\s+/)[0]}" — describes effort, not an accomplishment`
          );
        }
        const filler = text.match(FILLER);
        if (filler) problems.push(`filler phrase "${filler[0]}"`);

        if (!HAS_OUTCOME.test(text)) {
          problems.push("no measurable outcome or before/after");
        } else {
          // A number that only appears past the halfway mark gets skimmed over.
          const firstNumber = text.search(/\d/);
          if (firstNumber > text.length * 0.55) {
            problems.push("the number sits in the back half — lead with it");
          }
        }
        if (isActivityList(text)) {
          problems.push("reads as a list of activities rather than one claim with a result");
        }

        if (problems.length > 0) {
          issues.push({ where: `${section.title} / ${label}`, text, problems });
        }
      }
    }
  }

  return { issues, bulletCount: count, density: count === 0 ? 1 : used / count };
}
