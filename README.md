# AI Judge

AI Judge is a Next.js 16 review workflow for uploading submission queues, configuring AI judges, running persisted evaluations, and inspecting reviewer-facing results.

## Architecture

The current runtime flow is:

```text
/upload
  → persist queue, submissions, questions, and answers in Supabase
/judges
  → create active or inactive persisted judge records
/queues/[queueId]/assign
  → map judges to queue questions
POST /api/queues/[id]/runs
  → startRun(...)
  → scheduleRunExecution({ schedule: after, execute: () => executeRun(...) })
  → return { runId, total }
/queues/[queueId]/run
  → poll /api/queues/[id]/runs/[runId] until the run settles
/queues/[queueId]/results
  → fetch judges + queue questions + queue-scoped results in parallel
  → render the filtered reviewer results contract
```

What each runtime boundary is responsible for:

- `src/app/api/queues/[id]/runs/route.ts` loads active assignments, submissions, and answers from Supabase, then calls `startRun` and schedules background work with `after()`.
- `src/lib/run/start-run.ts` validates the queue state, inserts `evaluation_runs`, inserts pending `evaluations`, and returns the concrete tasks that should be executed.
- `src/lib/run/execute-run.ts` runs those tasks with `runWithConcurrency(..., 5)`, increments completed or errored counters, and finalizes the run as `completed` or `error` from the persisted summary.
- `src/lib/ai/evaluator.ts` calls the AI Gateway through AI SDK structured output and stores verdict, reasoning, retry count, token usage, latency, and error text on each evaluation row.
- `src/app/api/queues/[id]/results/route.ts` returns the queue-scoped results contract used by the reviewer UI. Judge, question, and verdict filters apply consistently to the row list, `passRate`, and `judgePassRates`.
- `src/app/queues/[queueId]/results/page.tsx` fetches judges, questions, and results in parallel and renders the visible reviewer table with Submission, Question, Judge, Verdict, Reasoning, and Created as primary fields.

## Environment Variables

Create `.env.local` with the real credentials for the Supabase project and AI Gateway you want to use:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SECRET_KEY=<service-role-or-secret-key>
AI_GATEWAY_API_KEY=<vercel-ai-gateway-key>
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v3/ai
```

Notes:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the browser key the app expects. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted as a compatibility fallback.
- `SUPABASE_SECRET_KEY` is the preferred server-side key name used by the app and live verifiers. `SUPABASE_SERVICE_ROLE_KEY` is also accepted as a fallback.
- `AI_GATEWAY_BASE_URL` is an override knob. Keep the default Vercel AI Gateway URL unless you intentionally route through a different compatible endpoint.
- `AI_GATEWAY_API_KEY` is required for real judge execution.
- `S03_VERIFY_MODEL` is optional and affects the attachment-capable S03/S04 verifier lanes. If unset, those lanes use `openai/gpt-4o-mini`, while the S03 text-only lane uses `openai/gpt-oss-120b`.

## Local Setup

1. Install dependencies.

   ```bash
   bun install
   ```

2. Point the app at a Supabase project.

   - **Hosted Supabase:** set the env vars above in `.env.local`.
   - **Local Supabase:** run your local Supabase stack however you normally manage it. When the verifiers target `http://localhost:3000`, they will try to read credentials from `bunx supabase status -o env` before falling back to `.env.local`.

3. Apply the schema in `supabase/migrations/0001_initial.sql` to the same Supabase project.

   - If your Supabase CLI project is already configured, run:

     ```bash
     bunx supabase db push
     ```

   - Otherwise, apply `supabase/migrations/0001_initial.sql` in the Supabase SQL editor for the project referenced by your env vars.

4. Start the Next.js app.

   ```bash
   bun dev
   ```

5. Open `http://localhost:3000`. The root route redirects to `/upload`.

## Proof Commands

With the local app running, the slice verifiers exercise the real workflow against persisted data:

```bash
bun run verify:s01-live -- --base-url http://localhost:3000
bun run verify:s02-live -- --base-url http://localhost:3000
bun run verify:m005-s03 -- --base-url http://localhost:3000 --timeout-ms 180000
bun run verify:s04-live -- --base-url http://localhost:3000 --timeout-ms 180000
```

What they prove:

- `verify:s01-live` checks upload, run preview, run start, run polling, and persisted evaluation audit basics.
- `verify:s02-live` checks upload/assignment/run wiring and the reviewer-facing judges lifecycle surface.
- `verify:m005-s03` checks the queue results workflow end to end, including real results persistence, judge/question/verdict filters, pass-rate aggregation, readiness and poll budgets, and the reviewer audit evidence (plan markers, blocked diagnostics, and the filtered results API) that proves supported, disabled, and blocked paths.
- `verify:s04-live` proves the full spec-ordered reviewer walkthrough end to end: upload → judges CRUD → assignment → run → results. It still emits the concrete queue, judge, question, assignment, run, page, and filtered API targets that a reviewer can copy directly into a browser follow-up.

Both `verify:m005-s03` and `verify:s04-live` now surface the readiness/poll budgets (`env-readiness`, `schema-readiness`, `storage-readiness`, `model-readiness`, `results-poll`) so you know immediately whether migrations, storage buckets, env knobs, or the chosen model are blocking the proof before the expensive upload/run phases start. Tune the `--timeout-ms`/`--poll-ms` overrides (or the `M005_S03_VERIFY_*` and `S04_VERIFY_*` env vars) if a phase consistently exhausts its budget, and copy the filtered `results` API URL from the command output whenever you need run-scoped evidence.

All four commands require a reachable Next.js app at `--base-url`. If you do not pass the flag, the scripts only fall back to `BASE_URL` when that env var is set.

## Attachment-backed launchability checklist

### Required prerequisites
- Apply `supabase/migrations/0002_submission_attachments.sql` to every Supabase instance the verifier targets. The S04 proof reads the extra columns/tables before it can claim attachment persistence, so a missing migration stops the verifier during schema readiness. Run `bunx supabase db push` or paste the SQL into the Supabase SQL editor for the project named in your env vars.
- Make sure the private storage bucket `submission-attachments` exists and is writable. Local Supabase users can run `bunx supabase storage list --bucket submission-attachments` to confirm. If it is missing, recreate it with `bunx supabase storage create-bucket submission-attachments` (or the equivalent Supabase UI action) before rerunning the verifier.
- Run `bun run verify:supabase` before the upload/run proofs so the readiness phases report the required tables and bucket up front instead of failing mid-proof. This command uses the same `bunx supabase status -o env` output that the verifiers rely on and strips optional quotes before matching the values stored in `.env.local`.
- Set the env vars that the verifier scripts expect:
  - `NEXT_PUBLIC_SUPABASE_URL` (or rely on `bunx supabase status -o env` output for the local stack).
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (branch compatibility for the reviewer UI).
  - `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` (server-side key used by S03/S04 verifiers).
  - `AI_GATEWAY_API_KEY` plus `AI_GATEWAY_BASE_URL` (defaults to `https://ai-gateway.vercel.sh/v3/ai`).
  - Optional overrides: `S03_VERIFY_MODEL` and `S04_VERIFY_MODEL` if your preferred multimodal provider differs from `openai/gpt-4o-mini`. Spell each name exactly — wrong env names are a common failure mode.
- Keep a local Supabase CLI installation handy (`supabase` at `bunx supabase`). The verifier uses `bunx supabase status -o env` to auto-detect `SUPABASE_URL` and service-role keys when running against the local stack. If that command fails, start the CLI (`bunx supabase start`), ensure the background Postgres/PostgREST services are running, and re-run the verifier with the env dump piped into `.env.local`.

### Recommended verification order (S01 → S04)
1. Run `bun run verify:m005-s01 -- --base-url http://localhost:3000` to reproduce the deterministic fixture that uploads attachments and emits the queue/submission coordinates later proofs rely on. Without this fixture, S04 may not find the expected attachment rows.
2. Run the S02/S03 proofs (`bun run verify:m005-s02` followed by `bun run verify:m005-s03 -- --base-url http://localhost:3000 --timeout-ms 180000`) to re-prove that assignment forwarding, prompt_snapshot, and auth filtering are stable and to emit the queue/judge/assignment identifiers that S04 reuses. The S04 verifier assumes those identifiers exist and that the reviewer flow is queue-scoped rather than run-scoped, so use the `results` API URL it spits out if you need to isolate the latest proof.
3. Finally run `bun run verify:s04-live -- --base-url http://localhost:3000 --timeout-ms 180000`. This command performs the upload → judges → assignment → run → results workflow and prints the `OK` line with queue, judge, run, results, and inspection URLs.

The docs above reuse the S01–S03 proof targets because they form the deterministic path that the attachment-backed verifier covers. When browsing the reviewer history after multiple runs, prefer the filtered URLs from the emitted `Inspect`/`APIs` lines, since the visible pages (`/queues/…/results`, `/queues/…/assign`) always show queue-level history.

### Browser/UAT follow-up checklist
- Copy the inspection URLs from the `OK` line the verifier prints (valid/invalid judge, assign, results, queue/queues, run, APIs). Open them in a browser to confirm reviewer ceremonies, not just the API response.
- On `/queues/:queueId/submissions/:submissionId`, confirm the stored attachment filename renders, the copy `Stored` or `Durable storage succeeded for this attachment.` appears, and the raw blob bytes are redacted in the HTML (the API already returns a sanitized `attachments` array). This proves the sticky attachment metadata is reviewer-visible.
- On `/queues/:queueId/assignments`, ensure the verifier judge row shows the `attachment_forwarding` toggle and that the visible copy reflects the forwarding state (`Forward stored attachments when enabled`). This demonstrates that assignment-level forwarding is surfaced to reviewers.
- Open the emitted `results` page and API URL. Verify the table still shows attachments/prompt_snapshot details for each evaluation row, that attachment-aware errors appear (blocked rows include `error_message` and `prompt_snapshot`), and that the filters isolate the current proof (use the filtered API URL when you need run-scoped evidence).

### Recovery guidance for common blockers
- **Missing migration or storage bucket** → rerun `bunx supabase db push` and `bunx supabase storage create-bucket submission-attachments`. After these succeed, reapply the S01 fixture (`bun run verify:m005-s01 …`) so the stored attachments actually exist.
- **Supabase mismatch (local vs hosted)** → run `bunx supabase status -o env` and compare the output to your `.env.local`. If they differ, copy the CLI env block into `.env.local` so the verifier and Next.js app point at the same cluster. Restart the local Supabase stack (`bunx supabase start`) if the CLI is unavailable.
- **Unavailable multimodal model** → set `S03_VERIFY_MODEL` and `S04_VERIFY_MODEL` to a model ID that your AI Gateway supports (e.g., `openai/gpt-4o-mini` or a locally hosted custom model). The verifiers log which model they try to run, so inspect their stdout when the model fails and correct the env override before rerunning.

## S04 Final Conformance Walkthrough

Use this when you need the final handoff proof from a fresh context window.

1. **Start from a clean local stack**.
   - `bun dev` must be running from this repo so Next.js loads `.env.local`.
   - If you use local Supabase, confirm `bunx supabase status -o env` points at the same project your `.env.local` values target. A mixed local/hosted setup is the fastest way to get `/api/queues` or `/api/judges` 500s during verifier startup.
   - Keep the verifier queue isolated to the built-in `queue_s04_live_proof` fixture namespace. The verifier intentionally clears only its own prior S04 assignments before baseline preview; it does not wipe unrelated queue history.

2. **Run the live proof**.

   ```bash
   bun run verify:s04-live -- --base-url http://localhost:3000 --timeout-ms 180000
   ```

3. **Copy the emitted identifiers from the `OK ...` line**.
   - `queue` / `queueLabel` identify the persisted proof queue.
   - `validJudge` and `invalidJudge` identify the two fresh verifier judges for this run.
   - `questions=` encodes each tracked question as `questionId:validAssignmentId:invalidAssignmentId:answerCount`.
   - `run=` encodes `runId:status:previewTotal/startedTotal:completedRows/erroredRows/retriedRows`.

4. **Walk the reviewer flow in the same order as the spec**.
   - **Upload** — open `http://localhost:3000/upload` and confirm **Upload Submissions**. The verifier already persisted `queueLabel`, so this page is the starting route reference rather than a page with emitted ids.
   - **Judges CRUD** — open the emitted `judges=...`, `validJudgeDetail=...`, and `invalidJudgeDetail=...` targets from the `Inspect ...` line. Confirm the valid judge is the active reviewer path and the invalid judge exists as the known failing model used to prove mixed run outcomes.
   - **Assign Judges** — open the emitted `assign=...` target and match the visible queue questions to the `questions=` summary ids and assignment ids.
   - **Run Evaluations** — open the emitted `run=...` target. If you need API-level confirmation, use the `runStart=...` and `runProgress=...` URLs from the `APIs ...` line together with the `run=` summary token.
   - **Results** — open the emitted `results=...` target and confirm **Results** plus the reviewer table. For current-proof isolation, use the emitted filtered `results=...` API URL from the `APIs ...` line because the visible results page is queue-scoped, not run-scoped.

5. **Check the known local-proof gotchas before declaring success**.
   - The results surface is queue-scoped history. Repeat runs append rows, so browser/UAT checks for the current proof must use the emitted verifier judge ids or the emitted filtered results API URL.
   - `AI_GATEWAY_BASE_URL` should resolve to `https://ai-gateway.vercel.sh/v3/ai`. The app normalizes the legacy Vercel `/v1` base path, but the supported handoff contract is `/v3/ai` semantics.
   - On the results page, expect clean console and network diagnostics while filters load and while the table/chart render. Treat browser console errors or failed fetch/XHR requests as proof failures, not as acceptable local noise.

## Supported Models

The built-in model suggestions currently come from `src/types/submission.ts`:

| Model ID | Provider |
|---|---|
| `openai/gpt-4o-mini` | OpenAI |
| `google/gemini-2.0-flash` | Google |
| `meta/llama-4-scout` | Meta |
| `meta/llama-4-maverick` | Meta |
| `deepseek/deepseek-v3.2` | DeepSeek |
| `alibaba/qwen-3-235b` | Alibaba |
| `xai/grok-4.1-fast-non-reasoning` | xAI |
| `zai/glm-4.7-flashx` | ZAI |

The judge form is free-solo, so you can also type another AI Gateway-compatible model ID.

## Demo Walkthrough

1. **Upload submissions** — open `http://localhost:3000`, which redirects to `/upload`, and upload a JSON file containing one or more queues.
2. **Create judges** — go to `/judges` and add at least one active judge with a system prompt and model.
3. **Assign judges to a queue** — open the queue from `/queues`, click **Assign Judges**, and save question-to-judge assignments.
4. **Preview and start a run** — from the queue page click **Run Evaluations**, confirm the preview, and start the run. The route returns immediately after `startRun` persists the work and `after()` schedules `executeRun`.
5. **Watch run progress** — stay on `/queues/[queueId]/run` until the run reaches `completed` or `error`. The progress page polls persisted counters and warns when some evaluations fail.
6. **Inspect reviewer results** — click **View Results** to open `/queues/[queueId]/results`. Use the judge, question, and verdict filters; confirm the pass-rate card and per-judge chart; and review the table rows with Submission, Question, Judge, Verdict, Reasoning, and Created. Expand rows for audit detail such as model, tokens, latency, retries, and error text.

## Trade-offs

### `after()`-scheduled in-process worker

Using `after()` keeps the demo deployment simple because the app can return `{ runId, total }` quickly and continue evaluation work without a separate queue service. The trade-off is durability: the scheduled work still lives inside the Next.js process lifetime and platform max duration, so this is appropriate for local development and modest queue sizes, not for long-running production batches.

### Reviewer results are queue-scoped, not run-scoped

The results API and page intentionally show queue history instead of only the latest run. That is helpful for reviewer auditability, but it means repeat runs accumulate rows in the same results surface. The S03 verifier handles this by creating fresh time-tagged verifier judges and applying filters when it proves one batch.

### Pass rate only counts completed evaluations

`passRate` and `judgePassRates` are computed from completed evaluations inside the active filter set. Errored rows remain visible in the table for auditability, but they do not silently count as passes. Reviewers should treat non-zero error rows as work to inspect, not as hidden noise.

### Polling instead of Realtime

The run page polls `/api/queues/[id]/runs/[runId]` for progress instead of subscribing to Supabase Realtime. That keeps the runtime smaller and easier to reason about, but it is less reactive than a live subscription model.

### Attachment forwarding is still not wired end to end

`judge_assignments` already carry `attachment_forwarding`, but uploads and evaluation execution still operate on JSON answers only. Multimodal file forwarding is a future enhancement, not part of the current verified path.
