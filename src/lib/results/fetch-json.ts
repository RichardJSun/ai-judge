import { z } from 'zod';
import type {
  ResultsFilterJudge as ApiResultsFilterJudge,
  ResultsFilterMetadata as ApiResultsFilterMetadata,
  ResultsFilterQuestion as ApiResultsFilterQuestion,
  ResultsResponse,
} from '@/types/api';

const VerdictSchema = z.enum(['pass', 'fail', 'inconclusive']);
const EvalStatusSchema = z.enum(['pending', 'running', 'completed', 'error']);

const ResultsFilterJudgeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
});

const ResultsFilterQuestionSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().min(1).nullable(),
  question_text: z.string().min(1),
});

const ResultsFilterQuestionListSchema = z.array(ResultsFilterQuestionSchema);

const ResultsFilterMetadataSchema = z.object({
  judges: z.array(ResultsFilterJudgeSchema),
  questions: z.array(ResultsFilterQuestionSchema),
  verdicts: z.array(VerdictSchema),
});

const ResultsResponseSchema = z.object({
  evaluations: z.array(
    z.object({
      id: z.string().min(1),
      verdict: VerdictSchema.nullable(),
      reasoning: z.string().nullable(),
      prompt_snapshot: z.string().nullable(),
      model_used: z.string().nullable(),
      tokens_used: z.number().int().nonnegative().nullable(),
      latency_ms: z.number().nonnegative().nullable(),
      retry_count: z.number().int().nonnegative(),
      error_message: z.string().nullable(),
      created_at: z.string().min(1),
      status: EvalStatusSchema,
      submission: z.object({
        id: z.string().min(1),
        external_id: z.string().min(1),
      }),
      question: z.object({
        id: z.string().min(1),
        external_id: z.string().min(1),
        question_text: z.string().min(1),
      }),
      judge: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        model: z.string().min(1),
      }),
    })
  ),
  total: z.number().int().nonnegative(),
  passRate: z.number().int().min(0).max(100),
  judgePassRates: z.array(
    z.object({
      judgeId: z.string().min(1),
      name: z.string().min(1),
      passRate: z.number().int().min(0).max(100),
      total: z.number().int().nonnegative(),
    })
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  filterMetadata: ResultsFilterMetadataSchema,
});

export type ResultsFilterJudge = ApiResultsFilterJudge;
export type ResultsFilterQuestion = ApiResultsFilterQuestion;
export type ResultsFilterMetadata = ApiResultsFilterMetadata;

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

export function parseResultsFilterQuestionList(
  value: unknown,
  context = 'queue questions response'
): ResultsFilterQuestion[] {
  const parsed = ResultsFilterQuestionListSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function parseResultsFilterMetadata(
  value: unknown,
  context = 'results filter metadata'
): ResultsFilterMetadata {
  const parsed = ResultsFilterMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function parseResultsResponse(value: unknown, context = 'results response'): ResultsResponse {
  const parsed = ResultsResponseSchema.safeParse(value);
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
