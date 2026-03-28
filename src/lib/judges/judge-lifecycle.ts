import { z } from 'zod';
import { UpdateJudgeSchema } from '@/lib/validators/judge';
import type { Judge } from '@/types/db';

export const JudgeRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  system_prompt: z.string().min(1),
  model: z.string().min(1),
  active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const JudgeListSchema = z.array(JudgeRecordSchema);

export const JudgeUpdatePatchSchema = UpdateJudgeSchema.refine(
  (value) => Object.keys(value).length > 0,
  {
    message: 'Provide at least one judge field to update.',
  }
);

export type JudgeUpdatePatch = z.infer<typeof JudgeUpdatePatchSchema>;
export type JudgeLifecycleAction = 'edit' | 'deactivate' | 'reactivate';

const reviewerDeleteRejection = {
  status: 405,
  error: 'Judges are deactivated instead of deleted.',
  guidance:
    'Use PATCH with {"active":false} to deactivate the existing judge row or {"active":true} to reactivate it.',
} as const;

export function parseJudgeRecord(value: unknown, context = 'judge response'): Judge {
  const parsed = JudgeRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function parseJudgeList(value: unknown, context = 'judge list response'): Judge[] {
  const parsed = JudgeListSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function parseJudgeUpdatePatch(value: unknown) {
  return JudgeUpdatePatchSchema.safeParse(value);
}

export function resolveJudgeLifecycleAction(
  currentJudge: Pick<Judge, 'active'>,
  patch: JudgeUpdatePatch
): JudgeLifecycleAction {
  if (patch.active == null || patch.active === currentJudge.active) {
    return 'edit';
  }

  return patch.active ? 'reactivate' : 'deactivate';
}

export function applyJudgeUpdate(
  currentJudge: Judge,
  patch: JudgeUpdatePatch,
  updatedAt: string
): Judge {
  return {
    ...currentJudge,
    ...patch,
    updated_at: updatedAt,
  };
}

export function planJudgeUpdate(
  currentJudge: Judge,
  patch: JudgeUpdatePatch,
  updatedAt = new Date().toISOString()
) {
  return {
    action: resolveJudgeLifecycleAction(currentJudge, patch),
    databasePatch: {
      ...patch,
      updated_at: updatedAt,
    },
    nextJudge: applyJudgeUpdate(currentJudge, patch, updatedAt),
  };
}

export function getReviewerDeleteRejection() {
  return reviewerDeleteRejection;
}
