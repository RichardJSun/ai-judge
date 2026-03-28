import { describe, expect, it } from 'bun:test';
import {
  assertInactiveJudgeProof,
  assertPersistedAssignmentRow,
  assertRunPreviewPayload,
  assertUploadResultPayload,
  loadFixture,
  parseVerifierOptions,
  runPhase,
  VerifierPhaseError,
} from './verify-s02-live';

describe('parseVerifierOptions', () => {
  it('requires --base-url when no environment fallback is present', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });
});

describe('loadFixture', () => {
  it('reports a missing tracked fixture path clearly', async () => {
    await expect(
      loadFixture('scripts/missing-fixture.json', async () => {
        const error = new Error('missing');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      })
    ).rejects.toThrow('Fixture file not found: scripts/missing-fixture.json.');
  });
});

describe('runPhase', () => {
  it('wraps failures with the phase name and safe identifiers', async () => {
    await expect(
      runPhase('upload', { queueLabel: 'queue_s02', endpoint: '/api/upload' }, async () => {
        throw new Error('Upload response was malformed.');
      })
    ).rejects.toThrow(
      '[verify:s02-live] phase=upload queueLabel=queue_s02 endpoint=/api/upload Upload response was malformed.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('judge-lifecycle', 'Judge detail failed.', { judgeId: 'judge-1' });

    await expect(
      runPhase('judge-lifecycle', { judgeId: 'judge-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('assertUploadResultPayload', () => {
  it('rejects malformed upload responses immediately', () => {
    expect(() =>
      assertUploadResultPayload({ queues: 1, submissions: 1, questions: 1 })
    ).toThrow('Upload response answers must be a non-negative integer.');
  });
});

describe('assertRunPreviewPayload', () => {
  it('rejects malformed preview breakdown payloads', () => {
    expect(() =>
      assertRunPreviewPayload({ total: 1, inactiveAssignmentCount: 0, breakdown: [{}] })
    ).toThrow('Run preview breakdown[0].questionText must be a non-empty string.');
  });
});

describe('assertPersistedAssignmentRow', () => {
  it('rejects malformed persisted assignment rows before the verifier trusts them', () => {
    expect(() =>
      assertPersistedAssignmentRow({
        id: 'assignment-1',
        queue_id: 'queue-1',
        question_template_id: 'question-1',
        judge_id: 'judge-1',
        prompt_fields: 'questionText',
        attachment_forwarding: false,
        created_at: '2026-03-28T00:00:00.000Z',
      })
    ).toThrow('Persisted assignment row prompt_fields must be an array of strings.');
  });
});

describe('assertInactiveJudgeProof', () => {
  it('accepts truthful preview totals and stable assignment ids', () => {
    expect(() =>
      assertInactiveJudgeProof({
        baseline: { total: 3, inactiveAssignmentCount: 2 },
        active: { total: 4, inactiveAssignmentCount: 2 },
        inactive: { total: 3, inactiveAssignmentCount: 3 },
        reactivated: { total: 4, inactiveAssignmentCount: 2 },
        answerCount: 1,
        activeAssignmentId: 'assignment-1',
        inactiveAssignmentId: 'assignment-1',
        reactivatedAssignmentId: 'assignment-1',
      })
    ).not.toThrow();
  });

  it('fails when the inactive preview still counts the deactivated judge', () => {
    expect(() =>
      assertInactiveJudgeProof({
        baseline: { total: 3, inactiveAssignmentCount: 0 },
        active: { total: 4, inactiveAssignmentCount: 0 },
        inactive: { total: 4, inactiveAssignmentCount: 1 },
        reactivated: { total: 4, inactiveAssignmentCount: 0 },
        answerCount: 1,
        activeAssignmentId: 'assignment-1',
        inactiveAssignmentId: 'assignment-1',
        reactivatedAssignmentId: 'assignment-1',
      })
    ).toThrow('Inactive preview total 4 should have returned to the baseline 3.');
  });
});
