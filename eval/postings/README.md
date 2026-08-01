# Eval postings

Job postings the eval harness scores your resume against. Each file is:

```json
{ "jobDescription": "...", "charLimit": 200 }
```

The resume is not part of the fixture. It comes from your own `data/resumes/`,
which is gitignored — postings are public and belong in the repo, resumes are
personal and never do.

The four shipped postings are not a random sample. Each one is chosen to break
a different part of the pipeline:

| posting | what it tests |
| --- | --- |
| `ai-engineer` | the ordinary case: a posting squarely in the candidate's lane |
| `chemistry-swe` | whether relevant coursework is surfaced and irrelevant coursework yields, without inventing chemistry the candidate never did |
| `early-stage-startup` | whether an entry moves between sections when the posting rewards it — a venture under Leadership belongs under Experience here |
| `quant-research` | the adversarial case: mostly out of the candidate's lane. A resume that scores well here is a resume that is lying, so a *low* score is the correct output |

`quant-research` is the one that matters most. Any critic can be talked into
approving a good match. The test of a critic is whether it says no.

Add your own by dropping a JSON file in this folder. Anything with a
`jobDescription` is picked up.
