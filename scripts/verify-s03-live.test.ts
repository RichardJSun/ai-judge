import { describe, expect, it } from 'bun:test';
import type { ResultsEvaluation, ResultsResponse } from '../src/types/api';
import {
  assertFilteredResultsResponse,
  parseVerifierOptions,
  ResultsVerifierPhaseError,
  runPhase,
} from './verify-s03-live';

function createEvaluation(overrides: Partial<ResultsEvaluation> = {}): ResultsEvaluation {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: 'Grounded in the provided evidence.',
    prompt_snapshot: null,
    model_used: 'openai/gpt-4o-mini',
    tokens_used: 101,
    latency_ms: 250,
    retry_count: 0,
    error_message: null,
    created_at: '2026-03-28T00:00:00.000Z',
    status: 'completed',
    submission: {
      id: 'submission-1',
      external_id: 'sub-1',
    },
    question: {
      id: 'question-1',
      external_id: 'q-1',
      question_text: 'Does the answer cite evidence?',
    },
    judge: {
      id: 'judge-valid',
      name: 'Verifier Valid',
      model: 'openai/gpt-4o-mini',
    },
    ...overrides,
  };
}

function createResponse(overrides: Partial<ResultsResponse> = {}): ResultsResponse {
  const evaluations = [createEvaluation()];

  return {
    evaluations,
    total: evaluations.length,
    passRate: 100,
    judgePassRates: [
      {
        judgeId: 'judge-valid',
        name: 'Verifier Valid',
        passRate: 100,
        total: 1,
      },
    ],
    page: 1,
    pageSize: 25,
    filterMetadata: {
      judges: [
        { id: 'judge-valid', name: 'Verifier Valid', model: 'openai/gpt-4o-mini' },
      ],
      questions: [
        { id: 'question-1', external_id: 'q-1', question_text: 'Does the answer cite evidence?' },
      ],
      verdicts: ['pass'],
    },
    ...overrides,
  };
}

describe('parseVerifierOptions', () => {
  it('requires --base-url when no environment fallback is present', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });

  it('parses timeout and poll settings from CLI args', () => {
    expect(
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000/',
        '--fixture',
        'scripts/custom.fixture.json',
        '--timeout-ms',
        '9000',
        '--poll-ms',
        '750',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/custom.fixture.json',
      timeoutMs: 9000,
      pollMs: 750,
    });
  });
});

describe('runPhase', () => {
  it('wraps failures with the phase name and safe identifiers', async () => {
    await expect(
      runPhase(
        'results-assertions',
        { queueId: 'queue-1', runId: 'run-1', filter: 'judgeId=judge-valid' },
        async () => {
          throw new Error('Filter payload was malformed.');
        }
      )
    ).rejects.toThrow(
      '[verify:s03-live] phase=results-assertions queueId=queue-1 runId=run-1 filter=judgeId=judge-valid Filter payload was malformed.'
    );
  });

  it('preserves existing ResultsVerifierPhaseError instances', async () => {
    const failure = new ResultsVerifierPhaseError('page-confirmation', 'Results page was missing the heading.', {
      page: '/queues/queue-1/results',
    });

    await expect(
      runPhase('page-confirmation', { page: '/queues/queue-1/results' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('assertFilteredResultsResponse', () => {
  it('accepts truthful filtered rows and aggregate statistics', () => {
    const completedPass = createEvaluation({ id: 'evaluation-pass' });
    const errored = createEvaluation({
      id: 'evaluation-error',
      status: 'error',
      verdict: null,
      reasoning: null,
      tokens_used: null,
      error_message: 'Model lookup failed',
      judge: {
        id: 'judge-invalid',
        name: 'Verifier Invalid',
        model: 'openai/not-a-real-model-s03-live',
      },
    });

    const response = createResponse({
      evaluations: [completedPass, errored],
      total: 2,
      passRate: 100,
      judgePassRates: [
        {
          judgeId: 'judge-valid',
          name: 'Verifier Valid',
          passRate: 100,
          total: 1,
        },
      ],
    });

    expect(() =>
      assertFilteredResultsResponse({
        label: 'judge filter',
        response,
        expectedRows: [completedPass, errored],
        expectedJudgeIds: ['judge-valid', 'judge-invalid'],
      })
    ).not.toThrow();
  });

  it('fails when passRate drifts from the filtered completed rows', () => {
    const completedFail = createEvaluation({
      id: 'evaluation-fail',
      verdict: 'fail',
    });

    expect(() =>
      assertFilteredResultsResponse({
        label: 'verdict filter',
        response: createResponse({
          evaluations: [completedFail],
          total: 1,
          passRate: 100,
          judgePassRates: [
            {
              judgeId: 'judge-valid',
              name: 'Verifier Valid',
              passRate: 100,
              total: 1,
            },
          ],
        }),
        expectedRows: [completedFail],
        expectedJudgeIds: ['judge-valid'],
        expectedVerdicts: ['fail'],
      })
    ).toThrow('verdict filter passRate 100 did not match 0.');
  });

  it('fails when the response includes a row outside the requested question filter', () => {
    const expectedRow = createEvaluation({ id: 'evaluation-q1', question: { id: 'question-1', external_id: 'q-1', question_text: 'Q1' } });
    const unexpectedRow = createEvaluation({
      id: 'evaluation-q2',
      question: { id: 'question-2', external_id: 'q-2', question_text: 'Q2' },
    });

    expect(() =>
      assertFilteredResultsResponse({
        label: 'question filter',
        response: createResponse({
          evaluations: [expectedRow, unexpectedRow],
          total: 2,
          passRate: 100,
          judgePassRates: [
            {
              judgeId: 'judge-valid',
              name: 'Verifier Valid',
              passRate: 100,
              total: 2,
            },
          ],
        }),
        expectedRows: [expectedRow, unexpectedRow],
        expectedJudgeIds: ['judge-valid'],
        expectedQuestionIds: ['question-1'],
      })
    ).toThrow('question filter included evaluation evaluation-q2 for question question-2.');
  });
});
