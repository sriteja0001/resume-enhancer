// Core data model. See resume-enhancer-plan.md §5.
//
// The central idea: FACTS are raw truths about what I've done (global,
// append-only, unstyled). BULLETS are styled, char-limited renderings of
// facts, scoped to one resume. Facts are the only permitted source of
// numbers anywhere in the pipeline.

export interface Fact {
  id: string;
  text: string;
  /** Where this fact came from, e.g. "resume-upload 2026-07-24" or "interview 2026-07-24" */
  source: string;
}

export interface Experience {
  id: string;
  org: string;
  role: string;
  dates: string;
  facts: Fact[];
}

export interface ProfileSettings {
  /** Max characters per bullet so it fits one line in my resume template. */
  defaultCharLimit: number;
}

export interface Profile {
  experiences: Experience[];
  settings: ProfileSettings;
}

export const EMPTY_PROFILE: Profile = {
  experiences: [],
  settings: { defaultCharLimit: 118 },
};

// ---- Run types (Phase 3/4 — analysis, interview, rewrite, chat) ----

export type StrengthBasis =
  | "quantified"
  | "scope"
  | "complexity"
  | "adoption"
  | "responsibility"
  | "constraint";

export interface RewriteCandidate {
  text: string;
  chars: number;
  factRefs: string[];
}

export interface BulletAnalysis {
  bulletId: string;
  original: string;
  hasQuantifiedOutcome: boolean;
  strengthBasis: StrengthBasis | null;
  verdict: "strong" | "weak";
  weaknesses: string[];
  supportingFactIds: string[];
  /** The question that would surface a missing number — asked, never invented. */
  question: string | null;
  candidates: RewriteCandidate[];
}

export interface Run {
  id: string;
  resumeFile: string;
  jobDescription: string | null;
  charLimit: number;
  analysis: BulletAnalysis[];
  bullets: {
    text: string;
    factRefs: string[];
    chars: number;
    status: "kept-original" | "rewritten";
    candidates: RewriteCandidate[];
  }[];
  chat: { role: "user" | "assistant"; content: string }[];
}
