// A tailoring session: one resume + one posting, plus everything derived from
// them. Persisted to data/sessions/ so a run survives a refresh and can be
// reopened later.

import type { ResumeDoc } from "../resume/model";

export interface TargetProfile {
  roleTitle: string;
  roleFamily: string;
  seniority: string;
  companyType: string;
  domains: string[];
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  requirements: { text: string; importance: "critical" | "important" | "nice-to-have" }[];
  readStrategy: string;
}

export interface CoverageRow {
  requirement: string;
  importance: "critical" | "important" | "nice-to-have";
  status: "strong" | "partial" | "none";
  evidenceFactIds: string[];
  note: string;
  /** Computed in code: does the term appear verbatim on the tailored page? */
  literal: boolean;
}

/**
 * A bullet the candidate has judged; anchors the critic's scale to their taste.
 * Declared here rather than beside its storage because it is a shape the AI
 * layer reasons about — lib/memory/store.ts imports it back for persistence.
 */
export interface CalibrationExample {
  text: string;
  verdict: "strong" | "weak";
  note: string | null;
  ratedAt: string;
}

export interface CritiqueRound {
  round: number;
  score: number;
  weakestLink: string;
  verdict: string;
  bulletScores: {
    id: string;
    score: number;
    lenses: {
      atsScreen: number;
      sixSecondSkim: number;
      domainExpert: number;
      interviewDefense: number;
    };
    namedArtifact: string | null;
    namedOutcome: string | null;
    interviewerFollowUp: string;
    instruction: string | null;
  }[];
  /** Rewrites that survived both the number audit and the blind comparison. */
  revised: { id: string; before: string; after: string }[];
  /**
   * Changes the critic asked for that the reviser declined to make, because
   * nothing in memory supported them. These name what the resume cannot yet
   * say — often the most useful thing a run produces.
   */
  unmet: { instruction: string; why: string | null }[];
  /** Whether any rewrite this round survived. */
  accepted: boolean | null;
  note: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  id: string;
  createdAt: string;
  resumeFile: string;
  jobDescription: string;
  charLimit: number;
  target: TargetProfile | null;
  original: ResumeDoc;
  tailored: ResumeDoc;
  coverage: CoverageRow[];
  strategy: string;
  /** Audit problems that survived the corrective turn — shown, never hidden. */
  auditFailures: { where: string; text: string; issues: string[] }[];
  chat: ChatTurn[];
  /** The critic loop's trace, shown rather than hidden. */
  critique: CritiqueRound[];
  /**
   * How many reviewer rounds this run was allowed. Recorded so a session
   * reopened later says what produced it — a flat score after one round means
   * something different from a flat score after three.
   */
  reviewRounds: number;
  exportedPath: string | null;
  demo: boolean;
}

export function newSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `s-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
