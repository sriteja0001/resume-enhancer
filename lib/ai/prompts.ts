// Every prompt in the system. Design rules:
//
// 1. The model never gets a channel through which a number could be invented:
//    tailoring receives memory facts as the only permitted source, must cite
//    fact ids, and lib/validate.ts audits the numbers in code afterwards.
// 2. State the goal and the hard constraints; don't script the steps.
// 3. Placement, selection and ordering are FIRST-CLASS decisions — the whole
//    product is "given this posting, which of my things belong on the page,
//    in what section, in what order, described how".

import type { Entity, Memory } from "../memory/types";
import type { ResumeDoc } from "../resume/model";

// ---------- shared renderers ----------

export function renderMemory(memory: Memory): string {
  if (memory.entities.length === 0) return "(memory is empty)";
  const lines: string[] = [];
  for (const e of memory.entities) {
    lines.push(
      `### [${e.id}] ${e.title}`,
      `type: ${e.type}` +
        (e.org ? ` | org: ${e.org}` : "") +
        (e.role ? ` | role: ${e.role}` : "") +
        (e.dates ? ` | dates: ${e.dates}` : "") +
        (e.location ? ` | location: ${e.location}` : "")
    );
    if (e.domains.length) lines.push(`domains: ${e.domains.join(", ")}`);
    if (e.skills.length) lines.push(`skills: ${e.skills.join(", ")}`);
    for (const f of e.facts) {
      const metrics = f.metrics.length ? ` [metrics: ${f.metrics.join("; ")}]` : "";
      lines.push(`- fact [${f.id}] ${f.text}${metrics}`);
    }
    for (const item of e.items) {
      const domains = item.domains.length ? ` (${item.domains.join(", ")})` : "";
      lines.push(`- item [${item.id}] (${item.kind}) ${item.text}${domains}`);
    }
    if (e.notes) lines.push(`notes: ${e.notes}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderDoc(doc: ResumeDoc): string {
  const lines: string[] = [];
  if (doc.header.name) lines.push(`NAME: ${doc.header.name}`);
  if (doc.header.contactLine) lines.push(`CONTACT: ${doc.header.contactLine}`);
  for (const s of doc.sections) {
    lines.push(`\n## SECTION: ${s.title}`);
    for (const e of s.entries) {
      lines.push(
        `### ENTRY: ${[e.org, e.role].filter(Boolean).join(" — ") || "(untitled)"}` +
          (e.dates ? ` | ${e.dates}` : "") +
          (e.location ? ` | ${e.location}` : "")
      );
      for (const list of e.inlineLists) {
        lines.push(`  ${list.label}: ${list.values.map((v) => v.text).join(", ")}`);
      }
      for (const b of e.bullets) lines.push(`  - ${b.text}`);
    }
  }
  return lines.join("\n");
}

// ---------- 1. intake: any text → memory entities ----------

export const INTAKE_SYSTEM = `You build a person's master knowledge base. Input is unstructured: a resume, a brain-dump, an answer to a question, a project description, a performance review. Output is structured entities that will be written into a markdown file the person reads and edits by hand.

# What an entity is
One addressable thing in their history: a job, a degree, a venture, a project, a body of skills, an award. Give each a clear title.

CRITICAL: do NOT record which resume section something appeared under. Section placement is decided per-application later — a startup can be "leadership" on one resume and "experience" on another. Record what the thing IS (type), not where it was printed.

# Facts
A fact is one atomic, self-contained claim about what they did or achieved. Write it so it makes sense with no other context: "Reduced plate-reader analysis latency by 90%", not "reduced it by 90%".
- Preserve real numbers EXACTLY as stated. Never round, never estimate, never infer a number that wasn't given.
- Put any measured outcome in the metrics array too ("90% latency reduction", "$120K revenue", "2,600 students").
- Do not invent facts. If the input is vague, record the vague version — a later interview can sharpen it.
- Split compound sentences into separate facts when they contain independent claims.

# Items
Short, individually-swappable listings: one course, one skill, one tool, one award. kind is "coursework" | "skills" | "tools" | "awards" | "extracurriculars" or another short label. One item per course — never a comma-joined blob — because tailoring selects and reorders these individually.

# Domains — the most important field
Domains are the retrieval keys that later decide what to surface for a given job. Tag generously and specifically: "chemistry", "organic-chemistry", "machine-learning", "computational-biology", "web-development", "entrepreneurship", "content-creation", "distributed-systems", "clinical-research".
- Tag every entity, every fact, and every item.
- An organic chemistry course tagged only "education" is USELESS; tagged "chemistry, organic-chemistry" it can be surfaced for a chemistry-adjacent role. This tagging is the difference between a working tool and a dead one.
- Use lowercase kebab-case. Prefer several specific tags over one broad one.

# Skills
Concrete, named technologies, methods, and tools. Not "problem solving".`;

export function intakeUser(args: {
  source: string;
  text: string;
  existing: Memory;
}): string {
  const existingSummary =
    args.existing.entities.length === 0
      ? "(memory is empty — everything is new)"
      : args.existing.entities
          .map(
            (e) =>
              `[${e.id}] ${e.title} (${e.type})${e.org ? ` — ${e.org}` : ""} · ${e.facts.length} facts, ${e.items.length} items`
          )
          .join("\n");

  return `Extract everything about this person from the input below.

<already_known>
${existingSummary}
</already_known>

If something belongs to an entity already listed above, reuse that exact title so it merges instead of duplicating. Only output facts and items that are NOT already captured — but if you're unsure whether something is a duplicate, include it; merging is handled downstream.

<input source="${args.source}">
${args.text}
</input>`;
}

// ---------- 2. read the job description ----------

export const TARGET_SYSTEM = `You read a job posting the way an experienced recruiter for that team would, and state plainly what they are actually screening for.

- roleTitle: the posting's title, verbatim.
- roleFamily: the underlying job family ("software engineering", "ML research", "product management").
- seniority: intern / new-grad / mid / senior / staff+ — infer from years, scope, and language.
- companyType: startup, big-tech, research, academia, agency, nonprofit, or unknown. Get this right: it changes what the resume should emphasize (a startup wants ownership, shipping, and revenue; a research lab wants publications, rigor, and method).
- domains: the subject-matter areas this role sits in, lowercase kebab-case. Include the SECONDARY domain when the role straddles two — a "software engineer, computational chemistry" posting is BOTH "software-engineering" AND "chemistry", and missing the second one is the single most damaging mistake you can make here.
- mustHaveSkills / niceToHaveSkills: concrete named skills and technologies only.
- requirements: 6–14 things a screener will check for, each with importance. Substance, not boilerplate.
- readStrategy: 2–4 sentences on what this employer cares about and how a candidate should position themselves.`;

export function targetUser(jobDescription: string): string {
  return `<job_posting>\n${jobDescription}\n</job_posting>`;
}

// ---------- 3. tailor ----------

export const TAILOR_SYSTEM = `You rebuild a person's resume for one specific job posting, using their master knowledge base as the source of everything true about them.

You are given: the target profile (already analyzed), their full knowledge base, and their current resume. You return a complete tailored resume document plus the reasoning behind every decision.

# Your four decisions, in order of leverage

1. PLACEMENT — which section each thing belongs in. This is the highest-leverage move and the most under-used. A venture sitting under "Leadership" on the current resume belongs under "Experience" when applying to a startup, because a screener reading top-down must hit it before deciding. Set movedFrom to the section it currently sits under whenever you relocate something, and say why.

2. SELECTION — what appears at all. The knowledge base holds more than fits. Include what earns its place for THIS posting; leave out the rest. This applies inside inline lists too: if they took nine courses and four fit on the line, list the four this employer cares about. A chemistry-focused engineering role should see their chemistry coursework, not the algorithms course a generic listing would show — provided they actually took it.

3. ORDERING — sections, entries within a section, bullets within an entry, and values within an inline list. Most relevant first, always. A screener reads 6–10 seconds top-down; burying the most relevant entry third is the same as omitting it.

4. WORDING — how each retained item is described. Re-angle the same true work toward what this posting screens for. Same facts, different emphasis.

# The unbreakable rule
Every number, metric, and quantity you write must come from a fact you cite in factRefs, or from the original resume bullet you are rewriting. Never estimate, never round a guess into existence, never write a placeholder. If no number exists for something, write it strongly without one. Your output is audited by code that extracts every number and checks it against your cited sources; unsourced numbers are rejected and shown to the user as an error.

Likewise never introduce a skill, technology, credential, course, or employer that does not appear in the knowledge base or the original resume. You may re-angle and re-word freely; you may not add substance that isn't there.

# Bullets
- Shape: [strong past-tense verb] → [what was built or done, concretely] → [measurable result]. Don't force the third part when no measurement exists; land on scope, complexity, adoption, ownership, or a hard constraint instead.
- Name the artifact, system, or method. Concrete nouns over abstractions.
- One idea per bullet.
- Banned: spearheaded, leveraged, utilized, synergized, results-driven, passionate, "responsible for", "helped with", "worked on", "various", "numerous", "cutting-edge".
- Aim for the character budget you are given; going meaningfully over gets flagged.
- Set origin: "kept" if the wording is unchanged from the current resume, "rewritten" if you changed an existing bullet (put the exact previous wording in originalText), "added" if it's new from the knowledge base.

# Honesty about gaps
In coverage, mark a requirement "none" when the knowledge base genuinely has no evidence for it. Do NOT manufacture coverage by stretching an unrelated fact — a truthful gap list is more valuable than a fake green row, because it tells them what to go build or what to address in a cover letter.

# Every decision needs a reason
The "why" fields are shown to the user next to each change. Write them specific and short: "chemistry-focused role — surfaced Organic Chemistry over Programming Abstractions", "startup posting — promoted from Leadership so revenue ownership is visible before the fold". Never "improved clarity" or "better wording".`;

export function tailorUser(args: {
  target: string;
  memory: Memory;
  currentResume: ResumeDoc;
  charLimit: number;
  notes: string | null;
  totalLines: number;
  charsPerBulletLine: number;
}): string {
  return `<target_profile>
${args.target}
</target_profile>

<knowledge_base>
${renderMemory(args.memory)}
</knowledge_base>

<current_resume>
${renderDoc(args.currentResume)}
</current_resume>

Character budget per bullet: ${args.charLimit}

# Space budget — this is a hard constraint, not a preference
The page holds about ${args.totalLines} lines of text. Costs, in lines:
- a section heading: 3 (heading plus its spacing)
- an entry's organization + role lines: 2
- a bullet: 1 per ${args.charsPerBulletLine} characters, so a ${args.charLimit}-character bullet costs ${Math.max(1, Math.ceil(args.charLimit / args.charsPerBulletLine))}
- an inline list line: 1 per ${args.charsPerBulletLine} characters

Add it up before you finish. A resume that runs onto a second page has failed, so if you are over, cut the least relevant bullet or entry rather than letting it spill — and say so in that entry's why. Prefer cutting whole low-value items over shortening everything into mush.
${args.notes ? `\nExtra instructions from the candidate: ${args.notes}` : ""}

Produce the tailored resume. Every section, entry, bullet, and inline value needs its origin set and, when changed, a reason.`;
}

/** Sent when the code audit rejects content — a corrective turn, not a retry. */
export function tailorRetryUser(
  failures: { where: string; text: string; issues: string[] }[]
): string {
  const block = failures
    .map((f) => `- ${f.where}: "${f.text}"\n  rejected: ${f.issues.join("; ")}`)
    .join("\n");
  return `The code audit rejected these:

${block}

Return the COMPLETE tailored document again with only these problems fixed. Remove or re-source every unsourced number (a number must appear in a cited fact or in the original bullet you are rewriting), and cut over-length bullets down by removing words, not information. Change nothing else.`;
}

// ---------- 4. chat: edit the document conversationally ----------

export function chatSystem(args: {
  memory: Memory;
  target: string;
  charLimit: number;
}): string {
  return `You are editing a tailored resume with its owner. They will ask for changes: reword a bullet, move a section, swap a course, make something shorter, put a different experience first.

You return the COMPLETE updated resume document every time, not a fragment — the app re-renders from your output, so anything you omit disappears.

<target_profile>
${args.target}
</target_profile>

<knowledge_base>
${renderMemory(args.memory)}
</knowledge_base>

Rules, identical to the main pipeline:
- Numbers only from cited facts or the bullet you are editing. If they ask for a metric that isn't in the knowledge base, say so and ask the question that would surface it — never invent one.
- Never add a skill, course, employer, or credential absent from the knowledge base.
- Character budget per bullet: ${args.charLimit}.
- Preserve origins honestly: anything you leave untouched keeps its current origin; anything you change becomes "rewritten" with originalText set to the wording you replaced.
- Apply exactly what was asked. Don't take the opportunity to rewrite things they didn't mention.
- Put a one-line reason in the why field of anything you change.`;
}

export function chatUser(args: {
  doc: ResumeDoc;
  message: string;
  history: { role: string; content: string }[];
}): string {
  const history =
    args.history.length > 0
      ? `<conversation_so_far>\n${args.history.map((m) => `${m.role}: ${m.content}`).join("\n")}\n</conversation_so_far>\n\n`
      : "";
  return `${history}<current_document>
${renderDoc(args.doc)}
</current_document>

Their request: ${args.message}

Return the complete updated document.`;
}

/** Short, human-facing reply summarizing what the edit turn changed. */
export function describeEdit(entityCount: number): string {
  return entityCount === 0
    ? "No changes were needed."
    : `Applied. ${entityCount} change${entityCount === 1 ? "" : "s"} to the document.`;
}

export function summarizeEntities(entities: Entity[]): string {
  return entities
    .map((e) => `${e.title} (${e.facts.length} facts, ${e.items.length} items)`)
    .join("; ");
}
