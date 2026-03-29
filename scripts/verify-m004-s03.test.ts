import { describe, expect, it } from 'bun:test';
import type { ResultsResponse } from '../src/types/api';
import { VerifierPhaseError as S04VerifierPhaseError } from './verify-s04-live';
import {
  assertFilteredResultsPayload,
  assertPageContract,
  assertResultsApiTarget,
  buildProofTargets,
  formatProofSubmission,
  formatProofTargets,
  formatSetupSummary,
  normalizeUpstreamError,
  parseVerifierOptions,
  runPhase,
  selectProofSubmission,
  type LiveVerificationSummary,
  type ProofSubmissionTarget,
  VerifierPhaseError,
} from './verify-m004-s03';

function createEvaluation(overrides: Partial<ResultsResponse['evaluations'][number]> = {}): ResultsResponse['evaluations'][number] {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: 'Looks correct.',
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
      queueUrl: 'http://localhost:3000/queues/queue-uuid-1',
      detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results',
      resultsUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
      resultsApi:
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
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
      },
      apiUrls: {
        runPreview: 'http://localhost:3000/api/queues/queue-uuid-1/run-preview',
        runStart: 'http://localhost:3000/api/queues/queue-uuid-1/runs',
        runProgress: 'http://localhost:3000/api/queues/queue-uuid-1/runs/run-uuid-1',
        results:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
      },
    },
    ...overrides,
  };
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
  it('wraps failures with the phase name and selected submission context', async () => {
    await expect(
      runPhase(
        'detail-page',
        {
          page: '/queues/queue-1/submissions/submission-1',
          url: 'http://localhost:3000/queues/queue-1/submissions/submission-1?source=results',
          queueId: 'queue-1',
          submissionId: 'submission-1',
          submissionExternalId: 'submission-ext-1',
        },
        async () => {
          throw new Error('Page returned 500.');
        }
      )
    ).rejects.toThrow(
      '[verify:m004-s03] phase=detail-page page=/queues/queue-1/submissions/submission-1 url=http://localhost:3000/queues/queue-1/submissions/submission-1?source=results queueId=queue-1 submissionId=submission-1 submissionExternalId=submission-ext-1 Page returned 500.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('results-page', 'Page HTML did not include expected heading "Results".', {
      page: '/queues/queue-1/results',
      url: 'http://localhost:3000/queues/queue-1/results',
    });

    await expect(
      runPhase('results-page', { page: '/queues/queue-1/results' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('assertPageContract', () => {
  it('fails when the expected heading is missing', () => {
    expect(() =>
      assertPageContract({
        body: '<main><p>Queue page only</p></main>',
        expectedHeading: 'Submission detail',
      })
    ).toThrow('Page HTML did not include expected heading "Submission detail".');
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

  it('rejects an empty filtered response instead of guessing from historical rows', () => {
    expect(() =>
      selectProofSubmission(
        createResultsResponse({
          evaluations: [],
          total: 0,
          passRate: 0,
          judgePassRates: [],
        })
      )
    ).toThrow('Filtered current-proof results did not include any evaluations.');
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

describe('proof target helpers', () => {
  it('rejects summaries that omit required queue, results, or judge data', () => {
    expect(() =>
      buildProofTargets(
        {
          queueId: 'queue-uuid-1',
          inspectionUrls: {
            queueDetail: 'http://localhost:3000/queues/queue-uuid-1',
            results: 'http://localhost:3000/queues/queue-uuid-1/results',
          },
          apiUrls: {
            results:
              'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
          },
          verifierJudgeIds: {
            valid: 'judge-valid-1',
          },
        },
        createProofSubmission()
      )
    ).toThrow('Verification summary is missing verifierJudgeIds.invalid.');
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

  it('builds detail, queue, results, and filtered results targets in a stable shape', () => {
    expect(
      buildProofTargets(
        {
          queueId: 'queue-uuid-1',
          inspectionUrls: {
            queueDetail: 'http://localhost:3000/queues/queue-uuid-1',
            results: 'http://localhost:3000/queues/queue-uuid-1/results',
          },
          apiUrls: {
            results:
              'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
          },
          verifierJudgeIds: {
            valid: 'judge-valid-1',
            invalid: 'judge-invalid-1',
          },
        },
        createProofSubmission()
      )
    ).toEqual({
      queueUrl: 'http://localhost:3000/queues/queue-uuid-1',
      detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results',
      resultsUrl: 'http://localhost:3000/queues/queue-uuid-1/results',
      resultsApi:
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1',
    });
  });

  it('formats the emitted proof submission and proof targets in a stable order', () => {
    expect(formatProofSubmission(createProofSubmission())).toBe(
      'submission=submission-1 submissionExternalId=submission-external-1 submissionRows=2 evaluationIds=evaluation-1,evaluation-2'
    );
    expect(formatProofTargets(createSummary().proofTargets)).toBe(
      'queueUrl=http://localhost:3000/queues/queue-uuid-1 detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results resultsUrl=http://localhost:3000/queues/queue-uuid-1/results resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1'
    );
  });

  it('formats the final summary with stable queue, run, submission, and target identifiers', () => {
    expect(formatSetupSummary(createSummary())).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof run=run-uuid-1 validJudge=judge-valid-1 invalidJudge=judge-invalid-1 submission=submission-1 submissionExternalId=submission-external-1 submissionRows=2 evaluationIds=evaluation-1,evaluation-2 queueUrl=http://localhost:3000/queues/queue-uuid-1 detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-1?source=results resultsUrl=http://localhost:3000/queues/queue-uuid-1/results resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-1&judgeId=judge-invalid-1'
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
      '[verify:m004-s03] phase=results-assertions queueId=queue-1 queueLabel=queue-proof runId=run-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 Results response was malformed.'
    );
  });
});
