# TokenScope

TokenScope is a SuperDocs extension that answers one question with numbers instead of
adjectives: **why regenerate the whole document when you only changed one paragraph?**
Select a paragraph in Word, type a rewrite instruction, and TokenScope performs the edit
through the SuperDocs API, shows you the proposed rewrite before anything is applied, and
puts what that surgical edit actually cost side by side with what regenerating the whole
document would have cost. Both sides of that comparison are measured against the live API,
not asserted, and every number on screen carries a badge saying whether it was measured,
tokenized, or derived.

Built against the SuperDocs Open Task List card **"Word selection rewrite with a live token
counter"** (Band S1, surfaces: chat + API).

---

## Problem

An AI document editor that regenerates the whole document on every turn pays for the whole
document on every turn. The cost of a one-paragraph change scales with the size of the file
it lives in, which is exactly backwards: the edit did not get bigger, the document did.

Surgical editing breaks that coupling. The claim is easy to make and easy to hand-wave, so
TokenScope makes it falsifiable: it runs both operations against the real API, on the same
document, on the same day, and reports what each one actually did.

The measured answer, from [`bench/RESULTS.md`](bench/RESULTS.md) — the same edit, the same
instruction, five document sizes, all against the live API:

| Document  | Sections changed | Text written, surgical | Text written, regenerated |     Saved |
| --------- | ---------------: | ---------------------: | ------------------------: | --------: |
| 3 pages   |          1 vs 20 |              26 tokens |              1,124 tokens |    97.69% |
| 10 pages  |          1 vs 61 |              18 tokens |              4,589 tokens |    99.61% |
| 50 pages  |         1 vs 300 |              37 tokens |             19,822 tokens |    99.81% |
| 100 pages |         1 vs 599 |              32 tokens |             43,344 tokens |    99.93% |
| 300 pages |           1 vs — |              30 tokens |            never finished | see below |

The surgical column does not move. That is the whole argument: the edit did not get bigger,
so its cost should not either.

At 300 pages the comparison stops being a comparison. The surgical edit still completed, in
five and a half minutes. The whole-document regeneration was tried three times and finished
none of them — SuperDocs' own watchdog eventually failed the job as wedged. That is the
strongest version of the point and also the least quotable one, so it is written up in full
under [Assumptions and limitations](#assumptions-and-limitations) rather than turned into a
percentage.

---

## Demo

```
npm install
cp .env.example .env.local     # add SUPERDOCS_API_KEY
npm run dev                    # http://127.0.0.1:5173
```

Then:

1. **Select** a paragraph in the document. TokenScope shows what it detected.
2. **Type an instruction** — "Make this more concise."
3. **Rewrite.** The request goes to SuperDocs as a surgical edit scoped to your selection.
4. **Read the result.** The rewrite is shown next to the original and marked _not applied
   yet_, because it is not: the job is paused awaiting your approval.
5. **Read the cost.** Two comparisons, each labelled with where its numbers came from.
6. **Apply** if you want it. That is the only action that changes your document.

Without Word, the right-hand column is a live document surface using the browser's own
Selection API, loaded with the same corpus the benchmark measures. Switch it between 3, 10
and 50 pages and run the same rewrite to watch the gap open up by hand.

Inside Word, that column is Word. See [Running inside Word](#running-inside-word).

---

## Architecture

```
document selection            Word (Office.js) or the demo surface, behind one
       │                      DocumentHost interface
       ▼
rewrite instruction           delimited, not described: the selection is passed
       │                      as an exact string the model has to match
       ▼
SuperDocs API                 POST /v1/chat/async, approval_mode=ask_every_time
       │                      GET  /v1/jobs/{id}  (compact while running)
       ▼
surgical result               the proposed change, still unapplied
       │
       ▼
token measurement             metadata.cumulative_tokens, plus the text the job
       │                      actually returned, tokenized
       ▼
whole-document comparison     the same instruction as a full regeneration, run
       │                      for real in a throwaway session
       ▼
UI                            two comparisons, every figure badged with its
                              provenance
```

| Path           | What lives there                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/`         | The task pane. React, one flow, no token math.                                                                                      |
| `src/host/`    | `word.ts` (Office.js) and `demo.ts` (DOM Selection API) behind `types.ts`.                                                          |
| `server/`      | The only process that holds the API key. `superdocs.ts` is the only module that makes network calls.                                |
| `shared/`      | Selection resolution, scope checking, token arithmetic, the benchmark corpus. Used by the pane, the server and the benchmark alike. |
| `bench/`       | The reproducible benchmark and its generated results.                                                                               |
| `manifest.xml` | The Word add-in manifest.                                                                                                           |

**Why a server at all.** A Word task pane is a browser, and the SuperDocs key must not be
in a browser bundle. The server exists to hold the key and to keep the tokenizer off the
wire; it is four routes and no state.

**Why `chat/async` rather than `chat`.** The synchronous endpoint returns before there is a
job record to read, and the job record is where the token count lives. The async job also
pauses at `awaiting_approval`, which is what lets TokenScope show you a rewrite without
having applied it.

**Why `approval_mode: "ask_every_time"`.** Not a preference — the contract. TokenScope never
sends `approve_all`. Your document is unchanged until you press Apply, and Apply approves
exactly one named change.

---

## Token methodology

This is the part worth reading carefully, because the honest answer is more interesting than
the tidy one.

### What is measured

**`metadata.cumulative_tokens`**, read off the SuperDocs job record at
`GET /v1/jobs/{job_id}`. This is SuperDocs' own figure for what a job consumed. TokenScope
never computes it, never adjusts it, and never substitutes anything for it. It is labelled
**Measured** in the UI.

The field is not in the published OpenAPI schema — `JobMetadata` is declared with
`additionalProperties: true` and it arrives inside that. It is read defensively: absent
means _not reported_, which is not zero.

Both sides of the comparison are measured the same way. The whole-document figure is not
modelled: TokenScope submits the same instruction as a full regeneration, as a genuine
SuperDocs job, in a **throwaway session on a copy of the document**, and reads the same
field off that job. Your document and your session are never involved, and nothing that
regeneration proposes is ever approved.

Every measurement runs in a **fresh session**, because `cumulative_tokens` reflects the
session's agent context. One session per measurement means the number attributed to an
operation is that operation's own.

### How far to trust the reported figure

In the sweep committed to `bench/RESULTS.md` this field behaves well: it rises with document
size on both sides of the comparison, and it is present on every job.

Across repeated sweeps during development it was less dependable, which is why TokenScope
reports it — it is the provider's own number and the honest answer to "what did it cost" —
but does not rest the product's claim on it alone:

- **It varies substantially run to run.** The same 3-page rewrite, same instruction, same
  model tier, reported 181,978 on one sweep and roughly 90,500 on three later ones.
- **It is sometimes absent.** One 300-page surgical run completed carrying no token count at
  all. TokenScope surfaces that as _not reported_ rather than as zero, and there is a test
  pinning that behaviour.
- **It did not always rise with document size.** On one sweep a 100-page regeneration that
  rewrote 770 sections reported fewer tokens than a 50-page regeneration that rewrote 300.
- **Within a single job it goes down as well as up** — what you would expect of a measure of
  the agent's current context rather than a running total.

Those four are observations from development runs, not claims you can check against the
committed results file. Re-run the benchmark a few times to see the spread yourself.

### The second measurement

**Text written**: the tokens in the text each job actually returned, counted from the job's
own `pending_changes` with a real BPE tokenizer (`o200k_base`, via `gpt-tokenizer`), plus
the number of sections it changed. Labelled **Tokenized**.

This is available on every job at every size, it is deterministic, and it moves the way the
underlying reality moves: a surgical edit writes one paragraph whether the document is 3
pages or 300; a regeneration writes the document. It is the comparison to read first.

### What is estimated

Two figures, both labelled **Estimated**, both replaced by measurements the moment a real
regeneration is run:

- **Estimated whole-document cost** = `reported surgical cost + 2 × (document − selection)`
  text tokens. A regeneration does everything the surgical edit did, then also reads the
  untouched remainder into the prompt and writes it back out. The surgical term carries the
  agent's fixed overhead, so both sides include it and the difference is attributable to
  document size. `bench/RESULTS.md` §4 reports how far this landed from the measured value.
- **Estimated whole-document text written** = the document body, tokenized. A full
  regeneration has to emit every paragraph.

On the committed sweep the first of those landed between 0.20× and 0.68× of the figure the
real regeneration reported, and it was low at every size. That direction matters: the
estimate understates what a regeneration costs, so the savings the pane shows before you
measure are the conservative version of the claim, not a flattering one.

### Assumptions and limitations

- **`o200k_base` is probably not SuperDocs' tokenizer.** Local counts are a consistent,
  reproducible measure of text volume, not a claim about the provider's billing. They are
  only ever compared against each other, never against `cumulative_tokens`.
- **A "page" is 500 words of body text**, defined in `shared/corpus.ts`. Real pages vary.
- **The benchmark corpus is generated, not sampled.** It is deterministic prose from a
  seeded PRNG, so the document is byte-identical across runs and only the size varies.
  It is not a sample of real customer documents.
- **One instruction, one model tier.** Everything is run with `core` and "Make this more
  concise." Other tiers and instructions will produce different numbers.
- **Costs move.** Every figure in `bench/RESULTS.md` is stamped with the time it was
  measured and the job id that produced it. Re-run the benchmark rather than trusting the
  numbers checked in here.
- **A 300-page whole-document regeneration never finished.** Three attempts all reached 99%
  and then stopped advancing. SuperDocs eventually failed the third itself, and its own
  diagnosis is the clearest statement of what happened (job
  `d8d2868d-48a9-4099-a710-440e1086cb57`):

  > no real work progress for 2720s (threshold 2700s) while 'in_progress' — job presumed
  > wedged (uncancellable blocking call or lost worker); failed by stuck-job sweeper

  The surgical edit on the same 150,000-word document completed every time, in 217–340
  seconds. The benchmark records the regeneration as a run that did not complete rather
  than inventing a figure for it. Treat this as a limit observed on this account and tier,
  not as proof that a document this size cannot be regenerated.

- **The Word host is not covered by automated tests.** Office.js needs a real Word process
  to run against. The logic it delegates to — resolving a selection onto the document,
  checking that a change stayed inside it, refusing an ambiguous apply — is tested through
  the demo host and the shared layer, and both hosts implement the same interface. The
  Office.js calls in `src/host/word.ts` themselves are unverified.

### Staying inside the selection

A surgical edit that quietly touches something else is not a surgical edit. SuperDocs mints
its own chunk ids, so returned changes come back keyed to ids TokenScope never sent; each
change is mapped back to the selection **on its original text**, which is the one thing both
sides agree on. A change that cannot be mapped is treated as out of scope — unproven is not
the same as safe. Out-of-scope changes are shown to you and are never offered for apply.

Across every benchmark run, every surgical edit proposed exactly one change and that change
was in scope (`bench/RESULTS.md` §2).

---

## Benchmark

```
npm run bench                  # all five sizes: 3, 10, 50, 100, 300 pages
npm run bench -- 3 10          # only those sizes
npm run bench -- --skip-whole  # surgical side only: half the quota, half the wait
```

For each size the harness generates the document, runs a real surgical rewrite and a real
whole-document regeneration, and records what each did. Results are merged into
`bench/results.json` and rendered to **[`bench/RESULTS.md`](bench/RESULTS.md)**, which is
generated — a size that failed can be re-run on its own without discarding the rest.

Every row carries its job ids and its timestamp. Nothing in that file is typed by hand, and
a cell with no number says so rather than showing a plausible one.

Two SuperDocs operations per size. The four smaller sizes take about fifteen minutes
together; the 300-page regeneration is the long pole and may not finish at all — see
[Assumptions and limitations](#assumptions-and-limitations).

---

## Setup

**Prerequisites:** Node 20+, and a SuperDocs API key from
[use.superdocs.app](https://use.superdocs.app) → Settings → API keys.

```bash
npm install
cp .env.example .env.local     # then add your key
```

| Variable               | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `SUPERDOCS_API_KEY`    | Your key. Server-side only; never reaches the browser.                        |
| `SUPERDOCS_BASE_URL`   | API root. Defaults to `https://api.superdocs.app/v1`.                         |
| `SUPERDOCS_MODEL_TIER` | `core` (default), `turbo`, `pro`, `max`. Both sides of the comparison use it. |
| `PORT`                 | TokenScope server port. Defaults to `8787`.                                   |

`.env.local` is git-ignored. There is no offline mock: without a key the app starts, says
so, and refuses to rewrite.

| Command             | What it does                       |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Server + Vite dev server, together |
| `npm run server`    | API server only                    |
| `npm test`          | Test suite                         |
| `npm run typecheck` | `tsc --noEmit`, strict             |
| `npm run lint`      | ESLint                             |
| `npm run format`    | Prettier                           |
| `npm run build`     | Typecheck + production build       |
| `npm run bench`     | The benchmark                      |

### Running inside Word

`manifest.xml` sideloads TokenScope as a Word task pane. Office requires HTTPS for add-in
content, including on localhost, so serve the pane over HTTPS (`office-addin-dev-certs`, or
your own certificate) and point the manifest's URLs at it. Then sideload `manifest.xml` —
on Windows via a shared folder trusted in Word's Trust Center, or with
`npx office-addin-debugging start manifest.xml`.

Inside Word, TokenScope reads the real selection through `Word.run`, and Apply replaces the
matched range. It refuses to write if the original text is not in the document exactly once:
zero matches means the document moved, more than one means the target is ambiguous, and
neither is a case where guessing beats stopping.

---

## License

MIT.
