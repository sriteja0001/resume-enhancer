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
const MAX_ROUNDS = 3;

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
 * Blind A/B. Order is randomised and neither side is labelled, so the model
 * cannot prefer the revision simply because it is the revision. A tie counts
 * as no improvement.
 */
async function revisionWins(before: string[], after: string[]): Promise<boolean> {
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
 * Score, revise, keep the better version, repeat. Bounded at three rounds and
 * stopped early once the resume is good enough — a fixed count wastes money on
 * a resume that was already strong and gives up on one that is not.
 */
export async function runCriticLoop(args: {
  doc: ResumeDoc;
  memory: Memory;
  target: TargetProfile;
  charLimit: number;
  originalText: string;
  calibration: CalibrationExample[];
}): Promise<LoopResult> {
  const factText = new Map<string, string>();
  for (const e of args.memory.entities) {
    for (const f of e.facts) {
      factText.set(f.id, `${f.text}${f.metrics.length ? ` [${f.metrics.join("; ")}]` : ""}`);
    }
  }

  const rounds: CritiqueRound[] = [];
  let doc = args.doc;
  let best = structuredClone(doc);
  let bestScore = -1;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const verdict = await critique({
      doc,
      target: args.target,
      charLimit: args.charLimit,
      calibration: args.calibration,
    });

    if (verdict.overallScore > bestScore) {
      bestScore = verdict.overallScore;
      best = structuredClone(doc);
    }

    const actionable = verdict.bullets.filter((b) => b.instruction);
    const stopping =
      verdict.overallScore >= GOOD_ENOUGH || actionable.length === 0 || round === MAX_ROUNDS;

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

    const candidate = structuredClone(doc);
    const changed = applyRevisions(candidate, revision.bullets);

    const current = rounds[rounds.length - 1];
    current.revised = changed.map((c) => ({ id: c.id, before: c.before, after: c.after }));

    if (changed.length === 0) {
      current.accepted = false;
      current.note = "Stopped: the revision returned nothing different.";
      break;
    }

    // Truth first: a revision that invents a number is discarded outright.
    const violations = auditDoc({
      doc: candidate,
      memory: args.memory,
      originalText: args.originalText,
      charLimit: args.charLimit,
    });
    if (violations.length > 0) {
      const reverted = revertRevisions(
        candidate,
        changed,
        new Set(violations.map((v) => v.text))
      );
      const keptIds = new Set(
        changed.filter((c) => !reverted.some((r) => r.id === c.id)).map((c) => c.id)
      );
      current.revised = current.revised.filter((c) => keptIds.has(c.id));
      if (reverted.length > 0) {
        current.note = `${reverted.length} revision(s) introduced unsourced numbers and were reverted.`;
      }
      if (current.revised.length === 0) {
        current.accepted = false;
        current.note = "Stopped: every revision this round invented a number and was reverted.";
        break;
      }
    }

    // Then taste: keep the new version only if it wins blind.
    const won = await revisionWins(
      indexBullets(doc).map(({ bullet }) => bullet.text),
      indexBullets(candidate).map(({ bullet }) => bullet.text)
    );
    current.accepted = won;
    if (won) {
      doc = candidate;
    } else {
      current.note = (current.note ? `${current.note} ` : "") +
        "Blind comparison preferred the previous version, so the revision was discarded.";
      break;
    }
  }

  // The best-scoring version wins, not the last one produced.
  const finalScore = rounds[rounds.length - 1]?.score ?? -1;
  return { doc: finalScore >= bestScore ? doc : best, rounds };
}
