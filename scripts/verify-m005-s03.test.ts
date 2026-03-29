import { describe, expect, it } from 'bun:test';
import { parsePlanMarker } from '../src/lib/ai/plan-marker';
import {
  formatVerifierSummary,
  parseVerifierOptions,
  runPhase,
  VerifierPhaseError,
  type LiveVerificationSummary,
  type ScenarioResult,
} from './verify-m005-s03';

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
        '9000',
        '--poll-ms',
        '500',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/custom.fixture.json',
      timeoutMs: 9000,
      pollMs: 500,
    });
  });
});

describe('runPhase', () => {
  it('wraps errors with phase and refs', async () => {
    await expect(
      runPhase('run-start', { queueId: 'queue-1' }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('[verify:m005-s03] phase=run-start queueId=queue-1 boom');
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('run-start', 'plan failed', { queueId: 'queue-1' });
    await expect(
      runPhase('run-start', { queueId: 'queue-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('formatVerifierSummary', () => {
  it('formats queue, run, and evaluation coordinates for S04', () => {
    const evaluations: ScenarioResult[] = [
      {
        scenario: 'text-only',
        evaluationId: 'eval-text',
        judgeId: 'judge-text',
        judgeName: 'Text Judge',
        status: 'completed',
        promptSnapshot:
          'Forwarding requested: no\nPlan: text-only\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}',
        modelUsed: 'verifier/m005-s03-text',
        errorMessage: null,
      },
      {
        scenario: 'multimodal',
        evaluationId: 'eval-multi',
        judgeId: 'judge-multi',
        judgeName: 'Multimodal Judge',
        status: 'completed',
        promptSnapshot:
          'Forwarding requested: yes\nPlan: multimodal\nPlan marker: {"version":1,"kind":"multimodal","forwardingRequested":true,"supportedMedia":["image/png","image/jpeg"]}',
        modelUsed: 'gateway/multimodal-model',
        errorMessage: null,
      },
      {
        scenario: 'blocked',
        evaluationId: 'eval-blocked',
        judgeId: 'judge-blocked',
        judgeName: 'Blocked Judge',
        status: 'error',
        promptSnapshot:
          'Forwarding requested: yes\nPlan: blocked\nPlan marker: {"version":1,"kind":"blocked","forwardingRequested":true,"blockedReason":"Model not configured"}',
        modelUsed: 'openai/gpt-4o-mini',
        errorMessage: 'Model not configured',
      },
    ];

    expect(parsePlanMarker(evaluations[0].promptSnapshot).kind).toBe('text-only');
    expect(parsePlanMarker(evaluations[1].promptSnapshot).kind).toBe('multimodal');
    expect(parsePlanMarker(evaluations[2].promptSnapshot).kind).toBe('blocked');

    const summary: LiveVerificationSummary = {
      queueId: 'queue-1',
      queueLabel: 'queue-proof',
      questionId: 'question-1',
      questionExternalId: 'q-proof-1',
      submissionId: 'submission-1',
      submissionExternalId: 'sub-proof-1',
      runId: 'run-1',
      evaluationSummaries: evaluations,
      resultsUrl: 'http://localhost/queues/queue-proof/results',
    };

    expect(formatVerifierSummary(summary)).toBe(
      'queue=queue-1 queueLabel=queue-proof run=run-1 question=question-1 questionExternalId=q-proof-1 submission=submission-1 submissionExternalId=sub-proof-1 evaluations=text-only=eval-text,multimodal=eval-multi,blocked=eval-blocked resultsUrl=http://localhost/queues/queue-proof/results'
    );
  });
});
