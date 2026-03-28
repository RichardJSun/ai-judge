# AI Judge

An AI-powered evaluation platform that lets you upload submission queues, configure LLM judges, run automated evaluations, and analyze results.

## Architecture

```
Next.js 16 (App Router)
  ├── API Routes          — REST endpoints for all data operations
  ├── React 19 pages      — MUI + TanStack Query client UI
  └── Vercel AI Gateway   — unified LLM routing via createGateway + generateObject

Supabase (Postgres)
  ├── 8 relational tables — queues, submissions, questions, judges, assignments, runs, evaluations
  ├── 3 ENUM types        — verdict, run_status, eval_status
  └── 2 atomic RPCs       — increment_run_completed, increment_run_errored
```

### Evaluation Flow

1. User uploads JSON → submissions persisted and normalized into `question_templates`
2. User creates AI judges (name, system prompt, model)
3. User assigns one or more judges per question (queue-scoped)
4. POST `/api/queues/[id]/runs` inserts evaluation rows and runs them with bounded concurrency (5 at a time)
5. Each evaluation calls `generateObject` via AI Gateway with a Zod schema forcing `{verdict, reasoning}`
6. UI polls `/api/queues/[id]/runs/[runId]` every 2s for progress
7. Results page shows filtered evaluations + aggregate pass rate + per-judge bar chart

## Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SECRET_KEY=<secret-key>
AI_GATEWAY_API_KEY=<vercel-ai-gateway-key>
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
```

## Local Setup

```bash
# Install dependencies
bun install

# Apply database schema
# Option A: Supabase CLI
supabase db push

# Option B: paste supabase/migrations/0001_initial.sql into the Supabase SQL editor

# Start dev server
bun dev
```

Open http://localhost:3000 — redirects to `/upload`.

## Supported Models

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

Any Vercel AI Gateway model ID can also be typed directly in the model selector (free-solo).

## Demo Walkthrough

1. **Upload** — drag your JSON file onto the upload page
2. **Judges** — create at least one judge with a system prompt and model
3. **Queues** → **Assign** — check which judges should evaluate which questions
4. **Queues** → **Run** — confirm and start; watch the progress bar
5. **Results** — filter by judge/question/verdict, see aggregate pass rate and chart

## Trade-offs

### Synchronous evaluation worker
Evaluations run synchronously inside the POST `/runs` handler rather than in a Supabase Edge Function. The handler fires the `runWithConcurrency` promise without awaiting it before returning `{runId, total}`, which is effectively a short-lived background task scoped to the Node.js request lifecycle.

**Why:** Simpler to deploy (no `supabase functions deploy`), no Deno toolchain required, correct for typical demo queue sizes. For production with large queues, move the worker to a Supabase Edge Function or a queue (BullMQ, Inngest) so it survives beyond the HTTP timeout.

### Polling over Realtime
The run progress page polls every 2 seconds rather than subscribing to Supabase Realtime. Reduces WebSocket connection overhead for a v1 demo; trivial to swap later.

### No file attachment support in v1
The DB schema and assignment config include `attachment_forwarding` as a flag, but the upload parser and evaluator do not yet forward files to the LLM. The hook point is in `evaluator.ts` — guard by `assignment.attachment_forwarding && modelSupportsMultimodal(judge.model)`.

### prompt_fields are queue-scoped
Each `judge_assignment` row stores its own `prompt_fields`, so the same judge can be configured differently across queues.

## Time Spent

~5 hours total.

- ~30min: planning, schema design
- ~1.5h: foundation (types, clients, theme, layout, upload)
- ~1.5h: judges + assignments + matrix UI
- ~1h: AI evaluator, run API, progress polling
- ~1h: results page, chart, filters, polish
