import { describe, expect, it } from 'bun:test';
import {
  applyResultsFilters,
  createResultsResponse,
  normalizeResultsFilters,
  ResultsResponseError,
} from './results-response';

function createEvaluationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: 'Looks good.',
    prompt_snapshot: null,
    model_used: 'gateway/model-a',
    tokens_used: 321,
    latency_ms: 875,
    retry_count: 1,
    error_message: null,
    created_at: '2026-03-28T12:00:00.000Z',
    status: 'completed',
    submissions: [{ id: 'submission-1', external_id: 'SUB-001' }],
    question_templates: [{ id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' }],
    judges: [{ id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' }],
    ...overrides,
  };
}

function createAggregateRow(overrides: Record<string, unknown> = {}) {
  return {
    judge_id: 'judge-1',
    verdict: 'pass',
    status: 'completed',
    judges: [{ id: 'judge-1', name: 'Judge Zeta' }],
    ...overrides,
  };
}

class QuerySpy {
  readonly calls: Array<{ column: string; values: string[] }> = [];

  in(column: string, values: readonly string[]) {
    this.calls.push({ column, values: [...values] });
    return this;
  }
}

describe('normalizeResultsFilters', () => {
  it('dedupes filter params, rejects invalid verdicts, and normalizes malformed page values', () => {
    const params = new URLSearchParams([
      ['judgeId', 'judge-1'],
      ['judgeId', 'judge-1'],
      ['questionId', 'question-1'],
      ['verdict', 'pass'],
      ['page', '0'],
    ]);

    expect(normalizeResultsFilters(params)).toEqual({
      judgeIds: ['judge-1'],
      questionIds: ['question-1'],
      verdicts: ['pass'],
      page: 1,
      pageSize: 25,
      from: 0,
    });

    expect(() => normalizeResultsFilters(new URLSearchParams([['verdict', 'maybe']])))
      .toThrowError(ResultsResponseError);

    try {
      normalizeResultsFilters(new URLSearchParams([['verdict', 'maybe']]));
      throw new Error('Expected invalid verdict filter to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(ResultsResponseError);
      expect((error as ResultsResponseError).status).toBe(400);
      expect((error as ResultsResponseError).publicMessage).toBe('Invalid verdict filter.');
    }
  });
});

describe('applyResultsFilters', () => {
  it('keeps list and aggregate queries on the same judge/question/verdict filter contract', () => {
    const query = new QuerySpy();

    const next = applyResultsFilters(query, {
      judgeIds: ['judge-1'],
      questionIds: ['question-1'],
      verdicts: ['fail'],
    });

    expect(next).toBe(query);
    expect(query.calls).toEqual([
      { column: 'judge_id', values: ['judge-1'] },
      { column: 'question_template_id', values: ['question-1'] },
      { column: 'verdict', values: ['fail'] },
    ]);
  });

  it('treats empty filter arrays as a no-op instead of widening with bogus clauses', () => {
    const query = new QuerySpy();

    applyResultsFilters(query, {
      judgeIds: [],
      questionIds: [],
      verdicts: [],
    });

    expect(query.calls).toEqual([]);
  });
});

describe('createResultsResponse', () => {
  it('maps joined Supabase rows to the stable singular contract and computes filtered aggregates from completed rows', () => {
    const response = createResultsResponse({
      evaluationRows: [
        createEvaluationRow(),
        createEvaluationRow({
          id: 'evaluation-2',
          verdict: 'fail',
          reasoning: 'Missing required evidence.',
          retry_count: 0,
          submissions: [{ id: 'submission-2', external_id: 'SUB-002' }],
        }),
      ],
      aggregateRows: [
        createAggregateRow({
          judge_id: 'judge-2',
          judges: [{ id: 'judge-2', name: 'Judge Alpha' }],
        }),
        createAggregateRow({ verdict: 'fail' }),
        createAggregateRow(),
        createAggregateRow({ verdict: null, status: 'error' }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    expect(response).toEqual({
      evaluations: [
        {
          id: 'evaluation-1',
          verdict: 'pass',
          reasoning: 'Looks good.',
          prompt_snapshot: null,
          model_used: 'gateway/model-a',
          tokens_used: 321,
          latency_ms: 875,
          retry_count: 1,
          error_message: null,
          created_at: '2026-03-28T12:00:00.000Z',
          status: 'completed',
          submission: { id: 'submission-1', external_id: 'SUB-001' },
          question: { id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' },
          judge: { id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' },
        },
        {
          id: 'evaluation-2',
          verdict: 'fail',
          reasoning: 'Missing required evidence.',
          prompt_snapshot: null,
          model_used: 'gateway/model-a',
          tokens_used: 321,
          latency_ms: 875,
          retry_count: 0,
          error_message: null,
          created_at: '2026-03-28T12:00:00.000Z',
          status: 'completed',
          submission: { id: 'submission-2', external_id: 'SUB-002' },
          question: { id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' },
          judge: { id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' },
        },
      ],
      total: 2,
      passRate: 67,
      judgePassRates: [
        { judgeId: 'judge-2', name: 'Judge Alpha', passRate: 100, total: 1 },
        { judgeId: 'judge-1', name: 'Judge Zeta', passRate: 50, total: 2 },
      ],
      page: 1,
      pageSize: 25,
    });

    expect('submissions' in response.evaluations[0]).toBe(false);
    expect('question_templates' in response.evaluations[0]).toBe(false);
    expect('judges' in response.evaluations[0]).toBe(false);
  });

  it('returns zeroed aggregates for empty result sets and filtered subsets with only errored rows', () => {
    expect(
      createResultsResponse({
        evaluationRows: [],
        aggregateRows: [],
        total: 0,
        page: 1,
        pageSize: 25,
      })
    ).toEqual({
      evaluations: [],
      total: 0,
      passRate: 0,
      judgePassRates: [],
      page: 1,
      pageSize: 25,
    });

    expect(
      createResultsResponse({
        evaluationRows: [createEvaluationRow({ status: 'error', verdict: null, reasoning: null })],
        aggregateRows: [createAggregateRow({ status: 'error', verdict: null })],
        total: 1,
        page: 1,
        pageSize: 25,
      })
    ).toMatchObject({
      total: 1,
      passRate: 0,
      judgePassRates: [],
    });
  });

  it('rejects malformed joined relation data before the UI can consume mismatched fields', () => {
    try {
      createResultsResponse({
        evaluationRows: [createEvaluationRow({ judges: null })],
        aggregateRows: [],
        total: 1,
        page: 1,
        pageSize: 25,
      });
      throw new Error('Expected malformed judge relation to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(ResultsResponseError);
      expect((error as ResultsResponseError).publicMessage).toBe('Malformed judge returned from storage.');
    }
  });
});
