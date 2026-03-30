import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'bun:test';
import { handleGetResults } from './route';

type QueryResult<T> = {
  data: T | null;
  error: { message: string; code?: string | null; details?: string | null } | null;
  count?: number | null;
};

type QueryExecutor<T> = (query: FakeQuery<T>) => QueryResult<T> | Promise<QueryResult<T>>;

class FakeQuery<T> implements PromiseLike<QueryResult<T>> {
  readonly selectArgs: unknown[][] = [];
  readonly orderArgs: unknown[][] = [];
  readonly rangeArgs: Array<{ from: number; to: number }> = [];
  readonly inArgs: Array<{ column: string; values: unknown[] }> = [];
  readonly eqArgs: Array<{ column: string; value: unknown }> = [];

  constructor(
    private readonly executor: QueryExecutor<T>,
    readonly table: string
  ) {}

  select(...args: unknown[]) {
    this.selectArgs.push(args);
    return this;
  }

  order(...args: unknown[]) {
    this.orderArgs.push(args);
    return this;
  }

  range(from: number, to: number) {
    this.rangeArgs.push({ from, to });
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.inArgs.push({ column, values: [...values] });
    return this;
  }

  eq(column: string, value: unknown) {
    this.eqArgs.push({ column, value });
    return this;
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onFulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const promise = Promise.resolve().then(() => this.executor(this));
    return promise.then(onFulfilled ?? undefined, onRejected ?? undefined);
  }
}

class FakeSupabaseClient {
  readonly queries: FakeQuery<unknown>[] = [];

  constructor(private readonly executors: Record<string, QueryExecutor<unknown> | QueryExecutor<unknown>[]>) {}

  from(table: string) {
    const executorEntry = this.executors[table];
    if (!executorEntry) {
      throw new Error(`Missing fixture for table ${table}.`);
    }

    const executor = Array.isArray(executorEntry) ? executorEntry.shift() : executorEntry;
    if (!executor) {
      throw new Error(`No remaining fixture for table ${table}.`);
    }

    const query = new FakeQuery(executor as QueryExecutor<unknown>, table);
    this.queries.push(query);
    return query;
  }
}

function json<T>(value: T, count?: number | null): QueryResult<T> {
  return { data: value, error: null, count };
}

function failure(message: string): QueryResult<never> {
  return { data: null, error: { message } };
}

function rangeNotSatisfiable(details: string): QueryResult<never> {
  return {
    data: null,
    error: { message: 'Requested range not satisfiable', code: 'PGRST103', details },
    count: null,
  };
}

function createRequest(url = 'http://localhost/api/queues/queue-1/results'): NextRequest {
  return new Request(url) as NextRequest;
}

function createEvaluationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evaluation-1',
    verdict: 'pass',
    reasoning: 'Looks good.',
    prompt_snapshot: null,
    model_used: 'gateway/model-a',
    tokens_used: 321,
    latency_ms: 875,
    retry_count: 1,
    error_message: null,
    created_at: '2026-03-28T12:00:00.000Z',
    status: 'completed',
    submissions: [{ id: 'submission-1', external_id: 'SUB-001', queue_id: 'queue-1' }],
    question_templates: [{ id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' }],
    judges: [{ id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' }],
    ...overrides,
  };
}

function createAggregateRow(overrides: Record<string, unknown> = {}) {
  return {
    judge_id: 'judge-1',
    verdict: 'pass',
    status: 'completed',
    judges: [{ id: 'judge-1', name: 'Judge Zeta' }],
    submissions: [{ queue_id: 'queue-1' }],
    ...overrides,
  };
}

function createFilterMetadataRow(overrides: Record<string, unknown> = {}) {
  return {
    verdict: 'pass',
    submissions: [{ queue_id: 'queue-1' }],
    question_templates: [{ id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' }],
    judges: [{ id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' }],
    ...overrides,
  };
}

function getQueries(client: FakeSupabaseClient, table: string) {
  return client.queries.filter((query) => query.table === table);
}

describe('handleGetResults', () => {
  it('clamps filtered out-of-range requests and returns queue-truth filter metadata', async () => {
    const client = new FakeSupabaseClient({
      evaluations: [
        (query) => {
          expect(query.eqArgs).toEqual([{ column: 'submissions.queue_id', value: 'queue-1' }]);
          expect(query.inArgs).toEqual([
            { column: 'judge_id', values: ['judge-1'] },
            { column: 'question_template_id', values: ['question-1'] },
            { column: 'verdict', values: ['pass'] },
          ]);
          expect(query.rangeArgs).toEqual([]);
          return json([
            createAggregateRow(),
            createAggregateRow({ judge_id: 'judge-1', verdict: null, status: 'error' }),
          ]);
        },
        (query) => {
          expect(query.eqArgs).toEqual([{ column: 'submissions.queue_id', value: 'queue-1' }]);
          expect(query.inArgs).toEqual([]);
          expect(query.rangeArgs).toEqual([]);
          return json([
            createFilterMetadataRow(),
            createFilterMetadataRow({
              verdict: 'fail',
              question_templates: [{ id: 'question-2', external_id: 'Q-002', question_text: 'Was evidence cited?' }],
              judges: [{ id: 'judge-2', name: 'Judge Alpha', model: 'gateway/model-b' }],
            }),
            createFilterMetadataRow({ verdict: 'pass' }),
          ]);
        },
        (query) => {
          expect(query.eqArgs).toEqual([{ column: 'submissions.queue_id', value: 'queue-1' }]);
          expect(query.inArgs).toEqual([
            { column: 'judge_id', values: ['judge-1'] },
            { column: 'question_template_id', values: ['question-1'] },
            { column: 'verdict', values: ['pass'] },
          ]);
          expect(query.rangeArgs).toEqual([{ from: 2450, to: 2474 }]);
          return json([], 1);
        },
        (query) => {
          expect(query.eqArgs).toEqual([{ column: 'submissions.queue_id', value: 'queue-1' }]);
          expect(query.inArgs).toEqual([
            { column: 'judge_id', values: ['judge-1'] },
            { column: 'question_template_id', values: ['question-1'] },
            { column: 'verdict', values: ['pass'] },
          ]);
          expect(query.rangeArgs).toEqual([{ from: 0, to: 24 }]);
          return json([createEvaluationRow()], 1);
        },
      ],
    });

    const response = await handleGetResults(
      createRequest(
        'http://localhost/api/queues/queue-1/results?page=99&judgeId=judge-1&judgeId=judge-1&questionId=question-1&questionId=%20&verdict=pass'
      ),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      evaluations: [
        {
          id: 'evaluation-1',
          verdict: 'pass',
          reasoning: 'Looks good.',
          prompt_snapshot: null,
          model_used: 'gateway/model-a',
          tokens_used: 321,
          latency_ms: 875,
          retry_count: 1,
          error_message: null,
          created_at: '2026-03-28T12:00:00.000Z',
          status: 'completed',
          submission: { id: 'submission-1', external_id: 'SUB-001' },
          question: { id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' },
          judge: { id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' },
        },
      ],
      total: 1,
      passRate: 100,
      judgePassRates: [{ judgeId: 'judge-1', name: 'Judge Zeta', passRate: 100, total: 1 }],
      page: 1,
      pageSize: 25,
      filterMetadata: {
        judges: [
          { id: 'judge-2', name: 'Judge Alpha', model: 'gateway/model-b' },
          { id: 'judge-1', name: 'Judge Zeta', model: 'gateway/model-a' },
        ],
        questions: [
          { id: 'question-1', external_id: 'Q-001', question_text: 'Was the answer correct?' },
          { id: 'question-2', external_id: 'Q-002', question_text: 'Was evidence cited?' },
        ],
        verdicts: ['pass', 'fail'],
      },
    });

    const evaluationQueries = getQueries(client, 'evaluations');
    expect(evaluationQueries[0]?.rangeArgs).toEqual([]);
    expect(evaluationQueries[1]?.rangeArgs).toEqual([]);
    expect(evaluationQueries[2]?.rangeArgs[0]).toEqual({ from: 2450, to: 2474 });
    expect(evaluationQueries[3]?.rangeArgs[0]).toEqual({ from: 0, to: 24 });
  });

  it('clamps out-of-range results pages when Supabase reports PGRST103', async () => {
    const client = new FakeSupabaseClient({
      evaluations: [
        () => json([createAggregateRow()]),
        () => json([createFilterMetadataRow()]),
        (query) => {
          expect(query.rangeArgs).toEqual([{ from: 2475, to: 2499 }]);
          return rangeNotSatisfiable('An offset of 2475 was requested, but there are only 27 rows.');
        },
        (query) => {
          expect(query.rangeArgs).toEqual([]);
          expect(query.selectArgs[0]?.[1]).toEqual({ count: 'exact', head: true });
          return json(null, 27);
        },
        (query) => {
          expect(query.rangeArgs).toEqual([{ from: 25, to: 49 }]);
          return json([
            createEvaluationRow(),
            createEvaluationRow({ id: 'evaluation-2', submissions: [{ id: 'submission-2', external_id: 'SUB-002', queue_id: 'queue-1' }] }),
          ], 27);
        },
      ],
    });

    const response = await handleGetResults(
      createRequest('http://localhost/api/queues/queue-1/results?page=100'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total: 27,
      page: 2,
      pageSize: 25,
      evaluations: [
        expect.objectContaining({ id: 'evaluation-1' }),
        expect.objectContaining({ id: 'evaluation-2' }),
      ],
    });
  });

  it('rejects invalid verdict filters before storage is queried', async () => {
    let createServiceClientCalled = false;

    const response = await handleGetResults(
      createRequest('http://localhost/api/queues/queue-1/results?verdict=maybe'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      {
        createServiceClient: () => {
          createServiceClientCalled = true;
          throw new Error('should not be called');
        },
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid verdict filter.' });
    expect(createServiceClientCalled).toBe(false);
  });

  it('returns a reviewer-safe 500 when queue-scoped metadata leaks a foreign queue id', async () => {
    const client = new FakeSupabaseClient({
      evaluations: [
        () => json([createAggregateRow()]),
        () => json([createFilterMetadataRow({ submissions: [{ queue_id: 'queue-2' }] })]),
        () => json([createEvaluationRow()], 1),
      ],
    });

    const response = await handleGetResults(
      createRequest('http://localhost/api/queues/queue-1/results?page=1'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Malformed queue-scoped results returned from storage.' });
  });

  it('returns a reviewer-safe 500 when aggregate or metadata queries fail', async () => {
    const client = new FakeSupabaseClient({
      evaluations: [
        () => failure('aggregate lookup failed'),
        () => json([createFilterMetadataRow()]),
        () => json([createEvaluationRow()], 1),
      ],
    });

    const response = await handleGetResults(
      createRequest('http://localhost/api/queues/queue-1/results?page=1'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load queue results.' });
  });
});
