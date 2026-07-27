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
  exportedPath: string | null;
  demo: boolean;
}

export function newSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `s-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
