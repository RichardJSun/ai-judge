import type { SupabaseClient } from '@supabase/supabase-js';
import { APICallError, NoObjectGeneratedError } from 'ai';
import { describe, expect, it } from 'bun:test';
import {
  evaluateSingle,
  planEvaluationRequest,
  EvaluationPlanError,
  type EvaluationAttachment,
  type EvaluateParams,
  type EvaluateSingleDeps,
} from '@/lib/ai/evaluator';

function createParams(overrides: Partial<EvaluateParams> = {}): EvaluateParams {
  return {
    evaluationId: 'evaluation-1',
    submissionId: 'submission-1',
    questionText: 'How would you answer?',
    questionType: 'short_text',
    answerJson: { value: 'A careful answer' },
    judge: {
      id: 'judge-1',
      name: 'Judge One',
      system_prompt: 'Be precise.',
      model: 'gateway/model-a',
    },
    promptFields: ['questionType', 'questionText', 'answer'],
    attachmentForwarding: false,
    attachments: [],
    ...overrides,
  };
}

function createAttachment(overrides: Partial<EvaluationAttachment> = {}): EvaluationAttachment {
  return {
    id: 'attachment-1',
    submissionId: 'submission-1',
    externalAttachmentId: 'external-attachment-1',
    sourceKind: 'inline',
    fileName: 'blob.png',
    mediaType: 'image/png',
    byteSize: 1024,
    storageBucket: 'uploads',
    storagePath: 'uploads/blob.png',
    storageStatus: 'stored',
    storageError: null,
    ...overrides,
  };
}

function createSupabaseMock(options: { failUpdateAt?: number; errorMessage?: string } = {}) {
  const updates: Array<{
    table: string;
    values: Record<string, unknown>;
    filters: Array<{ column: string; value: string }>;
  }> = [];
  let updateCount = 0;

  const supabase = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          const entry = { table, values, filters: [] as Array<{ column: string; value: string }> };
          updates.push(entry);

          return {
            async eq(column: string, value: string) {
              entry.filters.push({ column, value });
              updateCount += 1;

              if (options.failUpdateAt === updateCount) {
                return { error: new Error(options.errorMessage ?? 'db write failed') };
              }

              return { error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { supabase, updates };
}

function createDeps(options: {
  nowValues?: number[];
  generate?: EvaluateSingleDeps['generate'];
} = {}) {
  const state = {
    generateCalls: [] as Array<{ modelId: string; system: string; prompt: string }>,
    sleepCalls: [] as number[],
  };
  const nowValues = options.nowValues ?? [1000, 1150];
  let nowIndex = 0;

  const deps: EvaluateSingleDeps = {
    now() {
      const value = nowValues[Math.min(nowIndex, nowValues.length - 1)] ?? 0;
      nowIndex += 1;
      return value;
    },
    async sleep(ms) {
      state.sleepCalls.push(ms);
    },
    async generate(input) {
      state.generateCalls.push(input);

      if (options.generate) {
        return options.generate(input);
      }

      return {
        output: { verdict: 'pass', reasoning: 'Grounded reasoning.' },
        response: { modelId: 'gateway/model-a:final' },
        usage: { totalTokens: 321 },
      };
    },
  };

  return { deps, state };
}

function createNoObjectGeneratedError(options: {
  message?: string;
  text?: string;
  totalTokens?: number;
  modelId?: string;
  cause?: Error;
} = {}) {
  return new NoObjectGeneratedError({
    message: options.message,
    text: options.text,
    cause: options.cause,
    finishReason: 'stop',
    response: {
      id: 'response-1',
      timestamp: new Date('2026-03-28T00:00:00.000Z'),
      modelId: options.modelId ?? 'gateway/model-a:structured',
    },
    usage: {
      inputTokens: 10,
      inputTokenDetails: {
        noCacheTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 4,
      outputTokenDetails: {
        textTokens: 4,
        reasoningTokens: 0,
      },
      totalTokens: options.totalTokens ?? 14,
    },
  });
}

describe('evaluateSingle', () => {
  for (const statusCode of [429, 502, 503]) {
    it(`retries transient provider status ${statusCode} and persists success audit fields`, async () => {
      const { supabase, updates } = createSupabaseMock();
      let attempts = 0;
      const { deps, state } = createDeps({
        nowValues: [1000, 1480],
        async generate(input) {
          attempts += 1;

          if (attempts < 3) {
            throw new APICallError({
              message: `Provider failed with ${statusCode}`,
              statusCode,
              url: 'https://gateway.test',
              requestBodyValues: { prompt: input.prompt },
            });
          }

          return {
            output: { verdict: 'pass', reasoning: 'Recovered after retry.' },
            response: { modelId: 'gateway/model-a:provider' },
            usage: { totalTokens: 144 },
          };
        },
      });

      await evaluateSingle(supabase, createParams(), deps);

      expect(attempts).toBe(3);
      expect(state.sleepCalls).toEqual([1000, 2000]);
      expect(updates).toHaveLength(2);
      expect(updates[0]?.values).toMatchObject({
        status: 'running',
        model_used: 'gateway/model-a',
        retry_count: 0,
      });
      expect(updates[0]?.values.prompt_snapshot).toBeDefined();
      const runningSnapshot = String(updates[0]?.values.prompt_snapshot);
      expect(runningSnapshot).toContain('[System]\nBe precise.');
      expect(runningSnapshot).toContain('Question Type: short_text');
      expect(runningSnapshot).toContain('Answer:\nvalue: "A careful answer"');
      expect(runningSnapshot).toContain('[Attachments]');
      expect(runningSnapshot).toContain('Plan: text-only');
      expect(updates[1]?.values).toMatchObject({
        status: 'completed',
        verdict: 'pass',
        reasoning: 'Recovered after retry.',
        model_used: 'gateway/model-a:provider',
        tokens_used: 144,
        latency_ms: 480,
        retry_count: 2,
        error_message: null,
      });
    });
  }

  it('retries status-less network failures and caps transient retry counts on terminal failure', async () => {
    const { supabase, updates } = createSupabaseMock();
    let attempts = 0;
    const { deps, state } = createDeps({
      nowValues: [2000, 4200],
      async generate(input) {
        attempts += 1;

        throw new APICallError({
          message: 'Cannot connect to API: socket hang up',
          url: 'https://gateway.test',
          requestBodyValues: { prompt: input.prompt },
          isRetryable: true,
        });
      },
    });

    await expect(evaluateSingle(supabase, createParams(), deps)).rejects.toThrow(
      'Cannot connect to API: socket hang up'
    );

    expect(attempts).toBe(4);
    expect(state.sleepCalls).toEqual([1000, 2000, 4000]);
    expect(updates.at(-1)?.values).toMatchObject({
      status: 'error',
      model_used: 'gateway/model-a',
      retry_count: 3,
      error_message: 'Cannot connect to API: socket hang up',
      latency_ms: 2200,
      tokens_used: null,
      verdict: null,
      reasoning: null,
    });
  });

  it('retries timeout failures even when the provider does not set a retryable status code', async () => {
    const { supabase, updates } = createSupabaseMock();
    let attempts = 0;
    const timeoutCause = Object.assign(new Error('Headers timeout'), {
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    const { deps, state } = createDeps({
      nowValues: [3000, 3600],
      async generate(input) {
        attempts += 1;

        if (attempts === 1) {
          throw new APICallError({
            message: 'Gateway request failed',
            url: 'https://gateway.test',
            requestBodyValues: { prompt: input.prompt },
            cause: timeoutCause,
          });
        }

        return {
          output: { verdict: 'fail', reasoning: 'Timeout recovered.' },
          response: { modelId: 'gateway/model-a:provider' },
          usage: { totalTokens: 99 },
        };
      },
    });

    await evaluateSingle(supabase, createParams(), deps);

    expect(attempts).toBe(2);
    expect(state.sleepCalls).toEqual([1000]);
    expect(updates.at(-1)?.values).toMatchObject({
      status: 'completed',
      verdict: 'fail',
      reasoning: 'Timeout recovered.',
      retry_count: 1,
      latency_ms: 600,
    });
  });

  it('treats malformed structured output as terminal and persists the raw audit context', async () => {
    const { supabase, updates } = createSupabaseMock();
    const malformed = createNoObjectGeneratedError({
      message: 'No object generated: response did not match schema.',
      text: '{"verdict":"pass","reasoning":""}',
      totalTokens: 77,
      cause: new Error('reasoning must be at least 1 character'),
    });
    const { deps, state } = createDeps({
      nowValues: [4000, 4095],
      async generate() {
        throw malformed;
      },
    });

    await expect(evaluateSingle(supabase, createParams(), deps)).rejects.toBe(malformed);

    expect(state.sleepCalls).toEqual([]);
    expect(updates.at(-1)?.values).toMatchObject({
      status: 'error',
      model_used: 'gateway/model-a:structured',
      retry_count: 0,
      tokens_used: 77,
      latency_ms: 95,
      verdict: null,
      reasoning: null,
    });
    expect(String(updates.at(-1)?.values.error_message)).toContain('raw_output={"verdict":"pass","reasoning":""}');
    expect(String(updates.at(-1)?.values.error_message)).toContain(
      'cause=reasoning must be at least 1 character'
    );
  });

  it('stops immediately on non-retryable provider failures even when the SDK marks them retryable', async () => {
    const { supabase, updates } = createSupabaseMock();
    let attempts = 0;
    const { deps, state } = createDeps({
      nowValues: [5000, 5300],
      async generate(input) {
        attempts += 1;

        throw new APICallError({
          message: 'Gateway internal error',
          statusCode: 500,
          url: 'https://gateway.test',
          requestBodyValues: { prompt: input.prompt },
          responseBody: '{"error":"upstream"}',
          isRetryable: true,
        });
      },
    });

    await expect(evaluateSingle(supabase, createParams(), deps)).rejects.toThrow('Gateway internal error');

    expect(attempts).toBe(1);
    expect(state.sleepCalls).toEqual([]);
    expect(updates.at(-1)?.values).toMatchObject({
      status: 'error',
      model_used: 'gateway/model-a',
      retry_count: 0,
      latency_ms: 300,
      error_message: 'Gateway internal error | status=500 | response={"error":"upstream"}',
    });
  });

  it('handles malformed answer payloads during prompt assembly without throwing before persistence', async () => {
    const { supabase, updates } = createSupabaseMock();
    const { deps, state } = createDeps();

    await evaluateSingle(
      supabase,
      createParams({ answerJson: null as unknown as Record<string, unknown> }),
      deps
    );

    expect(state.generateCalls).toHaveLength(1);
    expect(state.generateCalls[0]?.prompt).toContain('Answer:\nnull');
    expect(updates.at(-1)?.values).toMatchObject({
      status: 'completed',
      verdict: 'pass',
    });
  });

  it('bubbles Supabase write failures after leaving the row in its last truthful state', async () => {
    const { supabase, updates } = createSupabaseMock({ failUpdateAt: 2, errorMessage: 'audit update failed' });
    const { deps } = createDeps();

    await expect(evaluateSingle(supabase, createParams(), deps)).rejects.toThrow('audit update failed');

    expect(updates).toHaveLength(2);
    expect(updates[0]?.values).toMatchObject({
      status: 'running',
      model_used: 'gateway/model-a',
      prompt_snapshot: expect.stringContaining('[System]\nBe precise.'),
    });
    expect(updates[1]?.values).toMatchObject({
      status: 'completed',
      verdict: 'pass',
      reasoning: 'Grounded reasoning.',
      model_used: 'gateway/model-a:final',
      tokens_used: 321,
      retry_count: 0,
    });
  });

  it('keeps text-only plan when attachments exist but forwarding is disabled', async () => {
    const attachments = [
      createAttachment({ externalAttachmentId: 'b', fileName: 'beta.png' }),
      createAttachment({ externalAttachmentId: 'a', fileName: 'alpha.png' }),
    ];
    const { supabase, updates } = createSupabaseMock();
    const { deps, state } = createDeps();

    await evaluateSingle(
      supabase,
      createParams({ attachmentForwarding: false, attachments }),
      deps
    );

    expect(state.generateCalls).toHaveLength(1);
    const snapshot = updates[0]?.values.prompt_snapshot as string;
    expect(snapshot).toContain('Forwarding requested: no');
    expect(snapshot).toContain('Plan: text-only');
    expect(snapshot.indexOf('externalAttachmentId=a')).toBeLessThan(snapshot.indexOf('externalAttachmentId=b'));
    expect(updates[1]?.values.status).toBe('completed');
  });

  it('blocks unknown models when attachment forwarding is requested', async () => {
    const unknownModel = 'gateway/unknown-multimodal';
    const attachments = [createAttachment()];
    const { supabase, updates } = createSupabaseMock();
    const { deps, state } = createDeps();
    const params = createParams({
      judge: {
        id: 'judge-unknown',
        name: 'Judge Unknown',
        system_prompt: 'Be precise.',
        model: unknownModel,
      },
      attachmentForwarding: true,
      attachments,
    });
    const blockedReason = `Model ${unknownModel} is not configured to accept forwarded attachments.`;

    let caughtError: unknown;
    await evaluateSingle(supabase, params, deps).catch((error) => {
      caughtError = error;
    });

    expect(caughtError).toBeInstanceOf(EvaluationPlanError);
    expect((caughtError as Error).message).toBe(blockedReason);
    expect(state.generateCalls).toHaveLength(0);
    expect(updates).toHaveLength(2);
    expect(updates[1]?.values).toMatchObject({
      status: 'error',
      model_used: unknownModel,
      error_message: blockedReason,
    });
    expect((updates[1]?.values.prompt_snapshot as string)).toContain('Plan: blocked');
    expect((updates[1]?.values.prompt_snapshot as string)).toContain('Forwarding requested: yes');
  });

  it('blocks unsupported media types when attachments are forwarded', async () => {
    const attachments = [createAttachment({ mediaType: 'video/mp4', externalAttachmentId: 'video-1' })];
    const { supabase, updates } = createSupabaseMock();
    const { deps, state } = createDeps();
    const supportedModel = 'gateway/multimodal-model';
    const params = createParams({
      judge: {
        id: 'judge-vision',
        name: 'Judge Vision',
        system_prompt: 'Be precise.',
        model: supportedModel,
      },
      attachmentForwarding: true,
      attachments,
    });
    const blockedReason = `Attachment ${attachments[0].externalAttachmentId} uses unsupported media type ${attachments[0].mediaType} for model ${supportedModel}. Supported types: image/png, image/jpeg.`;

    await expect(evaluateSingle(supabase, params, deps)).rejects.toThrow(blockedReason);

    expect(state.generateCalls).toHaveLength(0);
    expect(updates[1]?.values).toMatchObject({
      status: 'error',
      error_message: blockedReason,
    });
  });

  it('blocks malformed attachment metadata before provider invocation', async () => {
    const malformed = createAttachment({ fileName: '' });
    const { supabase, updates } = createSupabaseMock();
    const { deps, state } = createDeps();
    const params = createParams({
      judge: {
        id: 'judge-vision',
        name: 'Judge Vision',
        system_prompt: 'Be precise.',
        model: 'gateway/multimodal-model',
      },
      attachmentForwarding: true,
      attachments: [malformed],
    });
    const blockedReason = `Attachment ${malformed.externalAttachmentId} missing fileName.`;

    await expect(evaluateSingle(supabase, params, deps)).rejects.toThrow(blockedReason);

    expect(state.generateCalls).toHaveLength(0);
    expect(updates[1]?.values).toMatchObject({
      status: 'error',
      error_message: blockedReason,
    });
  });
});

describe('planEvaluationRequest', () => {
  it('returns multimodal plan for supported models and sorts the manifest entries', () => {
    const attachments = [
      createAttachment({ externalAttachmentId: 'z', fileName: 'z.png' }),
      createAttachment({ externalAttachmentId: 'a', fileName: 'a.png' }),
    ];
    const params = createParams({
      judge: {
        id: 'judge-vision',
        name: 'Judge Vision',
        system_prompt: 'Be precise.',
        model: 'gateway/multimodal-model',
      },
      attachmentForwarding: true,
      attachments,
    });

    const plan = planEvaluationRequest(params);

    expect(plan.kind).toBe('multimodal');
    expect(plan.supportedMedia).toEqual(['image/png', 'image/jpeg']);
    expect(plan.manifestText.indexOf('externalAttachmentId=a')).toBeLessThan(
      plan.manifestText.indexOf('externalAttachmentId=z')
    );
    expect(plan.manifestText).toContain('fileName=a.png');
  });
});
