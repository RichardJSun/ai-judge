import { describe, expect, it } from 'bun:test';
import { VerifierPhaseError as S04VerifierPhaseError } from './verify-s04-live';
import {
  assertPageContract,
  buildProofTargets,
  formatProofTargets,
  formatSetupSummary,
  normalizeUpstreamError,
  parseVerifierOptions,
  runPhase,
  type LiveVerificationSummary,
  VerifierPhaseError,
} from './verify-m002-s02';

function createSummary(overrides: Partial<LiveVerificationSummary> = {}): LiveVerificationSummary {
  return {
    queueId: 'queue-uuid-1',
    queueLabel: 'queue_s04_live_proof',
    runId: 'run-uuid-1',
    verifierJudgeIds: {
      valid: 'judge-valid-uuid-1',
      invalid: 'judge-invalid-uuid-1',
    },
    proofTargets: {
      assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
      results: 'http://localhost:3000/queues/queue-uuid-1/results',
      resultsApi:
        'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1',
    },
    upstreamSummary: {
      queueId: 'queue-uuid-1',
      queueLabel: 'queue_s04_live_proof',
      verifierJudgeIds: {
        valid: 'judge-valid-uuid-1',
        invalid: 'judge-invalid-uuid-1',
      },
      verifierJudgeNames: {
        valid: 'S04 Live Results Valid [queue_s04_live_proof] [20260328123456000]',
        invalid: 'S04 Live Results Invalid [queue_s04_live_proof] [20260328123456000]',
      },
      questionRefs: [
        {
          id: 'question-uuid-1',
          externalId: 'q_template_s04_live_1',
          questionText: 'Does the answer follow the rubric?',
          answerCount: 3,
          validAssignmentId: 'assignment-valid-q1',
          invalidAssignmentId: 'assignment-invalid-q1',
        },
        {
          id: 'question-uuid-2',
          externalId: 'q_template_s04_live_2',
          questionText: 'Is the final recommendation supported by cited evidence?',
          answerCount: 3,
          validAssignmentId: 'assignment-valid-q2',
          invalidAssignmentId: null,
        },
      ],
      assignmentProof: {
        baseline: 0,
        active: 6,
        inactive: 0,
        reactivated: 6,
        inactiveAssignments: 2,
      },
      run: {
        runId: 'run-uuid-1',
        status: 'completed',
        previewTotal: 9,
        startedTotal: 9,
        completedRows: 6,
        erroredRows: 3,
        retriedRows: 3,
      },
      resultsProof: {
        currentTotal: 9,
        currentCompleted: 6,
        currentErrored: 3,
        verdictFilter: 'pass',
      },
      inspectionUrls: {
        queues: 'http://localhost:3000/queues',
        queueDetail: 'http://localhost:3000/queues/queue-uuid-1',
        judges: 'http://localhost:3000/judges',
        validJudgeDetail: 'http://localhost:3000/judges/judge-valid-uuid-1',
        invalidJudgeDetail: 'http://localhost:3000/judges/judge-invalid-uuid-1',
        assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
        run: 'http://localhost:3000/queues/queue-uuid-1/run',
        results: 'http://localhost:3000/queues/queue-uuid-1/results',
      },
      apiUrls: {
        runPreview: 'http://localhost:3000/api/queues/queue-uuid-1/run-preview',
        runStart: 'http://localhost:3000/api/queues/queue-uuid-1/runs',
        runProgress: 'http://localhost:3000/api/queues/queue-uuid-1/runs/run-uuid-1',
        results:
          'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1',
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
  it('wraps failures with the phase name and page-specific context', async () => {
    await expect(
      runPhase(
        'results-page',
        {
          page: '/queues/queue-1/results',
          url: 'http://localhost:3000/queues/queue-1/results',
          queueId: 'queue-1',
        },
        async () => {
          throw new Error('Page returned 500.');
        }
      )
    ).rejects.toThrow(
      '[verify:m002-s02] phase=results-page page=/queues/queue-1/results url=http://localhost:3000/queues/queue-1/results queueId=queue-1 Page returned 500.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('assign-page', 'Page HTML did not include expected heading "Assign Judges".', {
      page: '/queues/queue-1/assign',
      url: 'http://localhost:3000/queues/queue-1/assign',
    });

    await expect(
      runPhase('assign-page', { page: '/queues/queue-1/assign' }, async () => {
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
        expectedHeading: 'Assign Judges',
      })
    ).toThrow('Page HTML did not include expected heading "Assign Judges".');
  });
});

describe('proof target helpers', () => {
  it('rejects summaries that omit verifier ids or emitted proof targets', () => {
    expect(() =>
      buildProofTargets({
        inspectionUrls: {
          assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
          results: 'http://localhost:3000/queues/queue-uuid-1/results',
        },
        apiUrls: {
          results: 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1',
        },
        verifierJudgeIds: {
          valid: 'judge-valid-uuid-1',
        },
      })
    ).toThrow('Verification summary is missing verifierJudgeIds.invalid.');
  });

  it('rejects a results API target that is not scoped to both verifier judges', () => {
    expect(() =>
      buildProofTargets({
        inspectionUrls: {
          assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
          results: 'http://localhost:3000/queues/queue-uuid-1/results',
        },
        apiUrls: {
          results: 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1',
        },
        verifierJudgeIds: {
          valid: 'judge-valid-uuid-1',
          invalid: 'judge-invalid-uuid-1',
        },
      })
    ).toThrow('Verification summary results API target must include both verifier judge ids.');
  });

  it('formats the emitted browser and API proof targets in a stable order', () => {
    expect(formatProofTargets(createSummary().proofTargets)).toBe(
      'assign=http://localhost:3000/queues/queue-uuid-1/assign results=http://localhost:3000/queues/queue-uuid-1/results resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1'
    );
  });

  it('formats the final summary with stable queue, judge, run, and proof target identifiers', () => {
    expect(formatSetupSummary(createSummary())).toBe(
      'queue=queue-uuid-1 queueLabel=queue_s04_live_proof run=run-uuid-1 validJudge=judge-valid-uuid-1 invalidJudge=judge-invalid-uuid-1 assign=http://localhost:3000/queues/queue-uuid-1/assign results=http://localhost:3000/queues/queue-uuid-1/results resultsApi=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1'
    );
  });
});

describe('normalizeUpstreamError', () => {
  it('rewraps upstream phase errors under the slice verifier prefix without dropping refs', () => {
    expect(() =>
      normalizeUpstreamError(
        new S04VerifierPhaseError('run-start', 'Run preview response was malformed.', {
          queueId: 'queue-1',
          queueLabel: 'queue-proof',
          runId: 'run-1',
          validJudgeId: 'judge-valid-1',
          invalidJudgeId: 'judge-invalid-1',
        })
      )
    ).toThrow(
      '[verify:m002-s02] phase=run-start queueId=queue-1 queueLabel=queue-proof runId=run-1 validJudgeId=judge-valid-1 invalidJudgeId=judge-invalid-1 Run preview response was malformed.'
    );
  });
});
