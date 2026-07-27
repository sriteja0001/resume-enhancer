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
npm test        # master.md round-trip, graph ranking, diff/origins, audit, docx export
npm run build   # type-check + build
```
