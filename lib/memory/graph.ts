// The derived index. Entities are the nodes; domains and skills are the join
// nodes that make retrieval a lookup instead of a scan. This is what turns
// "chemistry-focused SWE role" into a concrete set of courses and experiences
// to promote, and it is also what the UI renders as the coverage map.

import type { Entity, Item, Memory, MemoryGraph } from "./types";

export function norm(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

export function buildGraph(memory: Memory): MemoryGraph {
  const graph: MemoryGraph = {
    domains: new Map(),
    skills: new Map(),
    entityById: new Map(),
    factById: new Map(),
    itemById: new Map(),
  };

  const touch = (map: Map<string, ReturnType<typeof emptyNode>>, tag: string) => {
    const key = norm(tag);
    if (!key) return null;
    if (!map.has(key)) map.set(key, emptyNode(key));
    return map.get(key)!;
  };

  for (const e of memory.entities) {
    graph.entityById.set(e.id, e);
    for (const d of e.domains) touch(graph.domains, d)?.entityIds.push(e.id);
    for (const s of e.skills) touch(graph.skills, s)?.entityIds.push(e.id);

    for (const f of e.facts) {
      graph.factById.set(f.id, { fact: f, entityId: e.id });
      for (const d of f.domains) touch(graph.domains, d)?.factIds.push(f.id);
    }
    for (const item of e.items) {
      graph.itemById.set(item.id, { item, entityId: e.id });
      for (const d of item.domains) touch(graph.domains, d)?.itemIds.push(item.id);
    }
  }
  return graph;
}

function emptyNode(tag: string) {
  return { tag, entityIds: [] as string[], itemIds: [] as string[], factIds: [] as string[] };
}

/** Free-text match used to catch tags the author never wrote down. */
function mentions(haystack: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (n.length < 3) return false;
  return haystack.toLowerCase().includes(n);
}

export interface EntityScore {
  entity: Entity;
  score: number;
  /** Which target terms this entity matched — the "why it surfaced" trail. */
  matched: string[];
}

/**
 * Rank entities against a target profile's domains + skills. Tag hits are
 * worth more than text hits because tags were asserted deliberately (by the
 * user or at intake) while text hits are incidental.
 */
export function rankEntities(
  memory: Memory,
  targetDomains: string[],
  targetSkills: string[]
): EntityScore[] {
  const domains = targetDomains.map(norm);
  const skills = targetSkills.map((s) => s.trim().toLowerCase());

  return memory.entities
    .map((entity) => {
      const matched = new Set<string>();
      let score = 0;

      for (const d of entity.domains) {
        if (domains.includes(norm(d))) {
          score += 3;
          matched.add(d);
        }
      }
      for (const s of entity.skills) {
        if (skills.includes(s.trim().toLowerCase())) {
          score += 3;
          matched.add(s);
        }
      }

      const blob = [
        entity.title,
        entity.role ?? "",
        entity.org ?? "",
        ...entity.facts.map((f) => f.text),
        ...entity.items.map((i) => i.text),
      ].join(" ");

      for (const s of targetSkills) {
        if (mentions(blob, s) && !matched.has(s)) {
          score += 1;
          matched.add(s);
        }
      }
      for (const d of targetDomains) {
        if (mentions(blob, d) && !matched.has(d)) {
          score += 1;
          matched.add(d);
        }
      }

      // Facts carrying a measured outcome make an entity more useful to place.
      score += Math.min(entity.facts.filter((f) => f.metrics.length > 0).length, 3);

      return { entity, score, matched: [...matched] };
    })
    .sort((a, b) => b.score - a.score);
}

/** Same idea for individual items — this is the course-swap query. */
export function rankItems(
  memory: Memory,
  kind: string,
  targetDomains: string[],
  targetSkills: string[]
): { item: Item; entityId: string; score: number; matched: string[] }[] {
  const domains = targetDomains.map(norm);
  const out: { item: Item; entityId: string; score: number; matched: string[] }[] = [];

  for (const e of memory.entities) {
    for (const item of e.items) {
      if (item.kind !== kind) continue;
      const matched = new Set<string>();
      let score = 0;
      for (const d of item.domains) {
        if (domains.includes(norm(d))) {
          score += 3;
          matched.add(d);
        }
      }
      for (const t of [...targetDomains, ...targetSkills]) {
        if (mentions(item.text, t) && !matched.has(t)) {
          score += 1;
          matched.add(t);
        }
      }
      out.push({ item, entityId: e.id, score, matched: [...matched] });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface MemoryStats {
  entities: number;
  facts: number;
  items: number;
  metrics: number;
  domains: { tag: string; count: number }[];
  skills: { tag: string; count: number }[];
}

export function memoryStats(memory: Memory): MemoryStats {
  const graph = buildGraph(memory);
  const count = (m: MemoryGraph["domains"]) =>
    [...m.values()]
      .map((n) => ({
        tag: n.tag,
        count: n.entityIds.length + n.itemIds.length + n.factIds.length,
      }))
      .sort((a, b) => b.count - a.count);

  return {
    entities: memory.entities.length,
    facts: memory.entities.reduce((n, e) => n + e.facts.length, 0),
    items: memory.entities.reduce((n, e) => n + e.items.length, 0),
    metrics: memory.entities.reduce(
      (n, e) => n + e.facts.filter((f) => f.metrics.length > 0).length,
      0
    ),
    domains: count(graph.domains),
    skills: count(graph.skills),
  };
}
