# Resume Enhancer

Tailors a resume to a specific job posting using a knowledge base of your whole
background, not just the document you hand it.

Most resume tools edit the file in front of them. But that file is a lossy copy
of your history — the chemistry course you took and didn't list, the venture
you filed under "Leadership" that a startup would want to see first. A tool
that can only see the page can only reword the page.

This one keeps a persistent record of your background in a markdown file you
can edit by hand, then rebuilds the page for each posting: what goes on it,
which section it goes in, what order things appear, how they're worded. It
can't put a number in a bullet that you never gave it.

After the draft, a reviewer grades every bullet and the generator rewrites
whatever gets flagged. A rewrite only lands if it beats the original in a blind
comparison. The full trace is visible in the UI, rejected rewrites included.

## Quickstart

Needs Node 20+.

```bash
npm install
cp .env.local.example .env.local   # add your Anthropic API key
npm run dev                        # http://localhost:3000
```

`.env.local` is read at startup, so restart the dev server if you add the key
after the fact.

Then: put a `.docx` resume in `data/resumes/` — that's the layout you tailor
*from*. Open **Intake**, drag in whatever documents describe your background,
and hit absorb. Switch to **Enhance**, paste a posting, and run it.

Without an API key the app starts in demo mode behind a banner, falling back to
hand-written keyword rules instead of a model. Parsing, the memory graph,
ranking, diffing, the number audit and `.docx` export all still work; only the
judgment is faked. Set `ANTHROPIC_MODEL` to override the default of
`claude-opus-5`.

## The two modes

**Intake** exists to get information in, and the unit of intake is a file. Drop
in a research summary, a list of everything you did in high school, project
write-ups, transcripts, old resumes — `.docx`, `.pdf`, `.md`, `.txt`. Each gets
read into structured entities in `data/memory/master.md`.

The file library tracks each document's state: *not absorbed*, *in memory · 14
facts*, or *changed — re-absorb* once you edit it. Absorbing is additive and
safe to repeat. Identical facts dedupe by content hash, so re-absorbing an
edited file only adds what's new. You can also type text in directly, which is
handy for the one number you just remembered.

**Enhance** takes a base resume and a posting and gives you a rendered result
with a chat next to it. Save writes a new `.docx`; the original is opened
read-only and never modified.

## The rendering

The tailored resume renders as a document rather than a diff view:

| Color | Meaning |
|---|---|
| **black** | survived from your original file, untouched |
| yellow | rewritten (hover for word-level changes and the reason) |
| green | added from memory, wasn't on your resume before |
| blue | moved between sections, or reordered |
| red strike | dropped, with why |

Everything that isn't black carries a one-line rationale. Not "improved
clarity", but `"chemistry-focused role — surfaced Organic Chemistry over
Programming Abstractions"`.

## What it decides

Given *"Software Engineer, computational chemistry, seed-stage startup"*:

1. **Placement.** Your venture moves out of Leadership and into Experience,
   because a screener reading top-down needs to hit it before they decide.
2. **Selection.** Of nine courses, the four this employer cares about make the
   line. Chemistry coursework surfaces if you actually took it.
3. **Ordering.** Sections, entries, bullets and inline values, most relevant
   first. Screens run six to ten seconds, so burying your best entry third is
   close to leaving it off.
4. **Wording.** The same true work, angled toward what this posting screens
   for.

You also get a requirement coverage matrix: what the posting asks for against
what your history can actually evidence. Requirements with nothing behind them
are marked `none` rather than glossed over, which tells you what to build or
what to address in a cover letter.

## How your history is stored

It's a knowledge graph — entities joined through shared tag nodes — kept as
markdown. Two things it deliberately isn't:

- **Not a graph database.** Every query the app runs is a filter or a rank:
  which courses are chemistry, what evidences agent orchestration. Those are
  inverted-index lookups. Multi-hop traversal is the one thing a graph engine
  would buy you and it never comes up here.
- **Not plain JSON.** You need to be able to read and hand-edit everything the
  system believes about you. Markdown is the store; the parsed form is derived
  from it.

```
     Entity ──has──▶ Fact  (a claim; carries metrics)
       │   └──has──▶ Item  (a course, a skill — individually swappable)
       │
       └──tagged──▶ Domain ◀──tagged── Entity
                    Skill  ◀──────────
```

Domains and skills are the join nodes. A chemistry-focused posting walks
*jd-domain → tagged items → rank → place*, which is what makes swapping a
course or promoting a venture a lookup rather than a guess.

Section placement is deliberately not stored on an entity. The same venture is
Leadership on one resume and Experience on another, so where it goes is a
per-application decision rather than a fact about you.

`data/memory/master.md` is the source of truth and gets re-read on every run:

```markdown
### Northwind Lab
type: experience
org: Northwind Institute of Science
role: Machine Learning Researcher
dates: September 2025 – Present
domains: machine-learning, computational-biology
skills: Python, scikit-learn

- Reduced plate-reader analysis latency by 90% (metric: 90% latency reduction) | domains: infrastructure

items(coursework):
- Organic Chemistry | domains: chemistry, organic-chemistry
```

Delete a line you disagree with and the app obeys. Fact ids are content hashes,
so hand-editing mints a new id instead of corrupting references.

## The number guarantee

Every number in a generated bullet has to trace back to a cited fact in memory
or to the original bullet being rewritten. That's enforced in code rather than
by asking the model nicely:

1. The tailoring prompt gets memory facts as the only permitted number source,
   and has to cite fact ids per bullet.
2. `lib/ai/validate.ts` pulls every numeric token out of every bullet and checks
   it against those cited sources.
3. Failures get one corrective turn. Anything still failing is flagged red in
   the document instead of quietly accepted.

Character budgets work the same way, since language models can't count
characters.

## The reviewer loop

The number audit proves a bullet is true. It says nothing about whether the
bullet makes any sense to someone who has never met you, which is a judgment
call.

So once the resume is drafted, a reviewer grades each bullet on four things:
whether it clears a keyword screen, what it conveys in a six-second skim,
whether a domain expert would find it credible, and whether it survives an
interviewer pushing on it. The generator then rewrites what got flagged. Three
rounds at most, stopping early if the page is already good enough.

Reviewer and generator run on the same model, so they share blind spots. The
design works around that rather than solving it:

- The four lenses ask genuinely different questions instead of asking one
  question in four voices.
- The reviewer extracts rather than opines. It has to name the artifact, name
  the outcome, and write the question an interviewer would ask. Answers you can
  check are harder to fake than a rating.
- It argues for cutting each bullet instead of scoring it, since it's easier to
  spot a weakness while trying to make the case against something.
- Rewrites go through a blind pairwise comparison against the line they'd
  replace, in randomized order with neither side labelled, because a reviewer
  shown its own work tends to approve it. The comparison runs per bullet rather
  than per document; done per document, one weak rewrite drags down every good
  one in the same round.

A rewrite has to clear the number audit and win its comparison. Most don't.

The trace is in the UI — per-bullet scores, rewrites that were rejected and
why, and the reviewer's verdict. You can also mark bullets strong or weak
yourself, and those ratings feed back as calibration examples that anchor the
scale to your judgment instead of the model's.

### What it can't fix

When the reviewer asks for something no fact in memory supports — an eval
number you never measured, a repo you never published — the generator refuses
instead of inventing it, and the refusal shows up as missing evidence. That's
often more useful than the rewrites: it's a specific thing to go measure.

### What a run costs

One call to read the posting, one to draft the page (two if the number audit
rejects something), one craft pass over the prose, then per reviewer round: a
review, a revision, and one blind comparison per proposed rewrite.

The reviewer scores, revises, then scores again, so N rounds buys N−1 revision
passes. With ten bullets flagged, a single pass runs to about a dozen calls.
Comparisons inside a pass run concurrently, which is what keeps this bearable.

The **review** dropdown in Enhance mode is the knob. Times measured end to end
on an eleven-bullet resume:

| setting | what you get | wall clock |
| --- | --- | --- |
| off | draft + craft pass, no scoring | ~3 min |
| one revision pass | score, rewrite, re-score, missing-evidence report | ~6 min |
| thorough | up to two revision passes, early exit at 8/10 | ~10 min |

`GOOD_ENOUGH` and `MAX_ROUNDS` in `lib/ai/critic.ts` set the ceiling behind it.

### Checking the reviewer

```bash
npm run eval             # score every posting in eval/postings, before vs after
npm run eval -- --judge  # check the reviewer's scores against your own ratings
```

`--judge` is the one worth running. It hands your rated bullets to the reviewer
as a single anonymous batch with no calibration supplied, then reports
agreement and correlation. Without it there's no way to know whether the
reviewer's scores track anything real.

The four postings in `eval/postings/` aren't a random sample. One sits squarely
in the candidate's lane, one rewards moving an entry between sections, one
rewards surfacing different coursework, and one is a deliberate mismatch where
a low score is the correct output.

## Architecture

```
lib/sources/   text extraction for .docx / .pdf / .md / .txt
lib/memory/    master.md store · markdown parse/serialize · graph index + ranking
lib/resume/    ResumeDoc model · .docx parse · origin reconciliation · .docx export
lib/ai/        Claude client · prompts · schemas · pipeline · code-side audit
               critic.ts — the reviewer loop and its blind pairwise gate
eval/postings/ job postings the harness scores against (resumes stay local)
```

`.docx` gets parsed via HTML rather than raw text. `extractRawText` flattens
list items into plain paragraphs, so a real resume comes back with no bullet
markers at all. The HTML keeps `<li>`, along with the bold/italic structure
templates use to encode meaning — bold for a section or org, italic for role
and dates — and the tabs that push a second column out to the margin.

## Privacy

`data/` is gitignored in full: memory, resumes, postings, sessions, exports. So
are `.env*` and `*.docx` anywhere in the tree. Resume filenames coming from the
UI resolve against a server-side allowlist and never get joined onto a path.

In real mode your memory, the posting and the resume text go to the Anthropic
API. Demo mode sends nothing anywhere.

## Tests

```bash
npm test        # master.md round-trip, graph ranking, diff/origins, audit,
                # docx export, reviewer-loop revision bookkeeping
npm run build   # type-check + build
```

`npm test` needs no API key — it covers the deterministic half of the system.
`npm run eval` does, since it's exercising judgment.
