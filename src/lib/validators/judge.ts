import { z } from 'zod';

const RequiredJudgeTextSchema = z.string().trim().min(1);
const OptionalJudgeTextSchema = z.string().trim().min(1).optional();

export const CreateJudgeSchema = z.object({
  name: RequiredJudgeTextSchema,
  system_prompt: RequiredJudgeTextSchema,
  model: RequiredJudgeTextSchema,
  active: z.boolean().optional().default(true),
});

export const UpdateJudgeSchema = z.object({
  name: OptionalJudgeTextSchema,
  system_prompt: OptionalJudgeTextSchema,
  model: OptionalJudgeTextSchema,
  active: z.boolean().optional(),
});
