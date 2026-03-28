# AI Judge — Implementation Plan

## Context

Build the AI Judge take-home in the empty repo at /Users/r/GitRepositories/AIJudge.

**Goal:**
Create a Next.js 15 + React 19 + TypeScript strict app using Bun, MUI, Supabase, Zod, TanStack Query, Recharts, and Vercel AI Gateway.

**Core product requirements:**
- Upload and parse the provided JSON submission format
- Persist queues, submissions, normalized question templates, answers, judges, assignments, runs, and evaluations in Supabase
- Let users create, edit, and deactivate AI Judges
- Let users assign one or more judges per question within a queue
- Run real LLM evaluations through AI Gateway
- Persist verdict, reasoning, status, errors, model used, and prompt snapshot
- Show results with filters and aggregate pass-rate stats
- Handle common failures gracefully, especially rate limits, timeouts, and provider errors

**Priority order:** Correctness → Clean persistence → Proper LLM integration → Clear trade-offs → Polish

---

## Stack Constraints

- Bun
- Next.js 15 App Router
- TypeScript strict
- React 19 + MUI (`@mui/material`, `@emotion/react`, `@emotion/styled`)
- Supabase
- Zod
- TanStack Query
- Recharts
- Vercel AI Gateway using `createGateway` + `generateObject`

Do not use shadcn.

---

## Supported Models

```ts
export const SUPPORTED_MODELS = [
  "zai/glm-4.7-flashx",
  "deepseek/deepseek-v3.2",
  "alibaba/qwen-3-235b",
  "xai/grok-4.1-fast-non-reasoning",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash",
  "meta/llama-4-scout",
  "meta/llama-4-maverick",
] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];
```

`ModelSelector` may use free-solo so users can type any gateway model ID.

---

## Required Architectural Changes (from earlier plan)

1. Do NOT use fire-and-forget background work inside a Next.js route after returning the HTTP response.
2. Use a durable async worker path, preferably a Supabase Edge Function.
3. Keep polling for run progress in v1; do not add Realtime unless trivial and low-risk.
4. Add retry with exponential backoff for retryable LLM failures (429, 502, 503, timeout). Non-retryable: 400, 401, 404.
5. Prioritize relational DB indexes for actual query patterns; do not add blanket JSONB GIN indexes unless a real feature needs them.
6. Add a pre-run confirmation step showing planned evaluation count and warning that real provider API calls will be made.
7. Make attachment handling explicit with first-class records; support forwarding images/PDFs only when provider/model support exists.
8. Keep prompt field selection queue-aware or assignment-aware, not globally tied to a judge across all queues.
9. Keep the implementation practical for a take-home; prefer the smallest reliable solution.

---

## Implementation Expectations

- Use Supabase migrations for schema
- Use Zod for request validation
- Use AI Gateway + `generateObject` for structured verdict output (Zod schema: `{ verdict: enum, reasoning: string }`)
- Use bounded concurrency (limit 5) in the worker
- Persist `retry_count` and terminal `error_message` on evaluations
- Make evaluations auditable by `run_id` and `prompt_snapshot`
- Support manual verdict override if time allows
- Add README sections for setup, env vars, architecture, trade-offs, demo steps, and time-spent note

---

## Schema Summary

### Types
```sql
CREATE TYPE verdict_enum AS ENUM ('pass', 'fail', 'inconclusive');
CREATE TYPE run_status_enum AS ENUM ('pending', 'running', 'completed', 'error', 'cancelled');
CREATE TYPE eval_status_enum AS ENUM ('pending', 'running', 'completed', 'error');
```

### Core Tables
- `queues` — derived from uploaded JSON `queueId`
- `submissions` — one row per top-level JSON object; `raw_json JSONB` for debugging (no GIN index)
- `question_templates` — normalized by `(id, queue_id)`; one per distinct `data.id` within a queue
- `submission_answers` — one per `(submission_id, question_template_id)`; `answer_json JSONB`
- `submission_attachments` — explicit attachment records with `storage_path` (Supabase Storage)
- `judges` — name, system_prompt, model, active
- `judge_assignments` — `(queue_id, question_template_id, judge_id)` UNIQUE; `prompt_fields JSONB` (queue-aware, not global); `attachment_forwarding BOOLEAN`
- `evaluation_runs` — groups evaluations; tracks `total`, `completed`, `errored`, `status`
- `evaluations` — one per `(run_id, submission_id, question_template_id, judge_id)`; verdict, reasoning, prompt_snapshot, model_used, tokens_used, latency_ms, retry_count, error_message, status

### Key Indexes
```sql
submissions(queue_id)
question_templates(queue_id)
submission_answers(question_template_id, queue_id)
judge_assignments(queue_id, question_template_id)
judge_assignments(judge_id)
evaluation_runs(queue_id)
evaluations(run_id)
evaluations(judge_id)
evaluations(question_template_id)
evaluations(verdict)
evaluations(submission_id)
evaluations(created_at DESC)
```

### Atomic counter RPCs
```sql
-- Prevents race conditions when concurrent evals update run counters
CREATE FUNCTION increment_run_completed(p_run_id UUID) ...
CREATE FUNCTION increment_run_errored(p_run_id UUID) ...
```

---

## API Contract

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/upload` | Parse JSON, upsert all entities, return summary |
| GET/POST | `/api/judges` | List / create judges |
| GET/PATCH/DELETE | `/api/judges/[id]` | Single judge |
| GET | `/api/queues` | List queues with counts |
| GET | `/api/queues/[id]/submissions` | Paginated submissions |
| GET | `/api/queues/[id]/questions` | Question templates + assigned judges |
| GET/POST/DELETE | `/api/queues/[id]/assignments` | Manage judge assignments |
| GET | `/api/queues/[id]/run-preview` | Planned eval count (shown before confirm modal) |
| POST | `/api/queues/[id]/runs` | Create run + pending evals + invoke edge fn → `{ runId, total }` |
| GET | `/api/queues/[id]/runs/[runId]` | Poll progress: `{ status, total, completed, errored }` |
| GET | `/api/queues/[id]/results` | Filtered evaluations + aggregates (judge/question/verdict/page) |
| PATCH | `/api/evaluations/[id]` | Manual verdict override |

---

## Directory Structure (key paths)

```
AIJudge/
├── supabase/
│   ├── migrations/0001_initial.sql
│   └── functions/run-evaluations/index.ts   # Deno edge worker
└── src/
    ├── app/
    │   ├── layout.tsx                        # ThemeProvider, QueryClientProvider
    │   ├── upload/page.tsx
    │   ├── judges/page.tsx + [judgeId]/page.tsx
    │   ├── queues/page.tsx + [queueId]/
    │   │   ├── page.tsx                      # submissions
    │   │   ├── assign/page.tsx               # assignment matrix
    │   │   ├── run/page.tsx                  # confirm + progress
    │   │   └── results/page.tsx
    │   └── api/                              # all route handlers
    ├── components/
    │   ├── ui/theme.ts, VerdictChip.tsx
    │   ├── layout/AppShell.tsx, NavSidebar.tsx
    │   ├── upload/FileDropzone.tsx, UploadPreview.tsx
    │   ├── judges/JudgeForm.tsx, ModelSelector.tsx
    │   ├── assign/AssignmentMatrix.tsx, PromptFieldSelector.tsx
    │   ├── run/RunPreviewDialog.tsx, RunProgress.tsx
    │   └── results/ResultsTable.tsx, ResultsFilters.tsx, PassRateChart.tsx
    ├── lib/
    │   ├── supabase/client.ts, server.ts
    │   ├── ai/gateway.ts, evaluator.ts
    │   ├── parsers/submission.ts
    │   └── validators/upload.ts, judge.ts, assignment.ts
    ├── hooks/useRunProgress.ts, useJudges.ts, useResults.ts
    └── types/db.ts, api.ts, submission.ts
```

---

## Implementation Phases

### Phase 1 — Foundation + schema + Supabase wiring
Files: `supabase/migrations/0001_initial.sql`, `src/types/db.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/ai/gateway.ts`, `src/components/ui/theme.ts`, `src/app/layout.tsx`

### Phase 2 — Upload + parsing + persistence
Files: `src/lib/validators/upload.ts`, `src/lib/parsers/submission.ts`, `src/app/api/upload/route.ts`, upload page + components

### Phase 3 — Judges CRUD
Files: judge API routes, `JudgeForm`, `ModelSelector`, judges pages

### Phase 4 — Assignments
Files: assignment API routes, `AssignmentMatrix`, `PromptFieldSelector`, assign page

### Phase 5 — Run preview + creation + edge worker
Files: `run-preview` API, `runs` POST API, `RunPreviewDialog`, `supabase/functions/run-evaluations/index.ts`, `src/lib/ai/evaluator.ts` (with retry)

### Phase 6 — Run progress polling
Files: `runs/[runId]` GET API, `useRunProgress`, `RunProgress` component, run page

### Phase 7 — Results table + filters + aggregates + chart
Files: results API, `ResultsTable`, `ResultsFilters`, `AggregateStats`, `PassRateChart`, `VerdictChip`, results page

### Phase 8 — Bonus polish (only if core done)
- Animated charts refinement
- Manual verdict override inline
- File attachment upload UI + forwarding in evaluator
- Empty/loading states

---

## Assumptions to Verify Before Coding

1. **Supabase Edge Function invoke is non-blocking** — call with a short timeout on the invoke itself; do not await full worker completion in the Next.js route.
2. **Edge function 150s cap** — v1: cap work per invocation at ~200 items; document this limit in README.
3. **AI Gateway model string format** — confirm `"provider/model-id"` format is correct for each of the 8 models; log `model_used` per evaluation.
4. **`prompt_fields` key matching** — filter defensively: only include keys present in `answer_json`; log any missing fields.
5. **Multimodal attachment support** — guard: only forward attachments if `attachment_forwarding=true` on the assignment AND the model is known to support it; fallback to text-only with a note in `error_message`.

---

## README Sections to Include

- Architecture overview (Next.js + Supabase Edge Function + AI Gateway)
- Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `VERCEL_AI_GATEWAY_KEY`
- Local setup: `bun install` → `supabase start` → `supabase db push` → `bun dev`
- Edge function deploy: `supabase functions deploy run-evaluations`
- Trade-offs: edge fn 150s cap, polling over Realtime, prompt_fields default behavior
- Demo walkthrough order: upload → judges → assign → run → results
- Time Spent / Trade-offs note template
