import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResultsEvaluation } from '@/types/api';
import { REVIEWER_TABLE_SURFACE_TEST_ID } from '@/components/layout/ReviewerTableSurface';
import ResultsTable, { formatCreatedAt, summarizeReasoning } from './ResultsTable';

const QUEUE_ID = 'queue-1';
const LONG_REASONING = [
  'The judge cites the submission, compares it against the rubric,',
  'notes one unsupported claim, and explains why the final verdict',
  'still passes because the primary requirement was satisfied with evidence.',
].join(' ');

const DEFAULT_PROMPT_SNAPSHOT =
  'Prompt snapshot content describing stored attachments and forwarding.\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}';

function createEvaluation(overrides: Partial<ResultsEvaluation> = {}): ResultsEvaluation {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: LONG_REASONING,
    prompt_snapshot: DEFAULT_PROMPT_SNAPSHOT,
    model_used: 'gateway/model-a',
    tokens_used: 321,
    latency_ms: 875,
    retry_count: 0,
    error_message: null,
    created_at: '2026-03-28T12:00:00.000Z',
    status: 'completed',
    submission: {
      id: 'submission-1',
      external_id: 'SUB-001',
    },
    question: {
      id: 'question-1',
      external_id: 'Q-001',
      question_text: 'Did the answer satisfy the policy requirement?',
    },
    judge: {
      id: 'judge-1',
      name: 'Judge Atlas',
      model: 'gateway/model-a',
    },
    ...overrides,
  };
}

describe('summarizeReasoning', () => {
  it('truncates long reasoning for the primary table while keeping null reasoning explicit', () => {
    const summary = summarizeReasoning(LONG_REASONING, 80);

    expect(summary).toEndWith('…');
    expect(summary.length).toBeLessThanOrEqual(80);
    expect(summarizeReasoning(null)).toBe('—');
  });
});

describe('ResultsTable', () => {
  it('renders the shared reviewer overflow surface around reviewer-visible result fields and uses the submission cell as the detail entrypoint', () => {
    const evaluation = createEvaluation();
    const html = renderToStaticMarkup(<ResultsTable queueId={QUEUE_ID} evaluations={[evaluation]} />);

    expect(html).toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
    expect(html).toContain('data-overflow-surface="reviewer-table"');
    expect(html).toContain('Submission');
    expect(html).toContain('Question');
    expect(html).toContain('Judge');
    expect(html).toContain('Verdict');
    expect(html).toContain('Reasoning');
    expect(html).toContain('Created');
    expect(html).not.toContain('Actions');
    expect(html).not.toContain('View');

    expect(html).toContain(evaluation.submission.external_id);
    expect(html).toContain(
      `href="/queues/${QUEUE_ID}/submissions/${evaluation.submission.id}?source=results"`
    );
    expect(html).toContain(`aria-label="Open submission ${evaluation.submission.external_id} from results"`);
    expect(html).toContain(evaluation.question.external_id);
    expect(html).toContain(evaluation.question.question_text);
    expect(html).toContain(evaluation.judge.name);
    expect(html).toContain('Pass');
    expect(html).toContain(summarizeReasoning(evaluation.reasoning));
    expect(html).toContain(formatCreatedAt(evaluation.created_at));
    expect(html).toContain('Evaluation status');
    expect(html).toContain('completed');
    expect(html).toContain('Prompt snapshot');
    expect(html).toContain('Prompt snapshot content describing stored attachments and forwarding.');
    expect(html).toContain('Plan marker');
    expect(html).toContain('Plan marker kind');
    expect(html).toContain('Forwarding requested');
  });

  it('keeps errored rows with long submission ids and missing optional audit fields renderable behind a valid detail link', () => {
    const longExternalId = 'SUBMISSION-EXTERNAL-ID-WITH-A-LONG-MONOSPACE-VISIBLE-VALUE-0001';
    const html = renderToStaticMarkup(
      <ResultsTable
        queueId={QUEUE_ID}
        evaluations={[
          createEvaluation({
            id: 'evaluation-2',
            verdict: null,
            reasoning: null,
            prompt_snapshot: null,
            model_used: null,
            tokens_used: null,
            latency_ms: null,
            retry_count: 2,
            error_message: 'Gateway timed out after retries.',
            status: 'error',
            submission: {
              id: 'submission-2',
              external_id: longExternalId,
            },
          }),
        ]}
      />
    );

    expect(html).toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
    expect(html).toContain(longExternalId);
    expect(html).toContain(`href="/queues/${QUEUE_ID}/submissions/submission-2?source=results"`);
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Error');
    expect(html).toContain('—');
    expect(html).toContain('Evaluation status');
    expect(html).toContain('error');
    expect(html).toContain('Prompt snapshot');
    expect(html).toContain('Prompt snapshot was not captured for this run.');
  });

  it('surfaces blocked diagnostics when the plan marker indicates a blocked path', () => {
    const blockedHtml = renderToStaticMarkup(
      <ResultsTable
        queueId={QUEUE_ID}
        evaluations={
          [
            createEvaluation({
              id: 'evaluation-3',
              verdict: null,
              status: 'error',
              prompt_snapshot:
                'Forwarding requested: yes\nPlan: blocked\nPlan marker: {"version":1,"kind":"blocked","forwardingRequested":true,"blockedReason":"forwarding disabled"}',
              error_message: 'forwarding disabled',
            }),
          ]
        }
      />
    );

    expect(blockedHtml).toContain('Plan marker');
    expect(blockedHtml).toContain('Plan marker kind');
    expect(blockedHtml).toContain('Forwarding requested');
    expect(blockedHtml).toContain('Blocked diagnostics');
    expect(blockedHtml).toContain('forwarding disabled');
  });

  it('renders multiple visible rows for the same submission without adding a separate action column', () => {
    const firstEvaluation = createEvaluation();
    const secondEvaluation = createEvaluation({
      id: 'evaluation-2',
      question: {
        id: 'question-2',
        external_id: 'Q-002',
        question_text: 'A second visible question for the same submission.',
      },
    });
    const html = renderToStaticMarkup(
      <ResultsTable queueId={QUEUE_ID} evaluations={[firstEvaluation, secondEvaluation]} />
    );

    const href = `href="/queues/${QUEUE_ID}/submissions/${firstEvaluation.submission.id}?source=results"`;

    expect(html.split(href)).toHaveLength(3);
    expect(html).toContain('A second visible question for the same submission.');
    expect(html).toContain('Expand audit details');
    expect(html).not.toContain('Actions');
    expect(html).not.toContain('View');
  });

  it('renders an explicit empty state when filters match no evaluations without a table surface', () => {
    const html = renderToStaticMarkup(<ResultsTable queueId={QUEUE_ID} evaluations={[]} />);

    expect(html).toContain('No evaluations match the current filters.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
  });
});
