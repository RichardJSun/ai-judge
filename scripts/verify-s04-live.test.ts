import { describe, expect, it } from 'bun:test';
import { parsePlanMarker } from '../src/lib/ai/plan-marker';
import {
  assertInspectionUrls,
  assertRunStartPayload,
  buildApiUrls,
  buildInspectionUrls,
  formatApiTargets,
  formatInspectionTargets,
  formatSetupSummary,
  parseVerifierOptions,
  runPhase,
  type LiveVerificationSummary,
  VerifierPhaseError,
} from './verify-s04-live';

function createSummary(overrides: Partial<LiveVerificationSummary> = {}): LiveVerificationSummary {
  return {
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
    attachmentProof: {
      submissionId: 'submission-uuid-1',
      submissionExternalId: 'submission-ext-1',
      detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1?source=results',
      detailApiUrl: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1',
      attachments: [
        {
          id: 'attachment-uuid-1',
          externalAttachmentId: 'external-attachment-1',
          fileName: 'screenshot.png',
          mediaType: 'image/png',
          storageStatus: 'stored',
        },
      ],
    },
    assignmentForwarding: [
      {
        questionId: 'question-uuid-1',
        assignmentId: 'assignment-valid-q1',
        attachmentForwarding: true,
      },
      {
        questionId: 'question-uuid-2',
        assignmentId: 'assignment-valid-q2',
        attachmentForwarding: false,
      },
    ],
    scenarioProof: [
      {
        scenario: 'text-only',
        evaluationId: 'eval-text-1',
        status: 'completed',
        verdict: 'pass',
        modelUsed: 'gateway/text-only-model',
        promptSnapshot: 'Forwarding requested: no\nPlan: text-only\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}',
        errorMessage: null,
      },
      {
        scenario: 'multimodal',
        evaluationId: 'eval-multi-1',
        status: 'completed',
        verdict: 'pass',
        modelUsed: 'gateway/multimodal-model',
        promptSnapshot: 'Forwarding requested: yes\nPlan: multimodal\nPlan marker: {"version":1,"kind":"multimodal","forwardingRequested":true,"supportedMedia":["image/png","image/jpeg"]}',
        errorMessage: null,
      },
      {
        scenario: 'blocked',
        evaluationId: 'eval-blocked-1',
        status: 'error',
        verdict: null,
        modelUsed: 'gateway/multimodal-model',
        promptSnapshot: 'Forwarding requested: yes\nPlan: blocked\nPlan marker: {"version":1,"kind":"blocked","forwardingRequested":true,"blockedReason":"forwarding disabled"}',
        errorMessage: 'forwarding disabled',
      },
    ],
    inspectionUrls: {
      queues: 'http://localhost:3000/queues',
      queueDetail: 'http://localhost:3000/queues/queue-uuid-1',
      judges: 'http://localhost:3000/judges',
      validJudgeDetail: 'http://localhost:3000/judges/judge-valid-uuid-1',
      invalidJudgeDetail: 'http://localhost:3000/judges/judge-invalid-uuid-1',
      assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
      run: 'http://localhost:3000/queues/queue-uuid-1/run',
      results: 'http://localhost:3000/queues/queue-uuid-1/results',
      submissionDetail: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1?source=results',
    },
    apiUrls: {
      runPreview: 'http://localhost:3000/api/queues/queue-uuid-1/run-preview',
      runStart: 'http://localhost:3000/api/queues/queue-uuid-1/runs',
      runProgress: 'http://localhost:3000/api/queues/queue-uuid-1/runs/run-uuid-1',
      results: 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1',
      submissionDetail: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1',
    },
    ...overrides,
  };
}

describe('parseVerifierOptions', () => {
  it('requires --base-url when no environment fallback is present', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
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
  it('wraps failures with the phase name and safe identifiers', async () => {
    await expect(
      runPhase(
        'results-assertions',
        { queueId: 'queue-1', runId: 'run-1', filter: 'judgeId=judge-valid-1' },
        async () => {
          throw new Error('Results payload was malformed.');
        }
      )
    ).rejects.toThrow(
      '[verify:s04-live] phase=results-assertions queueId=queue-1 runId=run-1 filter=judgeId=judge-valid-1 Results payload was malformed.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('page-confirmation', 'Results page heading drifted.', {
      page: '/queues/queue-1/results',
    });

    await expect(
      runPhase('page-confirmation', { page: '/queues/queue-1/results' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('run start helpers', () => {
  it('rejects malformed run start payloads', () => {
    expect(() => assertRunStartPayload({ total: 9 })).toThrow('Run start response runId must be a non-empty string.');
  });

  it('accepts a truthful run start payload', () => {
    expect(assertRunStartPayload({ runId: 'run-1', total: 9 })).toEqual({ runId: 'run-1', total: 9 });
  });
});

describe('summary helpers', () => {
  it('builds canonical inspection URLs for downstream browser checks', () => {
    expect(buildInspectionUrls('http://localhost:3000/', 'queue-uuid-1', 'judge-valid-uuid-1', 'judge-invalid-uuid-1', 'submission-uuid-1')).toEqual({
      queues: 'http://localhost:3000/queues',
      queueDetail: 'http://localhost:3000/queues/queue-uuid-1',
      judges: 'http://localhost:3000/judges',
      validJudgeDetail: 'http://localhost:3000/judges/judge-valid-uuid-1',
      invalidJudgeDetail: 'http://localhost:3000/judges/judge-invalid-uuid-1',
      assign: 'http://localhost:3000/queues/queue-uuid-1/assign',
      run: 'http://localhost:3000/queues/queue-uuid-1/run',
      results: 'http://localhost:3000/queues/queue-uuid-1/results',
      submissionDetail: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1?source=results',
    });
  });

  it('builds canonical API URLs for deterministic follow-up', () => {
    expect(
      buildApiUrls(
        'http://localhost:3000/',
        'queue-uuid-1',
        'run-uuid-1',
        'page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1',
        'submission-uuid-1'
      )
    ).toEqual({
      runPreview: 'http://localhost:3000/api/queues/queue-uuid-1/run-preview',
      runStart: 'http://localhost:3000/api/queues/queue-uuid-1/runs',
      runProgress: 'http://localhost:3000/api/queues/queue-uuid-1/runs/run-uuid-1',
      results: 'http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1',
      submissionDetail: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1',
    });
  });

  it('rejects summaries that omit a reviewer page URL', () => {
    expect(() =>
      assertInspectionUrls({
        ...createSummary().inspectionUrls,
        results: '',
      })
    ).toThrow('Verification summary is missing inspection URL results.');
  });

  it('formats the final summary with stable queue, judge, run, and assignment identifiers', () => {
    const summary = createSummary();
    expect(parsePlanMarker(summary.scenarioProof[0].promptSnapshot).kind).toBe('text-only');
    expect(parsePlanMarker(summary.scenarioProof[1].promptSnapshot).kind).toBe('multimodal');
    expect(parsePlanMarker(summary.scenarioProof[2].promptSnapshot).kind).toBe('blocked');

    expect(formatSetupSummary(summary)).toBe(
      'queue=queue-uuid-1 queueLabel=queue_s04_live_proof validJudge=judge-valid-uuid-1 invalidJudge=judge-invalid-uuid-1 questions=question-uuid-1:assignment-valid-q1:assignment-invalid-q1:3,question-uuid-2:assignment-valid-q2:none:3 previews=0/6/0/6 inactiveAssignments=2 run=run-uuid-1:completed:9/9:6/3/3 verdictFilter=pass results=9/6/3 submission=submission-uuid-1:submission-ext-1 detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1?source=results detailApiUrl=http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1 attachments=attachment-uuid-1:screenshot.png:stored forwarding=question-uuid-1:assignment-valid-q1:forward,question-uuid-2:assignment-valid-q2:no-forward scenarios=text-only:eval-text-1:completed:gateway/text-only-model,multimodal:eval-multi-1:completed:gateway/multimodal-model,blocked:eval-blocked-1:error:gateway/multimodal-model:forwarding disabled'
    );
  });

  it('formats inspection targets from the assembled summary', () => {
    expect(formatInspectionTargets(createSummary())).toBe(
      'queues=http://localhost:3000/queues queueDetail=http://localhost:3000/queues/queue-uuid-1 judges=http://localhost:3000/judges validJudgeDetail=http://localhost:3000/judges/judge-valid-uuid-1 invalidJudgeDetail=http://localhost:3000/judges/judge-invalid-uuid-1 assign=http://localhost:3000/queues/queue-uuid-1/assign run=http://localhost:3000/queues/queue-uuid-1/run results=http://localhost:3000/queues/queue-uuid-1/results submissionDetail=http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1?source=results'
    );
  });

  it('formats API targets from the assembled summary', () => {
    expect(formatApiTargets(createSummary())).toBe(
      'runPreview=http://localhost:3000/api/queues/queue-uuid-1/run-preview runStart=http://localhost:3000/api/queues/queue-uuid-1/runs runProgress=http://localhost:3000/api/queues/queue-uuid-1/runs/run-uuid-1 results=http://localhost:3000/api/queues/queue-uuid-1/results?page=1&judgeId=judge-valid-uuid-1&judgeId=judge-invalid-uuid-1 submissionDetail=http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1'
    );
  });
});
