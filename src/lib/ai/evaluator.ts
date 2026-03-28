import type { SupabaseClient } from '@supabase/supabase-js';
import { APICallError, generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { gateway } from './gateway';

const VerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'inconclusive']),
  reasoning: z.string().trim().min(1),
});

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503]);
const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const MAX_RETRIES = 3;
const MAX_ERROR_CONTEXT_LENGTH = 500;

type VerdictResult = z.infer<typeof VerdictSchema>;

type EvaluationStatus = 'running' | 'completed' | 'error';

type EvaluationAuditPatch = {
  status: EvaluationStatus;
  prompt_snapshot: string;
  model_used: string;
  retry_count: number;
  error_message: string | null;
  latency_ms: number | null;
  tokens_used: number | null;
  verdict: VerdictResult['verdict'] | null;
  reasoning: string | null;
};

export interface EvaluateParams {
  evaluationId: string;
  submissionId: string;
  questionText: string;
  questionType: string | null;
  answerJson: Record<string, unknown>;
  judge: { id: string; name: string; system_prompt: string; model: string };
  promptFields: string[];
}

export interface EvaluateSingleDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  generate(input: {
    modelId: string;
    system: string;
    prompt: string;
  }): Promise<{
    output: VerdictResult;
    response: { modelId?: string | null };
    usage: { totalTokens: number | undefined };
  }>;
}

const defaultEvaluateSingleDeps: EvaluateSingleDeps = {
  now: () => Date.now(),
  sleep,
  async generate({ modelId, system, prompt }) {
    const result = await generateText({
      model: gateway(modelId),
      system,
      prompt,
      output: Output.object({ schema: VerdictSchema }),
    });

    return {
      output: result.output,
      response: { modelId: result.response.modelId },
      usage: { totalTokens: result.totalUsage.totalTokens ?? result.usage.totalTokens },
    };
  },
};

function buildPrompt(params: EvaluateParams): string {
  const { questionText, questionType, answerJson, promptFields } = params;
  const parts: string[] = [];

  if (promptFields.includes('questionType') && questionType) {
    parts.push(`Question Type: ${questionType}`);
  }
  if (promptFields.includes('questionText')) {
    parts.push(`Question: ${questionText}`);
  }
  if (promptFields.includes('answer')) {
    parts.push(`Answer:\n${formatAnswer(answerJson)}`);
  }

  return parts.join('\n\n');
}

function formatAnswer(answerJson: unknown): string {
  if (answerJson != null && typeof answerJson === 'object' && !Array.isArray(answerJson)) {
    const entries = Object.entries(answerJson);
    if (!entries.length) {
      return '{}';
    }

    return entries.map(([key, value]) => `${key}: ${safeJsonStringify(value)}`).join('\n');
  }

  if (Array.isArray(answerJson)) {
    return safeJsonStringify(answerJson);
  }

  return String(answerJson);
}

async function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function evaluateSingle(
  supabase: SupabaseClient,
  params: EvaluateParams,
  deps: EvaluateSingleDeps = defaultEvaluateSingleDeps
): Promise<void> {
  const { evaluationId, judge } = params;
  const prompt = buildPrompt(params);
  const promptSnapshot = `[System]\n${judge.system_prompt}\n\n[User]\n${prompt}`;

  let retryCount = 0;
  let lastTokensUsed: number | null = null;

  await updateEvaluation(
    supabase,
    evaluationId,
    buildAuditPatch({
      status: 'running',
      promptSnapshot,
      modelUsed: judge.model,
      retryCount: 0,
      errorMessage: null,
      latencyMs: null,
      tokensUsed: null,
      verdict: null,
      reasoning: null,
    })
  );

  const startedAt = deps.now();

  while (true) {
    let result: Awaited<ReturnType<EvaluateSingleDeps['generate']>>;

    try {
      result = await deps.generate({
        modelId: judge.model,
        system: judge.system_prompt,
        prompt,
      });
    } catch (error) {
      lastTokensUsed = extractTokensUsed(error) ?? lastTokensUsed;

      if (shouldRetry(error) && retryCount < MAX_RETRIES) {
        retryCount += 1;
        await deps.sleep(getRetryDelayMs(retryCount));
        continue;
      }

      await updateEvaluation(
        supabase,
        evaluationId,
        buildAuditPatch({
          status: 'error',
          promptSnapshot,
          modelUsed: extractModelUsed(error) ?? judge.model,
          retryCount,
          errorMessage: formatErrorMessage(error),
          latencyMs: deps.now() - startedAt,
          tokensUsed: lastTokensUsed,
          verdict: null,
          reasoning: null,
        })
      );

      throw asError(error);
    }

    lastTokensUsed = result.usage.totalTokens ?? null;

    await updateEvaluation(
      supabase,
      evaluationId,
      buildAuditPatch({
        status: 'completed',
        promptSnapshot,
        modelUsed: result.response.modelId ?? judge.model,
        retryCount,
        errorMessage: null,
        latencyMs: deps.now() - startedAt,
        tokensUsed: lastTokensUsed,
        verdict: result.output.verdict,
        reasoning: result.output.reasoning,
      })
    );
    return;
  }
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

async function updateEvaluation(
  supabase: SupabaseClient,
  evaluationId: string,
  patch: EvaluationAuditPatch
): Promise<void> {
  const { error } = await supabase.from('evaluations').update(patch).eq('id', evaluationId);

  if (error) {
    throw error;
  }
}

function buildAuditPatch(input: {
  status: EvaluationStatus;
  promptSnapshot: string;
  modelUsed: string;
  retryCount: number;
  errorMessage: string | null;
  latencyMs: number | null;
  tokensUsed: number | null;
  verdict: VerdictResult['verdict'] | null;
  reasoning: string | null;
}): EvaluationAuditPatch {
  return {
    status: input.status,
    prompt_snapshot: input.promptSnapshot,
    model_used: input.modelUsed,
    retry_count: input.retryCount,
    error_message: input.errorMessage,
    latency_ms: input.latencyMs,
    tokens_used: input.tokensUsed,
    verdict: input.verdict,
    reasoning: input.reasoning,
  };
}

function shouldRetry(error: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(error)) {
    return false;
  }

  const statusCode = extractStatusCode(error);
  if (statusCode != null && RETRYABLE_STATUS_CODES.has(statusCode)) {
    return true;
  }

  if (isTimeoutError(error)) {
    return true;
  }

  return APICallError.isInstance(error) && error.statusCode == null && error.isRetryable === true;
}

function getRetryDelayMs(retryCount: number): number {
  return 1000 * Math.pow(2, retryCount - 1);
}

function isTimeoutError(error: unknown): boolean {
  for (const candidate of iterateErrorChain(error)) {
    if (!(candidate instanceof Error)) {
      continue;
    }

    const candidateWithCode = candidate as Error & { code?: unknown };
    const code = typeof candidateWithCode.code === 'string' ? candidateWithCode.code : undefined;

    if (
      candidate.name === 'AbortError' ||
      candidate.name === 'TimeoutError' ||
      code === 'ABORT_ERR' ||
      (code != null && TIMEOUT_ERROR_CODES.has(code))
    ) {
      return true;
    }

    if (extractStatusCode(candidate) === 408) {
      return true;
    }
  }

  return false;
}

function extractStatusCode(error: unknown): number | undefined {
  for (const candidate of iterateErrorChain(error)) {
    if (APICallError.isInstance(candidate)) {
      return candidate.statusCode;
    }

    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as { statusCode?: unknown }).statusCode === 'number'
    ) {
      return (candidate as { statusCode: number }).statusCode;
    }
  }

  return undefined;
}

function extractTokensUsed(error: unknown): number | null {
  if (NoObjectGeneratedError.isInstance(error)) {
    return error.usage?.totalTokens ?? null;
  }

  return null;
}

function extractModelUsed(error: unknown): string | null {
  if (NoObjectGeneratedError.isInstance(error)) {
    return error.response?.modelId ?? null;
  }

  return null;
}

function formatErrorMessage(error: unknown): string {
  const parts = [getErrorMessage(error)];
  const statusCode = extractStatusCode(error);
  if (statusCode != null) {
    parts.push(`status=${statusCode}`);
  }

  if (APICallError.isInstance(error) && error.responseBody) {
    parts.push(`response=${truncate(error.responseBody)}`);
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.cause instanceof Error) {
      parts.push(`cause=${error.cause.message}`);
    }
    if (error.text) {
      parts.push(`raw_output=${truncate(error.text)}`);
    }
  }

  return parts.join(' | ');
}

function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch (error) {
    return `[Unserializable value: ${getErrorMessage(error)}]`;
  }
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_CONTEXT_LENGTH
    ? `${value.slice(0, MAX_ERROR_CONTEXT_LENGTH)}…`
    : value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function* iterateErrorChain(error: unknown): Generator<unknown> {
  let current = error;
  let depth = 0;

  while (current != null && depth < 10) {
    yield current;

    if (typeof current !== 'object' || current === null || !('cause' in current)) {
      return;
    }

    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }
}
