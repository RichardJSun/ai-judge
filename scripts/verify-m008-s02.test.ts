import { describe, expect, it } from 'bun:test';
import type { ResultsResponse } from '../src/types/api';
import { VerifierPhaseError as S01VerifierPhaseError, type LiveVerificationSummary as S01LiveVerificationSummary } from './verify-m008-s01';
import {
  buildProofTargets,
  formatProofSubmission,
  formatProofTargets,
  formatSetupSummary,
  normalizeUpstreamError,
  normalizeUpstreamSummary,
  parseVerifierOptions,
  resolveProofTargets,
  runPhase,
  type ContextualFilteredProofState,
  type LiveVerificationSummary,
  VerifierPhaseError,
} from './verify-m008-s02';

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
    created_at: '2026-03-30T01:00:00.000Z',
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
  return {
    evaluations: [
      createEvaluation({
        id: 'evaluation-a-2',
        submission: { id: 'submission-a', external_id: 'submission-a' },
      }),
      createEvaluation({
        id: 'evaluation-a-1',
        submission: { id: 'submission-a', external_id: 'submission-a' },
      }),
      createEvaluation({
        id: 'evaluation-b-1',
        submission: { id: 'submission-b', external_id: 'submission-b' },
      }),
    ],
    total: 3,
    passRate: 100,
    judgePassRates: [
      {
        judgeId: 'judge-valid-1',
        name: 'Verifier Valid',
        passRate: 100,
        total: 3,
      },
    ],
    page: 1,
    pageSize: 25,
    filterMetadata: {
      judges: [{ id: 'judge-valid-1', name: 'Verifier Valid', model: 'openai/gpt-4o-mini' }],
      questions: [
        { id: 'question-1', external_id: 'question-external-1', question_text: 'Question one?' },
      ],
      verdicts: ['pass'],
    },
    ...overrides,
  };
}

function createFilteredProof(overrides: Partial<ContextualFilteredProofState> = {}): ContextualFilteredProofState {
  return {
    page: 1,
    judgeId: 'judge-valid-1',
    questionId: 'question-1',
    verdict: 'pass',
    total: 3,
    ...overrides,
  };
}

function createUpstreamSummary(overrides: Partial<S01LiveVerificationSummary> = {}): S01LiveVerificationSummary {
  return {
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
      total: 3,
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
    upstreamSummary: {
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
        valid: 'S03 Live Results Valid [queue-proof] [20260330010000000]',
        invalid: 'S03 Live Results Invalid [queue-proof] [20260330010000000]',
      },
      questionIds: ['question-1', 'question-2'],
      resultsProof: {
        currentTotal: 3,
        currentCompleted: 3,
        currentErrored: 0,
        verdictFilter: 'pass',
      },
      pageUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
    },
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
  it('wraps failures with the phase name and selected filter plus submission context', async () => {
    await expect(
      runPhase(
        'detail-page',
        {
          page: '/queues/queue-1/submissions/submission-1',
          url: 'http://localhost:3000/queues/queue-1/submissions/submission-1?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
          queueId: 'queue-1',
          submissionId: 'submission-1',
          questionId: 'question-1',
        },
        async () => {
          throw new Error('Page returned 500.');
        }
      )
    ).rejects.toThrow(
      '[verify:m008-s02] phase=detail-page page=/queues/queue-1/submissions/submission-1 url=http://localhost:3000/queues/queue-1/submissions/submission-1?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass queueId=queue-1 submissionId=submission-1 questionId=question-1 Page returned 500.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('proof-target-selection', 'Filtered current-proof results did not include any evaluations.', {
      queueId: 'queue-1',
      questionId: 'question-1',
    });

    await expect(
      runPhase('proof-target-selection', { queueId: 'queue-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('normalizeUpstreamSummary', () => {
  it('rejects summaries that omit the filtered results proof target', () => {
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...createUpstreamSummary(),
          proofTargets: {
            ...createUpstreamSummary().proofTargets,
            filteredResults: undefined,
          },
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary is missing proofTargets.filteredResults.');
  });

  it('rejects upstream filtered results URLs that point at a different host', () => {
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...createUpstreamSummary(),
          proofTargets: {
            ...createUpstreamSummary().proofTargets,
            filteredResults:
              'http://evil.example/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
          },
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary proofTargets.filteredResults must resolve under http://localhost:3000.');
  });

  it('rejects filtered results targets that omit contextual filter params', () => {
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...createUpstreamSummary(),
          proofTargets: {
            ...createUpstreamSummary().proofTargets,
            filteredResults:
              'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1',
          },
        },
        'http://localhost:3000'
      )
    ).toThrow(
      'Verification summary proofTargets.filteredResults must preserve the selected page, judge, question, and verdict context.'
    );
  });
});

describe('resolveProofTargets', () => {
  it('derives a deterministic proof submission and emits contextual filteredResults/detailUrl targets', async () => {
    const summary = createUpstreamSummary();
    const filteredResultsApi = 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass';
    const fetchImpl = createFetchMock({
      [filteredResultsApi]: createJsonResponse(createResultsResponse()),
      'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createTextResponse('<main><h1>Results</h1></main>'),
      'http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createTextResponse('<main><h1>Submission detail</h1></main>'),
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
        page: 1,
        judgeId: 'judge-valid-1',
        questionId: 'question-1',
        verdict: 'pass',
        total: 3,
      },
      proofSubmission: {
        submissionId: 'submission-a',
        submissionExternalId: 'submission-a',
        evaluationIds: ['evaluation-a-1', 'evaluation-a-2'],
        rowCount: 2,
      },
      proofTargets: {
        filteredResults:
          'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        detailUrl:
          'http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        filteredResultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      },
    });
  });

  it('fails with a phase-labelled error when the filtered results page heading is stale', async () => {
    const summary = createUpstreamSummary();
    const filteredResultsApi = 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass';
    const fetchImpl = createFetchMock({
      [filteredResultsApi]: createJsonResponse(createResultsResponse()),
      'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createTextResponse('<main><h1>Queue only</h1></main>'),
    });

    await expect(
      resolveProofTargets({
        summary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow(
      '[verify:m008-s02] phase=filtered-results-page page=/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass url=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass queueId=queue-uuid-1 queueLabel=queue-proof runId=run-uuid-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 judgeId=judge-valid-1 questionId=question-1 verdict=pass Page HTML did not include expected heading "Results".'
    );
  });

  it('fails when the refetched filtered rowset no longer preserves the selected metadata', async () => {
    const summary = createUpstreamSummary();
    const filteredResultsApi = 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass';
    const fetchImpl = createFetchMock({
      [filteredResultsApi]: createJsonResponse(
        createResultsResponse({
          filterMetadata: {
            judges: [{ id: 'judge-valid-1', name: 'Verifier Valid', model: 'openai/gpt-4o-mini' }],
            questions: [{ id: 'question-2', external_id: 'question-external-2', question_text: 'Question two?' }],
            verdicts: ['pass'],
          },
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
    ).rejects.toThrow('Filtered results metadata omitted selected question question-1.');
  });
});

describe('proof target formatting', () => {
  it('builds and formats the emitted proof targets in a stable order', () => {
    const normalized = normalizeUpstreamSummary(createUpstreamSummary(), 'http://localhost:3000');
    const proofTargets = buildProofTargets(normalized, {
      submissionId: 'submission-a',
      submissionExternalId: 'submission-a',
      evaluationIds: ['evaluation-a-1', 'evaluation-a-2'],
      rowCount: 2,
    });

    expect(proofTargets).toEqual({
      filteredResults:
        'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      detailUrl:
        'http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      filteredResultsApi:
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
    });

    expect(formatProofTargets(proofTargets)).toBe(
      'filteredResults=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass filteredResultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass'
    );
  });

  it('formats the final summary with stable queue, filter, submission, and target identifiers', () => {
    const summary: LiveVerificationSummary = {
      queueId: 'queue-uuid-1',
      queueLabel: 'queue-proof',
      runId: 'run-uuid-1',
      verifierJudgeIds: {
        valid: 'judge-valid-1',
        invalid: 'judge-invalid-1',
      },
      filteredProof: createFilteredProof(),
      proofSubmission: {
        submissionId: 'submission-a',
        submissionExternalId: 'submission-a',
        evaluationIds: ['evaluation-a-1', 'evaluation-a-2'],
        rowCount: 2,
      },
      proofTargets: {
        filteredResults:
          'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        detailUrl:
          'http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        filteredResultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      },
      upstreamSummary: createUpstreamSummary(),
    };

    expect(
      formatProofSubmission(summary.proofSubmission)
    ).toBe(
      'submission=submission-a submissionExternalId=submission-a submissionRows=2 evaluationIds=evaluation-a-1,evaluation-a-2'
    );

    expect(formatSetupSummary(summary)).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof run=run-uuid-1 validJudge=judge-valid-1 invalidJudge=judge-invalid-1 filteredPage=1 filteredJudge=judge-valid-1 filteredQuestion=question-1 filteredVerdict=pass submission=submission-a submissionExternalId=submission-a submissionRows=2 evaluationIds=evaluation-a-1,evaluation-a-2 filteredResults=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass filteredResultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass'
    );
  });
});

describe('normalizeUpstreamError', () => {
  it('rewraps upstream phase errors under the slice verifier prefix without dropping refs', () => {
    expect(() =>
      normalizeUpstreamError(
        new S01VerifierPhaseError('filtered-results-target', 'Filtered results response was malformed.', {
          queueId: 'queue-1',
          queueLabel: 'queue-proof',
          runId: 'run-1',
          validJudgeId: 'judge-valid-1',
          invalidJudgeId: 'judge-invalid-1',
          judgeId: 'judge-valid-1',
          questionId: 'question-1',
          verdict: 'pass',
        })
      )
    ).toThrow(
      '[verify:m008-s02] phase=filtered-results-target queueId=queue-1 queueLabel=queue-proof runId=run-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 judgeId=judge-valid-1 questionId=question-1 verdict=pass Filtered results response was malformed.'
    );
  });
});
