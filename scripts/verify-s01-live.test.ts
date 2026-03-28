import { describe, expect, it } from 'bun:test';
import {
  assertPersistedAudit,
  assertRunProgressPayload,
  pollRunUntilTerminal,
  type EvaluationAuditRow,
  type PersistedRunAudit,
} from './verify-s01-live';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createCompletedRow(overrides: Partial<EvaluationAuditRow> = {}): EvaluationAuditRow {
  return {
    id: 'evaluation-complete',
    status: 'completed',
    verdict: 'pass',
    reasoning: 'Grounded reasoning.',
    prompt_snapshot: '[System]\nJudge carefully',
    model_used: 'gateway/model-a',
    tokens_used: 123,
    latency_ms: 456,
    retry_count: 0,
    error_message: null,
    ...overrides,
  };
}

function createErrorRow(overrides: Partial<EvaluationAuditRow> = {}): EvaluationAuditRow {
  return {
    id: 'evaluation-error',
    status: 'error',
    verdict: null,
    reasoning: null,
    prompt_snapshot: '[System]\nJudge carefully',
    model_used: 'gateway/model-a',
    tokens_used: null,
    latency_ms: 789,
    retry_count: 2,
    error_message: 'Gateway timeout',
    ...overrides,
  };
}

function createRun(overrides: Partial<PersistedRunAudit> = {}): PersistedRunAudit {
  return {
    id: 'run-1',
    status: 'completed',
    total: 2,
    completed: 1,
    errored: 1,
    ...overrides,
  };
}

describe('assertRunProgressPayload', () => {
  it('fails fast when the API payload is missing status', () => {
    expect(() =>
      assertRunProgressPayload({ total: 2, completed: 1, errored: 0 })
    ).toThrow('Run progress response is missing a valid status.');
  });
});

describe('pollRunUntilTerminal', () => {
  it('times out with the last observed progress state instead of hanging forever', async () => {
    const nowValues = [0, 0, 11];
    let nowIndex = 0;

    await expect(
      pollRunUntilTerminal({
        baseUrl: 'http://localhost:3000',
        queueId: 'queue-1',
        runId: 'run-1',
        timeoutMs: 10,
        pollMs: 1,
        fetchImpl: async () => jsonResponse({ status: 'running', total: 3, completed: 1, errored: 1 }),
        sleepImpl: async () => undefined,
        now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)] ?? 11,
      })
    ).rejects.toThrow(
      'Timed out waiting for run run-1 after 10ms. Last observed state: running (completed=1, errored=1, total=3).'
    );
  });
});

describe('assertPersistedAudit', () => {
  it('accepts mixed completed and errored runs with truthful counters', () => {
    expect(
      assertPersistedAudit({
        run: createRun(),
        evaluations: [createCompletedRow(), createErrorRow()],
        expectedTotal: 2,
      })
    ).toEqual({
      completedRows: 1,
      erroredRows: 1,
      retriedRows: 1,
    });
  });

  it('fails when completed rows are missing required audit fields', () => {
    expect(() =>
      assertPersistedAudit({
        run: createRun(),
        evaluations: [createCompletedRow({ tokens_used: null }), createErrorRow()],
        expectedTotal: 2,
      })
    ).toThrow('Completed evaluation evaluation-complete is missing tokens_used.');
  });

  it('fails when errored rows are missing their terminal error message', () => {
    expect(() =>
      assertPersistedAudit({
        run: createRun(),
        evaluations: [createCompletedRow(), createErrorRow({ error_message: null })],
        expectedTotal: 2,
      })
    ).toThrow('Errored evaluation evaluation-error is missing error_message.');
  });
});
