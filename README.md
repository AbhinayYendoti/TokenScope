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
npm run dev                    # http://localhost:5173
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

(Once an Office dev certificate is installed the same command serves `https://localhost:5173`
instead — see [Running inside Word](#running-inside-word).)

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

### 1. Prerequisites

| Need                          | Version                                   | Check with                                     |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------- |
| [Node.js](https://nodejs.org) | 20 or newer                               | `node -v`                                      |
| npm                           | 10 or newer (ships with Node)             | `npm -v`                                       |
| A SuperDocs account           | free tier is enough                       | [use.superdocs.app](https://use.superdocs.app) |
| Microsoft Word                | _optional_ — Word 2019+, or Microsoft 365 | only for the add-in                            |

Word is genuinely optional. Without it TokenScope runs standalone in a browser against a
live document surface, and every SuperDocs call is the same.

### 2. Install

```bash
git clone https://github.com/AbhinayYendoti/TokenScope.git
cd TokenScope
npm install
```

### 3. Get a SuperDocs API key

Sign in at [use.superdocs.app](https://use.superdocs.app), then **Settings → API keys →
Create key**. Copy it when it is shown; you cannot read it back later. Keys start with
`sk_` or `lce_`.

The free tier allows 500 operations a month. A rewrite costs one, and measuring a
whole-document regeneration costs another.

### 4. Configure

Copy the example file and put your key in it:

```bash
cp .env.example .env.local          # macOS, Linux, Git Bash
```

```powershell
Copy-Item .env.example .env.local   # Windows PowerShell
```

Then edit `.env.local`:

```ini
SUPERDOCS_API_KEY=sk_your_key_here
```

| Variable               | Required | Purpose                                                                                                                   |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SUPERDOCS_API_KEY`    | yes      | Your key. Read only by the server; never reaches the browser.                                                             |
| `SUPERDOCS_BASE_URL`   | no       | API root. Defaults to `https://api.superdocs.app/v1`.                                                                     |
| `SUPERDOCS_MODEL_TIER` | no       | `core` (default), `turbo`, `pro`, `max`. Both sides of the comparison use the same tier or the comparison is meaningless. |
| `PORT`                 | no       | TokenScope server port. Defaults to `8787`.                                                                               |

`.env.local` is git-ignored. Keep it that way — and if a key has ever been pasted into a
chat, a terminal history or a screenshot, rotate it.

There is no offline mock. Without a key the app starts, tells you the key is missing, and
refuses to rewrite rather than showing invented numbers.

### 5. Run it

```bash
npm run dev
```

Open **http://localhost:5173**. You should see the pane on the left and a demo document on
the right, with a status line reading something like _"481 of 500 SuperDocs operations
left"_ — that line is a live call to SuperDocs, so if it appears, your key works.

Then: click **Select it** above the document, leave the instruction as _"Make this more
concise"_, and press **Rewrite selection**.

### 6. Check the install

```bash
npm test          # 93 tests, no API key needed
npm run typecheck
npm run build
```

None of those call SuperDocs, so they pass with or without a key.

To confirm the key itself is reaching the API:

```bash
npm run server
curl http://127.0.0.1:8787/api/status
```

A working key returns your tier and quota. A missing or rejected one returns a `problem`
field saying which.

### Commands

| Command                            | What it does                                                    |
| ---------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                      | Server + pane together — the normal way to run it               |
| `npm run server`                   | API server only                                                 |
| `npm start`                        | Production build, then serve it                                 |
| `npm test`                         | Test suite                                                      |
| `npm run typecheck`                | `tsc --noEmit`, strict                                          |
| `npm run lint`                     | ESLint                                                          |
| `npm run format`                   | Prettier                                                        |
| `npm run build`                    | Typecheck + production build                                    |
| `npm run bench`                    | The benchmark (spends real quota — see [Benchmark](#benchmark)) |
| `npm run word:certs`               | One-time HTTPS certificate for the Word add-in                  |
| `npm run word:validate`            | Check `manifest.xml` against the Office schema                  |
| `npm run word:start` / `word:stop` | Sideload the add-in into Word, and undo it                      |

### If something goes wrong

| Symptom                                     | Cause                                                        | Fix                                                                   |
| ------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Pane says _"SUPERDOCS_API_KEY is not set"_  | No `.env.local`, or the server was started before it existed | Create it, then restart `npm run dev`                                 |
| _"SuperDocs rejected the API key"_          | Key wrong, truncated, or revoked                             | Re-copy from Settings → API keys                                      |
| _"monthly operation quota is used up"_      | 500 free operations spent                                    | Wait for the monthly reset, or upgrade                                |
| _"The TokenScope server is not responding"_ | Only Vite is running                                         | Use `npm run dev`, not `vite` alone                                   |
| Port 5173 already in use                    | Something else has it                                        | Free the port — the Word manifest names 5173 exactly, so it is pinned |
| Rewrite hangs for minutes                   | Large document                                               | Expected: a 50-page edit takes ~1 min, 300 pages ~5                   |

### Running inside Word

Word will not load add-in content over plain HTTP, even from localhost, so this takes one
extra step the standalone demo does not.

```bash
npm run word:certs      # installs a locally-trusted certificate for https://localhost
npm run word:validate   # optional: check manifest.xml against the Office schema
npm run dev             # serves the pane over HTTPS on :5173
```

`word:certs` adds a CA named "Developer CA for Microsoft Office Add-ins" to your trust
store, scoped to `localhost`. It is the supported way to get a dev certificate for Office,
and `npx office-addin-dev-certs uninstall` removes it. `npm run dev` never installs
anything on its own — without a certificate it says so and falls back to HTTP.

Then sideload `manifest.xml`, either with the tooling:

```bash
npm run word:start      # sideloads and opens Word; npm run word:stop to undo
```

or by hand on Windows: put `manifest.xml` in a folder, share that folder, then in Word go to
**File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs**, add the
share path, tick **Show in Menu**, restart Word, and pick TokenScope from
**Insert → My Add-ins → Shared Folder**.

TokenScope then appears on the **Home** tab as **Token counter**. The pane replaces the demo
document column with Word itself: it reads the real selection through `Word.run`, and Apply
replaces the matched range. It refuses to write if the original text is not in the document
exactly once — zero matches means the document moved, more than one means the target is
ambiguous, and neither is a case where guessing beats stopping.

The manifest points at `https://localhost:5173`. To host the pane anywhere else, replace
that origin throughout `manifest.xml` and serve the built `dist/`.

---

## License

MIT.
