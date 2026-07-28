// The document pipeline: parsing a real-shaped Word resume, deciding what
// actually changed, and generating a .docx. Origins drive every highlight in
// the UI, so they are decided by comparison here rather than trusted from the
// model. Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { auditDoc } from "../lib/ai/validate";
import { parseMemory } from "../lib/memory/markdown";
import { collectDropped, reconcileOrigins, wordDiff } from "../lib/resume/diff";
import { docToDocx } from "../lib/resume/docx-export";
import type { ResumeDoc } from "../lib/resume/model";
import { changeLog, countChanges, docToText } from "../lib/resume/model";
import { blocksToDoc, type Block } from "../lib/resume/parse";

const p = (text: string, o: { bold?: boolean; italic?: boolean } = {}): Block => ({
  kind: "paragraph",
  text,
  bold: o.bold ?? false,
  italic: o.italic ?? false,
  columns: text.split("\t").map((c) => c.trim()).filter(Boolean),
});
const li = (text: string): Block => ({
  kind: "list-item",
  text,
  bold: false,
  italic: false,
  columns: [text],
});

// Mirrors a real Word resume: bullets are list items with NO "•" character,
// the org line is bold, the role/date line is italic with a tab column.
const BLOCKS: Block[] = [
  p("Jane Doe"),
  p("jane@example.com · github.com/jane"),
  p("EDUCATION", { bold: true }),
  p("State University\tPortland, OR", { bold: true }),
  p("BS Computer Science\tExpected 2029", { italic: true }),
  li("Coursework: Programming Abstractions, Organic Chemistry, Probability Theory"),
  p("PROFESSIONAL EXPERIENCE", { bold: true }),
  p("Northwind Lab\tPortland, OR", { bold: true }),
  p("Machine Learning Researcher\tSeptember 2025 – Present", { italic: true }),
  li("Engineered bacterial phenotyping pipeline processing 96-well plate kinetics."),
  li("Reduced plate-reader analysis latency by 90%."),
  p("LEADERSHIP", { bold: true }),
  p("TEJA", { bold: true }),
  p("Founder/CEO\tAugust 2022 – Present", { italic: true }),
  li("Generated $120K+ in revenue across Amazon and D2C channels."),
];

test("parses a Word resume whose bullets carry no bullet character", () => {
  const doc = blocksToDoc(BLOCKS);
  assert.equal(doc.header.name, "Jane Doe");
  assert.ok(doc.header.contactLine?.includes("@"));

  const titles = doc.sections.map((s) => s.title);
  assert.deepEqual(titles, ["EDUCATION", "PROFESSIONAL EXPERIENCE", "LEADERSHIP"]);

  const lab = doc.sections[1].entries[0];
  assert.equal(lab.org, "Northwind Lab");
  assert.equal(lab.location, "Portland, OR");
  assert.equal(lab.role, "Machine Learning Researcher");
  assert.equal(lab.bullets.length, 2);
});

test("inline lists are split into individually swappable values", () => {
  const doc = blocksToDoc(BLOCKS);
  const list = doc.sections[0].entries[0].inlineLists[0];
  assert.equal(list.label, "Coursework");
  assert.equal(list.values.length, 3);
  assert.ok(list.values.some((v) => v.text === "Organic Chemistry"));
});

test("origins come from comparison, not from what the model claimed", () => {
  const original = blocksToDoc(BLOCKS);
  const tailored: ResumeDoc = JSON.parse(JSON.stringify(original));

  // The model claims a rewrite but returns identical words → must become kept.
  tailored.sections[1].entries[0].bullets[0].origin = "rewritten";
  tailored.sections[1].entries[0].bullets[0].originalText =
    tailored.sections[1].entries[0].bullets[0].text;

  // A genuine rewrite.
  const target = tailored.sections[1].entries[0].bullets[1];
  target.originalText = target.text;
  target.text = "Cut plate-reader analysis latency 90% by automating ingestion.";
  target.origin = "kept"; // understated on purpose

  const out = reconcileOrigins(tailored, original);
  assert.equal(out.sections[1].entries[0].bullets[0].origin, "kept", "false rewrite corrected");
  assert.equal(out.sections[1].entries[0].bullets[1].origin, "rewritten", "real change caught");
});

test("moving an entry between sections is detected and attributed", () => {
  const original = blocksToDoc(BLOCKS);
  const tailored: ResumeDoc = JSON.parse(JSON.stringify(original));

  // Promote TEJA out of Leadership into Experience — the startup use case.
  const teja = tailored.sections[2].entries[0];
  tailored.sections[2].entries = [];
  tailored.sections[1].entries.unshift(teja);

  const out = reconcileOrigins(tailored, original);
  const moved = out.sections[1].entries[0];
  assert.equal(moved.origin, "moved");
  assert.equal(moved.movedFrom, "LEADERSHIP");
});

test("an entry is still recognized when tailoring relabels its organization", () => {
  // Observed on a real run: the model rewrites the label itself, e.g.
  // "Northwind Lab" -> "Northwind Institute — ML Group". Exact string matching
  // called these brand new, which painted the whole resume as "added" and made
  // the highlighting meaningless.
  const original = blocksToDoc(BLOCKS);
  const tailored: ResumeDoc = JSON.parse(JSON.stringify(original));

  const lab = tailored.sections[1].entries[0];
  lab.org = "Northwind Institute — ML Group";
  const youtube = tailored.sections[2].entries[0];
  youtube.org = "TEJA (supplements)";

  const out = reconcileOrigins(tailored, original);
  assert.equal(out.sections[1].entries[0].origin, "kept", "relabelled org is not 'added'");
  assert.equal(out.sections[2].entries[0].origin, "kept");
});

test("a genuinely new entry is still reported as added", () => {
  const original = blocksToDoc(BLOCKS);
  const tailored: ResumeDoc = JSON.parse(JSON.stringify(original));
  tailored.sections[1].entries.push({
    id: "new1",
    entityId: null,
    org: "Helix Robotics",
    role: "Founding Engineer",
    location: null,
    dates: "2026",
    bullets: [],
    inlineLists: [],
    origin: "kept",
    movedFrom: null,
    why: null,
  });

  const out = reconcileOrigins(tailored, original);
  const added = out.sections[1].entries.find((e) => e.org === "Helix Robotics")!;
  assert.equal(added.origin, "added", "an entry with no counterpart is genuinely new");
});

test("dropped coursework is recorded rather than silently vanishing", () => {
  const original = blocksToDoc(BLOCKS);
  const tailored: ResumeDoc = JSON.parse(JSON.stringify(original));
  const list = tailored.sections[0].entries[0].inlineLists[0];
  list.values = list.values.filter((v) => v.text !== "Programming Abstractions");

  const out = collectDropped(reconcileOrigins(tailored, original), original);
  const dropped = out.sections[0].entries[0].inlineLists[0].dropped;
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].text, "Programming Abstractions");
});

test("word diff marks only the words that actually moved", () => {
  const parts = wordDiff("Reduced latency by 90%.", "Cut latency 90% by automating ingestion.");
  assert.ok(parts.some((p) => p.kind === "added"));
  assert.ok(parts.some((p) => p.kind === "removed"));
  assert.ok(parts.some((p) => p.kind === "same" && p.text.includes("latency")));
});

test("change log and counts summarize what happened", () => {
  const original = blocksToDoc(BLOCKS);
  const tailored: ResumeDoc = JSON.parse(JSON.stringify(original));
  const b = tailored.sections[1].entries[0].bullets[0];
  b.originalText = b.text;
  b.text = "Built a bacterial phenotyping pipeline over 96-well plate kinetics.";
  b.why = "chemistry-adjacent role — led with the wet-lab artifact";

  const out = reconcileOrigins(tailored, original);
  const counts = countChanges(out);
  assert.equal(counts.rewritten, 1);

  const log = changeLog(out);
  const row = log.find((r) => r.origin === "rewritten")!;
  assert.ok(row.originalText, "the previous wording is retained for display");
  assert.match(row.why!, /chemistry/);
});

test("number audit rejects a metric that exists nowhere in memory", () => {
  const memory = parseMemory(`## Experience

### Northwind Lab
type: experience

- Reduced plate-reader analysis latency by 90% (metric: 90% latency reduction)
`);
  const doc = blocksToDoc(BLOCKS);
  // Numbers already printed on the current resume are things this person has
  // already claimed, so they license themselves — same as in the real pipeline.
  const originalText = docToText(blocksToDoc(BLOCKS));
  const factId = memory.entities[0].facts[0].id;

  // Sourced number → passes.
  doc.sections[1].entries[0].bullets[1] = {
    id: "x1",
    text: "Cut analysis latency 90% by automating plate-reader ingestion.",
    origin: "rewritten",
    originalText: "Reduced plate-reader analysis latency by 90%.",
    factRefs: [factId],
    why: null,
  };
  assert.equal(
    auditDoc({ doc, memory, originalText, charLimit: 200 }).length,
    0,
    "a number traceable to a cited fact is allowed"
  );

  // Invented number → rejected.
  doc.sections[1].entries[0].bullets[1].text =
    "Cut analysis latency 97% by automating plate-reader ingestion.";
  const failures = auditDoc({ doc, memory, originalText, charLimit: 200 });
  assert.equal(failures.length, 1);
  assert.match(failures[0].issues[0], /97/);
});

test("docx export produces a real Word file", async () => {
  const buffer = await docToDocx(blocksToDoc(BLOCKS));
  assert.ok(buffer.length > 2000, "non-trivial file size");
  // .docx is a zip: first bytes are the PK local file header.
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
});
