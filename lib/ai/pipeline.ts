// Orchestration. Two entry points that matter:
//   ingest()  — any text becomes entities in master.md (Intake mode)
//   tailor()  — resume + posting becomes a tailored ResumeDoc (Enhance mode)
// plus editDoc() for the chat loop.

import { hashId, slugId } from "../memory/markdown";
import type { Bucket } from "../memory/store";
import {
  listSourceFiles,
  loadMemory,
  mergeEntities,
  recordAbsorbed,
  resolveResume,
  resolveSourceFile,
  saveMemory,
  saveSession,
} from "../memory/store";
import type { Entity, Memory } from "../memory/types";
import { collectDropped, reconcileOrigins } from "../resume/diff";
import type { ResumeDoc } from "../resume/model";
import { docToText } from "../resume/model";
import { lineBudget } from "../resume/layout";
import { parseResume, renderBlocks } from "../resume/parse";
import {
  SUPPORTED_EXTENSIONS,
  extensionOf,
  extractFile,
  isSupported,
} from "../sources/extract";
import { isDemo, structuredCall } from "./client";
import type { IntakeResult } from "./demo";
import { demoChatReply, demoIntake, demoIntakeFromDoc, demoTailor, demoTarget } from "./demo";
import {
  INTAKE_SYSTEM,
  TAILOR_SYSTEM,
  TARGET_SYSTEM,
  chatSystem,
  chatUser,
  intakeUser,
  tailorRetryUser,
  tailorUser,
  targetUser,
} from "./prompts";
import { INTAKE_SCHEMA, TAILOR_SCHEMA, TARGET_SCHEMA } from "./schemas";
import type { CoverageRow, CritiqueRound, Session, TargetProfile } from "./session";
import { newSessionId } from "./session";
import { auditDoc, literallyContains, markFailures } from "./validate";
import { reviewBullets } from "./quality";
import { runCriticLoop } from "./critic";
import { loadCalibration } from "../memory/store";
import { renderRankedEvidence } from "./evidence";
import { POLISH_SYSTEM, polishUser } from "./prompts";
import { POLISH_SCHEMA } from "./schemas";

const schema = (s: unknown) => s as unknown as Record<string, unknown>;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- intake ----------

/** Raw extraction → typed entities with content-hash ids. */
function toEntities(result: IntakeResult, source: string): Entity[] {
  return result.entities.map((e) => ({
    id: slugId("e", e.title),
    title: e.title,
    type: (["experience", "education", "project", "leadership", "skills", "award", "other"].includes(
      e.type
    )
      ? e.type
      : "other") as Entity["type"],
    org: e.org,
    role: e.role,
    dates: e.dates,
    location: e.location,
    domains: e.domains,
    skills: e.skills,
    facts: e.facts.map((f) => ({
      id: hashId("f", f.text),
      text: f.text,
      domains: f.domains,
      metrics: f.metrics,
      source,
    })),
    items: e.items.map((i) => ({
      id: hashId("i", `${i.kind}:${i.text}`),
      kind: i.kind,
      text: i.text,
      domains: i.domains,
    })),
    notes: null,
  }));
}

export interface IngestOutcome {
  summary: string;
  addedEntities: number;
  addedFacts: number;
  addedItems: number;
  demo: boolean;
}

/**
 * Intake mode: push any text into memory. `preParsed` is supplied when the
 * source was a .docx we already structured — demo mode uses that structure
 * directly instead of re-splitting flat text.
 */
export async function ingest(args: {
  text: string;
  sourceLabel: string;
  preParsed?: IntakeResult;
}): Promise<IngestOutcome> {
  const memory = await loadMemory();
  const source = `${args.sourceLabel} ${today()}`;

  const result = isDemo()
    ? (args.preParsed ?? demoIntake(args.text))
    : await structuredCall<IntakeResult>({
        system: INTAKE_SYSTEM,
        messages: [
          { role: "user", content: intakeUser({ source: args.sourceLabel, text: args.text, existing: memory }) },
        ],
        schema: schema(INTAKE_SCHEMA),
      });

  const id = memory.identity;
  id.name ??= result.identity.name;
  id.email ??= result.identity.email;
  id.phone ??= result.identity.phone;
  id.location ??= result.identity.location;
  id.links = [...new Set([...id.links, ...result.identity.links])];

  const merged = mergeEntities(memory, toEntities(result, source));
  await saveMemory(merged.memory);

  return {
    summary: result.summary,
    addedEntities: merged.addedEntities,
    addedFacts: merged.addedFacts,
    addedItems: merged.addedItems,
    demo: isDemo(),
  };
}

/**
 * Ingest straight from a resume file. The model receives the STRUCTURE
 * (labelled list items, bold/italic, tab columns) rather than flattened prose,
 * because Word list formatting is what tells bullets apart from headings and
 * raw text throws it away.
 */
export async function ingestResume(resumeName: string): Promise<IngestOutcome> {
  const path = await resolveResume(resumeName);
  if (!path) throw new Error(`Unknown resume: ${resumeName}`);
  const { doc, blocks, plainText } = await parseResume(path);
  if (!plainText.trim()) throw new Error("Could not read any text from that .docx.");
  return ingest({
    text: renderBlocks(blocks),
    sourceLabel: `resume ${resumeName}`,
    preParsed: demoIntakeFromDoc(doc),
  });
}

/**
 * Absorb one source document — the primary way information enters memory.
 * Resumes route through the structural parser; everything else (research
 * summaries, notes, transcripts) is prose and goes in as text.
 */
export async function absorbFile(args: {
  name: string;
  bucket: Bucket;
}): Promise<IngestOutcome & { file: string; warning: string | null }> {
  const files = await listSourceFiles();
  const file = files.find((f) => f.name === args.name && f.bucket === args.bucket);
  if (!file) throw new Error(`File not found: ${args.name}`);

  const resolved = await resolveSourceFile(args.name, args.bucket);
  if (!resolved) throw new Error(`File not found: ${args.name}`);
  if (!isSupported(args.name)) {
    throw new Error(
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`
    );
  }

  // A resume in data/resumes/ carries structure worth preserving; a prose
  // document does not, so it takes the simpler text path.
  const isResume = args.bucket === "resumes" && extensionOf(args.name) === ".docx";
  let outcome: IngestOutcome;
  let warning: string | null = null;

  if (isResume) {
    outcome = await ingestResume(args.name);
  } else {
    const extracted = await extractFile(resolved);
    warning = extracted.warning;
    if (!extracted.text) {
      throw new Error(
        extracted.warning ?? "No text could be read from that file."
      );
    }
    outcome = await ingest({
      text: extracted.text,
      sourceLabel: args.name,
    });
  }

  await recordAbsorbed(`${args.bucket}/${args.name}`, {
    sha: file.sha,
    absorbedAt: new Date().toISOString(),
    entities: outcome.addedEntities,
    facts: outcome.addedFacts,
    items: outcome.addedItems,
  });

  return { ...outcome, file: args.name, warning };
}

// ---------- tailoring ----------

interface TailorRaw {
  header: { name: string | null; contactLine: string | null };
  sections: {
    title: string;
    why: string | null;
    entries: {
      entityId: string | null;
      org: string | null;
      role: string | null;
      location: string | null;
      dates: string | null;
      movedFrom: string | null;
      why: string | null;
      bullets: {
        text: string;
        originalText: string | null;
        factRefs: string[];
        origin: string;
        why: string | null;
      }[];
      inlineLists: {
        label: string;
        values: { text: string; origin: string; why: string | null }[];
        dropped: { text: string; why: string }[];
      }[];
    }[];
  }[];
  coverage: Omit<CoverageRow, "literal">[];
  strategy: string;
}

let counter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${++counter}`;

function rawToDoc(raw: TailorRaw): ResumeDoc {
  const asOrigin = (v: string): ResumeDoc["sections"][number]["origin"] =>
    (["kept", "rewritten", "added", "moved", "reordered"].includes(v) ? v : "kept") as never;

  return {
    header: raw.header,
    sections: raw.sections.map((s) => ({
      id: uid("s"),
      title: s.title,
      why: s.why,
      origin: "kept",
      entries: s.entries.map((e) => ({
        id: uid("en"),
        entityId: e.entityId,
        org: e.org,
        role: e.role,
        location: e.location,
        dates: e.dates,
        movedFrom: e.movedFrom,
        why: e.why,
        origin: e.movedFrom ? "moved" : "kept",
        bullets: e.bullets.map((b) => ({
          id: uid("b"),
          text: b.text,
          origin: asOrigin(b.origin),
          originalText: b.originalText,
          factRefs: b.factRefs,
          why: b.why,
        })),
        inlineLists: e.inlineLists.map((l) => ({
          label: l.label,
          values: l.values.map((v) => ({
            text: v.text,
            origin: asOrigin(v.origin),
            why: v.why,
          })),
          dropped: l.dropped,
        })),
      })),
    })),
  };
}


interface PolishRaw {
  bullets: { id: string; text: string; changed: boolean; why: string | null }[];
}

/**
 * Second pass over the prose alone.
 *
 * The tailoring call decides structure, selection, ordering AND wording in one
 * output, so bullet craft competes for attention with everything else. This
 * pass sees only the drafted bullets, the problems found in them, and the facts
 * they may draw on — a narrow task it can actually do well.
 *
 * Bounded deliberately: score, revise, re-score, stop. An open-ended loop would
 * trade the determinism the rest of the pipeline depends on for diminishing
 * returns on wording.
 */
async function polishBullets(args: {
  doc: ResumeDoc;
  memory: Memory;
  target: TargetProfile;
  charLimit: number;
  originalText: string;
}): Promise<{ doc: ResumeDoc; before: number; after: number }> {
  const factText = new Map<string, string>();
  for (const e of args.memory.entities) {
    for (const f of e.facts) {
      factText.set(f.id, `${f.text}${f.metrics.length ? ` [${f.metrics.join("; ")}]` : ""}`);
    }
  }

  const first = reviewBullets(args.doc, args.charLimit);
  let report = first;

  for (let round = 0; round < 2; round++) {
    if (report.issues.length === 0) break;

    // Every bullet goes in, not just the flagged ones: an entry reads as a
    // whole, and fixing one line in isolation produces a mismatched voice.
    const byId = new Map<string, { where: string; problems: string[] }>();
    for (const issue of report.issues) byId.set(issue.text, { where: issue.where, problems: issue.problems });

    const payload: {
      id: string;
      where: string;
      text: string;
      problems: string[];
      facts: string[];
    }[] = [];
    const index = new Map<string, ResumeDoc["sections"][number]["entries"][number]["bullets"][number]>();

    for (const section of args.doc.sections) {
      for (const entry of section.entries) {
        const where =
          [entry.org, entry.role].filter(Boolean).join(" — ") || section.title;
        for (const bullet of entry.bullets) {
          index.set(bullet.id, bullet);
          payload.push({
            id: bullet.id,
            where,
            text: bullet.text,
            problems: byId.get(bullet.text)?.problems ?? [],
            facts: bullet.factRefs.map((r) => factText.get(r)).filter((v): v is string => !!v),
          });
        }
      }
    }

    const raw = await structuredCall<PolishRaw>({
      system: POLISH_SYSTEM,
      messages: [
        {
          role: "user",
          content: polishUser({
            target: JSON.stringify(args.target, null, 2),
            charLimit: args.charLimit,
            bullets: payload,
          }),
        },
      ],
      schema: schema(POLISH_SCHEMA),
      maxTokens: 16000,
    });

    // Apply, then re-audit numbers: polish is prose-only, so any figure it
    // introduces is a fabrication and the original wording stands.
    type Bullet = ResumeDoc["sections"][number]["entries"][number]["bullets"][number];
    const applied: { bullet: Bullet; previous: string }[] = [];
    for (const out of raw.bullets) {
      const bullet = index.get(out.id);
      if (!bullet || !out.text.trim() || out.text.trim() === bullet.text) continue;
      applied.push({ bullet, previous: bullet.text });
      if (bullet.origin === "kept") {
        bullet.originalText = bullet.text;
        bullet.origin = "rewritten";
      }
      bullet.text = out.text.trim();
      if (out.why) bullet.why = out.why;
    }

    const failures = auditDoc({
      doc: args.doc,
      memory: args.memory,
      originalText: args.originalText,
      charLimit: args.charLimit,
    });
    if (failures.length > 0) {
      const bad = new Set(failures.map((f) => f.text));
      for (const { bullet, previous } of applied) {
        if (bad.has(bullet.text)) bullet.text = previous;
      }
    }

    report = reviewBullets(args.doc, args.charLimit);
  }

  return { doc: args.doc, before: first.issues.length, after: report.issues.length };
}

export async function tailor(args: {
  resumeName: string;
  jobDescription: string;
  charLimit: number;
  notes: string | null;
}): Promise<Session> {
  const path = await resolveResume(args.resumeName);
  if (!path) throw new Error(`Unknown resume: ${args.resumeName}`);

  const { doc: original, plainText } = await parseResume(path);
  if (original.sections.length === 0) {
    throw new Error("Could not find any sections in that resume file.");
  }

  const memory = await loadMemory();
  if (memory.entities.length === 0) {
    throw new Error(
      "Your memory is empty. Switch to Intake mode and add your background first — tailoring reads from memory, not from the resume alone."
    );
  }

  let target: TargetProfile;
  let doc: ResumeDoc;
  let coverage: CoverageRow[];
  let strategy: string;
  let auditFailures: { where: string; text: string; issues: string[] }[] = [];
  let critique: CritiqueRound[] = [];

  if (isDemo()) {
    target = demoTarget(args.jobDescription);
    const out = demoTailor({ memory, original, target });
    doc = out.doc;
    coverage = out.coverage;
    strategy = out.strategy;
  } else {
    target = await structuredCall<TargetProfile>({
      system: TARGET_SYSTEM,
      messages: [{ role: "user", content: targetUser(args.jobDescription) }],
      schema: schema(TARGET_SCHEMA),
      maxTokens: 16000,
    });

    const budget = lineBudget();
    const userMsg = tailorUser({
      target: JSON.stringify(target, null, 2),
      memory,
      evidence: renderRankedEvidence(memory, target),
      currentResume: original,
      charLimit: args.charLimit,
      notes: args.notes,
      totalLines: budget.totalLines,
      charsPerBulletLine: budget.charsPerBulletLine,
    });

    let raw = await structuredCall<TailorRaw>({
      system: TAILOR_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
      schema: schema(TAILOR_SCHEMA),
    });
    doc = rawToDoc(raw);

    // One corrective turn for anything the code audit rejects.
    let failures = auditDoc({ doc, memory, originalText: plainText, charLimit: args.charLimit });
    if (failures.length > 0) {
      raw = await structuredCall<TailorRaw>({
        system: TAILOR_SYSTEM,
        messages: [
          { role: "user", content: userMsg },
          { role: "assistant", content: JSON.stringify(raw) },
          { role: "user", content: tailorRetryUser(failures) },
        ],
        schema: schema(TAILOR_SCHEMA),
      });
      doc = rawToDoc(raw);
      failures = auditDoc({ doc, memory, originalText: plainText, charLimit: args.charLimit });
    }
    auditFailures = failures;

    // Craft last: the document is structurally settled and factually clean, so
    // wording can be improved without disturbing either. Code checks run first
    // as a free filter, then the critic judges what code cannot see.
    const polished = await polishBullets({
      doc,
      memory,
      target,
      charLimit: args.charLimit,
      originalText: plainText,
    });
    doc = polished.doc;

    const loop = await runCriticLoop({
      doc,
      memory,
      target,
      charLimit: args.charLimit,
      originalText: plainText,
      calibration: await loadCalibration(),
    });
    doc = loop.doc;
    critique = loop.rounds;

    auditFailures = auditDoc({
      doc,
      memory,
      originalText: plainText,
      charLimit: args.charLimit,
    });
    if (auditFailures.length > 0) doc = markFailures(doc, auditFailures);

    coverage = raw.coverage.map((c) => ({ ...c, literal: false }));
    strategy = raw.strategy;
  }

  // A resume with nobody's name on it is unusable. If neither the model nor the
  // source file supplied a header, fall back to what memory learned.
  const contactFromMemory =
    [memory.identity.email, memory.identity.phone, ...memory.identity.links]
      .filter(Boolean)
      .join(" · ") || null;
  doc.header.name ??= original.header.name ?? memory.identity.name;
  doc.header.contactLine ??= original.header.contactLine ?? contactFromMemory;

  // Origins are decided by comparison, not by assertion.
  doc = collectDropped(reconcileOrigins(doc, original), original);

  const pageText = docToText(doc);
  coverage = coverage.map((c) => ({
    ...c,
    literal: literallyContains(pageText, c.requirement.split(/[\s,]+/)[0] ?? ""),
  }));

  const session: Session = {
    id: newSessionId(),
    createdAt: new Date().toISOString(),
    resumeFile: args.resumeName,
    jobDescription: args.jobDescription,
    charLimit: args.charLimit,
    target,
    original,
    tailored: doc,
    coverage,
    strategy,
    auditFailures,
    chat: [],
    critique,
    exportedPath: null,
    demo: isDemo(),
  };
  await saveSession(session.id, session);
  return session;
}

// ---------- chat editing ----------

export async function editDoc(session: Session, message: string): Promise<Session> {
  session.chat.push({ role: "user", content: message });

  if (isDemo()) {
    session.chat.push({ role: "assistant", content: demoChatReply() });
    await saveSession(session.id, session);
    return session;
  }

  const memory = await loadMemory();
  const raw = await structuredCall<TailorRaw>({
    system: chatSystem({
      memory,
      target: JSON.stringify(session.target, null, 2),
      charLimit: session.charLimit,
    }),
    messages: [
      {
        role: "user",
        content: chatUser({
          doc: session.tailored,
          message,
          history: session.chat.slice(0, -1),
        }),
      },
    ],
    schema: schema(TAILOR_SCHEMA),
  });

  let doc = rawToDoc(raw);
  const failures = auditDoc({
    doc,
    memory,
    originalText: docToText(session.original),
    charLimit: session.charLimit,
  });
  if (failures.length > 0) doc = markFailures(doc, failures);
  session.auditFailures = failures;

  session.tailored = collectDropped(reconcileOrigins(doc, session.original), session.original);
  if (raw.coverage.length > 0) {
    session.coverage = raw.coverage.map((c) => ({ ...c, literal: false }));
  }

  const changed = session.tailored.sections
    .flatMap((s) => s.entries.flatMap((e) => e.bullets))
    .filter((b) => b.origin !== "kept").length;
  session.chat.push({
    role: "assistant",
    content: `Updated the document — ${changed} bullet${changed === 1 ? "" : "s"} now differ from your original. ${raw.strategy}`,
  });

  await saveSession(session.id, session);
  return session;
}
