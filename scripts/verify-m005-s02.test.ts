import { describe, expect, it } from 'bun:test';
import {
  assertAssignmentResponse,
  formatProofSummary,
  parseVerifierOptions,
  runPhase,
  VerifierPhaseError,
  type LiveVerificationSummary,
} from './verify-m005-s02';

describe('parseVerifierOptions', () => {
  it('requires --base-url when no fallback is provided', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });

  it('parses optional CLI flags and normalizes the base URL', () => {
    expect(
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000/',
        '--fixture',
        'scripts/custom.fixture.json',
        '--timeout-ms',
        '8000',
        '--startup-timeout-ms',
        '25000',
        '--probe-timeout-ms',
        '300',
        '--poll-ms',
        '600',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/custom.fixture.json',
      timeoutMs: 8000,
      startupTimeoutMs: 25000,
      probeTimeoutMs: 300,
      pollMs: 600,
    });
  });
});

describe('runPhase', () => {
  it('wraps unexpected errors with phase metadata', async () => {
    await expect(
      runPhase('assignment-persistence', { queueId: 'queue-1' }, async () => {
        throw new Error('API unreachable');
      })
    ).rejects.toThrow('[verify:m005-s02] phase=assignment-persistence queueId=queue-1 API unreachable');
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('assignment-persistence', 'boom', { queueId: 'queue-1' });

    await expect(
      runPhase('assignment-persistence', { queueId: 'queue-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('formatProofSummary', () => {
  it('formats verification metadata into a single string', () => {
    const summary: LiveVerificationSummary = {
      queueId: 'queue-1',
      queueLabel: 'queue-proof',
      questionId: 'question-1',
      questionExternalId: 'q-proof-1',
      questionText: 'Describe proof.',
      submissionId: 'submission-1',
      submissionExternalId: 'sub-proof-1',
      judgeId: 'judge-1',
      judgeName: 'Verifier Judge',
      assignmentId: 'assignment-1',
      assignPageUrl: 'http://localhost/queues/queue-proof/assign',
      assignmentsApiUrl: 'http://localhost/api/queues/queue-1/assignments',
      detailUrl: 'http://localhost/queues/queue-proof/submissions/submission-1',
      detailApiUrl: 'http://localhost/api/queues/queue-1/submissions/submission-1',
      forwardingStates: [false, true, false],
      autoStartedLocalApp: false,
    };

    expect(formatProofSummary(summary)).toBe(
      'queue=queue-1 queueLabel=queue-proof question=question-1 questionExternalId=q-proof-1 submission=submission-1 submissionExternalId=sub-proof-1 judge=judge-1 assignment=assignment-1 forwarding=false/true/false assignPage=http://localhost/queues/queue-proof/assign assignmentsApi=http://localhost/api/queues/queue-1/assignments detailUrl=http://localhost/queues/queue-proof/submissions/submission-1 detailApiUrl=http://localhost/api/queues/queue-1/submissions/submission-1'
    );
  });
});

describe('assertAssignmentResponse', () => {
  it('accepts complete assignment payloads', () => {
    expect(
      assertAssignmentResponse({
        id: 'assignment-1',
        queue_id: 'queue-1',
        question_template_id: 'question-1',
        judge_id: 'judge-1',
        attachment_forwarding: true,
      })
    ).toMatchObject({ attachment_forwarding: true });
  });

  it('defaults missing attachment_forwarding to false', () => {
    expect(
      assertAssignmentResponse({
        id: 'assignment-1',
        queue_id: 'queue-1',
        question_template_id: 'question-1',
        judge_id: 'judge-1',
      })
    ).toMatchObject({ attachment_forwarding: false });
  });

  it('rejects malformed attachment_forwarding payloads', () => {
    expect(() =>
      assertAssignmentResponse({
        id: 'assignment-1',
        queue_id: 'queue-1',
        question_template_id: 'question-1',
        judge_id: 'judge-1',
        attachment_forwarding: 'yes',
      })
    ).toThrow('Assignment attachment_forwarding must be a boolean.');
  });
});
