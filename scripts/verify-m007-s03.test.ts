import { describe, expect, it } from 'bun:test';
import type { ResultsResponse } from '../src/types/api';
import { VerifierPhaseError as S04VerifierPhaseError } from './verify-s04-live';
import {
  assertFilteredResultsPayload,
  buildProofTargets,
  formatProofSubmission,
  formatProofTargets,
  formatSetupSummary,
  normalizeUpstreamError,
  normalizeUpstreamSummary,
  parseVerifierOptions,
  resolveJudgePageTarget,
  resolveProofTargets,
  runPhase,
  selectProofSubmission,
  selectQueuePageTargets,
  type JudgePageTarget,
  type LiveVerificationSummary,
  type ProofSubmissionTarget,
  type QueuePageTargets,
  VerifierPhaseError,
} from './verify-m007-s03';

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
  const completedPass = createEvaluation();
  const errored = createEvaluation({
    id: 'evaluation-2',
    status: 'error',
    verdict: null,
    reasoning: null,
    tokens_used: null,
    error_message: 'Model lookup failed',
    judge: {
      id: 'judge-invalid-1',
      name: 'Verifier Invalid',
      model: 'openai/not-a-real-model-s04-live',
    },
  });

  return {
    evaluations: [completedPass, errored],
    total: 2,
    passRate: 100,
    judgePassRates: [
      {
        judgeId: 'judge-valid-1',
        name: 'Verifier Valid',
        passRate: 100,
        total: 1,
      },
    ],
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

function createProofSubmission(overrides: Partial<ProofSubmissionTarget> = {}): ProofSubmissionTarget {
  return {
    submissionId: 'submission-1',
    submissionExternalId: 'submission-external-1',
    evaluationIds: ['evaluation-1', 'evaluation-2'],
    rowCount: 2,
    ...overrides,
  };
}

function createJudgePageTarget(overrides: Partial<JudgePageTarget> = {}): JudgePageTarget {
  return {
    judgeId: 'judge-valid-1',
    judgesApi: 'http://localhost:3000/api/judges?page=2',
    judgesUrl: 'http://localhost:3000/judges?page=2',
    judgePage: 2,
    ...overrides,
  };
}

function createQueuePageTargets(overrides: Partial<QueuePageTargets> = {}): QueuePageTargets {
  return {
    queuesApi: 'http://localhost:3000/api/queues?page=1',
    queuesUrl: 'http://localhost:3000/queues?page=1',
    positiveQueueId: 'queue-uuid-1',
    positiveQueueLabel: 'queue-proof',
    zeroQueueId: 'queue-zero-1',
    zeroQueueLabel: 'queue-zero',
    ...overrides,
  };
}

function createSummary(overrides: Partial<LiveVerificationSummary> = {}): LiveVerificationSummary {
  return {
    queueId: 'queue-uuid-1',
    queueLabel: 'queue-proof',
    runId: 'run-uuid-1',
    verifierJudgeIds: {
      valid: 'judge-valid-1',
      invalid: 'judge-invalid-1',
    },
    proofSubmission: createProofSubmission(),
    proofTargets: {
      judgesUrl: 'http://localhost:3000/judges?page=2',
      judgesApi: 'http://localhost:3000/api/judges?page=2',
      judgePage: 2,
      manageJudgeId: 'judge-valid-1',
      queuesUrl: 'http://localhost:3000/queues?page=1',
      queuesApi: 'http://localhost:3000/api/queues?page=1',
      positiveQueueId: 'queue-uuid-1',
      positiveQueueLabel: 'queue-proof',
      zeroQueueId: 'queue-zero-1',
      zeroQueueLabel: 'queue-zero',
      resultsUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
      resultsApi:
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
      detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results',
    },
    upstreamSummary: {
      queueId: 'queue-uuid-1',
      queueLabel: 'queue-proof',
      verifierJudgeIds: {
        valid: 'judge-valid-1',
        invalid: 'judge-invalid-1',
      },
      verifierJudgeNames: {
        valid: 'S04 Live Results Valid [queue-proof] [20260329010000000]',
        invalid: 'S04 Live Results Invalid [queue-proof] [20260329010000000]',
      },
      questionRefs: [
        {
          id: 'question-1',
          externalId: 'question-external-1',
          questionText: 'Question one?',
          answerCount: 2,
          validAssignmentId: 'assignment-valid-q1',
          invalidAssignmentId: 'assignment-invalid-q1',
        },
        {
          id: 'question-2',
          externalId: 'question-external-2',
          questionText: 'Question two?',
          answerCount: 1,
          validAssignmentId: 'assignment-valid-q2',
          invalidAssignmentId: null,
        },
      ],
      assignmentProof: {
        baseline: 0,
        active: 3,
        inactive: 0,
        reactivated: 3,
        inactiveAssignments: 2,
      },
      run: {
        runId: 'run-uuid-1',
        status: 'completed',
        previewTotal: 3,
        startedTotal: 3,
        completedRows: 2,
        erroredRows: 1,
        retriedRows: 1,
      },
      resultsProof: {
        currentTotal: 3,
        currentCompleted: 2,
        currentErrored: 1,
        verdictFilter: 'pass',
        evaluations: [],
      },
      inspectionUrls: {
        queues: 'http://localhost:3000/queues',
        queueDetail: 'http://localhost:3000/queues/queue-uuid-1',
        judges: 'http://localhost:3000/judges',
        validJudgeDetail: 'http://localhost:3000/judges/judge-valid-1',
        invalidJudgeDetail: 'http://localhost:3000/judges/judge-invalid-1',
        assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
        run: 'http://localhost:3000/queues/queue-uuid-1/run',
        results: 'http://localhost:3000/queues/queue-uuid-1/results',
        submissionDetail: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results',
      },
      apiUrls: {
        runPreview: 'http://localhost:3000/api/queues/queue-uuid-1/run-preview',
        runStart: 'http://localhost:3000/api/queues/queue-uuid-1/runs',
        runProgress: 'http://localhost:3000/api/queues/queue-uuid-1/runs/run-uuid-1',
        results:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
        submissionDetail: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-1',
      },
      attachmentProof: {
        submissionId: 'submission-1',
        submissionExternalId: 'submission-external-1',
        detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results',
        detailApiUrl: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-1',
        attachments: [],
      },
      assignmentForwarding: [],
      scenarioProof: [],
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
  it('wraps failures with the phase name and discovery context', async () => {
    await expect(
      runPhase(
        'judge-page-discovery',
        {
          endpoint: '/api/judges',
          page: '/judges?page=2',
          judgeId: 'judge-valid-1',
          pageBoundary: '1-4',
        },
        async () => {
          throw new Error('Response was not valid JSON (500).');
        }
      )
    ).rejects.toThrow(
      '[verify:m007-s03] phase=judge-page-discovery endpoint=/api/judges page=/judges?page=2 judgeId=judge-valid-1 pageBoundary=1-4 Response was not valid JSON (500).'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError(
      'queue-page-discovery',
      'Paged queue discovery requires a zero-result row on /api/queues?page=1.',
      { endpoint: '/api/queues', page: '/queues?page=1' }
    );

    await expect(
      runPhase('queue-page-discovery', { endpoint: '/api/queues' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('normalizeUpstreamSummary', () => {
  it('rejects summaries that omit required inspection context', () => {
    const summary = createSummary().upstreamSummary;
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...summary,
          inspectionUrls: {
            ...summary.inspectionUrls,
            submissionDetail: '',
          },
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary is missing inspectionUrls.submissionDetail.');
  });

  it('rejects upstream URLs that point at a different host', () => {
    const summary = createSummary().upstreamSummary;
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...summary,
          apiUrls: {
            ...summary.apiUrls,
            results: 'http://evil.example/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
          },
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary apiUrls.results must resolve under http://localhost:3000.');
  });

  it('rejects submission detail context that is not results-originated', () => {
    const summary = createSummary().upstreamSummary;
    expect(() =>
      normalizeUpstreamSummary(
        {
          ...summary,
          inspectionUrls: {
            ...summary.inspectionUrls,
            submissionDetail: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-1',
          },
        },
        'http://localhost:3000'
      )
    ).toThrow('Verification summary inspectionUrls.submissionDetail must include source=results.');
  });
});

describe('filtered results helpers', () => {
  it('accepts a truthful filtered results payload', () => {
    expect(() => assertFilteredResultsPayload(createResultsResponse(), 'results response')).not.toThrow();
  });

  it('rejects malformed filtered results payloads', () => {
    expect(() => assertFilteredResultsPayload({ evaluations: 'nope' }, 'results response')).toThrow(
      'results response'
    );
  });

  it('selects one deterministic proof submission when multiple current-proof submissions exist', () => {
    const response = createResultsResponse({
      evaluations: [
        createEvaluation({
          id: 'evaluation-b-1',
          submission: { id: 'submission-b', external_id: 'submission-b' },
        }),
        createEvaluation({
          id: 'evaluation-a-2',
          submission: { id: 'submission-a', external_id: 'submission-a' },
          question: { id: 'question-2', external_id: 'question-external-2', question_text: 'Question two?' },
        }),
        createEvaluation({
          id: 'evaluation-a-1',
          submission: { id: 'submission-a', external_id: 'submission-a' },
        }),
      ],
      total: 3,
      judgePassRates: [
        {
          judgeId: 'judge-valid-1',
          name: 'Verifier Valid',
          passRate: 100,
          total: 3,
        },
      ],
    });

    expect(selectProofSubmission(response)).toEqual({
      submissionId: 'submission-a',
      submissionExternalId: 'submission-a',
      evaluationIds: ['evaluation-a-1', 'evaluation-a-2'],
      rowCount: 2,
    });
  });

  it('rejects conflicting submission external ids within the same filtered submission group', () => {
    expect(() =>
      selectProofSubmission(
        createResultsResponse({
          evaluations: [
            createEvaluation({
              id: 'evaluation-1',
              submission: { id: 'submission-1', external_id: 'submission-external-1' },
            }),
            createEvaluation({
              id: 'evaluation-2',
              submission: { id: 'submission-1', external_id: 'submission-external-2' },
            }),
          ],
        })
      )
    ).toThrow(
      'Filtered current-proof results contained conflicting submission external ids for submission submission-1.'
    );
  });
});

describe('paged discovery helpers', () => {
  it('scans paged judges until it finds the verifier-owned judge', async () => {
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/judges?page=1': createJsonResponse({
        judges: [
          {
            id: 'judge-other-1',
            name: 'Other Judge',
            system_prompt: 'Other prompt',
            model: 'openai/gpt-4o-mini',
            active: true,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 1,
      }),
      'http://localhost:3000/api/judges?page=2': createJsonResponse({
        judges: [
          {
            id: 'judge-valid-1',
            name: 'Verifier Valid',
            system_prompt: 'Verifier prompt',
            model: 'openai/gpt-4o-mini',
            active: true,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
        ],
        total: 2,
        page: 2,
        pageSize: 1,
      }),
    });

    await expect(
      resolveJudgePageTarget({
        baseUrl: 'http://localhost:3000',
        judgesRootUrl: 'http://localhost:3000/judges',
        judgeId: 'judge-valid-1',
        queueId: 'queue-uuid-1',
        queueLabel: 'queue-proof',
        runId: 'run-uuid-1',
        validJudgeId: 'judge-valid-1',
        invalidJudgeId: 'judge-invalid-1',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).resolves.toEqual({
      judgeId: 'judge-valid-1',
      judgesApi: 'http://localhost:3000/api/judges?page=2',
      judgesUrl: 'http://localhost:3000/judges?page=2',
      judgePage: 2,
    });
  });

  it('fails with the scan boundary when the verifier-owned judge is absent', async () => {
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/judges?page=1': createJsonResponse({
        judges: [
          {
            id: 'judge-other-1',
            name: 'Other Judge',
            system_prompt: 'Other prompt',
            model: 'openai/gpt-4o-mini',
            active: true,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 1,
      }),
      'http://localhost:3000/api/judges?page=2': createJsonResponse({
        judges: [
          {
            id: 'judge-other-2',
            name: 'Other Judge Two',
            system_prompt: 'Other prompt two',
            model: 'openai/gpt-4o-mini',
            active: true,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
        ],
        total: 2,
        page: 2,
        pageSize: 1,
      }),
    });

    await expect(
      resolveJudgePageTarget({
        baseUrl: 'http://localhost:3000',
        judgesRootUrl: 'http://localhost:3000/judges',
        judgeId: 'judge-valid-1',
        queueId: 'queue-uuid-1',
        queueLabel: 'queue-proof',
        runId: 'run-uuid-1',
        validJudgeId: 'judge-valid-1',
        invalidJudgeId: 'judge-invalid-1',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow('Verifier judge judge-valid-1 was not found while scanning /api/judges pages 1-2.');
  });

  it('pins the proof queue on page 1 while still selecting a separate zero-result row', () => {
    expect(
      selectQueuePageTargets(
        {
          queues: [
            {
              id: 'queue-other-positive',
              queue_id: 'queue-other-positive',
              created_at: '2026-03-29T00:00:00.000Z',
              submission_count: 4,
              question_count: 2,
              result_count: 1,
            },
            {
              id: 'queue-uuid-1',
              queue_id: 'queue-proof',
              created_at: '2026-03-29T00:00:00.000Z',
              submission_count: 5,
              question_count: 2,
              result_count: 3,
            },
            {
              id: 'queue-zero-1',
              queue_id: 'queue-zero',
              created_at: '2026-03-29T00:00:00.000Z',
              submission_count: 1,
              question_count: 1,
              result_count: 0,
            },
          ],
          total: 3,
          page: 1,
          pageSize: 50,
        },
        'queue-uuid-1',
        'http://localhost:3000/queues',
        'http://localhost:3000'
      )
    ).toEqual({
      queuesApi: 'http://localhost:3000/api/queues?page=1',
      queuesUrl: 'http://localhost:3000/queues?page=1',
      positiveQueueId: 'queue-uuid-1',
      positiveQueueLabel: 'queue-proof',
      zeroQueueId: 'queue-zero-1',
      zeroQueueLabel: 'queue-zero',
    });
  });

  it('rejects queue page 1 when there is no zero-result row to prove the negative case', () => {
    expect(() =>
      selectQueuePageTargets(
        {
          queues: [
            {
              id: 'queue-uuid-1',
              queue_id: 'queue-proof',
              created_at: '2026-03-29T00:00:00.000Z',
              submission_count: 5,
              question_count: 2,
              result_count: 3,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        },
        'queue-uuid-1',
        'http://localhost:3000/queues',
        'http://localhost:3000'
      )
    ).toThrow('Paged queue discovery requires a zero-result row on /api/queues?page=1.');
  });
});

describe('resolveProofTargets', () => {
  it('resolves paged judges, page-1 queue rows, and deterministic results/detail targets together', async () => {
    const upstreamSummary = createSummary().upstreamSummary;
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/judges?page=1': createJsonResponse({
        judges: [
          {
            id: 'judge-other-1',
            name: 'Other Judge',
            system_prompt: 'Other prompt',
            model: 'openai/gpt-4o-mini',
            active: true,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 1,
      }),
      'http://localhost:3000/api/judges?page=2': createJsonResponse({
        judges: [
          {
            id: 'judge-valid-1',
            name: 'Verifier Valid',
            system_prompt: 'Verifier prompt',
            model: 'openai/gpt-4o-mini',
            active: true,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
        ],
        total: 2,
        page: 2,
        pageSize: 1,
      }),
      'http://localhost:3000/api/queues?page=1': createJsonResponse({
        queues: [
          {
            id: 'queue-other-positive',
            queue_id: 'queue-other-positive',
            created_at: '2026-03-29T00:00:00.000Z',
            submission_count: 4,
            question_count: 2,
            result_count: 1,
          },
          {
            id: 'queue-uuid-1',
            queue_id: 'queue-proof',
            created_at: '2026-03-29T00:00:00.000Z',
            submission_count: 5,
            question_count: 2,
            result_count: 3,
          },
          {
            id: 'queue-zero-1',
            queue_id: 'queue-zero',
            created_at: '2026-03-29T00:00:00.000Z',
            submission_count: 1,
            question_count: 1,
            result_count: 0,
          },
        ],
        total: 3,
        page: 1,
        pageSize: 50,
      }),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1': createJsonResponse(
        createResultsResponse({
          evaluations: [
            createEvaluation({
              id: 'evaluation-b-1',
              submission: { id: 'submission-b', external_id: 'submission-b' },
            }),
            createEvaluation({
              id: 'evaluation-a-2',
              submission: { id: 'submission-a', external_id: 'submission-a' },
              question: { id: 'question-2', external_id: 'question-external-2', question_text: 'Question two?' },
            }),
            createEvaluation({
              id: 'evaluation-a-1',
              submission: { id: 'submission-a', external_id: 'submission-a' },
            }),
          ],
          total: 3,
          judgePassRates: [
            {
              judgeId: 'judge-valid-1',
              name: 'Verifier Valid',
              passRate: 100,
              total: 3,
            },
          ],
        })
      ),
    });

    await expect(
      resolveProofTargets({
        summary: upstreamSummary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).resolves.toEqual({
      proofSubmission: {
        submissionId: 'submission-a',
        submissionExternalId: 'submission-a',
        evaluationIds: ['evaluation-a-1', 'evaluation-a-2'],
        rowCount: 2,
      },
      proofTargets: {
        judgesUrl: 'http://localhost:3000/judges?page=2',
        judgesApi: 'http://localhost:3000/api/judges?page=2',
        judgePage: 2,
        manageJudgeId: 'judge-valid-1',
        queuesUrl: 'http://localhost:3000/queues?page=1',
        queuesApi: 'http://localhost:3000/api/queues?page=1',
        positiveQueueId: 'queue-uuid-1',
        positiveQueueLabel: 'queue-proof',
        zeroQueueId: 'queue-zero-1',
        zeroQueueLabel: 'queue-zero',
        resultsUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
        resultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
        detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-a?source=results',
      },
    });
  });

  it('rejects malformed paged queue payloads instead of guessing at result metadata', async () => {
    const upstreamSummary = createSummary().upstreamSummary;
    const createMalformedQueueFetch = () =>
      createFetchMock({
        'http://localhost:3000/api/judges?page=1': () =>
          createJsonResponse({
            judges: [
              {
                id: 'judge-valid-1',
                name: 'Verifier Valid',
                system_prompt: 'Verifier prompt',
                model: 'openai/gpt-4o-mini',
                active: true,
                created_at: '2026-03-29T00:00:00.000Z',
                updated_at: '2026-03-29T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
          }),
        'http://localhost:3000/api/queues?page=1': () =>
          createJsonResponse({
            queues: [
              {
                id: 'queue-uuid-1',
                queue_id: 'queue-proof',
                created_at: '2026-03-29T00:00:00.000Z',
                submission_count: 5,
                question_count: 2,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
          }),
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1': () =>
          createJsonResponse(createResultsResponse()),
      });

    await expect(
      resolveProofTargets({
        summary: upstreamSummary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl: createMalformedQueueFetch(),
      })
    ).rejects.toThrow('[verify:m007-s03] phase=queue-page-discovery');

    await expect(
      resolveProofTargets({
        summary: upstreamSummary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl: createMalformedQueueFetch(),
      })
    ).rejects.toThrow('result_count');
  });
});

describe('proof target formatting', () => {
  it('builds a stable proof target shape from normalized upstream context', () => {
    const normalized = normalizeUpstreamSummary(createSummary().upstreamSummary, 'http://localhost:3000');

    expect(buildProofTargets(normalized, createJudgePageTarget(), createQueuePageTargets(), createProofSubmission())).toEqual(
      createSummary().proofTargets
    );
  });

  it('formats the emitted proof submission and proof targets in a stable order', () => {
    expect(formatProofSubmission(createProofSubmission())).toBe(
      'submission=submission-1 submissionExternalId=submission-external-1 submissionRows=2 evaluationIds=evaluation-1,evaluation-2'
    );
    expect(formatProofTargets(createSummary().proofTargets)).toBe(
      'judgesUrl=http://localhost:3000/judges?page=2 judgesApi=http://localhost:3000/api/judges?page=2 judgePage=2 manageJudge=judge-valid-1 queuesUrl=http://localhost:3000/queues?page=1 queuesApi=http://localhost:3000/api/queues?page=1 positiveQueue=queue-uuid-1 positiveQueueLabel=queue-proof zeroQueue=queue-zero-1 zeroQueueLabel=queue-zero resultsUrl=http://localhost:3000/queues/queue-uuid-1/results resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1 detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results'
    );
  });

  it('formats the final summary with stable queue, run, submission, and proof target identifiers', () => {
    expect(formatSetupSummary(createSummary())).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof run=run-uuid-1 validJudge=judge-valid-1 invalidJudge=judge-invalid-1 submission=submission-1 submissionExternalId=submission-external-1 submissionRows=2 evaluationIds=evaluation-1,evaluation-2 judgesUrl=http://localhost:3000/judges?page=2 judgesApi=http://localhost:3000/api/judges?page=2 judgePage=2 manageJudge=judge-valid-1 queuesUrl=http://localhost:3000/queues?page=1 queuesApi=http://localhost:3000/api/queues?page=1 positiveQueue=queue-uuid-1 positiveQueueLabel=queue-proof zeroQueue=queue-zero-1 zeroQueueLabel=queue-zero resultsUrl=http://localhost:3000/queues/queue-uuid-1/results resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1 detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results'
    );
  });
});

describe('normalizeUpstreamError', () => {
  it('rewraps upstream phase errors under the slice verifier prefix without dropping refs', () => {
    expect(() =>
      normalizeUpstreamError(
        new S04VerifierPhaseError('results-assertions', 'Results response was malformed.', {
          queueId: 'queue-1',
          queueLabel: 'queue-proof',
          runId: 'run-1',
          validJudgeId: 'judge-valid-1',
          invalidJudgeId: 'judge-invalid-1',
        })
      )
    ).toThrow(
      '[verify:m007-s03] phase=results-assertions queueId=queue-1 queueLabel=queue-proof runId=run-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 Results response was malformed.'
    );
  });
});
