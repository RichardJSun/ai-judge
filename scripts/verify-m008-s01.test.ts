import { describe, expect, it } from 'bun:test';
import type { ResultsResponse } from '../src/types/api';
import { ResultsVerifierPhaseError as S03ResultsVerifierPhaseError } from './verify-s03-live';
import {
  assertResultsApiTarget,
  formatProofTargets,
  formatSetupSummary,
  normalizeUpstreamError,
  normalizeUpstreamSummary,
  parseVerifierOptions,
  resolveProofTargets,
  runPhase,
  selectFilteredProofState,
  type LiveVerificationSummary,
  VerifierPhaseError,
} from './verify-m008-s01';

function createEvaluation(overrides: Partial<ResultsResponse['evaluations'][number]> = {}): ResultsResponse['evaluations'][number] {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: 'Looks correct.',
    prompt_snapshot: null,
    model_used: 'openai/gpt-4o-mini',
    tokens_used: 123,
    latency_ms: 456,
    retry_count: 0,
    error_message: null,
    created_at: '2026-03-29T01:00:00.000Z',
    status: 'completed',
    submission: {
      id: 'submission-1',
      external_id: 'submission-external-1',
    },
    question: {
      id: 'question-1',
      external_id: 'question-external-1',
      question_text: 'Question one?',
    },
    judge: {
      id: 'judge-valid-1',
      name: 'Verifier Valid',
      model: 'openai/gpt-4o-mini',
    },
    ...overrides,
  };
}

function createResultsResponse(overrides: Partial<ResultsResponse> = {}): ResultsResponse {
  const completedPassQ1 = createEvaluation();
  const completedPassQ2 = createEvaluation({
    id: 'evaluation-2',
    submission: {
      id: 'submission-2',
      external_id: 'submission-external-2',
    },
    question: {
      id: 'question-2',
      external_id: 'question-external-2',
      question_text: 'Question two?',
    },
  });
  const erroredInvalid = createEvaluation({
    id: 'evaluation-3',
    status: 'error',
    verdict: null,
    reasoning: null,
    tokens_used: null,
    error_message: 'Model lookup failed',
    judge: {
      id: 'judge-invalid-1',
      name: 'Verifier Invalid',
      model: 'openai/not-a-real-model-s03-live',
    },
  });

  return {
    evaluations: [completedPassQ1, completedPassQ2, erroredInvalid],
    total: 3,
    passRate: 100,
    judgePassRates: [
      {
        judgeId: 'judge-valid-1',
        name: 'Verifier Valid',
        passRate: 100,
        total: 2,
      },
    ],
    page: 1,
    pageSize: 25,
    filterMetadata: {
      judges: [
        { id: 'judge-invalid-1', name: 'Verifier Invalid', model: 'openai/not-a-real-model-s03-live' },
        { id: 'judge-valid-1', name: 'Verifier Valid', model: 'openai/gpt-4o-mini' },
      ],
      questions: [
        { id: 'question-1', external_id: 'question-external-1', question_text: 'Question one?' },
        { id: 'question-2', external_id: 'question-external-2', question_text: 'Question two?' },
      ],
      verdicts: ['pass'],
    },
    ...overrides,
  };
}

function createSummary(overrides: Partial<LiveVerificationSummary['upstreamSummary']> = {}): LiveVerificationSummary['upstreamSummary'] {
  return {
    queueId: 'queue-uuid-1',
    queueLabel: 'queue-proof',
    runId: 'run-uuid-1',
    runStatus: 'completed',
    previewTotal: 3,
    startedTotal: 3,
    verifierJudgeIds: {
      valid: 'judge-valid-1',
      invalid: 'judge-invalid-1',
    },
    verifierJudgeNames: {
      valid: 'S03 Live Results Valid [queue-proof] [20260329010000000]',
      invalid: 'S03 Live Results Invalid [queue-proof] [20260329010000000]',
    },
    questionIds: ['question-1', 'question-2'],
    resultsProof: {
      currentTotal: 3,
      currentCompleted: 2,
      currentErrored: 1,
      verdictFilter: 'pass',
    },
    pageUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
    ...overrides,
  };
}

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createTextResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function createFetchMock(responses: Record<string, Response | (() => Response)>) {
  return (async (input: RequestInfo | URL) => {
    const key = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const matched = responses[key];
    if (!matched) {
      throw new Error(`Unexpected fetch: ${key}`);
    }

    return typeof matched === 'function' ? matched() : matched;
  }) as typeof fetch;
}

describe('parseVerifierOptions', () => {
  it('requires --base-url when no environment fallback is present', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });

  it('rejects malformed base URLs before emitting proof targets', () => {
    expect(() => parseVerifierOptions(['--base-url', 'localhost:3000'], {} as NodeJS.ProcessEnv)).toThrow(
      '--base-url must be a valid http:// or https:// URL.'
    );
  });

  it('parses fixture, timeout, and poll settings from CLI args', () => {
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
  it('wraps failures with the phase name and deep-link context', async () => {
    await expect(
      runPhase(
        'filtered-results-target',
        {
          endpoint: '/api/queues/queue-1/results',
          filter: 'page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
          queueId: 'queue-1',
          questionId: 'question-1',
        },
        async () => {
          throw new Error('Filtered results metadata omitted selected question question-1.');
        }
      )
    ).rejects.toThrow(
      '[verify:m008-s01] phase=filtered-results-target endpoint=/api/queues/queue-1/results filter=page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass queueId=queue-1 questionId=question-1 Filtered results metadata omitted selected question question-1.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('clamped-results-page', 'Page returned 500.', {
      page: '/queues/queue-1/results?page=999999',
      url: 'http://localhost:3000/queues/queue-1/results?page=999999',
    });

    await expect(
      runPhase('clamped-results-page', { page: '/queues/queue-1/results?page=999999' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('normalizeUpstreamSummary', () => {
  it('rejects summaries that omit required proof-target fields', () => {
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...createSummary(),
          resultsProof: undefined,
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary is missing resultsProof.verdictFilter.');
  });

  it('rejects upstream page URLs that point at a different host', () => {
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...createSummary(),
          pageUrl: 'http://evil.example/queues/queue-uuid-1/results',
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary pageUrl must resolve under http://localhost:3000.');
  });
});

describe('selectFilteredProofState', () => {
  it('selects a deterministic completed row for the valid judge and verifier verdict', () => {
    expect(selectFilteredProofState(createResultsResponse(), 'judge-valid-1', 'pass')).toEqual({
      judgeId: 'judge-valid-1',
      questionId: 'question-1',
      verdict: 'pass',
      total: 1,
    });
  });

  it('rejects when the current verifier rows do not include a matching completed verdict row', () => {
    expect(() =>
      selectFilteredProofState(
        createResultsResponse({
          evaluations: [
            createEvaluation({
              status: 'error',
              verdict: null,
              reasoning: null,
              tokens_used: null,
              error_message: 'Model lookup failed',
            }),
          ],
          total: 1,
          passRate: 0,
          judgePassRates: [],
        }),
        'judge-valid-1',
        'pass'
      )
    ).toThrow('Current verifier results did not include a completed pass row for judge judge-valid-1.');
  });
});

describe('resolveProofTargets', () => {
  it('emits stable results, filteredResults, clampedResults, and resultsApi targets from live-summary context', async () => {
    const summary = createSummary();
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1':
        createJsonResponse(createResultsResponse()),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createJsonResponse(
          createResultsResponse({
            evaluations: [createEvaluation()],
            total: 1,
            judgePassRates: [
              {
                judgeId: 'judge-valid-1',
                name: 'Verifier Valid',
                passRate: 100,
                total: 1,
              },
            ],
          })
        ),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=999999': createJsonResponse(
        createResultsResponse({
          page: 24,
          total: 600,
          pageSize: 25,
          evaluations: [createEvaluation({ id: 'evaluation-last-page' })],
          judgePassRates: [
            {
              judgeId: 'judge-valid-1',
              name: 'Verifier Valid',
              passRate: 100,
              total: 1,
            },
          ],
        })
      ),
      'http://localhost:3000/queues/queue-uuid-1/results': createTextResponse('<main><h1>Results</h1></main>'),
      'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createTextResponse('<main><h1>Results</h1></main>'),
      'http://localhost:3000/queues/queue-uuid-1/results?page=999999': createTextResponse('<main><h1>Results</h1></main>'),
    });

    await expect(
      resolveProofTargets({
        summary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).resolves.toEqual({
      filteredProof: {
        judgeId: 'judge-valid-1',
        questionId: 'question-1',
        verdict: 'pass',
        total: 1,
      },
      clampedProof: {
        requestedPage: 999999,
        canonicalPage: 24,
        total: 600,
      },
      proofTargets: {
        results: 'http://localhost:3000/queues/queue-uuid-1/results',
        filteredResults:
          'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        clampedResults: 'http://localhost:3000/queues/queue-uuid-1/results?page=999999',
        resultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
      },
    });
  });

  it('rejects filtered results that omit the selected filter metadata', async () => {
    const summary = createSummary();
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1':
        createJsonResponse(createResultsResponse()),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createJsonResponse(
          createResultsResponse({
            evaluations: [createEvaluation()],
            total: 1,
            filterMetadata: {
              judges: [{ id: 'judge-valid-1', name: 'Verifier Valid', model: 'openai/gpt-4o-mini' }],
              questions: [{ id: 'question-2', external_id: 'question-external-2', question_text: 'Question two?' }],
              verdicts: ['pass'],
            },
            judgePassRates: [
              {
                judgeId: 'judge-valid-1',
                name: 'Verifier Valid',
                passRate: 100,
                total: 1,
              },
            ],
          })
        ),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=999999': createJsonResponse(
        createResultsResponse({
          page: 24,
          total: 600,
          pageSize: 25,
          evaluations: [createEvaluation({ id: 'evaluation-last-page' })],
          judgePassRates: [
            {
              judgeId: 'judge-valid-1',
              name: 'Verifier Valid',
              passRate: 100,
              total: 1,
            },
          ],
        })
      ),
      'http://localhost:3000/queues/queue-uuid-1/results': createTextResponse('<main><h1>Results</h1></main>'),
      'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createTextResponse('<main><h1>Results</h1></main>'),
      'http://localhost:3000/queues/queue-uuid-1/results?page=999999': createTextResponse('<main><h1>Results</h1></main>'),
    });

    await expect(
      resolveProofTargets({
        summary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow('Filtered results metadata omitted selected question question-1.');
  });

  it('rejects clamped results that never rewrite to the truthful last page', async () => {
    const summary = createSummary();
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1':
        createJsonResponse(createResultsResponse()),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createJsonResponse(
          createResultsResponse({
            evaluations: [createEvaluation()],
            total: 1,
            judgePassRates: [
              {
                judgeId: 'judge-valid-1',
                name: 'Verifier Valid',
                passRate: 100,
                total: 1,
              },
            ],
          })
        ),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=999999': createJsonResponse(
        createResultsResponse({
          page: 12,
          total: 600,
          pageSize: 25,
          evaluations: [createEvaluation({ id: 'evaluation-last-page' })],
          judgePassRates: [
            {
              judgeId: 'judge-valid-1',
              name: 'Verifier Valid',
              passRate: 100,
              total: 1,
            },
          ],
        })
      ),
    });

    await expect(
      resolveProofTargets({
        summary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow('Clamped results API returned page 12 instead of the truthful last page 24.');
  });
});

describe('proof target formatting', () => {
  it('formats the emitted proof targets and summary in a stable order', () => {
    const summary: LiveVerificationSummary = {
      queueId: 'queue-uuid-1',
      queueLabel: 'queue-proof',
      runId: 'run-uuid-1',
      verifierJudgeIds: {
        valid: 'judge-valid-1',
        invalid: 'judge-invalid-1',
      },
      filteredProof: {
        judgeId: 'judge-valid-1',
        questionId: 'question-1',
        verdict: 'pass',
        total: 1,
      },
      clampedProof: {
        requestedPage: 999999,
        canonicalPage: 24,
        total: 600,
      },
      proofTargets: {
        results: 'http://localhost:3000/queues/queue-uuid-1/results',
        filteredResults:
          'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        clampedResults: 'http://localhost:3000/queues/queue-uuid-1/results?page=999999',
        resultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
      },
      upstreamSummary: createSummary(),
    };

    expect(
      formatProofTargets(summary.proofTargets)
    ).toBe(
      'results=http://localhost:3000/queues/queue-uuid-1/results filteredResults=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass clampedResults=http://localhost:3000/queues/queue-uuid-1/results?page=999999 resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1'
    );

    expect(formatSetupSummary(summary)).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof run=run-uuid-1 validJudge=judge-valid-1 invalidJudge=judge-invalid-1 filteredJudge=judge-valid-1 filteredQuestion=question-1 filteredVerdict=pass clampedPage=24 results=http://localhost:3000/queues/queue-uuid-1/results filteredResults=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass clampedResults=http://localhost:3000/queues/queue-uuid-1/results?page=999999 resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1'
    );
  });

  it('rejects a results API target that is not scoped to both verifier judges', () => {
    expect(() =>
      assertResultsApiTarget(
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1',
        'judge-valid-1',
        'judge-invalid-1'
      )
    ).toThrow('Verification summary results API target must include both verifier judge ids.');
  });
});

describe('normalizeUpstreamError', () => {
  it('rewraps upstream phase errors under the slice verifier prefix without dropping refs', () => {
    expect(() =>
      normalizeUpstreamError(
        new S03ResultsVerifierPhaseError('results-assertions', 'Results response was malformed.', {
          queueId: 'queue-1',
          queueLabel: 'queue-proof',
          runId: 'run-1',
          validJudgeId: 'judge-valid-1',
          invalidJudgeId: 'judge-invalid-1',
        })
      )
    ).toThrow(
      '[verify:m008-s01] phase=results-assertions queueId=queue-1 queueLabel=queue-proof runId=run-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 Results response was malformed.'
    );
  });
});
