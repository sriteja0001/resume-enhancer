# Resume Enhancer

**A knowledge base of everything you've done, spent one job posting at a time.**

Most resume tools edit the resume in front of them. That's the wrong object.
Your resume is a *lossy projection* of your history — a chemistry course you
took but didn't list, a venture filed under "Leadership" that a startup would
want to see first. If the tool can only see the page, it can only reword the
page.

This one keeps a persistent record of everything about you, then rebuilds the
page against a specific posting: deciding **what belongs on it**, **in which
section**, **in what order**, and **how it's described** — and it structurally
cannot write a number you never gave it.

Then it argues with itself. A reviewer scores every bullet, the generator
revises, and each rewrite has to win a **blind comparison** against the line it
replaced before it's allowed onto the page. You see the entire trace, including
the rewrites that lost.

---

## The two modes

**Intake** — the only job is getting information *in*, and the unit of intake
is a **file**. Drop in a research summary, a list of everything you did in
high school, project write-ups, transcripts, old resumes — `.docx`, `.pdf`,
`.md`, `.txt`. Each one is read into structured entities in
`data/memory/master.md`.

The file library tracks every document's state: *not absorbed*, *in memory ·
14 facts*, or *changed — re-absorb* when you edit it. Absorbing is additive and
safe to repeat; identical facts are deduplicated by content hash, so
re-absorbing an edited file adds only what's new. Typing text directly is still
there, just secondary — for the number you only just remembered.

**Enhance** — pick a base resume, paste a posting, get a rendered tailored
resume with a chat beside it. Save writes a **new** `.docx`; your original is
opened read-only and never modified.

## The rendering

The tailored resume is shown as a document, not a diff view:

| Colour | Meaning |
|---|---|
| **black** | survived from your original file, untouched |
| yellow | rewritten (hover for word-level changes and the reason) |
| green | added from memory — wasn't on your resume before |
| blue | moved between sections, or re-ordered |
| red strike | dropped, with why |

Every non-black element carries a one-line rationale. Not *"improved
clarity"* — `"chemistry-focused role — surfaced Organic Chemistry over
Programming Abstractions"`.

## What it actually decides

Given *"Software Engineer, computational chemistry, seed-stage startup"*:

1. **Placement** — your venture moves out of Leadership into Experience,
   because a screener reading top-down must hit it before deciding.
2. **Selection** — of nine courses, the four this employer cares about make the
   line. Chemistry coursework surfaces *if you actually took it*.
3. **Ordering** — sections, entries, bullets, and inline values, most relevant
   first. A screener reads for 6–10 seconds; burying the best entry third is
   the same as omitting it.
4. **Wording** — the same true work, re-angled toward what this posting
   screens for.

Alongside it: a **requirement coverage matrix** (what the posting asks for vs.
what your history can evidence) that includes an honest gap list. Requirements
with no evidence are marked `none` rather than papered over — a truthful gap
tells you what to build or address in a cover letter.

---

## How your history is represented

You asked the right question: knowledge graph, or something simpler?

**It is a knowledge graph — entities joined by shared tag nodes — stored as
markdown.** Reasoning:

- *Not a graph database.* Every query the app runs is a filter or a rank
  ("which courses are chemistry", "what evidences agent orchestration"). Those
  are inverted-index lookups. Multi-hop traversal, the only thing a graph
  engine buys, never comes up.
- *Not plain JSON.* You have to be able to read and hand-edit everything the
  system believes about you. Markdown is the store; the parse is derived.

```
     Entity ──has──▶ Fact  (a claim; carries metrics)
       │   └──has──▶ Item  (a course, a skill — individually swappable)
       │
       └──tagged──▶ Domain ◀──tagged── Entity
                    Skill  ◀──────────
```

Domains and skills are the join nodes. `"chemistry-focused role"` walks
*jd-domain → tagged items → rank → place*. That traversal is what makes
swapping a course or promoting a venture a lookup rather than a guess.

**Section placement is deliberately not stored on an entity.** The same
venture is Leadership on one resume and Experience on another — where it goes
is a per-application decision, not a fact about you.

`data/memory/master.md` is the source of truth, re-read on every run:

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

Delete a line you disagree with and the app obeys. Fact ids are content
hashes, so hand-editing mints a new id instead of corrupting references.

---

## The number guarantee

Every number in a generated bullet must trace to a cited fact in memory or to
the original bullet being rewritten. This is enforced **in code**, not by
asking the model nicely:

1. The tailoring prompt receives memory facts as the only permitted number
   source and must cite fact ids per bullet.
2. `lib/ai/validate.ts` extracts every numeric token from every bullet and
   checks it against those cited sources.
3. Failures trigger one corrective turn; anything still failing is flagged red
   in the document rather than silently accepted.

Character budgets are enforced the same way, because language models cannot
count characters.

---

## The reviewer loop

The number audit proves a bullet is *true*. It cannot tell you whether the
bullet is comprehensible or impressive to someone who has never met you. So
after the resume is drafted, a reviewer scores every bullet through four
separate lenses — keyword screen, six-second skim, domain expert, and whether
it survives an interviewer pulling on it — then the generator revises what was
flagged. Three rounds at most, stopping early once the page is good enough.

The obvious objection is that the reviewer and the generator share a model, so
they share blind spots. Four things blunt that, none of which remove it:

- **Four genuinely different lenses**, not one opinion in four voices.
- **Extraction over taste.** The reviewer has to name the artifact, name the
  outcome, and write the question an interviewer would ask. Questions with
  checkable answers are the ones a model is least able to fool itself on.
- **Falsification.** It argues for *cutting* each bullet rather than rating it.
- **A blind pairwise gate.** Every rewrite is compared against the line it
  replaced, in randomised order, with neither side labelled — a reviewer shown
  its own output tends to approve it. This runs per bullet, not per document,
  so a single weak rewrite cannot throw away the good ones beside it.

A rewrite lands only if it survives the number audit *and* wins its comparison.
In practice most do not, which is the point.

Because the residual blind spot is real, **the whole trace is shown to you** —
per-bullet scores, the rewrites that were rejected and why, and the reviewer's
verdict. You can also rate any bullet strong or weak in the preview; those
ratings are fed back as calibration examples and anchor the scale to your taste
rather than the model's.

### What it cannot fix

When the reviewer asks for something no fact in memory supports — an eval
number you never measured, a repo you never published — the generator refuses
rather than inventing it, and the refusal is reported to you as *missing
evidence*. This is usually the most useful thing a run produces: not a better
sentence, but a specific thing to go get.

### What a run costs

The loop is not cheap, and pretending otherwise would be dishonest. One
tailored resume is:

| | calls |
| --- | --- |
| read the posting | 1 |
| draft the page | 1, plus 1 correction if the number audit rejects anything |
| craft pass over the prose | 1 |
| each reviewer round | 1 review + 1 revision + **one blind comparison per proposed rewrite** |

With ten bullets flagged in a round, that round alone is a dozen calls, and
there can be three rounds. Expect tens of calls and **minutes, not seconds**.
The comparisons within a round run concurrently, which is what keeps that
tolerable.

If you want it cheaper, `GOOD_ENOUGH` and `MAX_ROUNDS` in `lib/ai/critic.ts`
are the two knobs. Lowering `MAX_ROUNDS` to 1 costs you most of the loop and
saves most of the money.

### Checking the reviewer

```bash
npm run eval           # score every posting in eval/postings, before vs after
npm run eval -- --judge  # check the reviewer's scores against your own ratings
```

`--judge` is the one that matters. It shows your rated bullets to the reviewer
as one anonymous batch, with no calibration supplied, and reports agreement and
correlation. If the reviewer does not track your taste, the loop is theatre —
and this is the only way you would find out.

The shipped postings are not a random sample. One is squarely in the
candidate's lane, one rewards moving an entry between sections, one rewards
surfacing different coursework, and one is **deliberately a bad match**. On that
last one a low score is the correct output. Any reviewer can be talked into
approving a good match; the test of a reviewer is whether it says no.

---

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000
```

Open **Intake**, drag your documents onto the drop zone (they land in
`data/sources/`), and click absorb. Put a base resume in `data/resumes/` —
that's the layout you tailor *from*. Then switch to **Enhance**.

For real analysis:

```bash
cp .env.local.example .env.local   # add your Anthropic API key
# then RESTART the dev server — .env.local is read at startup
```

**Without a key the app runs in demo mode**, announced by an unmissable banner:
extraction and tailoring fall back to hand-written keyword rules, not a model.
Parsing, the memory graph, ranking, diffing, the number audit, and `.docx`
export are all real in both modes — only judgment is faked. Model defaults to
`claude-opus-5`; override with `ANTHROPIC_MODEL`.

## Architecture

```
lib/sources/   text extraction for .docx / .pdf / .md / .txt
lib/memory/    master.md store · markdown parse/serialize · graph index + ranking
lib/resume/    ResumeDoc model · .docx parse · origin reconciliation · .docx export
lib/ai/        Claude client · prompts · schemas · pipeline · code-side audit
               critic.ts — the reviewer loop and its blind pairwise gate
eval/postings/ job postings the harness scores against (resumes stay local)
```

Word `.docx` is parsed via HTML rather than raw text, because `extractRawText`
flattens list items into plain paragraphs — a real resume arrives with no
bullet markers at all. The HTML keeps `<li>`, plus the bold/italic structure
templates encode meaning in (bold = section or org, italic = role and dates)
and the tabs that push a second column to the margin.

## Privacy

`data/` is gitignored in full — memory, resumes, postings, sessions, exports.
So are `.env*` and `*.docx` anywhere in the tree. Resume filenames from the UI
resolve against a server-side allowlist and are never joined onto a path. In
real mode your memory, the posting, and resume text go to the Anthropic API;
demo mode sends nothing.

## Tests

```bash
npm test        # master.md round-trip, graph ranking, diff/origins, audit, docx export,
                # and the reviewer loop's revision bookkeeping
npm run build   # type-check + build
```

`npm test` needs no API key — it covers the deterministic half of the system.
`npm run eval` does, because it exercises judgment.
