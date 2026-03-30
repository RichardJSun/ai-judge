import { z } from 'zod';
import type { QueueSubmissionsResponse, SubmissionDetailResponse } from '@/types/api';

const QueueSubmissionSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().min(1),
  labeling_task_id: z.string().min(1).nullable(),
  submitted_at: z.string().min(1).nullable(),
  created_at: z.string().min(1),
});

const QueueSubmissionsResponseSchema = z.object({
  submissions: z.array(QueueSubmissionSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

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

const SubmissionDetailAttachmentSchema = z
  .object({
    id: z.string().min(1),
    external_attachment_id: z.string().min(1),
    source_kind: z.string().min(1),
    file_name: z.string().min(1),
    media_type: z.string().min(1),
    byte_size: z.number().int().positive(),
    storage_status: z.enum(['stored', 'unavailable', 'error']),
    storage_error: z.string().min(1).nullable(),
  })
  .superRefine((value, context) => {
    if (value.storage_status === 'stored' && value.storage_error !== null) {
      context.addIssue({
        code: 'custom',
        path: ['storage_error'],
        message: 'Stored attachments cannot report a storage_error.',
      });
    }
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
  attachments: z.array(SubmissionDetailAttachmentSchema),
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

export function fetchQueueSubmissions(queueId: string, page: number) {
  return fetchJson(`/api/queues/${queueId}/submissions?page=${page}`, {
    fallbackMessage: 'Failed to load queue submissions.',
    parse: (value) => parseQueueSubmissionsResponse(value, `/api/queues/${queueId}/submissions?page=${page} response`),
  });
}

export function parseQueueSubmissionsResponse(
  value: unknown,
  context = 'queue submissions response'
): QueueSubmissionsResponse {
  const parsed = QueueSubmissionsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
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
