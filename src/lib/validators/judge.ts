import { z } from 'zod';

export const CreateJudgeSchema = z.object({
  name: z.string().min(1),
  system_prompt: z.string().min(1),
  model: z.string().min(1),
  active: z.boolean().optional().default(true),
});

export const UpdateJudgeSchema = z.object({
  name: z.string().min(1).optional(),
  system_prompt: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  active: z.boolean().optional(),
});
