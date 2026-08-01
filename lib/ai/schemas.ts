// JSON schemas for structured outputs. Constraints that matter: every object
// needs additionalProperties:false plus a complete required list, no
// recursion, and nullables via anyOf (a ["string","null"] type array is not
// in the supported set).

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const STRING_ARRAY = { type: "array", items: { type: "string" } } as const;

const ENTITY_TYPES = [
  "experience",
  "education",
  "project",
  "leadership",
  "skills",
  "award",
  "other",
] as const;

/** Intake: any text (resume, brain-dump, answers) → entities for master.md. */
export const INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["identity", "entities", "summary"],
  properties: {
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["name", "email", "phone", "location", "links"],
      properties: {
        name: NULLABLE_STRING,
        email: NULLABLE_STRING,
        phone: NULLABLE_STRING,
        location: NULLABLE_STRING,
        links: STRING_ARRAY,
      },
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "type",
          "org",
          "role",
          "dates",
          "location",
          "domains",
          "skills",
          "facts",
          "items",
        ],
        properties: {
          title: { type: "string" },
          type: { type: "string", enum: [...ENTITY_TYPES] },
          org: NULLABLE_STRING,
          role: NULLABLE_STRING,
          dates: NULLABLE_STRING,
          location: NULLABLE_STRING,
          domains: STRING_ARRAY,
          skills: STRING_ARRAY,
          facts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "domains", "metrics"],
              properties: {
                text: { type: "string" },
                domains: STRING_ARRAY,
                metrics: STRING_ARRAY,
              },
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "text", "domains"],
              properties: {
                kind: { type: "string" },
                text: { type: "string" },
                domains: STRING_ARRAY,
              },
            },
          },
        },
      },
    },
    summary: { type: "string" },
  },
} as const;

/** Step 1 of tailoring: read the posting. */
export const TARGET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "roleTitle",
    "roleFamily",
    "seniority",
    "companyType",
    "domains",
    "mustHaveSkills",
    "niceToHaveSkills",
    "requirements",
    "readStrategy",
  ],
  properties: {
    roleTitle: { type: "string" },
    roleFamily: { type: "string" },
    seniority: { type: "string" },
    companyType: {
      type: "string",
      enum: ["startup", "big-tech", "research", "academia", "agency", "nonprofit", "unknown"],
    },
    domains: STRING_ARRAY,
    mustHaveSkills: STRING_ARRAY,
    niceToHaveSkills: STRING_ARRAY,
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "importance"],
        properties: {
          text: { type: "string" },
          importance: { type: "string", enum: ["critical", "important", "nice-to-have"] },
        },
      },
    },
    readStrategy: {
      type: "string",
      description:
        "2-4 sentences: what this employer is screening for and how the resume should be positioned.",
    },
  },
} as const;

const ORIGIN = {
  type: "string",
  enum: ["kept", "rewritten", "added", "moved", "reordered"],
} as const;

/** Step 2: the tailored document plus the reasoning behind every decision. */
export const TAILOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["header", "sections", "coverage", "strategy"],
  properties: {
    header: {
      type: "object",
      additionalProperties: false,
      required: ["name", "contactLine"],
      properties: { name: NULLABLE_STRING, contactLine: NULLABLE_STRING },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "entries"],
        properties: {
          title: { type: "string" },
          why: NULLABLE_STRING,
          entries: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "entityId",
                "org",
                "role",
                "location",
                "dates",
                "movedFrom",
                "why",
                "bullets",
                "inlineLists",
              ],
              properties: {
                entityId: NULLABLE_STRING,
                org: NULLABLE_STRING,
                role: NULLABLE_STRING,
                location: NULLABLE_STRING,
                dates: NULLABLE_STRING,
                movedFrom: NULLABLE_STRING,
                why: NULLABLE_STRING,
                bullets: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["text", "originalText", "factRefs", "origin", "why"],
                    properties: {
                      text: { type: "string" },
                      originalText: NULLABLE_STRING,
                      factRefs: STRING_ARRAY,
                      origin: ORIGIN,
                      why: NULLABLE_STRING,
                    },
                  },
                },
                inlineLists: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "values", "dropped"],
                    properties: {
                      label: { type: "string" },
                      values: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["text", "origin", "why"],
                          properties: {
                            text: { type: "string" },
                            origin: ORIGIN,
                            why: NULLABLE_STRING,
                          },
                        },
                      },
                      dropped: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["text", "why"],
                          properties: { text: { type: "string" }, why: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    coverage: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "importance", "status", "evidenceFactIds", "note"],
        properties: {
          requirement: { type: "string" },
          importance: { type: "string", enum: ["critical", "important", "nice-to-have"] },
          status: { type: "string", enum: ["strong", "partial", "none"] },
          evidenceFactIds: STRING_ARRAY,
          note: { type: "string" },
        },
      },
    },
    strategy: {
      type: "string",
      description: "3-6 sentences on the overall positioning choice for this application.",
    },
  },
} as const;

/** Polish pass: bullets only, keyed by id so they map back onto the document. */
export const POLISH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bullets"],
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "changed", "why"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          changed: {
            type: "boolean",
            description: "false when the bullet was already good and is returned unaltered.",
          },
          why: NULLABLE_STRING,
        },
      },
    },
  },
} as const;

/**
 * The critic's verdict. Deliberately weighted toward extraction rather than
 * opinion: naming the artifact and writing the interviewer's follow-up are
 * tasks with checkable answers, where a model that shares the generator's
 * blind spots is least able to fool itself.
 */
export const CRITIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bullets", "overallScore", "weakestLink", "verdict"],
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "atsScreen",
          "sixSecondSkim",
          "domainExpert",
          "interviewDefense",
          "score",
          "namedArtifact",
          "namedOutcome",
          "interviewerFollowUp",
          "caseForCutting",
          "instruction",
        ],
        properties: {
          id: { type: "string" },
          atsScreen: { type: "integer", description: "1-10: carries the terms this posting is screened on." },
          sixSecondSkim: { type: "integer", description: "1-10: lands with a recruiter who reads only the first half." },
          domainExpert: { type: "integer", description: "1-10: credible and non-trivial to someone who knows the field." },
          interviewDefense: { type: "integer", description: "1-10: specific enough to survive being probed." },
          score: { type: "integer", description: "1-10 overall." },
          namedArtifact: {
            ...NULLABLE_STRING,
            description: "The concrete thing built, named. Null if the bullet does not identify one — which is itself the finding.",
          },
          namedOutcome: {
            ...NULLABLE_STRING,
            description: "What measurably changed. Null if the bullet states activity only.",
          },
          interviewerFollowUp: {
            type: "string",
            description: "The question a sharp interviewer would ask. A trivial question means a thin bullet.",
          },
          caseForCutting: {
            type: "string",
            description: "The strongest argument for deleting this bullet entirely.",
          },
          instruction: {
            ...NULLABLE_STRING,
            description: "One concrete change. Null only when the bullet genuinely cannot be improved.",
          },
        },
      },
    },
    overallScore: { type: "integer", description: "1-10 for the resume as a whole." },
    weakestLink: { type: "string", description: "The single biggest problem with this resume." },
    verdict: { type: "string", description: "2-3 sentences: would this candidate get the screen, and why." },
  },
} as const;

/**
 * Blind comparison used as the regression gate. Models rank pairs far more
 * reliably than they score in the absolute, and a critic shown its own output
 * tends to approve it — so the two versions arrive unlabelled and in random
 * order, and the caller alone knows which is which.
 */
export const PAIRWISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["winner", "why"],
  properties: {
    winner: { type: "string", enum: ["A", "B", "tie"] },
    why: { type: "string" },
  },
} as const;
