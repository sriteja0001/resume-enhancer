// Offline stand-ins used when no API key is configured. These are HAND-WRITTEN
// RULES, not intelligence — they exist so the app is explorable on a fresh
// clone, and every surface that renders their output labels it as demo mode.
//
// What they still exercise for real: docx parsing, the memory store, the
// entity graph and ranking, diffing, highlighting, the number audit, and the
// .docx export. Only judgment is faked.

import { rankEntities, rankItems, norm } from "../memory/graph";
import type { Memory } from "../memory/types";
import type { ResumeDoc, Section } from "../resume/model";
import type { CoverageRow, TargetProfile } from "./session";
import { literallyContains } from "./validate";

const DOMAIN_HINTS: Record<string, string[]> = {
  chemistry: ["chemistry", "chemical", "organic chem", "molecul", "reaction", "spectro"],
  biology: ["biology", "bacterial", "microbiome", "clinical", "genom", "protein"],
  "machine-learning": ["machine learning", "ml", "model", "neural", "classifier", "pytorch", "scikit"],
  "software-engineering": ["software", "engineer", "backend", "frontend", "api", "codebase"],
  "data-science": ["data science", "analytics", "statistic", "pandas", "visualization"],
  entrepreneurship: ["startup", "founder", "revenue", "d2c", "growth", "customers"],
  research: ["research", "publication", "paper", "ieee", "lab", "experiment"],
  infrastructure: ["kubernetes", "docker", "deploy", "pipeline", "infrastructure", "cloud"],
};

const SKILL_WORDS =
  /\b(Python|TypeScript|JavaScript|Java|C\+\+|SQL|React|Next\.js|Node\.js|PyTorch|TensorFlow|Scikit-learn|Pandas|NumPy|LangGraph|LangChain|RAG|Qdrant|Flask|Django|Kubernetes|Docker|AWS|GCP|Terraform|Kafka|PostgreSQL|Redis|GraphQL|Swift|Rust|Go|R|MATLAB|Matplotlib)\b/gi;

function guessDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const found = Object.entries(DOMAIN_HINTS)
    .filter(([, hints]) => hints.some((h) => lower.includes(h)))
    .map(([domain]) => domain);
  return found.length > 0 ? found : ["general"];
}

function guessSkills(text: string): string[] {
  return [...new Set([...text.matchAll(SKILL_WORDS)].map((m) => m[0]))];
}

// ---------- intake ----------

export interface IntakeResult {
  identity: {
    name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    links: string[];
  };
  entities: {
    title: string;
    type: string;
    org: string | null;
    role: string | null;
    dates: string | null;
    location: string | null;
    domains: string[];
    skills: string[];
    facts: { text: string; domains: string[]; metrics: string[] }[];
    items: { kind: string; text: string; domains: string[] }[];
  }[];
  summary: string;
}

const METRIC_RE = /\$?\d[\d,]*(?:\.\d+)?\s*(?:%|k\b|m\b|x\b|\+|hours?|days?|weeks?|months?|users?|students?|subscribers?|views?|videos?)?/gi;

/** Split free text into entities on blank-line paragraphs and heading-ish lines. */
export function demoIntake(text: string): IntakeResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const entities: IntakeResult["entities"] = [];
  let current: IntakeResult["entities"][number] | null = null;

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
  const phone = text.match(/\+?\d[\d ()-]{8,}\d/)?.[0] ?? null;
  const links = [...text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?(github|linkedin)\.com\/\S+/gi)].map(
    (m) => m[0]
  );

  // Returns the entity rather than only assigning it, so control-flow
  // narrowing doesn't collapse `current` to never after the closure.
  const start = (title: string): IntakeResult["entities"][number] => {
    const created: IntakeResult["entities"][number] = {
      title,
      type: /universit|college|school|b\.?s\.?|bachelor|degree/i.test(title)
        ? "education"
        : /project/i.test(title)
          ? "project"
          : "experience",
      org: title,
      role: null,
      dates: null,
      location: null,
      domains: guessDomains(title),
      skills: guessSkills(title),
      facts: [],
      items: [],
    };
    entities.push(created);
    current = created;
    return created;
  };

  for (const line of lines) {
    if (!line) continue;
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const inline = line.match(
      /^(coursework|relevant coursework|skills?[^:]*|tools|awards?|extracurriculars?)\s*:\s*(.+)$/i
    );

    if (inline) {
      const target = current ?? start("Uncategorized");
      const kind = inline[1].toLowerCase().includes("course")
        ? "coursework"
        : inline[1].toLowerCase().includes("skill")
          ? "skills"
          : inline[1].toLowerCase().includes("award")
            ? "awards"
            : inline[1].toLowerCase().replace(/[^a-z]/g, "") || "items";
      for (const value of inline[2].split(/,(?![^(]*\))/)) {
        const v = value.trim();
        if (v) target.items.push({ kind, text: v, domains: guessDomains(v) });
      }
      continue;
    }

    if (bullet) {
      const target = current ?? start("Uncategorized");
      const body = bullet[1];
      target.facts.push({
        text: body,
        domains: guessDomains(body),
        metrics: [...new Set((body.match(METRIC_RE) ?? []).map((m) => m.trim()))].filter(
          (m) => /\d/.test(m)
        ),
      });
      continue;
    }

    // A short line with no sentence punctuation reads as a new entity heading.
    if (line.length < 80 && !/[.;]$/.test(line)) {
      start(line.replace(/\t/g, " — "));
      continue;
    }
    const target = current ?? start("Uncategorized");
    target.facts.push({
      text: line,
      domains: guessDomains(line),
      metrics: [...new Set((line.match(METRIC_RE) ?? []).map((m) => m.trim()))].filter((m) =>
        /\d/.test(m)
      ),
    });
  }

  return {
    identity: {
      name: lines.find((l) => l && !/[@\d]/.test(l) && l.split(" ").length <= 4) ?? null,
      email,
      phone,
      location: null,
      links,
    },
    entities,
    summary: `DEMO MODE — extracted by pattern-matching, not by a model: ${entities.length} entities, ${entities.reduce((n, e) => n + e.facts.length, 0)} facts, ${entities.reduce((n, e) => n + e.items.length, 0)} items. Domain tags are keyword guesses and will be rough.`,
  };
}

/**
 * Resume ingestion in demo mode. Converting the already-parsed ResumeDoc is
 * far more accurate than re-splitting flat text: sections give the entity
 * type, entries give org/role/dates, and inline lists give items — none of
 * which survive a plain-text pass.
 */
export function demoIntakeFromDoc(doc: ResumeDoc): IntakeResult {
  const typeFor = (title: string): string => {
    const t = title.toLowerCase();
    if (/education|academic/.test(t)) return "education";
    if (/project/.test(t)) return "project";
    if (/leader|volunteer|activit/.test(t)) return "leadership";
    if (/award|honor/.test(t)) return "award";
    if (/skill|additional|technical/.test(t)) return "skills";
    return "experience";
  };

  const entities: IntakeResult["entities"] = [];

  for (const section of doc.sections) {
    for (const entry of section.entries) {
      const title = [entry.org, entry.role].filter(Boolean).join(" — ") || section.title;
      const blob = [
        title,
        ...entry.bullets.map((b) => b.text),
        ...entry.inlineLists.flatMap((l) => l.values.map((v) => v.text)),
      ].join(" ");

      entities.push({
        title,
        type: typeFor(section.title),
        org: entry.org,
        role: entry.role,
        dates: entry.dates,
        location: entry.location,
        domains: guessDomains(blob),
        skills: guessSkills(blob),
        facts: entry.bullets.map((b) => ({
          text: b.text,
          domains: guessDomains(b.text),
          metrics: [...new Set((b.text.match(METRIC_RE) ?? []).map((m) => m.trim()))].filter(
            (m) => /\d/.test(m)
          ),
        })),
        items: entry.inlineLists.flatMap((list) =>
          list.values.map((v) => ({
            kind: list.label.toLowerCase().replace(/[^a-z]/g, "") || "items",
            text: v.text,
            domains: guessDomains(v.text),
          }))
        ),
      });
    }
  }

  return {
    identity: {
      name: doc.header.name,
      email: doc.header.contactLine?.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null,
      phone: doc.header.contactLine?.match(/\+?\d[\d ()-]{8,}\d/)?.[0] ?? null,
      location: null,
      links: [
        ...(doc.header.contactLine?.matchAll(
          /\b(?:https?:\/\/)?(?:www\.)?(?:github|linkedin)\.com\/\S+/gi
        ) ?? []),
      ].map((m) => m[0]),
    },
    entities,
    summary: `DEMO MODE — structure came from the .docx itself, but domain tags are keyword guesses, not judgment: ${entities.length} entities, ${entities.reduce((n, e) => n + e.facts.length, 0)} facts, ${entities.reduce((n, e) => n + e.items.length, 0)} items.`,
  };
}

// ---------- target profile ----------

export function demoTarget(jd: string): TargetProfile {
  const firstLine = jd.split(/\n/).find((l) => l.trim())?.trim() ?? "the role";
  const domains = guessDomains(jd);
  const skills = guessSkills(jd);
  const requirements = jd
    .split(/\n|[.;]/)
    .map((l) => l.replace(/^[-•*\s]+/, "").trim())
    .filter((l) => l.length > 25 && l.length < 160)
    .slice(0, 10)
    .map((text, i) => ({
      text,
      importance: (i < 3 ? "critical" : i < 7 ? "important" : "nice-to-have") as
        | "critical"
        | "important"
        | "nice-to-have",
    }));

  return {
    roleTitle: firstLine.slice(0, 80),
    roleFamily: domains[0] ?? "general",
    seniority: /senior|staff|principal/i.test(jd)
      ? "senior"
      : /intern/i.test(jd)
        ? "intern"
        : /new grad|entry/i.test(jd)
          ? "new-grad"
          : "mid",
    companyType: /startup|seed|series [a-c]|founding/i.test(jd)
      ? "startup"
      : /research|laborator|phd/i.test(jd)
        ? "research"
        : "unknown",
    domains,
    mustHaveSkills: skills.slice(0, 8),
    niceToHaveSkills: skills.slice(8),
    requirements,
    readStrategy:
      "DEMO MODE — this is keyword matching, not analysis. Set ANTHROPIC_API_KEY for a real read of the posting.",
  };
}

// ---------- tailor ----------

/**
 * Rule-based tailoring: rank the person's entities and items against the
 * target's domains, reorder sections and entries by that score, and reorder
 * inline lists so on-domain values come first. It genuinely demonstrates the
 * placement/selection/ordering mechanics — it just can't write.
 */
export function demoTailor(args: {
  memory: Memory;
  original: ResumeDoc;
  target: TargetProfile;
}): { doc: ResumeDoc; coverage: CoverageRow[]; strategy: string } {
  const { memory, original, target } = args;
  const ranked = rankEntities(memory, target.domains, target.mustHaveSkills);
  const scoreByOrg = new Map<string, number>();
  for (const r of ranked) {
    if (r.entity.org) scoreByOrg.set(norm(r.entity.org), r.score);
    scoreByOrg.set(norm(r.entity.title), r.score);
  }

  const relevantCourses = new Set(
    rankItems(memory, "coursework", target.domains, target.mustHaveSkills)
      .filter((r) => r.score > 0)
      .map((r) => r.item.text.toLowerCase())
  );

  const doc: ResumeDoc = {
    header: original.header,
    sections: original.sections.map<Section>((section) => ({
      ...section,
      entries: [...section.entries]
        .map((entry) => ({
          ...entry,
          bullets: entry.bullets.map((b) => ({ ...b, origin: "kept" as const })),
          inlineLists: entry.inlineLists.map((list) => {
            const sorted = [...list.values].sort((a, b) => {
              const aHit = relevantCourses.has(a.text.toLowerCase()) ? 1 : 0;
              const bHit = relevantCourses.has(b.text.toLowerCase()) ? 1 : 0;
              return bHit - aHit;
            });
            const reordered = sorted.some((v, i) => v.text !== list.values[i]?.text);
            return {
              ...list,
              values: sorted.map((v) => ({
                ...v,
                origin: reordered && relevantCourses.has(v.text.toLowerCase())
                  ? ("reordered" as const)
                  : ("kept" as const),
                why: reordered && relevantCourses.has(v.text.toLowerCase())
                  ? `DEMO: matches target domain (${target.domains.join(", ")})`
                  : null,
              })),
            };
          }),
        }))
        .sort((a, b) => {
          const sa = scoreByOrg.get(norm(a.org ?? "")) ?? 0;
          const sb = scoreByOrg.get(norm(b.org ?? "")) ?? 0;
          return sb - sa;
        }),
    })),
  };

  const pageText = doc.sections
    .flatMap((s) => s.entries.flatMap((e) => [...e.bullets.map((b) => b.text), ...e.inlineLists.flatMap((l) => l.values.map((v) => v.text))]))
    .join(" ");

  const coverage: CoverageRow[] = target.requirements.map((req) => {
    const hits = target.mustHaveSkills.filter((s) => literallyContains(req.text, s));
    const covered = hits.filter((s) => literallyContains(pageText, s));
    return {
      requirement: req.text,
      importance: req.importance,
      status: covered.length > 0 ? "strong" : hits.length > 0 ? "none" : "partial",
      evidenceFactIds: [],
      note: "DEMO MODE — keyword overlap only, not a judgment of substance.",
      literal: covered.length > 0,
    };
  });

  return {
    doc,
    coverage,
    strategy:
      "DEMO MODE. Entries and coursework were re-ordered by keyword-based domain scoring, and nothing was rewritten or moved between sections — a rule engine cannot judge placement or write bullets. Add ANTHROPIC_API_KEY to get real tailoring.",
  };
}

export function demoChatReply(): string {
  return [
    "DEMO MODE — no ANTHROPIC_API_KEY is configured, so I can't actually edit your resume.",
    "",
    "The document you're looking at was produced by keyword rules, not by a model.",
    "Add your key to .env.local and restart the dev server to enable real editing.",
  ].join("\n");
}
