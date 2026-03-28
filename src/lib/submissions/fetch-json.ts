import { z } from 'zod';
import type { SubmissionDetailResponse } from '@/types/api';

const SubmissionDetailAnswerSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

const SubmissionDetailQuestionSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().min(1),
  question_type: z.string().nullable(),
  question_text: z.string().min(1),
  created_at: z.string().min(1),
  answerState: z.enum(['answered', 'missing']),
  answer: SubmissionDetailAnswerSchema,
  rawAnswer: z.record(z.string(), z.unknown()).nullable(),
});

const SubmissionDetailResponseSchema = z.object({
  queue: z.object({
    id: z.string().min(1),
    queue_id: z.string().min(1),
    created_at: z.string().min(1),
  }),
  submission: z.object({
    id: z.string().min(1),
    queue_id: z.string().min(1),
    external_id: z.string().min(1),
    labeling_task_id: z.string().nullable(),
    submitted_at: z.string().nullable(),
    created_at: z.string().min(1),
  }),
  summary: z.object({
    totalQuestions: z.number().int().nonnegative(),
    answeredQuestions: z.number().int().nonnegative(),
    missingQuestions: z.number().int().nonnegative(),
  }),
  questions: z.array(SubmissionDetailQuestionSchema),
});

interface FetchJsonOptions<T> {
  fallbackMessage: string;
  parse: (value: unknown) => T;
  init?: RequestInit;
}

export async function fetchJson<T>(input: RequestInfo | URL, options: FetchJsonOptions<T>): Promise<T> {
  const response = await fetch(input, options.init);
  const body = await readResponseBody(response, options.fallbackMessage);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, options.fallbackMessage));
  }

  return options.parse(body);
}

export function parseSubmissionDetailResponse(
  value: unknown,
  context = 'submission detail response'
): SubmissionDetailResponse {
  const parsed = SubmissionDetailResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

async function readResponseBody(response: Response, fallbackMessage: string) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${fallbackMessage} The server returned invalid JSON.`);
  }
}

function getApiErrorMessage(payload: unknown, fallbackMessage: string) {
  if (typeof payload === 'object' && payload !== null) {
    const candidate = payload as { error?: unknown; detail?: unknown };

    if (typeof candidate.error === 'string' && typeof candidate.detail === 'string') {
      return `${candidate.error} ${candidate.detail}`;
    }

    if (typeof candidate.error === 'string') {
      return candidate.error;
    }
  }

  return fallbackMessage;
}
