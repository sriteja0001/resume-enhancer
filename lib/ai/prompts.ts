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

  // Identity first: without it the model has no name or contact line to put at
  // the top of a resume whose own header was missing.
  const id = memory.identity;
  const identityParts = [
    id.name && `name: ${id.name}`,
    id.email && `email: ${id.email}`,
    id.phone && `phone: ${id.phone}`,
    id.location && `location: ${id.location}`,
    id.links.length > 0 && `links: ${id.links.join(", ")}`,
  ].filter(Boolean);
  if (identityParts.length > 0) {
    lines.push("## Identity", ...(identityParts as string[]), "");
  }

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

1. PLACEMENT — which of the resume's EXISTING sections each entry belongs in. Moving a single entry is powerful: a venture sitting under "Leadership" belongs under "Experience" when applying to a startup, because a screener reading top-down must hit it before deciding. Set movedFrom whenever you relocate something, and say why.

KEEP THE SECTION STRUCTURE THEY ALREADY HAVE. Reproduce their section headings verbatim and IN THE SAME ORDER — same names, same set, same sequence. Do not promote a section up the page or push one down: a student who puts Education first has decided Education goes first, and reordering their sections is not yours to do. Do NOT rename a section, do NOT merge two sections into one, do NOT invent a new heading, and do NOT dissolve a section by scattering its entries elsewhere. "PROFESSIONAL EXPERIENCE" does not become "AI & MACHINE LEARNING EXPERIENCE"; "PROJECTS" and a YouTube channel do not become "PROJECTS & AUDIENCE"; "ADDITIONAL INFORMATION" does not become "TECHNICAL SKILLS & AWARDS". The owner must recognise their own resume at a glance — a document whose skeleton has been rebuilt reads as someone else's, and it destroys their trust in everything else you changed. Move entries between their sections freely; leave the sections themselves alone.

2. SELECTION — what appears at all. DEFAULT TO KEEPING EVERYTHING the current resume already has. It is their resume, and content vanishing without being asked for is the worst thing this tool can do — they will not notice the omission until an interviewer does. Add from the knowledge base when something genuinely earns its place for this posting. Trimming is routine in exactly one place: inline lists. If they list nine courses and the line holds four, show the four this employer cares about and put the rest in dropped. A chemistry-focused engineering role should see their chemistry coursework, not the algorithms course a generic listing would show — provided they actually took it.

3. ORDERING — entries within a section, bullets within an entry, and values within an inline list. NOT the sections themselves, which stay in the order the candidate chose. Most relevant first, always. A screener reads 6–10 seconds top-down; burying the most relevant entry third is the same as omitting it.

4. WORDING — how each retained item is described. Re-angle the same true work toward what this posting screens for. Same facts, different emphasis.

SPECIFICITY IS THE ENTIRE VALUE OF A BULLET. The named method, the named system, the named protocol — that is what a technical reader is scanning for and what separates this candidate from someone claiming the same thing generically. "Built analysis framework implementing log2 fold-change with Benjamini-Hochberg correction across 24+ strain-treatment combinations" is strong precisely because a reader can tell the person actually did the statistics. Compressed to "Modeled stress tolerance across 24+ pairs with Random Forest and SVM", it becomes a sentence anyone could write, and the resume is worse than before you touched it.

So: re-angle, do not summarise. Keep every named technology, method, metric and artefact from the original unless the posting makes one actively irrelevant. A rewritten bullet should land near the character budget you are given, not at half of it — coming in far under budget means you deleted detail you had room for. If you find yourself dropping a technical term to save space, you are optimising the wrong thing.

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

USE this space — do not come in far under it. Blank space at the bottom of a resume is wasted signal: if you have lines left over, keep the coursework, skills and awards you were considering trimming, and let bullets carry their full detail. Trim only what the page genuinely cannot hold.

Add it up before you finish. A resume that runs onto a second page has failed — but so does one that quietly loses a third of the candidate's work. If you are over budget, in this order:

1. Tighten wording. Most bullets carry 10-20% slack that can go without losing a single fact. This is almost always enough.
2. Trim inline list values, recording what you removed in dropped.
3. Only if still over, drop the single least relevant bullet, and say plainly in its why that it was cut for space.

Dropping a whole entry is a last resort that needs an explicit reason. Never remove more than one or two bullets in total. If the content genuinely cannot fit even after tightening, return it anyway and say so in strategy — an honest overflow the candidate can resolve beats silent deletion.
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
