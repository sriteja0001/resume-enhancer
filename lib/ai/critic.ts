// The critic loop.
//
// Code checks (lib/ai/quality.ts) catch mechanical faults — weak openers,
// buried metrics, thin bullets. They cannot tell whether a bullet is
// COMPREHENSIBLE or IMPRESSIVE to someone who has never met the candidate.
// That is a judgment call, and this is where it lives.
//
// Critic and generator share a model, so they share blind spots. Four things
// blunt that, none of which remove it:
//
//   - four genuinely different lenses, not one opinion in four voices
//   - extraction over taste: name the artifact, write the interviewer's
//     question. Questions with checkable answers are the ones a model is least
//     able to fool itself on.
//   - argue for cutting rather than rate, since falsification surfaces what
//     evaluation glosses over
//   - a BLIND pairwise gate on every revision, because a critic shown its own
//     output tends to approve it
//
// The residual is why the trace is shown to the user rather than hidden.

import type { Memory } from "../memory/types";
import type { ResumeDoc } from "../resume/model";
import { structuredCall } from "./client";
import {
  CRITIC_SYSTEM,
  PAIRWISE_SYSTEM,
  REVISE_SYSTEM,
  criticUser,
  pairwiseUser,
  renderCalibration,
  reviseUser,
} from "./prompts";
import { CRITIC_SCHEMA, PAIRWISE_SCHEMA, POLISH_SCHEMA } from "./schemas";
import type { CalibrationExample, CritiqueRound, TargetProfile } from "./session";
import { auditDoc } from "./validate";

const schema = (s: unknown) => s as unknown as Record<string, unknown>;

/** Good enough to stop. Below this, another round is likely to pay for itself. */
const GOOD_ENOUGH = 8;

/**
 * Rounds are the expensive knob. Each one costs a review, a revision, and a
 * blind comparison per proposed rewrite — so the ceiling is the difference
 * between a run that takes a minute and one that takes ten. Exposed in the UI
 * rather than buried here, because only the person waiting can judge the trade.
 */
export const MAX_ROUNDS = 3;
export const DEFAULT_ROUNDS = MAX_ROUNDS;

export function clampRounds(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_ROUNDS) : DEFAULT_ROUNDS;
}

export interface CriticBullet {
  id: string;
  atsScreen: number;
  sixSecondSkim: number;
  domainExpert: number;
  interviewDefense: number;
  score: number;
  namedArtifact: string | null;
  namedOutcome: string | null;
  interviewerFollowUp: string;
  caseForCutting: string;
  instruction: string | null;
}

export interface Critique {
  bullets: CriticBullet[];
  overallScore: number;
  weakestLink: string;
  verdict: string;
}

type Bullet = ResumeDoc["sections"][number]["entries"][number]["bullets"][number];

function indexBullets(doc: ResumeDoc): { bullet: Bullet; where: string }[] {
  const out: { bullet: Bullet; where: string }[] = [];
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      const where =
        [entry.org, entry.role].filter(Boolean).join(" — ") || section.title;
      for (const bullet of entry.bullets) out.push({ bullet, where });
    }
  }
  return out;
}

export async function critique(args: {
  doc: ResumeDoc;
  target: TargetProfile;
  charLimit: number;
  calibration: CalibrationExample[];
}): Promise<Critique> {
  const bullets = indexBullets(args.doc).map(({ bullet, where }) => ({
    id: bullet.id,
    where,
    text: bullet.text,
  }));

  return structuredCall<Critique>({
    system: CRITIC_SYSTEM,
    messages: [
      {
        role: "user",
        content: criticUser({
          target: JSON.stringify(args.target, null, 2),
          charLimit: args.charLimit,
          calibration: renderCalibration(args.calibration),
          bullets,
        }),
      },
    ],
    schema: schema(CRITIC_SCHEMA),
    maxTokens: 24000,
  });
}

/**
 * Blind A/B on a single bullet. Order is randomised and neither side is
 * labelled, so the model cannot prefer the revision simply because it is the
 * revision. A tie counts as no improvement.
 *
 * Judged one bullet at a time rather than a whole document at a time. Comparing
 * the full set makes the gate all-or-nothing: one bad rewrite drags down ten
 * good ones and the entire round is thrown away, which is exactly what happened
 * when this was document-level.
 */
async function revisionWins(before: string, after: string): Promise<boolean> {
  const afterIsA = Math.random() < 0.5;
  const result = await structuredCall<{ winner: "A" | "B" | "tie"; why: string }>({
    system: PAIRWISE_SYSTEM,
    messages: [
      {
        role: "user",
        content: afterIsA ? pairwiseUser(after, before) : pairwiseUser(before, after),
      },
    ],
    schema: schema(PAIRWISE_SCHEMA),
    maxTokens: 4000,
  });
  return result.winner === (afterIsA ? "A" : "B");
}

/**
 * A revision, plus enough of the bullet's prior state to undo it exactly. The
 * text alone is not enough: reverting only the words would leave the bullet
 * marked "rewritten" and highlighted in the mockup while reading identically to
 * the original, which tells the reader something false.
 */
export interface AppliedRevision {
  id: string;
  before: string;
  after: string;
  beforeOrigin: Bullet["origin"];
  beforeOriginalText: string | null;
}

/** Write revisions into `doc` in place. Returns what actually changed. */
export function applyRevisions(
  doc: ResumeDoc,
  revisions: { id: string; text: string; why?: string | null }[]
): AppliedRevision[] {
  const byId = new Map(indexBullets(doc).map(({ bullet }) => [bullet.id, bullet]));
  const applied: AppliedRevision[] = [];

  for (const revision of revisions) {
    const bullet = byId.get(revision.id);
    const text = revision.text?.trim();
    if (!bullet || !text || text === bullet.text) continue;

    applied.push({
      id: bullet.id,
      before: bullet.text,
      after: text,
      beforeOrigin: bullet.origin,
      beforeOriginalText: bullet.originalText,
    });

    // Only a bullet that survived untouched needs its original recorded here.
    // One already rewritten has an earlier, truer original that must survive.
    if (bullet.origin === "kept") {
      bullet.originalText = bullet.text;
      bullet.origin = "rewritten";
    }
    bullet.text = text;
    if (revision.why) bullet.why = revision.why;
  }
  return applied;
}

/** Undo the applied revisions whose new text appears in `reject`. */
export function revertRevisions(
  doc: ResumeDoc,
  applied: AppliedRevision[],
  reject: Set<string>
): AppliedRevision[] {
  const byId = new Map(indexBullets(doc).map(({ bullet }) => [bullet.id, bullet]));
  const reverted: AppliedRevision[] = [];

  for (const revision of applied) {
    if (!reject.has(revision.after)) continue;
    const bullet = byId.get(revision.id);
    if (!bullet) continue;
    bullet.text = revision.before;
    bullet.origin = revision.beforeOrigin;
    bullet.originalText = revision.beforeOriginalText;
    reverted.push(revision);
  }
  return reverted;
}

export interface LoopResult {
  doc: ResumeDoc;
  rounds: CritiqueRound[];
}

/**
 * Score, revise, keep the better version, repeat. Bounded by `maxRounds` and
 * stopped early once the resume is good enough — a fixed count wastes money on
 * a resume that was already strong and gives up on one that is not.
 *
 * `maxRounds: 0` skips the loop entirely and returns the document untouched.
 */
export async function runCriticLoop(args: {
  doc: ResumeDoc;
  memory: Memory;
  target: TargetProfile;
  charLimit: number;
  originalText: string;
  calibration: CalibrationExample[];
  maxRounds?: number;
}): Promise<LoopResult> {
  const maxRounds = clampRounds(args.maxRounds ?? DEFAULT_ROUNDS);
  if (maxRounds === 0) return { doc: args.doc, rounds: [] };

  const factText = new Map<string, string>();
  for (const e of args.memory.entities) {
    for (const f of e.facts) {
      factText.set(f.id, `${f.text}${f.metrics.length ? ` [${f.metrics.join("; ")}]` : ""}`);
    }
  }

  const rounds: CritiqueRound[] = [];
  let doc = args.doc;

  for (let round = 1; round <= maxRounds; round++) {
    const verdict = await critique({
      doc,
      target: args.target,
      charLimit: args.charLimit,
      calibration: args.calibration,
    });

    const actionable = verdict.bullets.filter((b) => b.instruction);
    const stopping =
      verdict.overallScore >= GOOD_ENOUGH || actionable.length === 0 || round === maxRounds;

    rounds.push({
      round,
      score: verdict.overallScore,
      weakestLink: verdict.weakestLink,
      verdict: verdict.verdict,
      bulletScores: verdict.bullets.map((b) => ({
        id: b.id,
        score: b.score,
        lenses: {
          atsScreen: b.atsScreen,
          sixSecondSkim: b.sixSecondSkim,
          domainExpert: b.domainExpert,
          interviewDefense: b.interviewDefense,
        },
        namedArtifact: b.namedArtifact,
        namedOutcome: b.namedOutcome,
        interviewerFollowUp: b.interviewerFollowUp,
        instruction: b.instruction,
      })),
      revised: [],
      unmet: [],
      accepted: null,
      note: stopping
        ? verdict.overallScore >= GOOD_ENOUGH
          ? `Stopped: scored ${verdict.overallScore}/10, at or above the bar.`
          : actionable.length === 0
            ? "Stopped: the critic had no concrete change left to ask for."
            : "Stopped: round limit reached."
        : null,
    });
    if (stopping) break;

    // Revise only what was flagged; the document's structure is settled.
    const byId = new Map(indexBullets(doc).map(({ bullet }) => [bullet.id, bullet]));
    const payload = actionable
      .filter((b) => byId.has(b.id))
      .map((b) => ({
        id: b.id,
        text: byId.get(b.id)!.text,
        instruction: b.instruction!,
        followUp: b.interviewerFollowUp,
        facts: byId
          .get(b.id)!
          .factRefs.map((r) => factText.get(r))
          .filter((v): v is string => !!v),
      }));

    const revision = await structuredCall<{
      bullets: { id: string; text: string; changed: boolean; why: string | null }[];
    }>({
      system: REVISE_SYSTEM,
      messages: [{ role: "user", content: reviseUser({ charLimit: args.charLimit, bullets: payload }) }],
      schema: schema(POLISH_SCHEMA),
      maxTokens: 16000,
    });

    const current = rounds[rounds.length - 1];

    // An instruction the reviser declined is worth more to the candidate than
    // one it satisfied: it names something the resume cannot currently say.
    const askedFor = new Map(payload.map((p) => [p.id, p.instruction]));
    current.unmet = revision.bullets
      .filter((b) => !b.changed && askedFor.has(b.id))
      .map((b) => ({ instruction: askedFor.get(b.id)!, why: b.why }));

    const candidate = structuredClone(doc);
    let changed = applyRevisions(candidate, revision.bullets);

    if (changed.length === 0) {
      current.accepted = false;
      current.note = "Stopped: the reviser had nothing it could truthfully change.";
      break;
    }

    // Truth first: a revision that invents a number is discarded outright.
    const violations = auditDoc({
      doc: candidate,
      memory: args.memory,
      originalText: args.originalText,
      charLimit: args.charLimit,
    });
    let invented = 0;
    if (violations.length > 0) {
      const reverted = revertRevisions(candidate, changed, new Set(violations.map((v) => v.text)));
      const undone = new Set(reverted.map((r) => r.id));
      changed = changed.filter((c) => !undone.has(c.id));
      invented = reverted.length;
    }

    // Then taste, bullet by bullet. Each rewrite has to beat the version it
    // replaced on its own merits; the ones that don't are rolled back and the
    // ones that do still land.
    const outcomes = await Promise.all(
      changed.map(async (c) => ({ revision: c, won: await revisionWins(c.before, c.after) }))
    );
    const rejected = outcomes.filter((o) => !o.won).map((o) => o.revision);
    revertRevisions(candidate, rejected, new Set(rejected.map((r) => r.after)));

    const kept = outcomes.filter((o) => o.won).map((o) => o.revision);
    current.revised = kept.map((c) => ({ id: c.id, before: c.before, after: c.after }));
    current.accepted = kept.length > 0;
    current.note = [
      invented > 0 ? `${invented} rewrite(s) invented a number and were reverted.` : null,
      rejected.length > 0
        ? `${rejected.length} rewrite(s) lost a blind comparison to the line they replaced.`
        : null,
    ]
      .filter(Boolean)
      .join(" ") || null;

    if (kept.length === 0) {
      current.note = `${current.note ?? ""} Stopped: nothing this round survived.`.trim();
      break;
    }
    doc = candidate;
  }

  // Every line on this page won a blind, forced-choice comparison against the
  // line it replaced. An earlier draft is not restored on the strength of a
  // holistic 1–10 score from the same model — that number is noisy enough to
  // rate a strictly-improved page lower, and when it did, the trace still
  // reported rewrites the returned document had silently dropped. The score
  // decides when to STOP; the blind gate decides what the page says.
  return { doc, rounds };
}
