# Resume Enhancer

Personal, single-user tool that audits and rewrites resume bullet points —
optionally tailored to a job posting. Bullet-by-bullet analysis (quantified
outcome or another legitimate strength basis), an interview step that asks for
missing numbers instead of inventing them, and rewrites shaped as
**[action → what I built → measurable result]** within a per-resume char limit.

Full design: see [PLAN.md](./PLAN.md).

## How it works (the short version)

- **Facts vs bullets.** `data/profile.json` is a fact bank — raw truths about
  what I've done. Facts are the *only* permitted source of numbers in any
  rewrite. Bullets are char-limited renderings of facts.
- **Word owns the resumes.** I keep `.docx` files in `data/resumes/` and edit
  them in Word. The app reads them fresh every run and **never writes them** —
  output is plain text I paste back myself.
- **Local-first.** Everything lives in `data/` on this machine. No hosting, no
  accounts.

## Setup

```bash
npm install
cp .env.local.example .env.local   # add your Anthropic API key (Phase 3+)
npm run dev                        # http://localhost:3000
```

Then drop your resume `.docx` files into `data/resumes/` (the folder is
created on first run; the dropdown lists whatever is in it).

## Privacy / security

- **`data/` is gitignored** — the fact bank, resumes, job descriptions, and
  run history never leave this machine. So are `.env*` (API key) and `*.docx`
  anywhere in the tree. Committing this repo publicly is safe by default.
- Resume filenames from the UI are resolved server-side against an allowlist
  of `data/resumes/` contents — never joined onto paths.
- Resume text, job descriptions, and interview answers are sent to the
  Anthropic API when running the pipeline; nothing else leaves the machine.

## Status

- [x] Phase 1 — data model, storage seam, profile panel, resume dropdown
- [ ] Phase 2 — .docx parse (mammoth) + fact reconcile with confirm step
- [ ] Phase 3 — analyze / interview / rewrite pipeline
- [ ] Phase 4 — output panel + run-scoped chat
