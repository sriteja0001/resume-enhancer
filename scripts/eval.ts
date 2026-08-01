// Eval harness. Two questions, one rubric.
//
//   npm run eval                      score every posting in eval/postings
//   npm run eval -- --only=chemistry  just the ones whose name matches
//   npm run eval -- --resume=old.docx pick a resume other than the first
//   npm run eval -- --judge           check the critic against your own labels
//
// The second matters more. A critic that shares a model with the generator can
// be confidently wrong, and the only way to find out is to test its scores
// against a human's. If they don't correlate, the loop is theatre — and you
// would never otherwise know.

import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { critique } from "../lib/ai/critic";
import { isDemo } from "../lib/ai/client";
import type { CalibrationExample, TargetProfile } from "../lib/ai/session";
import { tailor } from "../lib/ai/pipeline";
import { listResumes, loadCalibration } from "../lib/memory/store";
import type { ResumeDoc } from "../lib/resume/model";

const FIXTURES = path.join(process.cwd(), "eval", "postings");

/**
 * A fixture is a job posting, nothing more. The resume comes from your own
 * data/resumes — postings are shareable and check into the repo, resumes are
 * personal and never do.
 */
interface Fixture {
  name: string;
  jobDescription: string;
  charLimit?: number;
}

function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES)) return [];
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f.replace(/\.json$/, ""),
      ...JSON.parse(readFileSync(path.join(FIXTURES, f), "utf-8")),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function flag(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Pearson correlation; the question is whether the critic tracks human taste. */
function correlation(a: number[], b: number[]): number {
  if (a.length < 2) return NaN;
  const ma = mean(a);
  const mb = mean(b);
  const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
  const va = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0));
  const vb = Math.sqrt(b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return va && vb ? cov / (va * vb) : NaN;
}

/**
 * Does the critic agree with the candidate? Their rated bullets are presented
 * as one anonymous batch with no calibration examples supplied, so the critic
 * is scoring blind rather than being shown the answer.
 */
async function judgeTheJudge(examples: CalibrationExample[]): Promise<void> {
  if (examples.length < 4) {
    console.log(
      `Need at least 4 rated bullets to check the critic; found ${examples.length}.`
    );
    console.log("Rate bullets with the up/down arrows in the preview, then re-run.");
    return;
  }

  const doc: ResumeDoc = {
    header: { name: null, contactLine: null },
    sections: [
      {
        id: "s", title: "EXPERIENCE", origin: "kept", why: null,
        entries: [{
          id: "e", entityId: null, org: "—", role: null, location: null,
          dates: null, origin: "kept", movedFrom: null, why: null, inlineLists: [],
          bullets: examples.map((e, i) => ({
            id: `b${i}`, text: e.text, origin: "kept" as const,
            originalText: null, factRefs: [], why: null,
          })),
        }],
      },
    ],
  };

  const target: TargetProfile = {
    roleTitle: "(unspecified)", roleFamily: "software engineering",
    seniority: "new-grad", companyType: "unknown",
    domains: [], mustHaveSkills: [], niceToHaveSkills: [],
    requirements: [], readStrategy: "Judge these bullets on their own merits.",
  };

  const verdict = await critique({ doc, target, charLimit: 200, calibration: [] });
  const scoreById = new Map(verdict.bullets.map((b) => [b.id, b.score]));

  const human = examples.map((e) => (e.verdict === "strong" ? 8 : 3));
  const machine = examples.map((_, i) => scoreById.get(`b${i}`) ?? 5);

  console.log("\nCritic vs your own labels\n");
  examples.forEach((e, i) => {
    const agree = (e.verdict === "strong") === (machine[i] >= 6);
    console.log(
      `  ${agree ? "agree   " : "DISAGREE"}  you:${e.verdict.padEnd(6)} critic:${machine[i]}/10  ${e.text.slice(0, 62)}`
    );
  });

  const r = correlation(human, machine);
  const agreement =
    examples.filter((e, i) => (e.verdict === "strong") === (machine[i] >= 6)).length /
    examples.length;

  console.log(`\n  agreement: ${(agreement * 100).toFixed(0)}%   correlation r=${r.toFixed(2)}`);
  console.log(
    r > 0.6
      ? "  The critic tracks your taste well enough to trust its scores."
      : r > 0.3
        ? "  Weak correlation. Rate more bullets, or treat the scores as advisory."
        : "  The critic does NOT track your taste. Its scores should not be trusted as-is."
  );
}

async function scoreFixtures(
  fixtures: Fixture[],
  resume: string,
  calibration: CalibrationExample[]
) {
  console.log(`Scoring ${fixtures.length} posting(s) against ${resume}\n`);
  const before: number[] = [];
  const after: number[] = [];

  for (const fixture of fixtures) {
    let rounds;
    try {
      const session = await tailor({
        resumeName: resume,
        jobDescription: fixture.jobDescription,
        charLimit: fixture.charLimit ?? 200,
        notes: null,
      });
      rounds = session.critique;
    } catch (err) {
      // One bad posting should not cost you the whole run.
      console.log(`  ${fixture.name.padEnd(28)} FAILED  ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (rounds.length === 0) {
      console.log(`  ${fixture.name.padEnd(28)} no critique recorded`);
      continue;
    }
    const first = rounds[0].score;
    const last = rounds[rounds.length - 1].score;
    before.push(first);
    after.push(last);
    console.log(
      `  ${fixture.name.padEnd(28)} ${first}/10 -> ${last}/10  (${rounds.length} round${rounds.length === 1 ? "" : "s"})`
    );
    console.log(`  ${" ".repeat(28)} weakest: ${rounds[rounds.length - 1].weakestLink}`);
  }

  if (before.length === 0) return;

  console.log(
    `\n  first round ${mean(before).toFixed(2)}/10  ->  final ${mean(after).toFixed(2)}/10` +
      `   (${mean(after) >= mean(before) ? "+" : ""}${(mean(after) - mean(before)).toFixed(2)})`
  );
  console.log(`  worst final score: ${Math.min(...after)}/10   best: ${Math.max(...after)}/10`);
  console.log(`  calibration examples in use: ${calibration.length}`);
  console.log(
    "\n  These are the critic's own scores, so a rise is evidence the loop is doing"
  );
  console.log("  what it was told to — not proof the resume got better. For that, run --judge.");
}

async function main() {
  if (isDemo()) {
    console.log("Demo mode: no model is running, so there is nothing to evaluate.");
    console.log("Set ANTHROPIC_API_KEY in .env.local and re-run.");
    return;
  }
  const calibration = await loadCalibration();

  if (process.argv.includes("--judge")) {
    await judgeTheJudge(calibration);
    return;
  }

  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.log("No postings found in eval/postings/.");
    console.log('Add a file shaped like {"jobDescription": "...", "charLimit": 200}');
    return;
  }

  const resumes = await listResumes();
  const resume = flag("resume") ?? resumes[0];
  if (!resume) {
    console.log("No resume to score. Put a .docx in data/resumes/ and re-run.");
    return;
  }
  if (!resumes.includes(resume)) {
    console.log(`No such resume: ${resume}. Available: ${resumes.join(", ") || "(none)"}`);
    return;
  }

  const only = flag("only");
  await scoreFixtures(
    only ? fixtures.filter((f) => f.name.includes(only)) : fixtures,
    resume,
    calibration
  );
}

main();
