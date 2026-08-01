// Craft checks: the number audit proves a bullet is true, these prove it is
// worth reading. Their findings are what the polish pass is told to fix.

import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewBullets } from "../lib/ai/quality";
import type { ResumeDoc } from "../lib/resume/model";

const docWith = (texts: string[]): ResumeDoc => ({
  header: { name: "Jane Doe", contactLine: null },
  sections: [
    {
      id: "s", title: "EXPERIENCE", origin: "kept", why: null,
      entries: [{
        id: "e", entityId: null, org: "Northwind Lab", role: "Engineer",
        location: null, dates: null, origin: "kept", movedFrom: null, why: null,
        inlineLists: [],
        bullets: texts.map((text, i) => ({
          id: `b${i}`, text, origin: "kept" as const,
          originalText: null, factRefs: [], why: null,
        })),
      }],
    },
  ],
});

const problems = (text: string, limit = 200) =>
  reviewBullets(docWith([text]), limit).issues.flatMap((i) => i.problems).join(" | ");

test("flags a bullet that leaves most of its budget unused", () => {
  assert.match(problems("Cut deploy latency 90% by parallelizing the ingest path."), /only \d+ of 200/);
});

test("flags openers that describe effort rather than achievement", () => {
  assert.match(problems("Completed an AI bootcamp with a 15% acceptance rate, shipping MCP servers and production RAG pipelines with LangGraph over biomedical corpora for downstream research."), /describes effort/);
  assert.doesNotMatch(problems("Architected a 3-model KNN classifier reaching 94.5% accuracy across 2,600 students, cutting clinical evaluation time 90% against licensed professional assessments."), /describes effort/);
});

test("flags a metric buried in the back half", () => {
  const buried = "Architected a hierarchical multi-model classifier over elementary school student mental health intervention records, ultimately reaching 94.5% accuracy on primary risk detection.";
  assert.match(problems(buried), /back half/);
  const led = "Reached 94.5% accuracy on primary risk detection with a hierarchical 3-model KNN classifier spanning 2,600 elementary student records across a full clinical deployment.";
  assert.doesNotMatch(problems(led), /back half/);
});

test("flags a bullet with no measurable outcome, and activity lists", () => {
  const listy = "Benchmarked classifiers, applied subsampling, separated risk cohorts, and documented the resulting evaluation approach for the wider research team to reuse later.";
  const found = problems(listy);
  assert.match(found, /no measurable outcome/);
  assert.match(found, /list of activities/);
});

test("flags filler phrases", () => {
  assert.match(problems("Successfully leveraged various tools to grow the platform to 26.8K+ subscribers and 4.3M+ views across 114 videos on medical education and academic research topics."), /filler/);
});

test("a strong bullet reports nothing, and density is measured", () => {
  const strong = "Grew a 24K+ student community while directing a 12-person team through 200+ content cycles, sustaining the brand's organic acquisition across Amazon and D2C channels.";
  const report = reviewBullets(docWith([strong]), 200);
  assert.deepEqual(report.issues, []);
  assert.ok(report.density > 0.75, "density reflects budget use");
});
