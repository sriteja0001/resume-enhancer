// master.md is the source of truth. Not a cache, not an export — the file the
// app parses on every read and rewrites on every merge. You can hand-edit it,
// diff it in git, or delete a line you disagree with, and the app obeys.
//
// The grammar is deliberately small so it round-trips losslessly:
//
//   ## <Section>                 group heading (Experience, Education, ...)
//   ### <Entity title>           one addressable entity
//   key: value                   metadata lines, until the first blank/list
//   - <fact text>                a claim; "(metric: ...)" annotations optional
//   items(<kind>):               opens a listing block
//   - <text> | domains: a, b     one taggable item
//
// Fact and item ids are content hashes, so hand-editing text simply mints a
// new id rather than corrupting references.

import { createHash } from "crypto";
import type { Entity, EntityType, Fact, Item, Memory } from "./types";
import { EMPTY_MEMORY } from "./types";

export function hashId(prefix: string, text: string): string {
  const h = createHash("sha1").update(text.trim().toLowerCase()).digest("hex");
  return `${prefix}-${h.slice(0, 8)}`;
}

export function slugId(prefix: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}-${slug || hashId("x", text).slice(2)}`;
}

const ENTITY_TYPES: EntityType[] = [
  "experience",
  "education",
  "project",
  "leadership",
  "skills",
  "award",
  "other",
];

function splitList(v: string): string[] {
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "Reduced latency by 90% (metric: 90% latency reduction)" → text + metrics */
function parseFactLine(line: string, source: string): Fact {
  const domainMatch = line.match(/\|\s*domains:\s*([^|]+)$/i);
  let text = domainMatch ? line.slice(0, domainMatch.index).trim() : line.trim();
  const domains = domainMatch ? splitList(domainMatch[1]) : [];

  const metrics: string[] = [];
  text = text
    .replace(/\(metric:\s*([^)]+)\)/gi, (_, m) => {
      metrics.push(m.trim());
      return "";
    })
    .trim();

  return { id: hashId("f", text), text, domains, metrics, source };
}

function parseItemLine(line: string, kind: string): Item {
  const domainMatch = line.match(/\|\s*domains:\s*([^|]+)$/i);
  const text = domainMatch ? line.slice(0, domainMatch.index).trim() : line.trim();
  return {
    id: hashId("i", `${kind}:${text}`),
    kind,
    text,
    domains: domainMatch ? splitList(domainMatch[1]) : [],
  };
}

function typeFromString(v: string | undefined, sectionTitle: string): EntityType {
  const candidate = (v ?? sectionTitle).trim().toLowerCase().replace(/\s+/g, "");
  const direct = ENTITY_TYPES.find((t) => t === candidate);
  if (direct) return direct;
  if (/experience|work|employment/.test(candidate)) return "experience";
  if (/education|school|university/.test(candidate)) return "education";
  if (/project/.test(candidate)) return "project";
  if (/leader|volunteer|activity/.test(candidate)) return "leadership";
  if (/skill|tool|technolog/.test(candidate)) return "skills";
  if (/award|honor|recognition/.test(candidate)) return "award";
  return "other";
}

export function parseMemory(markdown: string): Memory {
  const lines = markdown.split(/\r?\n/);
  const memory: Memory = {
    identity: { ...EMPTY_MEMORY.identity, links: [] },
    entities: [],
    preamble: "",
  };

  let sectionTitle = "";
  let current: Entity | null = null;
  let itemKind: string | null = null;
  let inIdentity = false;
  const preamble: string[] = [];
  let sawHeading = false;

  const flush = () => {
    if (current) memory.entities.push(current);
    current = null;
    itemKind = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("## ")) {
      flush();
      sectionTitle = line.slice(3).trim();
      inIdentity = /^identity|^profile|^about/i.test(sectionTitle);
      sawHeading = true;
      continue;
    }

    if (line.startsWith("# ")) {
      sawHeading = true;
      continue;
    }

    if (line.startsWith("### ")) {
      flush();
      const title = line.slice(4).trim();
      current = {
        id: slugId("e", title),
        title,
        type: typeFromString(undefined, sectionTitle),
        org: null,
        role: null,
        dates: null,
        location: null,
        domains: [],
        skills: [],
        facts: [],
        items: [],
        notes: null,
      };
      inIdentity = false;
      continue;
    }

    if (!line) {
      itemKind = null;
      continue;
    }

    // items(kind): opens a listing block
    const itemsOpen = line.match(/^items\(([^)]+)\)\s*:\s*$/i);
    if (itemsOpen && current) {
      itemKind = itemsOpen[1].trim().toLowerCase();
      continue;
    }

    if (line.startsWith("- ")) {
      const body = line.slice(2).trim();
      if (!body) continue;
      if (current && itemKind) {
        current.items.push(parseItemLine(body, itemKind));
      } else if (current) {
        current.facts.push(parseFactLine(body, "master.md"));
      } else if (inIdentity) {
        memory.identity.links.push(body);
      }
      continue;
    }

    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_ ]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim().toLowerCase();
      const value = kv[2].trim();
      if (inIdentity) {
        if (key === "name") memory.identity.name = value || null;
        else if (key === "email") memory.identity.email = value || null;
        else if (key === "phone") memory.identity.phone = value || null;
        else if (key === "location") memory.identity.location = value || null;
        else if (key === "links") memory.identity.links.push(...splitList(value));
        continue;
      }
      if (current) {
        if (key === "type") current.type = typeFromString(value, sectionTitle);
        else if (key === "org" || key === "organization") current.org = value || null;
        else if (key === "role" || key === "title") current.role = value || null;
        else if (key === "dates") current.dates = value || null;
        else if (key === "location") current.location = value || null;
        else if (key === "domains") current.domains = splitList(value);
        else if (key === "skills") current.skills = splitList(value);
        else if (key === "notes") current.notes = value || null;
        continue;
      }
    }

    if (!sawHeading) preamble.push(raw);
  }
  flush();

  memory.preamble = preamble.join("\n").trim();
  return memory;
}

function sectionFor(type: EntityType): string {
  switch (type) {
    case "experience":
      return "Experience";
    case "education":
      return "Education";
    case "project":
      return "Projects";
    case "leadership":
      return "Leadership";
    case "skills":
      return "Skills";
    case "award":
      return "Awards";
    default:
      return "Other";
  }
}

const SECTION_ORDER = [
  "Education",
  "Experience",
  "Projects",
  "Leadership",
  "Skills",
  "Awards",
  "Other",
];

export function serializeMemory(memory: Memory): string {
  const out: string[] = [];
  out.push("# Master Profile");
  out.push("");
  out.push(
    "<!-- Everything the enhancer knows about you. Hand-edit freely: this file"
  );
  out.push("     is the source of truth and is re-read on every run. -->");
  out.push("");

  out.push("## Identity");
  const id = memory.identity;
  if (id.name) out.push(`name: ${id.name}`);
  if (id.email) out.push(`email: ${id.email}`);
  if (id.phone) out.push(`phone: ${id.phone}`);
  if (id.location) out.push(`location: ${id.location}`);
  if (id.links.length) out.push(`links: ${id.links.join(", ")}`);
  out.push("");

  const bySection = new Map<string, Entity[]>();
  for (const e of memory.entities) {
    const s = sectionFor(e.type);
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s)!.push(e);
  }

  const sections = [
    ...SECTION_ORDER.filter((s) => bySection.has(s)),
    ...[...bySection.keys()].filter((s) => !SECTION_ORDER.includes(s)),
  ];

  for (const section of sections) {
    out.push(`## ${section}`);
    out.push("");
    for (const e of bySection.get(section)!) {
      out.push(`### ${e.title}`);
      out.push(`type: ${e.type}`);
      if (e.org) out.push(`org: ${e.org}`);
      if (e.role) out.push(`role: ${e.role}`);
      if (e.dates) out.push(`dates: ${e.dates}`);
      if (e.location) out.push(`location: ${e.location}`);
      if (e.domains.length) out.push(`domains: ${e.domains.join(", ")}`);
      if (e.skills.length) out.push(`skills: ${e.skills.join(", ")}`);
      if (e.notes) out.push(`notes: ${e.notes}`);
      if (e.facts.length) {
        out.push("");
        for (const f of e.facts) {
          const metrics = f.metrics.length
            ? ` (metric: ${f.metrics.join("; ")})`
            : "";
          const domains = f.domains.length
            ? ` | domains: ${f.domains.join(", ")}`
            : "";
          out.push(`- ${f.text}${metrics}${domains}`);
        }
      }
      const kinds = [...new Set(e.items.map((i) => i.kind))];
      for (const kind of kinds) {
        out.push("");
        out.push(`items(${kind}):`);
        for (const item of e.items.filter((i) => i.kind === kind)) {
          const domains = item.domains.length
            ? ` | domains: ${item.domains.join(", ")}`
            : "";
          out.push(`- ${item.text}${domains}`);
        }
      }
      out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
