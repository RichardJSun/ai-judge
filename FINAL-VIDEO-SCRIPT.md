# Video Script — AI Judge Demo (~3.5 minutes)

Target: a concise Loom walkthrough that hits every requirement the spec asks for, calls out bonus features, and names trade-offs on camera.

---

## 0. Intro (~15 seconds)

> This is AI Judge — a web app for uploading submission queues, configuring AI judges, running real LLM-backed evaluations, and reviewing the results. It's built with Next.js 16, React 19, TypeScript, and Supabase. I'll walk through the full reviewer workflow.

---

## 1. Upload Submissions (~25 seconds)

Open `http://localhost:3000`.

> The app opens on Upload Submissions. I'll drag in a JSON queue file.
>
> After upload, the app shows a parsed summary — queues, submissions, question templates, answers, and attachments — all persisted in Supabase, so everything survives reloads.

On screen:
- Show the drag-and-drop area.
- Drop the sample file.
- Pause on the success panel and count chips.
- Click **View Queues**.

---

## 2. Judge CRUD (~40 seconds)

Go to **Judges**.

> The Judges page manages persisted judge configurations. Each judge stores a name, system prompt, model, and active/inactive status.

On screen:
- Click **New Judge**.
- Create one judge:
  - Name: `Factual Accuracy`
  - Model: `openai/gpt-4o-mini`
  - Prompt: "Evaluate whether the answer is factually correct and well-reasoned. Return pass if correct, fail if wrong, inconclusive if ambiguous."
- Optionally create a second judge:
  - Name: `Reasoning Quality`
  - Model: `google/gemini-2.0-flash`
- Click **Manage** on a judge, show edit.
- Toggle one inactive and reactivate it.

> Judges are deactivated rather than deleted, so assignment history and evaluation context stay inspectable.

---

## 3. Assign Judges to Questions (~30 seconds)

Go to **Queues**, open a queue, then click **Assign Judges**.

> This is the assignment matrix. I map judges to questions here — one or more judges per question.
>
> If I expand a row, I can also configure which prompt fields are included — question text, answer, question type — so I control exactly what the judge sees. That's one of the bonus features from the spec.

On screen:
- Show the matrix.
- Check one or more assignments.
- Expand a row and show the prompt field selector.

Brief mention:

> There's also a "Forward stored attachments" toggle here — a bonus capability for sending submission-linked files to multimodal models during evaluation.

---

## 4. Run Evaluations (~35 seconds)

Go back to the queue page and click **Run Evaluations**.

> Before starting, the app previews how many evaluations will be created from the current assignments. When I confirm, it persists the run and schedules real model calls through AI Gateway. The run page polls for progress as evaluations complete.

On screen:
- Show the preview.
- Start the run.
- Show live progress on the run page.

> Each evaluation stores the verdict, reasoning, model used, token count, latency, retry count, and any error text — all persisted in Supabase.

---

## 5. Results View (~45 seconds)

Click **View Results**.

> The results page shows an aggregate pass rate at the top — based on completed evaluations only, so errors don't silently inflate the number. Next to it is an animated per-judge pass-rate chart — another bonus from the spec.

On screen:
- Show the pass-rate percentage.
- Show the animated bar chart.

> The table has the columns the spec requires: Submission, Question, Judge, Verdict, Reasoning, and Created. I can filter by judge, question, and verdict, and the filters apply to both the table and the aggregate calculations.

On screen:
- Apply a judge filter.
- Apply a verdict filter.
- Expand a row.

> Each row also has expandable audit detail — model used, tokens, latency, retry count, prompt snapshot, and error text.

---

## 6. Submission Detail (~15 seconds)

Click a **submission ID** from the results table.

> Submission IDs link into a dedicated detail page showing the full question-and-answer context. If the submission has attachments, the page shows attachment metadata and storage status.

On screen:
- Show questions and answers.
- Show attachment status if present.

---

## 7. Closing (~30 seconds)

> To summarize the trade-offs I made: evaluation work runs in-process using Next.js `after()` — simple for a take-home, but a real deployment would use a separate worker. Results are queue-scoped rather than run-scoped, which is better for reviewer history. And the run page polls instead of using Supabase Realtime, keeping the runtime smaller.
>
> For bonus features: prompt field selection lets users control what the judge sees, the per-judge chart animates, and attachment forwarding is capability-gated — if a model can't consume the file type, the app records an explicit blocked diagnostic instead of silently dropping it.
>
> Time spent was roughly 32 hours across March 27 to 29. Thanks for reviewing.

---

## Presenter Checklist

Before recording:

- Start the app with `bun dev`.
- Make sure Supabase and AI Gateway credentials are valid.
- If showing attachments, use an attachment-backed fixture.
- Optionally pre-create a queue and judges for a cleaner run.

---

## One-paragraph version for a submission email

> AI Judge is a Next.js 16 + React 19 + TypeScript + Supabase review workflow. Reviewers upload queue JSON, create and manage AI judges, assign them per question with configurable prompt fields, run real LLM-backed evaluations, and inspect persisted results with filters, animated pass-rate charts, and per-evaluation audit detail. Bonus features include prompt field selection, animated per-judge charts, and capability-gated multimodal attachment forwarding. Time spent: ~32 hours across March 27–29.
