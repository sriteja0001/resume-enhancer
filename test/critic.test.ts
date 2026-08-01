// The critic loop's bookkeeping. The model calls are not tested here — what is
// tested is what happens around them, because that is where a bug is silent:
// a mis-tracked original makes the mockup lie about what changed, and a
// half-undone revert leaves an invented number on the page.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRevisions, revertRevisions } from "../lib/ai/critic";
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
