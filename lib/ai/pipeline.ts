// Orchestration. Two entry points that matter:
//   ingest()  — any text becomes entities in master.md (Intake mode)
//   tailor()  — resume + posting becomes a tailored ResumeDoc (Enhance mode)
// plus editDoc() for the chat loop.

import { hashId, slugId } from "../memory/markdown";
import { loadMemory, mergeEntities, resolveResume, saveMemory, saveSession } from "../memory/store";
import type { Entity } from "../memory/types";
import { collectDropped, reconcileOrigins } from "../resume/diff";
import type { ResumeDoc } from "../resume/model";
import { docToText } from "../resume/model";
import { parseResume, renderBlocks } from "../resume/parse";
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
import type { CoverageRow, Session, TargetProfile } from "./session";
import { newSessionId } from "./session";
import { auditDoc, literallyContains, markFailures } from "./validate";

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

    const userMsg = tailorUser({
      target: JSON.stringify(target, null, 2),
      memory,
      currentResume: original,
      charLimit: args.charLimit,
      notes: args.notes,
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
    if (failures.length > 0) doc = markFailures(doc, failures);

    coverage = raw.coverage.map((c) => ({ ...c, literal: false }));
    strategy = raw.strategy;
  }

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
