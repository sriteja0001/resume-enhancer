// The critic loop's bookkeeping. The model calls are not tested here — what is
// tested is what happens around them, because that is where a bug is silent:
// a mis-tracked original makes the mockup lie about what changed, and a
// half-undone revert leaves an invented number on the page.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
  applyRevisions,
  clampRounds,
  revertRevisions,
  runCriticLoop,
} from "../lib/ai/critic";
import { EMPTY_MEMORY } from "../lib/memory/types";
import type { Bullet, ResumeDoc } from "../lib/resume/model";

const docWith = (bullets: Partial<Bullet>[]): ResumeDoc => ({
  header: { name: "Jane Doe", contactLine: null },
  sections: [
    {
      id: "s", title: "EXPERIENCE", origin: "kept", why: null,
      entries: [{
        id: "e", entityId: null, org: "Northwind Lab", role: "Engineer",
        location: null, dates: null, origin: "kept", movedFrom: null, why: null,
        inlineLists: [],
        bullets: bullets.map((b, i) => ({
          id: `b${i}`, text: "", origin: "kept" as const,
          originalText: null, factRefs: [], why: null, ...b,
        })),
      }],
    },
  ],
});

const bulletsOf = (doc: ResumeDoc) => doc.sections[0].entries[0].bullets;

test("a revised bullet records the text it replaced", () => {
  const doc = docWith([{ text: "Built a thing." }]);
  const applied = applyRevisions(doc, [{ id: "b0", text: "Built a thing that cut latency 40%." }]);

  assert.equal(applied.length, 1);
  assert.equal(bulletsOf(doc)[0].text, "Built a thing that cut latency 40%.");
  assert.equal(bulletsOf(doc)[0].origin, "rewritten");
  assert.equal(bulletsOf(doc)[0].originalText, "Built a thing.");
});

test("revising twice keeps the first original, not the intermediate", () => {
  // The mockup diffs against originalText. If round two overwrote it, the page
  // would claim the bullet barely changed when it was rewritten twice over.
  const doc = docWith([{ text: "From the resume." }]);
  applyRevisions(doc, [{ id: "b0", text: "Second draft." }]);
  applyRevisions(doc, [{ id: "b0", text: "Third draft." }]);

  assert.equal(bulletsOf(doc)[0].text, "Third draft.");
  assert.equal(bulletsOf(doc)[0].originalText, "From the resume.");
});

test("an added bullet stays added when revised", () => {
  const doc = docWith([{ text: "New material.", origin: "added" }]);
  applyRevisions(doc, [{ id: "b0", text: "New material, sharpened." }]);

  assert.equal(bulletsOf(doc)[0].origin, "added");
  assert.equal(bulletsOf(doc)[0].originalText, null);
});

test("identical, blank, and unknown revisions are ignored", () => {
  const doc = docWith([{ text: "Unchanged." }]);
  const applied = applyRevisions(doc, [
    { id: "b0", text: "Unchanged." },
    { id: "b0", text: "   " },
    { id: "nope", text: "Belongs to no bullet." },
  ]);

  assert.equal(applied.length, 0);
  assert.equal(bulletsOf(doc)[0].origin, "kept");
  assert.equal(bulletsOf(doc)[0].originalText, null);
});

test("reverting a rejected revision restores the highlight state too", () => {
  // Restoring only the words would leave the bullet flagged as rewritten while
  // reading exactly as it always did — the mockup would highlight a non-change.
  const doc = docWith([{ text: "Ran the study." }]);
  const applied = applyRevisions(doc, [{ id: "b0", text: "Ran the study across 9,000 sites." }]);
  const reverted = revertRevisions(doc, applied, new Set(["Ran the study across 9,000 sites."]));

  assert.equal(reverted.length, 1);
  assert.equal(bulletsOf(doc)[0].text, "Ran the study.");
  assert.equal(bulletsOf(doc)[0].origin, "kept");
  assert.equal(bulletsOf(doc)[0].originalText, null);
});

test("the round setting is clamped rather than trusted", () => {
  // It arrives from a JSON request body, so every shape has to land somewhere.
  assert.equal(clampRounds(0), 0);
  assert.equal(clampRounds(1), 1);
  assert.equal(clampRounds(99), MAX_ROUNDS);
  assert.equal(clampRounds(-4), 0);
  assert.equal(clampRounds("2"), 2);
  assert.equal(clampRounds(2.7), 2);
  assert.equal(clampRounds(undefined), DEFAULT_ROUNDS);
  assert.equal(clampRounds("not a number"), DEFAULT_ROUNDS);
});

test("zero rounds returns the document untouched and makes no model call", async () => {
  // No API key is configured under test, so any call would throw. Reaching the
  // end proves the loop short-circuits before talking to anything.
  const doc = docWith([{ text: "Left exactly as it was." }]);
  const result = await runCriticLoop({
    doc,
    memory: structuredClone(EMPTY_MEMORY),
    target: {
      roleTitle: "x", roleFamily: "x", seniority: "x", companyType: "x",
      domains: [], mustHaveSkills: [], niceToHaveSkills: [],
      requirements: [], readStrategy: "x",
    },
    charLimit: 200,
    originalText: "Left exactly as it was.",
    calibration: [],
    maxRounds: 0,
  });

  assert.equal(result.rounds.length, 0);
  assert.equal(result.doc, doc);
  assert.equal(bulletsOf(result.doc)[0].text, "Left exactly as it was.");
});

test("reverting one bullet leaves the others alone", () => {
  const doc = docWith([{ text: "First." }, { text: "Second." }]);
  const applied = applyRevisions(doc, [
    { id: "b0", text: "First, invented 500 users." },
    { id: "b1", text: "Second, grounded." },
  ]);
  revertRevisions(doc, applied, new Set(["First, invented 500 users."]));

  assert.equal(bulletsOf(doc)[0].text, "First.");
  assert.equal(bulletsOf(doc)[1].text, "Second, grounded.");
  assert.equal(bulletsOf(doc)[1].origin, "rewritten");
});
