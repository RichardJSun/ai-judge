import { z } from 'zod';

const RawQuestionSchema = z.object({
  rev: z.number(),
  data: z.object({
    id: z.string(),
    questionType: z.string().optional(),
    questionText: z.string(),
  }).passthrough(),
});

export const RawSubmissionSchema = z.object({
  id: z.string(),
  queueId: z.string(),
  labelingTaskId: z.string().optional(),
  createdAt: z.number().optional(),
  questions: z.array(RawQuestionSchema),
  answers: z.record(z.string(), z.record(z.string(), z.unknown())),
}).passthrough();

export const SubmissionFileSchema = z.array(RawSubmissionSchema);

export type ValidatedSubmission = z.infer<typeof RawSubmissionSchema>;
