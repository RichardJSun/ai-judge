import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'bun:test';
import { handleGetQueues } from './route';

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

  in(column: string, values: unknown[]) {
    this.inArgs.push({ column, values: [...values] });
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

function createRequest(url = 'http://localhost/api/queues'): NextRequest {
  return new Request(url) as NextRequest;
}

function createQueueRow(id: number) {
  return {
    id: `queue-${id}`,
    queue_id: `QUEUE-${id.toString().padStart(3, '0')}`,
    created_at: `2026-03-${(id % 28) + 1}T10:00:00.000Z`,
  };
}

function createResultsRow(queueId: string, asArray = false) {
  const relation = { queue_id: queueId };
  return {
    submissions: asArray ? [relation] : relation,
  };
}

function getQueries(client: FakeSupabaseClient, table: string) {
  return client.queries.filter((query) => query.table === table);
}

describe('handleGetQueues', () => {
  it('keeps the legacy array contract when page is absent', async () => {
    const client = new FakeSupabaseClient({
      queues: () => json([createQueueRow(1), createQueueRow(2)]),
      submissions: () => json([{ queue_id: 'queue-1' }, { queue_id: 'queue-1' }, { queue_id: 'queue-2' }]),
      question_templates: () => json([{ queue_id: 'queue-2' }]),
    });

    const response = await handleGetQueues(createRequest(), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        ...createQueueRow(1),
        submission_count: 2,
        question_count: 0,
      },
      {
        ...createQueueRow(2),
        submission_count: 1,
        question_count: 1,
      },
    ]);
  });

  it('returns a paged response, normalizes malformed page input, and scopes derived metadata to visible ids', async () => {
    const visibleRows = Array.from({ length: 25 }, (_, index) => createQueueRow(index + 1));
    const client = new FakeSupabaseClient({
      queues: () => json(visibleRows, 30),
      submissions: (query) => {
        expect(query.inArgs[0]).toEqual({
          column: 'queue_id',
          values: visibleRows.map((row) => row.id),
        });
        return json([{ queue_id: 'queue-1' }, { queue_id: 'queue-25' }]);
      },
      question_templates: (query) => {
        expect(query.inArgs[0]).toEqual({
          column: 'queue_id',
          values: visibleRows.map((row) => row.id),
        });
        return json([{ queue_id: 'queue-25' }]);
      },
      evaluations: (query) => {
        expect(query.inArgs[0]).toEqual({
          column: 'submissions.queue_id',
          values: visibleRows.map((row) => row.id),
        });
        return json([
          createResultsRow('queue-1'),
          createResultsRow('queue-25'),
          createResultsRow('queue-25', true),
        ]);
      },
    });

    const response = await handleGetQueues(createRequest('http://localhost/api/queues?page=0'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      total: 30,
      page: 1,
      pageSize: 25,
    });
    expect(payload.queues).toHaveLength(25);
    expect(payload.queues[0]).toMatchObject({
      id: 'queue-1',
      submission_count: 1,
      question_count: 0,
      result_count: 1,
    });
    expect(payload.queues[24]).toMatchObject({
      id: 'queue-25',
      submission_count: 1,
      question_count: 1,
      result_count: 2,
    });

    expect(getQueries(client, 'queues')[0]?.rangeArgs).toEqual([{ from: 0, to: 24 }]);
  });

  it('clamps out-of-range pages to the last available page and recomputes metadata only for that page', async () => {
    const lastPageRows = [createQueueRow(26), createQueueRow(27)];
    const client = new FakeSupabaseClient({
      queues: [
        () => json([], 27),
        () => json(lastPageRows, 27),
      ],
      submissions: (query) => {
        expect(query.inArgs[0]).toEqual({
          column: 'queue_id',
          values: ['queue-26', 'queue-27'],
        });
        return json([{ queue_id: 'queue-26' }, { queue_id: 'queue-26' }]);
      },
      question_templates: (query) => {
        expect(query.inArgs[0]).toEqual({
          column: 'queue_id',
          values: ['queue-26', 'queue-27'],
        });
        return json([{ queue_id: 'queue-27' }]);
      },
      evaluations: (query) => {
        expect(query.inArgs[0]).toEqual({
          column: 'submissions.queue_id',
          values: ['queue-26', 'queue-27'],
        });
        return json([createResultsRow('queue-26'), createResultsRow('queue-26')]);
      },
    });

    const response = await handleGetQueues(createRequest('http://localhost/api/queues?page=9'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      queues: [
        {
          ...createQueueRow(26),
          submission_count: 2,
          question_count: 0,
          result_count: 2,
        },
        {
          ...createQueueRow(27),
          submission_count: 0,
          question_count: 1,
          result_count: 0,
        },
      ],
      total: 27,
      page: 2,
      pageSize: 25,
    });

    expect(getQueries(client, 'queues').map((query) => query.rangeArgs[0])).toEqual([
      { from: 200, to: 224 },
      { from: 25, to: 49 },
    ]);
  });

  it('clamps out-of-range pages when Supabase reports the requested range is not satisfiable', async () => {
    const lastPageRows = [createQueueRow(26), createQueueRow(27)];
    const client = new FakeSupabaseClient({
      queues: [
        () => rangeNotSatisfiable('An offset of 50 was requested, but there are only 27 rows.'),
        () => json(null, 27),
        () => json(lastPageRows, 27),
      ],
      submissions: () => json([{ queue_id: 'queue-26' }]),
      question_templates: () => json([{ queue_id: 'queue-27' }]),
      evaluations: () => json([createResultsRow('queue-27')]),
    });

    const response = await handleGetQueues(createRequest('http://localhost/api/queues?page=3'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      queues: [
        {
          ...createQueueRow(26),
          submission_count: 1,
          question_count: 0,
          result_count: 0,
        },
        {
          ...createQueueRow(27),
          submission_count: 0,
          question_count: 1,
          result_count: 1,
        },
      ],
      total: 27,
      page: 2,
      pageSize: 25,
    });
    const queueQueries = getQueries(client, 'queues');
    expect(queueQueries[0]?.rangeArgs[0]).toEqual({ from: 50, to: 74 });
    expect(queueQueries[1]?.rangeArgs).toEqual([]);
    expect(queueQueries[2]?.rangeArgs[0]).toEqual({ from: 25, to: 49 });
  });

  it('returns a reviewer-safe 500 when the base queue query fails', async () => {
    const client = new FakeSupabaseClient({
      queues: () => failure('database offline'),
    });

    const response = await handleGetQueues(createRequest('http://localhost/api/queues?page=1'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load queues.' });
  });

  it('returns a reviewer-safe 500 when derived lookups fail or the paged results metadata is malformed', async () => {
    const derivedResultsFailureClient = new FakeSupabaseClient({
      queues: () => json([createQueueRow(1)], 1),
      submissions: () => json([{ queue_id: 'queue-1' }]),
      question_templates: () => json([]),
      evaluations: () => failure('evaluations unavailable'),
    });

    const derivedResultsFailureResponse = await handleGetQueues(createRequest('http://localhost/api/queues?page=1'), {
      createServiceClient: () => derivedResultsFailureClient as never,
    });

    expect(derivedResultsFailureResponse.status).toBe(500);
    expect(await derivedResultsFailureResponse.json()).toEqual({ error: 'Failed to load queues.' });

    const malformedResultsMetadataClient = new FakeSupabaseClient({
      queues: () => json([createQueueRow(1)], 1),
      submissions: () => json([{ queue_id: 'queue-1' }]),
      question_templates: () => json([]),
      evaluations: () => json([createResultsRow('queue-2')]),
    });

    const malformedResultsMetadataResponse = await handleGetQueues(createRequest('http://localhost/api/queues?page=1'), {
      createServiceClient: () => malformedResultsMetadataClient as never,
    });

    expect(malformedResultsMetadataResponse.status).toBe(500);
    expect(await malformedResultsMetadataResponse.json()).toEqual({ error: 'Failed to load queues.' });

    const malformedCountClient = new FakeSupabaseClient({
      queues: () => json([createQueueRow(1)], null),
    });

    const malformedCountResponse = await handleGetQueues(createRequest('http://localhost/api/queues?page=1'), {
      createServiceClient: () => malformedCountClient as never,
    });

    expect(malformedCountResponse.status).toBe(500);
    expect(await malformedCountResponse.json()).toEqual({ error: 'Failed to load queues.' });
  });
});
