# Resume Enhancer — Project Plan

**Author:** Sriteja
**Date:** 2026-07-24
**Status:** v4 — grounded in ATS research (see Changelog §14, research in Appendix A)

---

## 1. What this is

A personal, single-user web app that analyzes and rewrites my resume bullet points — optionally tailored to a specific job posting. It automates a workflow I'd otherwise do by hand with an LLM chat every time:

> "Like an ATS: which required keywords am I missing based on a given job description? Go bullet by bullet, checking if each has a quantified outcome. Rewrite weak ones as [action → what I built → measurable result]. Where I'm missing a number, ask me the question that surfaces it — don't invent one. No fluff."

It is **only for me**. No accounts, no multi-tenancy, no public access. That constraint drives several design choices (local-first storage, no auth, filesystem as database).

### Explicit non-goals

- **No .docx editing/export.** The app never writes to my resume files. Output is plain text bullets I paste into Word myself. (Reason: round-tripping .docx while preserving formatting is the hardest problem in this space and provides marginal value over copy-paste.)
- **No resume generation from scratch.** It improves existing bullets; it doesn't write a resume from nothing.
- **Not a product.** No polish beyond what makes it pleasant for me to use.

---

## 2. Core design principles

These four ideas carry most of the architecture:

1. **The profile is the database; the resume is a view.** The app maintains a "fact bank" — every raw truth about what I've done (projects, metrics, outcomes). Resumes are styled, char-limited renderings of a subset of those facts. Facts are global and append-only; bullets are per-resume.

2. **Facts are the only permitted source of numbers.** The "don't invent metrics" rule is enforced *structurally*, not just by prompt. The rewrite stage receives only the facts array as source material and must cite fact IDs for every quantitative claim. Code validates that no number appears in a rewrite that isn't backed by a fact. Prompts drift; pipeline design holds.

3. **Word owns the resumes; the app owns the facts; each run is a saved conversation.** I keep my .docx files in a folder and edit them in Word. The app reads them fresh on every run (so edits are always picked up), but never writes them. Analysis sessions ("runs") are persisted so I can reopen and keep iterating.

   The full edit loop, to be unambiguous — **the app performs NO file editing; the human is the only writer of resume files**:

   ```
   app reads .docx ──► outputs improved bullets as TEXT
                                   │
   I edit the .docx in Word MYSELF ◄┘  (accepting/adapting/ignoring suggestions)
                │
   saved file in data/resumes/ = the new source of truth
                │
   next run parses it fresh; reconcile (§6.2) re-links my edits to their facts
   ```

   Consequence: what I actually kept — not what the app proposed — is what gets analyzed next time. The app's suggestions are advisory until my own edit ratifies them.

4. **Local-first.** Everything lives in a `data/` folder on my machine. The app runs via `npm run dev` when I need it. Deploying to Vercel is deferred (see §9) because a filesystem-based design conflicts with serverless (read-only FS, no access to my local folders). If hosting ever matters (e.g., phone access), the storage layer is isolated behind two functions (`loadProfile()` / `saveProfile()`) so swapping to Vercel Blob is a contained change.

---

## 3. User workflow (the happy path)

1. I keep my resume variants as .docx files in `data/resumes/` (e.g., `swe-internship.docx`, `research.docx`). I edit them in Word whenever.
2. Open the app. Pick a resume from a dropdown (populated by listing that folder). Optionally paste a job description into a parallel text box. Hit **Run**.
3. The app parses the .docx fresh from disk, extracts bullets, and reconciles new facts into the fact bank (with my confirmation — see §6.2).
4. **Analysis** renders in two blocks: the bullet-by-bullet audit (does each bullet have a quantified outcome or another legitimate strength basis?), and — if a JD was provided — the ATS/recruiter-screen report: keyword coverage (semantic vs literal), job-title alignment, and stuffing flags, with citations of which bullet covers which keyword.
5. **Interview**: for weak bullets with no supporting fact, the app asks me the specific question that would surface the missing number ("How many users? What was the latency before/after?"). My answers are saved as new facts — permanently, so it never asks twice.
6. **Rewrite**: weak bullets are regenerated as `[action → what I built → measurable result]`, drawing only from facts, within the character limit.
7. **Output panel**: the full final bullet list as plain text, char count per line, copy buttons. I paste into Word.
8. **Chat iteration**: a chat box under the output. "Make bullet 3 punchier," "less corporate," etc. Each turn returns an updated structured bullet list (re-validated for char limit and fact-backing), and the run — including chat history — is persisted so I can resume it days later.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js app (App Router), localhost                    │
│                                                         │
│  UI (React)              API routes                     │
│  ┌───────────┐           ┌──────────────────────────┐   │
│  │ Profile   │◄─────────►│ /api/profile  (CRUD)     │   │
│  │ panel     │           │ /api/resumes  (list dir) │   │
│  │ Run panel │◄─────────►│ /api/run      (pipeline) │   │
│  │ Output +  │           │ /api/chat     (iterate)  │   │
│  │ chat panel│           └───────┬──────────────────┘   │
│  └───────────┘                   │                      │
│                     ┌────────────┼───────────┐          │
│                     ▼            ▼           ▼          │
│               data/ folder   mammoth     Anthropic API  │
│               (fs read/write)(.docx→text)(Claude)       │
└─────────────────────────────────────────────────────────┘
```

### Data flow per run

```
data/resumes/X.docx ──parse──► bullets ──reconcile──► profile.json (facts)
                                  │                        │
                                  ▼                        │
                              ANALYZE ◄── job description ─┘ (JD optional)
                                  │
                     weak, no fact ──► INTERVIEW ──► answers become facts
                                  │                        │
                                  ▼                        ▼
                              REWRITE (facts-only, char-capped)
                                  │
                                  ▼
                          OUTPUT + CHAT loop ──► data/runs/<run>.json
```

---

## 5. Data model

### 5.1 Folder layout

```
data/
  profile.json            # fact bank — app reads AND writes
  resumes/
    swe-internship.docx   # I manage these in Word — app only reads
    research.docx
  runs/
    2026-07-24-swe.json   # each analysis session + chat, persisted
```

### 5.2 `profile.json` (the fact bank)

```json
{
  "experiences": [
    {
      "id": "treehacks-project",
      "org": "TreeHacks",
      "role": "Builder",
      "dates": "2026-02",
      "facts": [
        {
          "id": "f1",
          "text": "Built RAG pipeline over 2,400 course docs",
          "source": "resume-upload 2026-07-24"
        },
        {
          "id": "f2",
          "text": "Reduced answer latency from 6s to 1.8s",
          "source": "interview 2026-07-24"
        }
      ]
    }
  ],
  "settings": {
    "defaultCharLimit": 118
  }
}
```

- **Facts** are raw truths: un-styled, no char limit, append-only, each tagged with where it came from. The UI's profile panel renders this file directly (grouped by experience, fully editable — I can also just type facts in manually).
- Facts are **global across all resume variants**: a metric surfaced while fixing the SWE resume immediately improves rewrites for the research resume.

### 5.3 Run file (`data/runs/*.json`)

```json
{
  "id": "2026-07-24-swe",
  "resumeFile": "swe-internship.docx",
  "jobDescription": "…or null",
  "charLimit": 118,
  "analysis": [ /* per-bullet results, schema in §6.3 */ ],
  "keywordGap": [ /* JD keywords with coverage citations, or null */ ],
  "bullets": [
    {
      "text": "Built a course-search RAG tool serving 300 students, cutting lookup time 70%",
      "factRefs": ["f1", "f2"],
      "chars": 76,
      "status": "rewritten",
      "candidates": [ /* the 2–3 alternatives offered, for revisiting later */ ]
    },
    {
      "text": "…",
      "status": "kept-original",
      "candidates": []
    }
  ],
  "chat": [
    { "role": "user", "content": "make bullet 2 punchier" },
    { "role": "assistant", "bulletsSnapshot": [ /* updated list */ ] }
  ]
}
```

A run = (resume file, JD or none, analysis, current bullet drafts, chat history). Reopening a run resumes the conversation with full context.

---

## 6. The pipeline, stage by stage

All LLM calls use the Anthropic API with **structured outputs (tool use)** so every stage returns validated JSON, never prose. Orchestration logic lives in code; the LLM only does the fuzzy parts.

### 6.1 Parse (.docx → structured bullets)

- `mammoth` converts .docx → raw text (headings + bullets survive; formatting doesn't matter since we never write back).
- An LLM call converts raw text → `{ sections: [{ heading, bullets: [text] }] }`. Using the LLM for parsing (instead of regex/heuristics) is deliberate: resume layouts vary wildly, and fuzzy parsing is what LLMs are good at. Deterministic logic stays in code.

### 6.2 Reconcile (parsed bullets → fact bank)

The dedup problem: my SWE and research resumes describe the same project differently ("built RAG over course docs" vs. "developed retrieval system for 2,400 documents"). A naive importer would create duplicate facts.

- The parse-merge LLM call receives the **existing fact bank** and tags each extracted fact as `new` or `matches: <factId>`.
- **A human confirmation step gates the merge**: the UI shows "here's what I extracted and how it maps," and I approve/correct before anything is written. A 10-second review beats a dedup heuristic that silently corrupts the fact bank.
- Bullets are also matched against the previous run for this resume file: unchanged bullets keep their existing factRefs and analysis; changed/new ones are flagged for re-analysis. (Upload-fresh-every-time doubles as a sync mechanism for edits I made in Word.)

### 6.3 Analyze (the exact spec)

One structured LLM call over all bullets. Per bullet:

```json
{
  "bulletId": "b3",
  "original": "Worked on improving the recommendation system",
  "hasQuantifiedOutcome": false,
  "strengthBasis": null,
  "verdict": "weak",
  "weaknesses": ["no metric", "vague verb 'worked on'", "no artifact named"],
  "supportingFactIds": [],
  "question": "What metric did the recommendation improvement move, and by how much?",
  "rewrite": null
}
```

`strengthBasis` is how a bullet earns "strong" — and **a quantified outcome is only one of several legitimate bases**:

| Basis | Example of a strong bullet without a metric |
|---|---|
| `quantified` | "…cutting lookup time 70%" |
| `scope` | "…across all 14 campus dining locations" |
| `complexity` | "…integrating three legacy auth systems with zero downtime migration" |
| `adoption` | "…adopted as the default tool by the lab" |
| `responsibility` | "…sole engineer owning the deployment pipeline" |
| `constraint` | "…on a microcontroller with 256KB RAM" |

Not every strong bullet has a legitimate metric, and a pipeline that treats "no number" as "weak" will continually pressure me to manufacture numbers — the exact failure the tool exists to prevent. So: a bullet strong on *any* basis passes; only bullets weak on **all** bases get flagged. And the interview question is asked only when a metric *plausibly exists but is unstated* — the analyzer must distinguish "you probably know this number" from "this bullet's strength isn't numeric."

Rules baked into the stage design:

- **Bullet-by-bullet, no skipping.** The schema forces one entry per input bullet.
- **"Keep original" is a first-class verdict.** Strong bullets are never rewritten merely because the pipeline reached the rewrite stage; they flow through to the output panel untouched (and so does any weak bullet whose candidates I reject — see §6.5).
- **Weak + no supporting fact → question, no rewrite.** The rewrite field stays null until the interview supplies the fact. The model is instructed to ask *the question that surfaces the number*, and structurally cannot invent one because rewrites only run against facts.
- **JD is optional.** When present, the same call also produces the ATS/recruiter-screen report below; when absent, that prompt section is simply omitted.

**What the "ATS screen" actually is (research summary — details and sources in Appendix A).** Almost no ATS auto-rejects on resume content: 92% of surveyed recruiters said theirs doesn't, and the only true auto-reject mechanism is knockout questions (work authorization, location, minimum experience) — eligibility answers outside this tool's scope. The real gates, in order:

1. **Search and rank.** At 400–2,000+ applicants per posting, recruiters search and filter by skills and titles, then work the resulting list top-down until the shortlist is full. Unmatched resumes aren't rejected — they're *buried*, which looks identical from the applicant's side.
2. **The 6–10 second human skim** once a resume surfaces. Recruiters' own stated priorities: skimmable structure (92%), relevant experience (88%), *natural* keyword use (76%), short bullets (72%), measurable achievements (52%) — note how directly this validates the bullet audit and char limit.
3. **Algorithmic scoring exists but is mostly advisory.** 44% of systems have AI match scores; most recruiters treat them as guidance only. Modern platforms (Workable, HiredScore) are increasingly *semantic*, so exact-string stuffing is both detectable and discounted. Platform behavior varies widely: Greenhouse uses human-graded scorecards (no algorithmic resume score), while Workday-class scoring weights **job-title match** heavily.

Tailoring is still very much worth it — tailored resumes convert to interviews at roughly **2× the rate** of generic ones (~6% vs ~3%, measured across 225k resumes). But the audience is a searching, skimming human assisted by semantic software — not a keyword-counting robot. Three checks fall out of this:

**Check 1 — Keyword coverage,** separating two failure modes:

- **Semantic coverage** — does some bullet substantively demonstrate the skill? ("Built REST APIs" satisfies "API development.") This is what wins the human skim and semantic rankers.
- **Literal presence** — does the exact term (or a standard variant) appear anywhere? Recruiter search/filter is still largely literal even where ranking is semantic: if the JD says "Kubernetes" and the resume says "container orchestration," a skills search can miss it. Semantic coverage without literal presence is a specific, fixable finding — solved by swapping in the JD's vocabulary via the JD-vocabulary-led rewrite candidate (§6.5).

**Check 2 — Job-title alignment.** Recruiters search by titles and Workday-class scoring weights title match heavily. The report compares the resume's headline and role titles against the JD's title and flags naming/seniority mismatches, suggesting *truthful* reframings (e.g., leading a research role's bullets with the software artifacts built, when applying to SWE roles) — never title inflation.

**Check 3 — Stuffing guard.** The inverse failure: a term literally present but backed by no substantive bullet (`literal: true` + `semantic: "missing"`) reads as keyword stuffing — recruiters explicitly penalize unnatural keyword use (76% want it natural) and semantic rankers discount it. Flagged terms need either real backing (is there a fact for it?) or removal.

Every claimed coverage must cite the satisfying bullet, so I can verify the model isn't hallucinating coverage.

Schemas (JD runs only):

```json
{
  "keywordGap": [{
    "keyword": "CI/CD",
    "required": true,
    "semantic": "covered" | "weak" | "missing",
    "literal": true,
    "coveredBy": ["b5"],
    "suggestion": "Your deploy-pipeline fact (f9) could support a bullet here; use the literal term 'CI/CD'"
  }],
  "titleAlignment": {
    "jdTitle": "Software Engineering Intern",
    "resumeTitles": ["CS Course Assistant", "Research Assistant"],
    "verdict": "aligned" | "partial" | "mismatched",
    "suggestion": "Lead the research role's bullets with the software artifacts you built"
  }
}
```

The report renders sorted by burial risk: required terms semantically missing first, then covered-but-not-literal (easy vocabulary fixes), then stuffing flags, then covered.

### 6.4 Interview

- Pure UI + data step, no clever AI: weak-bullet questions render as a form; each answer is appended to `profile.json` as a fact with `source: "interview <date>"`.
- **"There is no meaningful number" is a valid answer.** It's recorded as a fact too (e.g., `"No usage metric exists for this project — strength is technical complexity"`), so the system never asks again and the rewrite stage pivots to a non-quantified basis (§6.3) instead of nagging.
- Because facts persist, **the app stops asking questions it has answers to** — the interview shrinks over time. This is the compounding value of the fact bank.

### 6.5 Rewrite

- Runs only after the interview (or immediately for weak bullets that already have supporting facts). Bullets verdicted strong skip this stage entirely.
- Prompt receives: the bullet, its supporting facts (the **only** permitted source of metrics), the char limit, JD vocabulary if present, and the target shape: **[action → what I built → measurable result]**. Style constraints: strong verb first, concrete artifact, no fluff, no filler adjectives.
- **The formula is the default shape, not a mandate.** When the bullet's strength basis is non-quantified (§6.3), the "measurable result" slot becomes the strength evidence — scope, adoption, constraint — rather than a number. Forcing every bullet into a metric-shaped ending pressures the model (and me) to manufacture numbers.
- **Two to three candidates, not one.** The rewrite returns `candidates: [{text, chars, factRefs}]` with different emphasis (e.g., metric-led vs. artifact-led vs. JD-vocabulary-led). The UI shows them side by side with a **Keep original** option always present — silently picking one hides exactly the judgment call I'm best positioned to make.
- If information is genuinely missing, the model must emit a `[?]` placeholder rather than a plausible number.
- **Char limit enforced in code, not trusted to the model.** LLMs are bad at counting. If `text.length > charLimit`, the code sends it back: "shorten to ≤N chars, drop the least important detail" — loop until it fits. Char limit is a per-resume setting (different templates → different line widths); default lives in `profile.json` settings.
- **Number audit in code**: extract numerals from each rewrite; every number must appear in a cited fact. Violations are rejected and regenerated.

### 6.6 Chat iteration

- Chat is **scoped to a run**, not global. Each turn sends: current bullet state + chat history + my message. Returns an updated structured bullet list (not prose) — the output panel re-renders from it.
- Every chat revision passes the same code-side gates: char limit and fact-backed numbers. This matters because "make the impact sound bigger," three messages deep, is exactly how invented metrics sneak back in.
- Chat history persists in the run file → "iterate over time" works literally across sessions.

> **Removed in v4: ATS parse-health check.** v3 included a parse-simulation stage (contact-info extraction, layout-hazard scan, etc.). Cut for two reasons: my resumes are already clean single-column layouts, and the research shows parse mangling is mostly a legacy-platform issue (older Workday/Taleo/iCIMS OCR pipelines) where recruiters can open the original file anyway. One habit survives it: keep contact info out of the .docx header/footer — the one placement that still commonly breaks on Workday.

---

## 7. UI spec

Single page, three panels:

```
┌────────────┬──────────────────────┬────────────────────┐
│  PROFILE   │  RUN                 │  OUTPUT            │
│            │                      │                    │
│ fact bank  │ [resume dropdown ▾]  │ final bullets,     │
│ from       │ [JD paste box]       │ plain text,        │
│ profile.   │ [Run]                │ char count/line,   │
│ json —     │                      │ copy buttons       │
│ grouped by │ scorecard:           │                    │
│ experience,│  ✓ b1 strong         │ ────────────────   │
│ editable,  │  ✗ b3 weak → Q&A     │ chat box           │
│ shows      │  ✗ b4 weak → Q&A     │ (iterate on the    │
│ EVERYTHING │ screen report (if JD)│  results)          │
│ the system │  keywords · title ·  │                    │
│ knows      │  stuffing flags      │ [past runs list]   │
│            │ interview form       │                    │
└────────────┴──────────────────────┴────────────────────┘
```

- **Profile panel = full transparency.** It displays the contents of the data file directly — every single piece of information the system has about me, so there is never hidden state. Editable in place (add/edit/delete facts and experiences).
- **Rewrite picker.** Each rewritten bullet shows its 2–3 candidates side by side plus a **Keep original** button; my pick becomes the bullet's text in the output panel. Unpicked candidates persist in the run file so I can change my mind mid-chat.
- Resume dropdown is populated by listing `data/resumes/` — the folder *is* the variant list; filenames are the variant names. No upload flow, no "which resume is this?" question.
- Reconcile confirmation (§6.2) appears as a modal/step between Run and results when new facts are detected.
- Plain styling (Tailwind). No component library needed at this scale.

---

## 8. Tech stack (and why)

| Choice | Rationale | Alternative considered |
|---|---|---|
| **Next.js (App Router)** | One codebase for UI + API routes; the dominant modern stack, best learning ROI | Python + Streamlit: faster prototype, but clunky for multi-step interview/chat flows, less transferable frontend learning |
| **Anthropic API, structured outputs via tool use** | JSON-schema-validated stage outputs; retries on mismatch happen at the tool-call layer | Raw prompting + JSON.parse: brittle |
| **mammoth (npm)** | .docx → text, read-only, battle-tested | python-docx (wrong language here); docx XML parsing (unneeded — we never write) |
| **Filesystem (`data/` folder) as storage** | Single user; zero infra; *optionally* versionable in a private repo — but gitignored by default, see §10 | SQLite: overkill for one document; Postgres: way overkill |
| **Tailwind** | Fast, no design system needed | Component libraries: unnecessary at this scale |
| **No auth** | Localhost only | Env-var password — only if/when deployed |

---

## 9. Deployment decision: local-first, Vercel deferred

The `data/`-folder design (Word-managed .docx files, writable `profile.json`) is fundamentally local-first, and **that's the right call for an only-me tool**:

- Vercel serverless functions have a **read-only filesystem** — the app couldn't write `profile.json` or see my local resume folder.
- Every resume edit would require commit + redeploy.
- `npm run dev` is one command; there are no other users to serve.

**If hosting ever matters** (phone access is the realistic trigger): move `data/` into **Vercel Blob** (store `profile.json` and run files as blobs; resumes uploaded rather than folder-read), add a single env-var password. The `loadProfile()`/`saveProfile()` seam (§2.4) is designed now precisely so that swap stays a ~20-line change. *Isolate the thing you know will change.*

---

## 10. Security, privacy & git policy

This app holds significant personal data (full work history, resumes, job targets, run/chat histories). Single-user and localhost don't excuse sloppiness here — especially since the code itself may end up in a public repo or shared for feedback.

### 10.1 Path handling (server-side)

- The resume dropdown value is a **key, not a path**. On every API call, the server re-lists `data/resumes/`, builds an allowlist of basenames, and resolves the request against it. A value not in the allowlist → 400. Never `path.join(dataDir, userInput)` on raw input — even solo apps get pasted URLs and replayed requests, and API routes are reachable by anything on the machine.
- Same rule for run IDs when loading `data/runs/<id>.json`: resolve against a listing, reject anything containing separators or `..`.

### 10.2 Git policy: versionable ≠ committed

- **`data/` is gitignored by default.** The app repo contains code only. `.gitignore` ships with: `data/`, `.env*`, `*.docx`.
- The app repo can then be public/shareable without thought. If I want version history for the fact bank (genuinely useful — an append-only record of accomplishments), `data/` becomes its **own separate private repo**, an explicit opt-in, never a default.
- **API key:** `ANTHROPIC_API_KEY` lives in `.env.local` (gitignored by Next.js convention), read only server-side in API routes — never exposed to client code, never committed.

### 10.3 Retention & backups

- **Runs:** kept indefinitely by default (they're small and useful history), pruned manually. A "delete run" button in the UI is in scope for Phase 4; nothing is auto-deleted.
- **Backups:** the `data/` folder rides on normal machine backup (Time Machine). If `data/` becomes a private repo, pushing it doubles as offsite backup. No cloud sync of `data/` otherwise — job-search data doesn't belong in a random sync service by accident.
- **Third-party exposure:** resume text, JDs, and interview answers are sent to the Anthropic API on every run — that's inherent to the tool. Nothing else leaves the machine.

---

## 11. Build order

| Phase | Scope | Done when… |
|---|---|---|
| **1. Data + profile panel** | Schema, `data/` layout, profile CRUD UI, storage seam. **No AI yet** — get the CRUD right first. | I can view/edit my full fact bank in the browser |
| **2. Parse + reconcile** | Resume dropdown (folder listing), mammoth, LLM parse, fact mapping with confirm step | Running a resume populates the fact bank correctly, dupes caught |
| **3. Analyze + interview + rewrite** | The full pipeline (§6.3–6.5), scorecard UI, interview form, char/number validation loops | Weak bullets get questions; answered bullets get valid rewrites |
| **4. Output + chat** | Output panel, copy buttons, run persistence, chat iteration | I can refine results conversationally and resume a run later |
| **5. (Deferred) Deploy** | Vercel Blob swap, password | Only if phone access becomes a real need |

Phase 1+2 is roughly a weekend; phase 3 is the meaty one.

---

## 12. Risks & open questions (feedback wanted here)

1. **Fact granularity.** How atomic should a fact be? "Built RAG pipeline over 2,400 docs, cutting latency 6s→1.8s" as one fact or two? Leaning **two** (one artifact fact, one metric fact) so rewrites can mix and match — but this makes the reconcile step chattier.
2. **Bullet matching across Word edits.** If I heavily rewrite a bullet in Word, fuzzy-matching it to its previous version (to preserve factRefs) may fail and it'll be treated as new. Acceptable? (Cost: re-answering nothing — facts persist — just re-running analysis on that bullet.)
3. **Char limit fidelity.** A char count is a proxy for "fits on one line," which really depends on font/glyph widths. Is a per-resume char setting good enough, or do I eventually want a live preview? (Proposal: char count is fine; I see the real layout when I paste into Word anyway.)
4. **Interview question quality.** The whole "surface the number, don't invent it" experience lives or dies on question specificity. May need a few prompt iterations with real bullets.
5. **Keyword-gap hallucination.** Even with citation requirements, semantic coverage judgments can be generous. Mitigation: the report shows the citing bullet inline so I can eyeball every claim.
6. **Model cost/latency.** Each run is ~3–5 LLM calls plus chat turns. Trivial cost at personal scale; latency (a few seconds per stage) is fine for this use case. Streaming the analysis stage into the UI would be a nice polish item, not a requirement.
7. **Is the reconcile confirm step too much friction?** It's one modal per run, only when new facts appear. I think it's worth it (protects the fact bank), but worth revisiting after a week of real use.

---

## 13. What I'd cut if scope pressure hits

In order: (1) run history UI (keep persistence, cut the browsing UI); (2) reconcile fuzzy-matching — treat every run's bullets as fresh and rely on fact persistence alone; (3) multi-candidate rewrites — fall back to one candidate + keep-original (keep-original itself is not cuttable; it's a correctness feature, not polish).

**Not cuttable: the recruiter-screen report** (keyword coverage + title alignment + stuffing guard). Search-and-rank burial is the first gate every resume hits — a beautifully rewritten bullet that never surfaces in a recruiter's search is worth nothing, and tailoring measurably doubles interview conversion (Appendix A). *(v2 of this plan listed the keyword report as the first cut; v3 reversed that; v4 grounds the reversal in research.)*

The irreducible core: **profile panel + recruiter-screen report + analyze + interview + rewrite + output with chat.**

---

## 14. Changelog

**v4 — 2026-07-24, ATS research pass.** Researched how ATS platforms actually work (findings + sources in Appendix A) and revised accordingly:

1. **Reframed the ATS layer around the real mechanisms** (§6.3): auto-rejection on resume content is largely a myth (92% of surveyed recruiters say their ATS doesn't do it; knockout questions are the only true auto-reject). The real gates are recruiter search-and-rank burial and the 6–10 second human skim — so the report optimizes for surfacing in searches and winning the skim, not "beating the robot."
2. **Added job-title alignment check** (§6.3): Workday-class scoring weights title match heavily and recruiters search by titles.
3. **Added stuffing guard** (§6.3): literal-but-unbacked terms flagged — recruiters penalize unnatural keyword use and semantic rankers discount it.
4. **Removed the parse-health check** (was §6.7): my resumes are clean single-column layouts, and parse mangling is mostly a legacy-platform issue where recruiters can open the original file anyway. Kept one guideline: no contact info in the .docx header/footer.
5. Research incidentally validates the core design: recruiters' stated priorities (short bullets 72%, measurable achievements 52%, skimmable structure 92%) map directly onto the char limit, the quantified-outcome audit, and the no-fluff rule.

**v3 — 2026-07-24, ATS emphasis pass.** The ATS screen is the first gate any resume hits; v2 under-weighted it:

1. **Keyword gap upgraded to first-class** (§6.3): now distinguishes *semantic coverage* (a bullet demonstrates the skill) from *literal presence* (the exact term appears — what recruiter searches and ATS filters actually match on). Report sorts by screen risk: required + literally-absent terms first.
2. **New ATS parse-health check** (§6.7): every run — JD or not — simulates an ATS parse via the mammoth extraction and code-side heuristics: contact info extracted, section headings recognized, dates parse, layout hazards (tables, text boxes, columns, headers), bullet-count integrity. Renders as a panel above all other results, since keyword findings are meaningless for sections that didn't parse.
3. **Cut list reversed** (§13): v2 listed the keyword-gap report as the first scope cut; the ATS layer is now explicitly non-cuttable.

**v2 — 2026-07-24, after first feedback round.** Incorporated external feedback:

1. **Strength bases beyond metrics** (§6.3): bullets can be strong via scope, complexity, adoption, responsibility, or technical constraint — not only quantified outcomes. Interview questions fire only when a metric plausibly exists; "no meaningful number" is a recordable answer (§6.4). Prevents the pipeline from pressuring me to manufacture numbers.
2. **"Keep original" as a first-class outcome** (§6.3, §6.5): strong bullets bypass rewriting entirely; every rewrite offers a keep-original choice.
3. **2–3 rewrite candidates instead of one** (§6.5, §7): silent selection replaced with a side-by-side picker; unpicked candidates persist in the run file.
4. **Server-side filename allowlisting** (§10.1): dropdown values resolved against a `data/resumes/` listing; path traversal via API routes blocked.
5. **Privacy & git policy made explicit** (§10.2–10.3): `data/` gitignored by default, "versionable ≠ committed," API key handling, retention, and backup expectations specified.

**v1 — 2026-07-24.** Initial plan.

---

## Appendix A — Research: how ATS actually works (July 2026)

### Findings

1. **Auto-rejection on resume content is mostly myth.** In a 25-recruiter survey, 92% said their ATS does not auto-reject based on resume content or formatting; only 8% use content-based auto-reject thresholds. The one universal true auto-reject is the **knockout question** — hard eligibility checks (work authorization, location, licenses, minimum experience) answered in the application form, not read from the resume.
2. **The real mechanism is ranking and burial, not rejection.** Typical volumes: 400–600 applicants for entry-level roles, 2,000+ for remote tech roles. Recruiters search and filter by skills/titles, then work the list top-down until the shortlist fills. A resume that doesn't surface isn't rejected — it's never opened. (Corollary from the survey: 52% of recruiters review roughly chronologically and stop once the shortlist is strong, so **applying early materially helps** — outside this tool's scope but worth knowing.)
3. **Humans skim for 6–10 seconds** once a resume surfaces. Recruiters' stated priorities: skimmable structure (92%), relevant experience/skills (88%), natural keyword use (76%), short bullets (72%), simple formatting (68%), 1–2 pages (64%), measurable achievements (52%). They explicitly penalize keyword stuffing and over-designed/generic-template resumes.
4. **Algorithmic scoring exists but is mostly advisory.** 44% of systems surveyed have AI match scores; 36% treat them as guidance with manual verification, 8% as hard thresholds. Platform behavior varies a lot: **Greenhouse** routes to human-graded scorecards (no algorithmic resume score); **Workday/HiredScore** letter-grades with heavy weight on job-title match; **Workable** ranks semantically (understands "program management" ≈ "project management"); **Ashby** refuses to auto-rank.
5. **Keyword search is literal-ish; ranking is increasingly semantic.** Boolean/keyword filters are used heavily for *sourcing* within candidate databases, less on each incoming application. Semantic rankers reduce exact-string dependence — which cuts both ways: synonyms get partial credit, and stuffing gets discounted.
6. **Tailoring measurably works:** ~2× interview conversion for tailored vs. generic resumes (~6% vs ~3%, across 225k resumes in one dataset).
7. **Parsing quality is a legacy-platform issue.** Older Workday/Taleo/iCIMS pipelines converting resumes to HTML previews historically mangled two-column layouts, tables, and header/footer content; modern platforms (Greenhouse, Ashby, Lever) parse cleanly, and recruiters can always open the originally uploaded file. Standing guideline: clean single-column .docx/PDF, contact info in the body, not the header.

### Design implications adopted

| Finding | Plan response |
|---|---|
| Burial-by-search, title-weighted scoring | Keyword literal-presence check + title-alignment check (§6.3) |
| Semantic rankers + stuffing penalties | Semantic/literal split + stuffing guard (§6.3) |
| 6–10s skim priorities | Already the core design: char limit, quantified/strength audit, no fluff |
| Knockout questions | Out of scope — they live in application forms, not the resume |
| Parse mangling mostly legacy + originals viewable | Parse-health check removed (v4); header/footer guideline kept |

### Sources

- [Does the ATS Reject Your Resume? 25 Recruiters Explain What Really Happens — Enhancv](https://enhancv.com/blog/does-ats-reject-resumes/) (survey percentages, skim priorities, volume data)
- [How Applicant Tracking Systems Actually Work in 2026 — Huntr](https://huntr.co/blog/how-applicant-tracking-systems-work) (platform-by-platform parsing/scoring mechanics, sourcing vs screening, tailoring conversion data)
- [Do Applicant Tracking Systems Really Auto-Reject Resumes — Metaintro](https://www.metaintro.com/blog/do-ats-auto-reject-resumes) (ranking-and-burial framing)
- [Greenhouse ATS Score Factors (2026) — resumeats.net](https://resumeats.net/blog/greenhouse-ats-deep-dive) (Greenhouse scorecard model, knockout questions)
- [How Workday, Taleo & Greenhouse Read Your Resume — shashiworks](https://www.shashiworks.com/ats-workday-greenhouse-taleo.html) (title weighting, legacy parsing behavior)

*Caveat: this is practitioner/blog-grade evidence, not peer-reviewed research — vendors don't publish their ranking internals. The consistent picture across independent sources (search + skim + burial, not robot rejection) is what the design leans on, not any single statistic.*
