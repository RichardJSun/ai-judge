import { describe, expect, it } from 'bun:test';
import { parsePlanMarker } from '../src/lib/ai/plan-marker';
import type { ResultsEvaluation } from '../src/types/api';
import {
  buildScenarioConfigs,
  ensureGatewayEnvConfigured,
  formatVerifierSummary,
  parseVerifierOptions,
  pollForScenarios,
  runPhase,
  VerifierPhaseError,
  type LiveVerificationSummary,
  type ScenarioName,
  type ScenarioResult,
} from './verify-m005-s03';

describe('parseVerifierOptions', () => {
  it('requires --base-url when no fallback is provided', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });

  it('parses optional CLI flags and normalizes the base URL', () => {
    expect(
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000/',
        '--fixture',
        'scripts/custom.fixture.json',
        '--timeout-ms',
        '9000',
        '--poll-ms',
        '500',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/custom.fixture.json',
      timeoutMs: 9000,
      pollMs: 500,
    });
  });

  it('rejects non-integer --timeout-ms overrides', () => {
    expect(() =>
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000',
        '--timeout-ms',
        'not-an-integer',
      ])
    ).toThrow('--timeout-ms must be a positive integer.');
  });

  it('rejects non-integer --poll-ms overrides', () => {
    expect(() =>
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000',
        '--poll-ms=-5',
      ])
    ).toThrow('--poll-ms must be a positive integer.');
  });
});

describe('readiness helpers', () => {
  it('fails when AI_GATEWAY_API_KEY is missing', () => {
    const originalKey = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    expect(() => ensureGatewayEnvConfigured()).toThrow('AI_GATEWAY_API_KEY');
    if (originalKey !== undefined) {
      process.env.AI_GATEWAY_API_KEY = originalKey;
    } else {
      delete process.env.AI_GATEWAY_API_KEY;
    }
  });
});

describe('runPhase', () => {
  it('wraps errors with phase and refs', async () => {
    await expect(
      runPhase('run-start', { queueId: 'queue-1' }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('[verify:m005-s03] phase=run-start queueId=queue-1 boom');
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('run-start', 'plan failed', { queueId: 'queue-1' });
    await expect(
      runPhase('run-start', { queueId: 'queue-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('formatVerifierSummary', () => {
  it('formats queue, run, and evaluation coordinates for S04', () => {
    const evaluations: ScenarioResult[] = [
      {
        scenario: 'text-only',
        evaluationId: 'eval-text',
        judgeId: 'judge-text',
        judgeName: 'Text Judge',
        status: 'completed',
        promptSnapshot:
          'Forwarding requested: no\nPlan: text-only\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}',
        modelUsed: 'openai/gpt-oss-120b',
        errorMessage: null,
      },
      {
        scenario: 'multimodal',
        evaluationId: 'eval-multi',
        judgeId: 'judge-multi',
        judgeName: 'Multimodal Judge',
        status: 'completed',
        promptSnapshot:
          'Forwarding requested: yes\nPlan: multimodal\nPlan marker: {"version":1,"kind":"multimodal","forwardingRequested":true,"supportedMedia":["image/png","image/jpeg"]}',
        modelUsed: 'openai/gpt-4o-mini',
        errorMessage: null,
      },
      {
        scenario: 'blocked',
        evaluationId: 'eval-blocked',
        judgeId: 'judge-blocked',
        judgeName: 'Blocked Judge',
        status: 'error',
        promptSnapshot:
          'Forwarding requested: yes\nPlan: blocked\nPlan marker: {"version":1,"kind":"blocked","forwardingRequested":true,"blockedReason":"Model not configured"}',
        modelUsed: 'openai/gpt-oss-120b',
        errorMessage: 'Model not configured',
      },
    ];

    expect(parsePlanMarker(evaluations[0].promptSnapshot).kind).toBe('text-only');
    expect(parsePlanMarker(evaluations[1].promptSnapshot).kind).toBe('multimodal');
    expect(parsePlanMarker(evaluations[2].promptSnapshot).kind).toBe('blocked');

    const summary: LiveVerificationSummary = {
      queueId: 'queue-1',
      queueLabel: 'queue-proof',
      questionId: 'question-1',
      questionExternalId: 'q-proof-1',
      submissionId: 'submission-1',
      submissionExternalId: 'sub-proof-1',
      runId: 'run-1',
      evaluationSummaries: evaluations,
      resultsUrl: 'http://localhost/queues/queue-proof/results',
    };

    expect(formatVerifierSummary(summary)).toBe(
      'queue=queue-1 queueLabel=queue-proof run=run-1 question=question-1 questionExternalId=q-proof-1 submission=submission-1 submissionExternalId=sub-proof-1 evaluations=text-only=eval-text,multimodal=eval-multi,blocked=eval-blocked resultsUrl=http://localhost/queues/queue-proof/results'
    );
  });
});

describe('pollForScenarios', () => {
  it('finds the tracked scenarios across paginated queue results', async () => {
    const options = {
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/verify-m005-s01.fixture.json',
      timeoutMs: 1000,
      pollMs: 10,
    };

    const scenarioConfigs = buildScenarioConfigs();
    const scenarioMap = new Map<ScenarioName, { judgeId: string; judgeName: string }>([
      ['text-only', { judgeId: 'judge-text', judgeName: 'Text Judge' }],
      ['multimodal', { judgeId: 'judge-multi', judgeName: 'Multimodal Judge' }],
      ['blocked', { judgeId: 'judge-blocked', judgeName: 'Blocked Judge' }],
    ]);

    const unrelatedEvaluations: ResultsEvaluation[] = Array.from({ length: 25 }, (_, index) => ({
      id: `unrelated-${index + 1}`,
      verdict: 'pass',
      reasoning: 'ok',
      prompt_snapshot:
        'Forwarding requested: no\nPlan: text-only\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}',
      model_used: 'openai/gpt-4o-mini',
      tokens_used: 0,
      latency_ms: 0,
      retry_count: 0,
      error_message: null,
      created_at: '2024-01-01T00:00:00.000Z',
      status: 'completed',
      submission: { id: `submission-${index + 1}`, external_id: `submission-ext-${index + 1}` },
      question: { id: 'question-1', external_id: 'question-ext-1', question_text: 'Sample' },
      judge: { id: `judge-unrelated-${index + 1}`, name: `Unrelated Judge ${index + 1}`, model: 'openai/gpt-4o-mini' },
    }));

    const trackedEvaluations: ResultsEvaluation[] = [
      {
        id: 'eval-text',
        verdict: 'pass',
        reasoning: 'ok',
        prompt_snapshot:
          'Forwarding requested: no\nPlan: text-only\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}',
        model_used: 'openai/gpt-oss-120b',
        tokens_used: 0,
        latency_ms: 0,
        retry_count: 0,
        error_message: null,
        created_at: '2024-01-01T00:00:01.000Z',
        status: 'completed',
        submission: { id: 'submission-1', external_id: 'submission-ext-1' },
        question: { id: 'question-1', external_id: 'question-ext-1', question_text: 'Sample' },
        judge: { id: 'judge-text', name: 'Text Judge', model: 'openai/gpt-oss-120b' },
      },
      {
        id: 'eval-multi',
        verdict: 'pass',
        reasoning: 'ok',
        prompt_snapshot:
          'Forwarding requested: yes\nPlan: multimodal\nPlan marker: {"version":1,"kind":"multimodal","forwardingRequested":true,"supportedMedia":["image/png","image/jpeg"]}',
        model_used: 'openai/gpt-4o-mini',
        tokens_used: 0,
        latency_ms: 0,
        retry_count: 0,
        error_message: null,
        created_at: '2024-01-01T00:00:01.000Z',
        status: 'completed',
        submission: { id: 'submission-1', external_id: 'submission-ext-1' },
        question: { id: 'question-1', external_id: 'question-ext-1', question_text: 'Sample' },
        judge: { id: 'judge-multi', name: 'Multimodal Judge', model: 'openai/gpt-4o-mini' },
      },
      {
        id: 'eval-blocked',
        verdict: null,
        reasoning: null,
        prompt_snapshot:
          'Forwarding requested: yes\nPlan: blocked\nPlan marker: {"version":1,"kind":"blocked","forwardingRequested":true,"blockedReason":"forwarding disabled"}',
        model_used: 'openai/gpt-oss-120b',
        tokens_used: 0,
        latency_ms: 0,
        retry_count: 0,
        error_message: 'forwarding disabled',
        created_at: '2024-01-01T00:00:01.000Z',
        status: 'error',
        submission: { id: 'submission-1', external_id: 'submission-ext-1' },
        question: { id: 'question-1', external_id: 'question-ext-1', question_text: 'Sample' },
        judge: { id: 'judge-blocked', name: 'Blocked Judge', model: 'openai/gpt-oss-120b' },
      },
    ];

    const pageOne = {
      evaluations: unrelatedEvaluations,
      total: 28,
      passRate: 100,
      judgePassRates: [],
      page: 1,
      pageSize: 25,
    };

    const pageTwo = {
      evaluations: trackedEvaluations,
      total: 28,
      passRate: 100,
      judgePassRates: [],
      page: 2,
      pageSize: 25,
    };

    const fetchImpl = (((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? new URL(input) : new URL(input.toString());
      const page = url.searchParams.get('page');
      const payload = page === '2' ? pageTwo : pageOne;

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      } as Response);
    }) as unknown) as typeof fetch;

    await expect(
      pollForScenarios(
        options,
        'queue-1',
        'question-1',
        'submission-ext-1',
        scenarioMap,
        scenarioConfigs,
        2000,
        fetchImpl,
        { queueId: 'queue-1', runId: 'run-1', questionId: 'question-1', submissionExternalId: 'submission-ext-1' }
      )
    ).resolves.toMatchObject([
      { scenario: 'text-only', evaluationId: 'eval-text', status: 'completed' },
      { scenario: 'multimodal', evaluationId: 'eval-multi', status: 'completed' },
      { scenario: 'blocked', evaluationId: 'eval-blocked', status: 'error' },
    ]);
  });

  it('throws when an evaluation is missing prompt_snapshot', async () => {
    const options = {
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/verify-m005-s01.fixture.json',
      timeoutMs: 1000,
      pollMs: 10,
    };

    const scenarioConfigs = buildScenarioConfigs().filter((config) => config.name === 'text-only');
    const scenarioMap = new Map<ScenarioName, { judgeId: string; judgeName: string }>([
      ['text-only', { judgeId: 'judge-text', judgeName: 'Text Judge' }],
    ]);

    const evaluation: ResultsEvaluation = {
      id: 'eval-text',
      verdict: 'pass',
      reasoning: 'ok',
      prompt_snapshot: null,
      model_used: 'openai/gpt-oss-120b',
      tokens_used: 0,
      latency_ms: 0,
      retry_count: 0,
      error_message: null,
      created_at: '2024-01-01T00:00:00.000Z',
      status: 'completed',
      submission: { id: 'submission-1', external_id: 'submission-ext-1' },
      question: { id: 'question-1', external_id: 'question-ext-1', question_text: 'Sample' },
      judge: { id: 'judge-text', name: 'Text Judge', model: 'openai/gpt-oss-120b' },
    };

    const payload = {
      evaluations: [evaluation],
      total: 1,
      passRate: 1,
      judgePassRates: [],
      page: 1,
      pageSize: 25,
    };

    const fetchImpl = ((() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      } as Response)) as unknown) as typeof fetch;

    await expect(
      pollForScenarios(
        options,
        'queue-1',
        'question-1',
        'submission-ext-1',
        scenarioMap,
        scenarioConfigs,
        2000,
        fetchImpl,
        { queueId: 'queue-1', runId: 'run-1', questionId: 'question-1', submissionExternalId: 'submission-ext-1' }
      )
    ).rejects.toThrow('prompt_snapshot');
  });
});
