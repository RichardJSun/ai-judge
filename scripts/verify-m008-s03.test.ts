import { describe, expect, it } from 'bun:test';
import type { ResultsResponse, SubmissionDetailResponse } from '../src/types/api';
import { loadFixture } from './verify-s02-live';
import type { LiveVerificationSummary as M008S01LiveVerificationSummary } from './verify-m008-s01';
import type { LiveVerificationSummary as UpstreamLiveVerificationSummary } from './verify-m008-s02';
import {
  assertHighCardinalityFixture,
  formatProofTargets,
  formatSetupSummary,
  formatTimestampProof,
  parseVerifierOptions,
  resolveProofTargets,
  runPhase,
  type LiveVerificationSummary,
  type QueuePageProof,
  VerifierPhaseError,
} from './verify-m008-s03';

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
    created_at: '2026-03-30T12:21:30.000Z',
    status: 'completed',
    submission: {
      id: 'submission-21',
      external_id: 'sub_m008_s03_21',
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
      createEvaluation(),
      createEvaluation({
        id: 'evaluation-2',
        created_at: '2026-03-30T12:22:30.000Z',
        submission: {
          id: 'submission-22',
          external_id: 'sub_m008_s03_22',
        },
      }),
    ],
    total: 2,
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
      judges: [{ id: 'judge-valid-1', name: 'Verifier Valid', model: 'openai/gpt-4o-mini' }],
      questions: [{ id: 'question-1', external_id: 'question-external-1', question_text: 'Question one?' }],
      verdicts: ['pass'],
    },
    ...overrides,
  };
}

function createSubmissionDetailResponse(overrides: Partial<SubmissionDetailResponse> = {}): SubmissionDetailResponse {
  return {
    queue: {
      id: 'queue-uuid-1',
      queue_id: 'queue-proof',
      created_at: '2026-03-30T12:00:00.000Z',
    },
    submission: {
      id: 'submission-21',
      queue_id: 'queue-uuid-1',
      external_id: 'sub_m008_s03_21',
      labeling_task_id: 'task-21',
      submitted_at: '2026-03-30T12:21:00.000Z',
      created_at: '2026-03-30T12:21:05.000Z',
    },
    summary: {
      totalQuestions: 2,
      answeredQuestions: 2,
      missingQuestions: 0,
    },
    questions: [
      {
        id: 'question-1',
        external_id: 'question-external-1',
        question_type: 'single_choice_with_reasoning',
        question_text: 'Question one?',
        created_at: '2026-03-30T12:00:00.000Z',
        answerState: 'answered',
        answer: 'yes',
        rawAnswer: null,
      },
    ],
    attachments: [],
    ...overrides,
  };
}

function createQueuePageResponse(overrides: Partial<ResultsResponse> = {}) {
  return {
    submissions: [
      {
        id: 'submission-21',
        external_id: 'sub_m008_s03_21',
        labeling_task_id: 'task-21',
        submitted_at: '2026-03-30T12:21:00.000Z',
        created_at: '2026-03-30T12:21:05.000Z',
      },
      {
        id: 'submission-22',
        external_id: 'sub_m008_s03_22',
        labeling_task_id: 'task-22',
        submitted_at: '2026-03-30T12:22:00.000Z',
        created_at: '2026-03-30T12:22:05.000Z',
      },
    ],
    total: 24,
    page: 2,
    pageSize: 20,
    ...overrides,
  };
}

function createUpstreamSummary(overrides: Partial<UpstreamLiveVerificationSummary> = {}): UpstreamLiveVerificationSummary {
  const upstreamRunSummary: M008S01LiveVerificationSummary = {
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
      total: 24,
    },
    clampedProof: {
      requestedPage: 999999,
      canonicalPage: 1,
      total: 24,
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
      previewTotal: 24,
      startedTotal: 24,
      verifierJudgeIds: {
        valid: 'judge-valid-1',
        invalid: 'judge-invalid-1',
      },
      verifierJudgeNames: {
        valid: 'Verifier Valid',
        invalid: 'Verifier Invalid',
      },
      questionIds: ['question-1', 'question-2'],
      resultsProof: {
        currentTotal: 24,
        currentCompleted: 24,
        currentErrored: 0,
        verdictFilter: 'pass',
      },
      pageUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
    },
  };

  return {
    queueId: 'queue-uuid-1',
    queueLabel: 'queue-proof',
    runId: 'run-uuid-1',
    verifierJudgeIds: {
      valid: 'judge-valid-1',
      invalid: 'judge-invalid-1',
    },
    filteredProof: {
      page: 1,
      judgeId: 'judge-valid-1',
      questionId: 'question-1',
      verdict: 'pass',
      total: 2,
    },
    proofSubmission: {
      submissionId: 'submission-upstream',
      submissionExternalId: 'submission-upstream',
      evaluationIds: ['evaluation-upstream'],
      rowCount: 1,
    },
    proofTargets: {
      filteredResults:
        'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      detailUrl:
        'http://localhost:3000/queues/queue-uuid-1/submissions/submission-upstream?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      filteredResultsApi:
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
    },
    upstreamSummary: upstreamRunSummary,
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
  it('wraps failures with the phase name and queue-page context', async () => {
    await expect(
      runPhase(
        'queue-detail-page',
        {
          page: '/queues/queue-1/submissions/submission-1?source=queue&page=2',
          url: 'http://localhost:3000/queues/queue-1/submissions/submission-1?source=queue&page=2',
          queueId: 'queue-1',
          submissionId: 'submission-1',
          queuePage: '2',
        },
        async () => {
          throw new Error('Page returned 500.');
        }
      )
    ).rejects.toThrow(
      '[verify:m008-s03] phase=queue-detail-page page=/queues/queue-1/submissions/submission-1?source=queue&page=2 url=http://localhost:3000/queues/queue-1/submissions/submission-1?source=queue&page=2 queueId=queue-1 submissionId=submission-1 queuePage=2 Page returned 500.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('timestamp-proof', 'Queue and submission-detail timestamps could not be matched.', {
      queueId: 'queue-1',
      submissionId: 'submission-1',
    });

    await expect(
      runPhase('timestamp-proof', { queueId: 'queue-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('fixture assumptions', () => {
  it('requires more than 20 submissions', () => {
    expect(() =>
      assertHighCardinalityFixture(
        Array.from({ length: 20 }, (_, index) => ({ queueId: `queue-${index + 1 > 0 ? 1 : 0}` }))
      )
    ).toThrow('Verification fixture must include more than 20 submissions to force a real queue page 2.');
  });

  it('accepts the dedicated high-cardinality fixture', async () => {
    const fixture = await loadFixture('scripts/verify-m008-s03.fixture.json');
    expect(() => assertHighCardinalityFixture(fixture)).not.toThrow();
    expect(fixture).toHaveLength(24);
  });
});

describe('resolveProofTargets', () => {
  it('derives queue page 2, queue-origin detail, results detail, and timestamp refs from live-summary context', async () => {
    const summary = createUpstreamSummary();
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/queues/queue-uuid-1/submissions?page=2': createJsonResponse(createQueuePageResponse()),
      'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
        createJsonResponse(createResultsResponse()),
      'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-21': createJsonResponse(
        createSubmissionDetailResponse()
      ),
      'http://localhost:3000/queues/queue-uuid-1?page=2': createTextResponse('<main><h1>Submissions</h1></main>'),
      'http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=queue&page=2': createTextResponse(
        '<main><h1>Submission detail</h1></main>'
      ),
      'http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass':
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
        total: 2,
      },
      queueProof: {
        page: 2,
        total: 24,
        pageSize: 20,
      } satisfies QueuePageProof,
      proofSubmission: {
        submissionId: 'submission-21',
        submissionExternalId: 'sub_m008_s03_21',
        evaluationIds: ['evaluation-1'],
        rowCount: 1,
      },
      proofTargets: {
        queuePage: 'http://localhost:3000/queues/queue-uuid-1?page=2',
        queueSubmissionsApi: 'http://localhost:3000/api/queues/queue-uuid-1/submissions?page=2',
        queueDetailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=queue&page=2',
        filteredResults:
          'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        detailUrl:
          'http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        filteredResultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      },
      timestampProof: {
        submissionId: 'submission-21',
        submissionExternalId: 'sub_m008_s03_21',
        queueSubmittedAt: '2026-03-30T12:21:00.000Z',
        detailSubmittedAt: '2026-03-30T12:21:00.000Z',
        resultsCreatedAt: '2026-03-30T12:21:30.000Z',
        resultsEvaluationId: 'evaluation-1',
      },
    });
  });

  it('fails with a phase-labelled error when queue submissions never expose page 2', async () => {
    const summary = createUpstreamSummary();
    const fetchImpl = createFetchMock({
      'http://localhost:3000/api/queues/queue-uuid-1/submissions?page=2': createJsonResponse(
        createQueuePageResponse({ total: 20, page: 1, pageSize: 20 })
      ),
    });

    await expect(
      resolveProofTargets({
        summary,
        baseUrl: 'http://localhost:3000',
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow(
      '[verify:m008-s03] phase=queue-submissions-target endpoint=/api/queues/queue-uuid-1/submissions filter=page=2 queueId=queue-uuid-1 queueLabel=queue-proof runId=run-uuid-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 queuePage=2 Queue submissions did not expose page 2; received page=1 total=20 pageSize=20.'
    );
  });
});

describe('proof target formatting', () => {
  it('formats the emitted proof targets, timestamps, and summary in a stable order', () => {
    const summary: LiveVerificationSummary = {
      queueId: 'queue-uuid-1',
      queueLabel: 'queue-proof',
      runId: 'run-uuid-1',
      verifierJudgeIds: {
        valid: 'judge-valid-1',
        invalid: 'judge-invalid-1',
      },
      filteredProof: {
        page: 1,
        judgeId: 'judge-valid-1',
        questionId: 'question-1',
        verdict: 'pass',
        total: 2,
      },
      queueProof: {
        page: 2,
        total: 24,
        pageSize: 20,
      },
      proofSubmission: {
        submissionId: 'submission-21',
        submissionExternalId: 'sub_m008_s03_21',
        evaluationIds: ['evaluation-1'],
        rowCount: 1,
      },
      proofTargets: {
        queuePage: 'http://localhost:3000/queues/queue-uuid-1?page=2',
        queueSubmissionsApi: 'http://localhost:3000/api/queues/queue-uuid-1/submissions?page=2',
        queueDetailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=queue&page=2',
        filteredResults:
          'http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        detailUrl:
          'http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
        filteredResultsApi:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass',
      },
      timestampProof: {
        submissionId: 'submission-21',
        submissionExternalId: 'sub_m008_s03_21',
        queueSubmittedAt: '2026-03-30T12:21:00.000Z',
        detailSubmittedAt: '2026-03-30T12:21:00.000Z',
        resultsCreatedAt: '2026-03-30T12:21:30.000Z',
        resultsEvaluationId: 'evaluation-1',
      },
      upstreamSummary: createUpstreamSummary(),
    };

    expect(formatProofTargets(summary.proofTargets)).toBe(
      'queuePage=http://localhost:3000/queues/queue-uuid-1?page=2 queueSubmissionsApi=http://localhost:3000/api/queues/queue-uuid-1/submissions?page=2 queueDetailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=queue&page=2 filteredResults=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass filteredResultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass'
    );

    expect(formatTimestampProof(summary.timestampProof)).toBe(
      'timestampSubmission=submission-21 timestampSubmissionExternalId=sub_m008_s03_21 queueSubmittedAt=2026-03-30T12:21:00.000Z detailSubmittedAt=2026-03-30T12:21:00.000Z resultsEvaluation=evaluation-1 resultsCreatedAt=2026-03-30T12:21:30.000Z'
    );

    expect(formatSetupSummary(summary)).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof run=run-uuid-1 validJudge=judge-valid-1 invalidJudge=judge-invalid-1 filteredPage=1 filteredJudge=judge-valid-1 filteredQuestion=question-1 filteredVerdict=pass queuePage=2 queueTotal=24 submission=submission-21 submissionExternalId=sub_m008_s03_21 submissionRows=1 evaluationIds=evaluation-1 queuePage=http://localhost:3000/queues/queue-uuid-1?page=2 queueSubmissionsApi=http://localhost:3000/api/queues/queue-uuid-1/submissions?page=2 queueDetailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=queue&page=2 filteredResults=http://localhost:3000/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-21?source=results&page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass filteredResultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&questionId=question-1&verdict=pass timestampSubmission=submission-21 timestampSubmissionExternalId=sub_m008_s03_21 queueSubmittedAt=2026-03-30T12:21:00.000Z detailSubmittedAt=2026-03-30T12:21:00.000Z resultsEvaluation=evaluation-1 resultsCreatedAt=2026-03-30T12:21:30.000Z'
    );
  });
});
