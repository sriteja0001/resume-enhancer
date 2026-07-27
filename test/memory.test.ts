// master.md is the source of truth, so the parser and serializer must
// round-trip losslessly — a lost domain tag or a mangled metric silently
// degrades every future tailoring. Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph, rankEntities, rankItems } from "../lib/memory/graph";
import { parseMemory, serializeMemory } from "../lib/memory/markdown";
import { mergeEntities } from "../lib/memory/store";
import type { Memory } from "../lib/memory/types";

const SAMPLE = `# Master Profile

## Identity
name: Jane Doe
email: jane@example.com
links: github.com/jane, linkedin.com/in/jane

## Education

### State University — BS Computer Science
type: education
dates: 2025 – 2029
domains: computer-science, artificial-intelligence

items(coursework):
- Programming Abstractions | domains: computer-science, algorithms
- Organic Chemistry | domains: chemistry, organic-chemistry
- Probability Theory | domains: math, computer-science

## Experience

### Northwind Lab
type: experience
org: Northwind Institute of Science
role: Machine Learning Researcher
dates: September 2025 – Present
domains: machine-learning, computational-biology
skills: Python, scikit-learn

- Engineered bacterial phenotyping pipeline processing 96-well plate kinetics | domains: machine-learning
- Reduced plate-reader analysis latency by 90% (metric: 90% latency reduction) | domains: infrastructure

## Leadership

### TEJA
type: leadership
org: TEJA
role: Founder/CEO
domains: entrepreneurship
skills: D2C, Amazon

- Generated $120K+ in revenue across Amazon and D2C channels (metric: $120K revenue) | domains: entrepreneurship
`;

test("parse extracts identity, entities, facts, items and their tags", () => {
  const m = parseMemory(SAMPLE);
  assert.equal(m.identity.name, "Jane Doe");
  assert.equal(m.identity.email, "jane@example.com");
  assert.equal(m.identity.links.length, 2);
  assert.equal(m.entities.length, 3);

  const edu = m.entities.find((e) => e.type === "education")!;
  assert.equal(edu.items.length, 3);
  assert.deepEqual(
    edu.items.find((i) => i.text === "Organic Chemistry")!.domains,
    ["chemistry", "organic-chemistry"]
  );

  const lab = m.entities.find((e) => e.title === "Northwind Lab")!;
  assert.equal(lab.role, "Machine Learning Researcher");
  assert.equal(lab.facts.length, 2);
  assert.deepEqual(lab.facts[1].metrics, ["90% latency reduction"]);
  assert.ok(!lab.facts[1].text.includes("metric:"), "metric annotation stripped from text");
});

test("serialize → parse round-trips without losing anything", () => {
  const first = parseMemory(SAMPLE);
  const second = parseMemory(serializeMemory(first));

  assert.equal(second.entities.length, first.entities.length);
  assert.equal(second.identity.name, first.identity.name);
  for (const before of first.entities) {
    const after = second.entities.find((e) => e.title === before.title)!;
    assert.ok(after, `entity ${before.title} survived`);
    assert.deepEqual(after.domains, before.domains);
    assert.deepEqual(after.skills, before.skills);
    assert.deepEqual(
      after.facts.map((f) => [f.text, f.metrics]),
      before.facts.map((f) => [f.text, f.metrics])
    );
    assert.deepEqual(
      after.items.map((i) => [i.kind, i.text, i.domains]),
      before.items.map((i) => [i.kind, i.text, i.domains])
    );
  }
});

test("fact ids are content hashes — stable across reorder, new on edit", () => {
  const a = parseMemory(SAMPLE);
  const b = parseMemory(SAMPLE);
  const factA = a.entities.find((e) => e.title === "Northwind Lab")!.facts[0];
  const factB = b.entities.find((e) => e.title === "Northwind Lab")!.facts[0];
  assert.equal(factA.id, factB.id);

  const edited = parseMemory(SAMPLE.replace("96-well", "384-well"));
  const factC = edited.entities.find((e) => e.title === "Northwind Lab")!.facts[0];
  assert.notEqual(factC.id, factA.id);
});

test("graph indexes domains across entities, facts and items", () => {
  const graph = buildGraph(parseMemory(SAMPLE));
  assert.ok(graph.domains.has("chemistry"));
  assert.equal(graph.domains.get("chemistry")!.itemIds.length, 1);
  assert.ok(graph.domains.get("machine-learning")!.entityIds.length >= 1);
});

test("ranking surfaces the chemistry course for a chemistry-focused role", () => {
  const memory = parseMemory(SAMPLE);
  const courses = rankItems(memory, "coursework", ["chemistry"], []);
  assert.equal(courses[0].item.text, "Organic Chemistry");
  assert.ok(courses[0].score > courses[courses.length - 1].score);
});

test("ranking promotes the venture for an entrepreneurship-flavored role", () => {
  const memory = parseMemory(SAMPLE);
  const ranked = rankEntities(memory, ["entrepreneurship"], ["D2C"]);
  assert.equal(ranked[0].entity.title, "TEJA");
  assert.ok(ranked[0].matched.includes("entrepreneurship"));
});

test("merge is additive — existing facts survive, duplicates do not stack", () => {
  const memory: Memory = parseMemory(SAMPLE);
  const incoming = parseMemory(SAMPLE).entities;
  const before = memory.entities.length;

  const first = mergeEntities(memory, incoming);
  assert.equal(first.memory.entities.length, before, "no duplicate entities");
  assert.equal(first.addedFacts, 0, "identical facts are not re-added");

  const extra = parseMemory(`## Experience

### Northwind Lab
type: experience

- Presented results at a lab meeting | domains: research
`).entities;
  const second = mergeEntities(first.memory, extra);
  assert.equal(second.addedFacts, 1);
  assert.equal(
    second.memory.entities.find((e) => e.title === "Northwind Lab")!.facts.length,
    3
  );
});
