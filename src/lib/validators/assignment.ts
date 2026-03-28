import { z } from 'zod';

export const CreateAssignmentSchema = z.object({
  judge_id: z.string().uuid(),
  question_template_id: z.string().uuid(),
  prompt_fields: z.array(z.string()).optional().default(['questionText', 'answer']),
  attachment_forwarding: z.boolean().optional().default(false),
});

export const DeleteAssignmentSchema = z.object({
  judge_id: z.string().uuid(),
  question_template_id: z.string().uuid(),
});
