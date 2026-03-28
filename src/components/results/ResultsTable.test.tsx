import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResultsEvaluation } from '@/types/api';
import ResultsTable, { formatCreatedAt, summarizeReasoning } from './ResultsTable';

const LONG_REASONING = [
  'The judge cites the submission, compares it against the rubric,',
  'notes one unsupported claim, and explains why the final verdict',
  'still passes because the primary requirement was satisfied with evidence.',
].join(' ');

function createEvaluation(overrides: Partial<ResultsEvaluation> = {}): ResultsEvaluation {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: LONG_REASONING,
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
  it('renders the reviewer-visible primary contract fields in the main table', () => {
    const evaluation = createEvaluation();
    const html = renderToStaticMarkup(<ResultsTable evaluations={[evaluation]} />);

    expect(html).toContain('Submission');
    expect(html).toContain('Question');
    expect(html).toContain('Judge');
    expect(html).toContain('Verdict');
    expect(html).toContain('Reasoning');
    expect(html).toContain('Created');

    expect(html).toContain(evaluation.submission.external_id);
    expect(html).toContain(evaluation.question.external_id);
    expect(html).toContain(evaluation.question.question_text);
    expect(html).toContain(evaluation.judge.name);
    expect(html).toContain('Pass');
    expect(html).toContain(summarizeReasoning(evaluation.reasoning));
    expect(html).toContain(formatCreatedAt(evaluation.created_at));
  });

  it('keeps errored rows with missing optional audit fields renderable in the primary hierarchy', () => {
    const html = renderToStaticMarkup(
      <ResultsTable
        evaluations={[
          createEvaluation({
            id: 'evaluation-2',
            verdict: null,
            reasoning: null,
            model_used: null,
            tokens_used: null,
            latency_ms: null,
            retry_count: 2,
            error_message: 'Gateway timed out after retries.',
            status: 'error',
          }),
        ]}
      />
    );

    expect(html).toContain('SUB-001');
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Error');
    expect(html).toContain('—');
  });

  it('renders an explicit empty state when filters match no evaluations', () => {
    const html = renderToStaticMarkup(<ResultsTable evaluations={[]} />);

    expect(html).toContain('No evaluations match the current filters.');
    expect(html).not.toContain('<table');
  });
});
