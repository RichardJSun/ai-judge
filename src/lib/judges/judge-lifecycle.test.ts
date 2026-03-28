import { describe, expect, it } from 'bun:test';
import {
  applyJudgeUpdate,
  getReviewerDeleteRejection,
  parseJudgeRecord,
  parseJudgeUpdatePatch,
  planJudgeUpdate,
  resolveJudgeLifecycleAction,
} from './judge-lifecycle';
import type { Judge } from '@/types/db';

const baseJudge: Judge = {
  id: 'judge-1',
  name: 'Clarity Judge',
  system_prompt: 'Score answers for clarity.',
  model: 'openai/gpt-4o-mini',
  active: true,
  created_at: '2026-03-28T00:00:00.000Z',
  updated_at: '2026-03-28T00:00:00.000Z',
};

describe('parseJudgeUpdatePatch', () => {
  it('rejects empty partial updates', () => {
    const parsed = parseJudgeUpdatePatch({});

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message === 'Provide at least one judge field to update.')).toBe(true);
    }
  });

  it('rejects blank name, system prompt, and model fields', () => {
    const parsed = parseJudgeUpdatePatch({
      name: '   ',
      system_prompt: '',
      model: ' ',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issuePaths = parsed.error.issues.map((issue) => issue.path.join('.'));
      expect(issuePaths).toContain('name');
      expect(issuePaths).toContain('system_prompt');
      expect(issuePaths).toContain('model');
    }
  });

  it('rejects malformed partial update payloads', () => {
    const parsed = parseJudgeUpdatePatch({ active: 'yes' });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path.join('.')).toBe('active');
    }
  });
});

describe('judge lifecycle transitions', () => {
  it('classifies edit, deactivate, and reactivate transitions', () => {
    expect(resolveJudgeLifecycleAction(baseJudge, { name: 'Revised Judge' })).toBe('edit');
    expect(resolveJudgeLifecycleAction(baseJudge, { active: false })).toBe('deactivate');
    expect(resolveJudgeLifecycleAction({ active: false }, { active: true })).toBe('reactivate');
  });

  it('preserves judge identity and created history through deactivate/reactivate cycles', () => {
    const deactivatedAt = '2026-03-28T01:00:00.000Z';
    const reactivatedAt = '2026-03-28T02:00:00.000Z';

    const deactivated = applyJudgeUpdate(baseJudge, { active: false }, deactivatedAt);
    const reactivatedPlan = planJudgeUpdate(deactivated, { active: true }, reactivatedAt);

    expect(deactivated).toMatchObject({
      id: baseJudge.id,
      created_at: baseJudge.created_at,
      active: false,
      updated_at: deactivatedAt,
    });
    expect(reactivatedPlan.action).toBe('reactivate');
    expect(reactivatedPlan.nextJudge).toMatchObject({
      id: baseJudge.id,
      created_at: baseJudge.created_at,
      active: true,
      updated_at: reactivatedAt,
    });
  });
});

describe('route contract guards', () => {
  it('rejects malformed judge records before the UI can render them', () => {
    expect(() =>
      parseJudgeRecord(
        {
          ...baseJudge,
          active: 'true',
        },
        '/api/judges/judge-1 response'
      )
    ).toThrow('Malformed /api/judges/judge-1 response.');
  });

  it('pins the reviewer delete rejection contract', () => {
    expect(getReviewerDeleteRejection()).toEqual({
      status: 405,
      error: 'Judges are deactivated instead of deleted.',
      guidance:
        'Use PATCH with {"active":false} to deactivate the existing judge row or {"active":true} to reactivate it.',
    });
  });
});
