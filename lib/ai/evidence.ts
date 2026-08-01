// Ranked evidence for the tailoring prompt.
//
// The graph in lib/memory/graph.ts scores entities and items against a posting,
// but until now only demo mode called it — the real prompt received memory in
// storage order with no scoring, so the model had to intuit what mattered from
// an undifferentiated pile. This renders the same memory ordered by relevance,
// with the reason each item surfaced, and calls out the strongest evidence
// explicitly.

import { rankEntities, rankItems } from "../memory/graph";
import type { Memory } from "../memory/types";
import type { TargetProfile } from "./session";

function factLine(text: string, id: string, metrics: string[]): string {
  const m = metrics.length > 0 ? ` [metrics: ${metrics.join("; ")}]` : "";
  return `- fact [${id}] ${text}${m}`;
}

export function renderRankedEvidence(memory: Memory, target: TargetProfile): string {
  const ranked = rankEntities(memory, target.domains, target.mustHaveSkills);
  const lines: string[] = [];

  const id = memory.identity;
  const identity = [
    id.name && `name: ${id.name}`,
    id.email && `email: ${id.email}`,
    id.phone && `phone: ${id.phone}`,
    id.location && `location: ${id.location}`,
    id.links.length > 0 && `links: ${id.links.join(", ")}`,
  ].filter(Boolean) as string[];
  if (identity.length > 0) lines.push("## Identity", ...identity, "");

  lines.push(
    "## Evidence, ranked against this posting",
    "Higher relevance first. `matched` names the posting terms this entry hits —",
    "that is the concrete reason it ranks where it does, not a vague vibe.",
    ""
  );

  for (const { entity: e, score, matched } of ranked) {
    lines.push(
      `### [${e.id}] ${e.title}  (relevance ${score}${matched.length ? `, matched: ${matched.join(", ")}` : ", no direct match"})`,
      `type: ${e.type}` +
        (e.org ? ` | org: ${e.org}` : "") +
        (e.role ? ` | role: ${e.role}` : "") +
        (e.dates ? ` | dates: ${e.dates}` : "") +
        (e.location ? ` | location: ${e.location}` : "")
    );
    if (e.domains.length) lines.push(`domains: ${e.domains.join(", ")}`);
    if (e.skills.length) lines.push(`skills: ${e.skills.join(", ")}`);
    for (const f of e.facts) lines.push(factLine(f.text, f.id, f.metrics));
    for (const item of e.items) {
      const d = item.domains.length ? ` (${item.domains.join(", ")})` : "";
      lines.push(`- item [${item.id}] (${item.kind}) ${item.text}${d}`);
    }
    if (e.notes) lines.push(`notes: ${e.notes}`);
    lines.push("");
  }

  // Facts carrying a measured outcome, from the entities that rank highest.
  // These are the sentences a screener remembers, so name them outright rather
  // than hoping they get noticed inside the pile above.
  const headline = ranked
    .filter((r) => r.score > 0)
    .flatMap((r) => r.entity.facts.filter((f) => f.metrics.length > 0).map((f) => ({ f, r })))
    .slice(0, 12);

  if (headline.length > 0) {
    lines.push(
      "## Highest-signal facts for this posting",
      "Quantified outcomes from the most relevant entries. These earn their place",
      "on the page before anything unquantified does.",
      ...headline.map(({ f, r }) => `- [${f.id}] ${f.text}  (from ${r.entity.title})`),
      ""
    );
  }

  // Coursework and skills the posting actually asks for, so selection inside an
  // inline list is a lookup rather than a guess.
  for (const kind of ["coursework", "skills"]) {
    const items = rankItems(memory, kind, target.domains, target.mustHaveSkills).filter(
      (i) => i.score > 0
    );
    if (items.length === 0) continue;
    lines.push(
      `## ${kind} matching this posting`,
      ...items.slice(0, 15).map((i) => `- ${i.item.text} (matched: ${i.matched.join(", ")})`),
      ""
    );
  }

  return lines.join("\n");
}
