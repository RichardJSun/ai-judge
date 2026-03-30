import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { REVIEWER_TIMESTAMP_SOURCE } from '@/lib/reviewer/reviewer-timestamp';
import { REVIEWER_TABLE_SURFACE_TEST_ID } from '@/components/layout/ReviewerTableSurface';
import type { ResultsPageUrlState } from '@/lib/results/results-page-url';
import type { ResultsEvaluation } from '@/types/api';
import ResultsTable, { summarizeReasoning } from './ResultsTable';

const QUEUE_ID = 'queue-1';
const LONG_REASONING = [
  'The judge cites the submission, compares it against the rubric,',
  'notes one unsupported claim, and explains why the final verdict',
  'still passes because the primary requirement was satisfied with evidence.',
].join(' ');

const DEFAULT_PROMPT_SNAPSHOT =
  'Prompt snapshot content describing stored attachments and forwarding.\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}';

const FILTERED_RESULTS_CONTEXT: ResultsPageUrlState = {
  page: 4,
  selectedJudges: ['judge-1'],
  selectedQuestions: ['question-1'],
  selectedVerdicts: ['pass'],
};

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
  it('renders the shared reviewer overflow surface around reviewer-visible result fields, keeps the submission link intentional, and exposes row-level audit toggles instead of per-cell hit areas', () => {
    const evaluation = createEvaluation();
    const html = renderToStaticMarkup(
      <ResultsTable
        queueId={QUEUE_ID}
        evaluations={[evaluation]}
        resultsContext={FILTERED_RESULTS_CONTEXT}
      />
    );

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
      `href="/queues/${QUEUE_ID}/submissions/${evaluation.submission.id}?source=results&amp;page=4&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"`
    );
    expect(html).toContain(`aria-label="Open submission ${evaluation.submission.external_id} from results"`);
    expect(html).toContain('data-audit-toggle="row"');
    expect(html).toContain(
      `aria-label="Expand audit details for submission ${evaluation.submission.external_id} from the row"`
    );
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-audit-toggle="icon"');
    expect(html).toContain(
      `aria-label="Expand audit details for submission ${evaluation.submission.external_id}"`
    );
    expect(html).not.toContain('data-audit-toggle="hit-area"');
    expect(html).toContain('aria-controls="results-audit-details-evaluation-1"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(evaluation.question.external_id);
    expect(html).toContain(evaluation.question.question_text);
    expect(html).toContain(evaluation.judge.name);
    expect(html).toContain('Pass');
    expect(html).toContain(summarizeReasoning(evaluation.reasoning));
    expect(html).toContain(`data-reviewer-timestamp-source="${REVIEWER_TIMESTAMP_SOURCE}"`);
    expect(html).toContain('data-reviewer-timestamp-state="fallback"');
    expect(html).toContain(`>${evaluation.created_at}</time>`);
    expect(html).toContain('Evaluation status');
    expect(html).toContain('completed');
    expect(html).toContain('Prompt snapshot');
    expect(html).toContain('Prompt snapshot content describing stored attachments and forwarding.');
    expect(html).toContain('Plan marker');
    expect(html).toContain('Plan marker kind');
    expect(html).toContain('Forwarding requested');
  });

  it('falls back to the canonical results root context for long-id error rows with missing optional audit fields instead of dropping the detail link', () => {
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
            created_at: 'not-a-real-timestamp',
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
    expect(html).toContain(
      `href="/queues/${QUEUE_ID}/submissions/submission-2?source=results&amp;page=1"`
    );
    expect(html).toContain(`aria-label="Open submission ${longExternalId} from results"`);
    expect(html).toContain(
      `aria-label="Expand audit details for submission ${longExternalId} from the row"`
    );
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Error');
    expect(html).toContain('not-a-real-timestamp');
    expect(html).toContain('data-reviewer-timestamp-state="invalid"');
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
        evaluations={[
          createEvaluation({
            id: 'evaluation-3',
            verdict: null,
            status: 'error',
            prompt_snapshot:
              'Forwarding requested: yes\nPlan: blocked\nPlan marker: {"version":1,"kind":"blocked","forwardingRequested":true,"blockedReason":"forwarding disabled"}',
            error_message: 'forwarding disabled',
          }),
        ]}
      />
    );

    expect(blockedHtml).toContain('Plan marker');
    expect(blockedHtml).toContain('Plan marker kind');
    expect(blockedHtml).toContain('Forwarding requested');
    expect(blockedHtml).toContain('Blocked diagnostics');
    expect(blockedHtml).toContain('forwarding disabled');
  });

  it('renders multiple visible rows for the same submission without adding a separate action column and preserves the contextual detail href on each row', () => {
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
      <ResultsTable
        queueId={QUEUE_ID}
        evaluations={[firstEvaluation, secondEvaluation]}
        resultsContext={FILTERED_RESULTS_CONTEXT}
      />
    );

    const href =
      `href="/queues/${QUEUE_ID}/submissions/${firstEvaluation.submission.id}` +
      '?source=results&amp;page=4&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"';

    expect(html.split(href)).toHaveLength(3);
    expect(html.split('data-audit-toggle="row"')).toHaveLength(3);
    expect(html.split('data-audit-toggle="icon"')).toHaveLength(3);
    expect(html).not.toContain('data-audit-toggle="hit-area"');
    expect(html).toContain('A second visible question for the same submission.');
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
