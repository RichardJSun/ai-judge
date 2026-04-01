# Video Script — AI Judge Demo (~4 minutes)

Target: a concise Loom walkthrough that covers the required flow, names the key bonus features that are actually implemented, and keeps the trade-offs accurate.

---

## 0. Intro (~15 seconds)

> This is AI Judge, a Next.js 16, React 19, TypeScript, and Supabase app for uploading submission queues, configuring AI judges, running real LLM-backed evaluations through AI Gateway, and reviewing persisted results. I'll walk through the full reviewer flow from upload to audit detail.

---

## 1. Upload Submissions (~25 seconds)

Open `http://localhost:3000`.

> The app redirects straight to Upload Submissions. I'll drag in a JSON queue file.
>
> After upload, the app shows a parsed summary for queues, submissions, questions, answers, and attachments, and all of that is persisted in Supabase so it survives reloads.

On screen:
- Show the drag-and-drop area.
- Drop the sample file.
- Pause on the success panel.
- Click **View Queues**.

Brief mention:

> From the queue list, each queue has a reviewer path for submissions, assignments, runs, and results.

---

## 2. Judge CRUD (~40 seconds)

Go to **Judges**.

> The Judges page manages persisted judge configurations. Each judge stores a name, system prompt or rubric, a target model, and an active flag.

On screen:
- Click **New Judge**.
- Create one judge:
  - Name: `Factual Accuracy`
  - Model: `openai/gpt-4o-mini`
  - Prompt: "Evaluate whether the answer is factually correct and well-reasoned. Return pass if correct, fail if wrong, inconclusive if ambiguous."
- Optionally create a second judge:
  - Name: `Reasoning Quality`
  - Model: `google/gemini-2.0-flash`
- Click **Manage** on an existing judge and show the edit flow.
- Toggle a judge inactive, then reactivate it.

> Judges are deactivated instead of deleted, so persisted assignment history and past evaluations stay inspectable.

---

## 3. Assign Judges to Questions (~35 seconds)

Go back to **Queues**, open a queue, then click **Assign Judges**.

> This is the assignment matrix. I can assign one or more judges per question, and those selections are persisted for later runs.
>
> If I expand a question row before checking a new active judge, I can choose which prompt fields that new assignment will send: question text, answer, and question type. That's one of the implemented bonus features.

On screen:
- Show the matrix.
- Expand a question row.
- Show the prompt field selector.
- Check one or more judge assignments.

Brief mention:

> Existing persisted assignments also show whether attachment forwarding is enabled. That toggle is stored per assignment and controls whether stored submission attachments are forwarded during evaluation.

---

## 4. Run Evaluations (~35 seconds)

Go back to the queue page and click **Run Evaluations**.

> Before starting, the app shows a preview with the total planned evaluations and excludes any assignments that point at inactive judges. When I confirm, it persists the run and schedules real model calls through AI Gateway. The run page then polls persisted progress.

On screen:
- Open the preview dialog.
- Point out the total planned calls.
- Start the run.
- Show the live run progress panel.

> The run summary stays truthful with total, completed, and error counts. Each evaluation persists the verdict, reasoning, model used, token count, latency, retry count, prompt snapshot, and any terminal error text.

---

## 5. Results View (~50 seconds)

Click **View Results**.

> The results page is the reviewer surface for persisted evaluations. At the top, it shows aggregate pass rate based only on completed evaluations, along with matching and completed counts. Next to that is an animated per-judge pass-rate chart.

On screen:
- Show the metric cards.
- Show the animated chart.

> The table includes the spec's required fields: Submission, Question, Judge, Verdict, Reasoning, and Created. I can filter by judge, question, and verdict, and those filters apply consistently to the rows, the pass-rate summary, and the chart.

On screen:
- Apply a judge filter.
- Apply a question or verdict filter.
- Expand a row.

> Expanding a row reveals audit detail like model used, tokens, latency, retries, prompt snapshot, the plan marker for attachment handling, and any error text.

---

## 6. Submission Detail (~20 seconds)

Click a **submission ID** from the results table.

> Submission IDs deep-link into a queue-scoped submission detail page. This shows the full ordered question set, the stored answers, and reviewer-safe attachment metadata with durable storage status.

On screen:
- Show the question cards.
- Open one raw payload if useful.
- Show the attachments section and storage status copy.

---

## 7. Closing (~35 seconds)

> The main trade-offs are these: evaluation work is scheduled in-process with Next.js `after()`, which keeps the take-home simple but would become a dedicated worker in production. Results are queue-scoped rather than run-scoped, which is better for history but means repeat runs accumulate on the same results page. And run progress uses polling instead of Realtime to keep the implementation smaller.
>
> For bonus features, the app supports prompt field selection for new assignments, animated per-judge pass-rate charts, submission detail pages with stored attachment status, and capability-gated attachment forwarding. Unsupported models or media types are not silently ignored; they surface explicit blocked diagnostics in the audit trail.
>
> Time spent was about 38 hours.

---

## Presenter Checklist

Before recording:

- Start the app with `bun dev`.
- Make sure Supabase and AI Gateway credentials are valid.
- If you want to show attachment handling, use an attachment-backed fixture.
- Optionally pre-create a queue and judges for a cleaner recording.

---

## One-paragraph Version For A Submission Email

> AI Judge is a Next.js 16 + React 19 + TypeScript + Supabase reviewer workflow. Reviewers upload queue JSON, create and manage persisted judges, assign them per question, choose prompt fields for new assignments, run real LLM-backed evaluations through AI Gateway, and inspect queue-scoped results with filters, pass-rate summaries, animated per-judge charts, expandable audit detail, and submission detail pages. Bonus work includes capability-gated attachment forwarding and reviewer-visible attachment storage status. Time spent: about 38 hours.
