// THE DATA DECISION.
//
// The question was "knowledge graph?". The honest answer is: a tagged entity
// store whose edges are shared tag nodes — which IS a knowledge graph, just
// not one that needs a graph database.
//
// Why not a real graph DB: every query this app actually runs is a filter or
// a rank over entities ("which of my courses are chemistry", "what evidences
// 'agent orchestration'"). Those are inverted-index queries. Multi-hop
// traversal — the only thing a graph engine buys you — never comes up.
//
// Why not plain JSON: the user must be able to READ and HAND-EDIT everything
// the system believes about them. Markdown is the store; JSON is the parse.
//
// So the shape is:
//
//        Entity ──has──> Fact (a claim, optionally carrying a metric)
//          │  └──has──> Item (a short taggable listing: a course, a skill)
//          │
//          └──tagged──> Domain ──tagged──< Entity   (the graph edges)
//                       Skill  ──────────< Entity
//
// Domains and skills are the join nodes. "Chemistry-focused SWE role" walks
// jd-domain(chemistry) → entities/items tagged chemistry → rank → place.
// That traversal is what makes swapping a CS course for a chem course, or
// promoting a startup out of Leadership, a lookup instead of a guess.

/** A claim about work done. The ONLY legitimate source of numbers downstream. */
export interface Fact {
  /** Content hash — stable across reorders, changes when the text changes. */
  id: string;
  text: string;
  domains: string[];
  /** Numeric outcomes stated in this fact, e.g. "90% latency reduction". */
  metrics: string[];
  /** Where it came from: "resume <file> 2026-07-27", "intake 2026-07-27". */
  source: string;
}

/**
 * A short, taggable listing entry — one course, one skill, one award. These
 * are separate from facts because they are individually swappable and
 * re-orderable when tailoring (the "drop a CS course, surface Organic Chem"
 * move operates on these).
 */
export interface Item {
  id: string;
  /** "coursework" | "skills" | "awards" | "tools" | anything the user names. */
  kind: string;
  text: string;
  domains: string[];
}

export type EntityType =
  | "experience"
  | "education"
  | "project"
  | "leadership"
  | "skills"
  | "award"
  | "other";

/**
 * One addressable thing in the person's history: a job, a degree, a project,
 * a venture. Placement in a resume section is NOT stored here — the same
 * entity can be Leadership on one resume and Experience on another. That is
 * the whole point: section assignment is a tailoring decision, not a fact.
 */
export interface Entity {
  id: string;
  /** H3 heading text in master.md — the human-facing name. */
  title: string;
  type: EntityType;
  org: string | null;
  role: string | null;
  dates: string | null;
  location: string | null;
  domains: string[];
  skills: string[];
  facts: Fact[];
  items: Item[];
  /** Free-form context that isn't a resume claim — preferences, goals. */
  notes: string | null;
}

export interface Identity {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: string[];
}

export interface Memory {
  identity: Identity;
  entities: Entity[];
  /** Anything the parser didn't recognize, preserved verbatim on round-trip. */
  preamble: string;
}

export const EMPTY_MEMORY: Memory = {
  identity: { name: null, email: null, phone: null, location: null, links: [] },
  entities: [],
  preamble: "",
};

// ---------- derived graph index ----------

export interface TagNode {
  tag: string;
  entityIds: string[];
  itemIds: string[];
  factIds: string[];
}

export interface MemoryGraph {
  domains: Map<string, TagNode>;
  skills: Map<string, TagNode>;
  entityById: Map<string, Entity>;
  factById: Map<string, { fact: Fact; entityId: string }>;
  itemById: Map<string, { item: Item; entityId: string }>;
}
