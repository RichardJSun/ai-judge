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
- `S03_VERIFY_MODEL` is optional and only affects the S03 live verifier. If unset, it uses `openai/gpt-4o-mini`.

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
bun run verify:s03-live -- --base-url http://localhost:3000
```

What they prove:

- `verify:s01-live` checks upload, run preview, run start, run polling, and persisted evaluation audit basics.
- `verify:s02-live` checks upload/assignment/run wiring and the reviewer-facing judges lifecycle surface.
- `verify:s03-live` checks the queue results workflow end to end, including real results persistence, judge/question/verdict filters, pass-rate aggregation, and the results page reachability.

All three commands require a reachable Next.js app at `--base-url`. If you do not pass the flag, the scripts only fall back to `BASE_URL` when that env var is set.

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
