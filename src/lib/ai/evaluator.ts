import { generateObject } from 'ai';
import { z } from 'zod';
import { gateway } from './gateway';
import type { SupabaseClient } from '@supabase/supabase-js';

const VerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'inconclusive']),
  reasoning: z.string(),
});

const RETRYABLE_STATUS = [429, 502, 503];
const MAX_RETRIES = 3;

export interface EvaluateParams {
  evaluationId: string;
  submissionId: string;
  questionText: string;
  questionType: string | null;
  answerJson: Record<string, unknown>;
  judge: { id: string; name: string; system_prompt: string; model: string };
  promptFields: string[];
}

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
    const answerStr = typeof answerJson === 'object'
      ? Object.entries(answerJson)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\n')
      : String(answerJson);
    parts.push(`Answer:\n${answerStr}`);
  }

  return parts.join('\n\n');
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function evaluateSingle(
  supabase: SupabaseClient,
  params: EvaluateParams
): Promise<void> {
  const { evaluationId, judge, promptFields } = params;
  const prompt = buildPrompt(params);
  const promptSnapshot = `[System]\n${judge.system_prompt}\n\n[User]\n${prompt}`;

  let retryCount = 0;
  let lastError: Error | null = null;

  // Mark as running
  await supabase
    .from('evaluations')
    .update({ status: 'running', prompt_snapshot: promptSnapshot })
    .eq('id', evaluationId);

  while (retryCount <= MAX_RETRIES) {
    const start = Date.now();
    try {
      const result = await generateObject({
        model: gateway(judge.model),
        schema: VerdictSchema,
        system: judge.system_prompt,
        prompt,
      });

      const latencyMs = Date.now() - start;
      await supabase
        .from('evaluations')
        .update({
          status: 'completed',
          verdict: result.object.verdict,
          reasoning: result.object.reasoning,
          model_used: judge.model,
          tokens_used: result.usage?.totalTokens ?? null,
          latency_ms: latencyMs,
          retry_count: retryCount,
          error_message: null,
        })
        .eq('id', evaluationId);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as { status?: number })?.status;

      if (!status || !RETRYABLE_STATUS.includes(status) || retryCount >= MAX_RETRIES) {
        break;
      }

      retryCount++;
      await sleep(1000 * Math.pow(2, retryCount - 1));
    }
  }

  // Terminal failure
  await supabase
    .from('evaluations')
    .update({
      status: 'error',
      retry_count: retryCount,
      error_message: lastError?.message ?? 'Unknown error',
    })
    .eq('id', evaluationId);
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
