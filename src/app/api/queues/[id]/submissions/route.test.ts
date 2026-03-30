import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'bun:test';
import { handleGetQueueSubmissions } from './route';

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

function createRequest(url = 'http://localhost/api/queues/queue-1/submissions'): NextRequest {
  return new Request(url) as NextRequest;
}

function createSubmissionRow(id: number) {
  return {
    id: `submission-${id}`,
    external_id: `SUB-${id.toString().padStart(3, '0')}`,
    labeling_task_id: id % 2 === 0 ? `task-${id}` : null,
    submitted_at: `2026-03-${(id % 28) + 1}T10:00:00.000Z`,
    created_at: `2026-03-${(id % 28) + 1}T09:00:00.000Z`,
  };
}

function getQueries(client: FakeSupabaseClient, table: string) {
  return client.queries.filter((query) => query.table === table);
}

describe('handleGetQueueSubmissions', () => {
  it('returns the always-object payload and defaults missing page to page 1', async () => {
    const rows = [createSubmissionRow(1), createSubmissionRow(2)];
    const client = new FakeSupabaseClient({
      submissions: (query) => {
        expect(query.eqArgs).toEqual([{ column: 'queue_id', value: 'queue-1' }]);
        expect(query.rangeArgs).toEqual([{ from: 0, to: 19 }]);
        return json(rows, 2);
      },
    });

    const response = await handleGetQueueSubmissions(
      createRequest(),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      submissions: rows,
      total: 2,
      page: 1,
      pageSize: 20,
    });
  });

  it('normalizes malformed page inputs to page 1 before range math executes', async () => {
    for (const url of [
      'http://localhost/api/queues/queue-1/submissions?page=abc',
      'http://localhost/api/queues/queue-1/submissions?page=0',
      'http://localhost/api/queues/queue-1/submissions?page=-1',
      'http://localhost/api/queues/queue-1/submissions?page=',
      'http://localhost/api/queues/queue-1/submissions?page=999999999999999999999999',
      'http://localhost/api/queues/queue-1/submissions?page=abc&page=4',
    ]) {
      const client = new FakeSupabaseClient({
        submissions: (query) => {
          expect(query.rangeArgs).toEqual([{ from: 0, to: 19 }]);
          return json([], 0);
        },
      });

      const response = await handleGetQueueSubmissions(
        createRequest(url),
        { params: Promise.resolve({ id: 'queue-1' }) },
        { createServiceClient: () => client as never }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        submissions: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    }
  });

  it('clamps out-of-range queue pages to the last available page when count truth is available', async () => {
    const lastPageRows = [createSubmissionRow(21)];
    const client = new FakeSupabaseClient({
      submissions: [
        (query) => {
          expect(query.rangeArgs).toEqual([{ from: 1960, to: 1979 }]);
          return json([], 21);
        },
        (query) => {
          expect(query.rangeArgs).toEqual([{ from: 20, to: 39 }]);
          return json(lastPageRows, 21);
        },
      ],
    });

    const response = await handleGetQueueSubmissions(
      createRequest('http://localhost/api/queues/queue-1/submissions?page=99'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      submissions: lastPageRows,
      total: 21,
      page: 2,
      pageSize: 20,
    });
    expect(getQueries(client, 'submissions').map((query) => query.rangeArgs[0])).toEqual([
      { from: 1960, to: 1979 },
      { from: 20, to: 39 },
    ]);
  });

  it('recomputes the canonical page when Supabase reports PGRST103', async () => {
    const lastPageRows = [createSubmissionRow(21), createSubmissionRow(22)];
    const client = new FakeSupabaseClient({
      submissions: [
        (query) => {
          expect(query.rangeArgs).toEqual([{ from: 1980, to: 1999 }]);
          return rangeNotSatisfiable('An offset of 1980 was requested, but there are only 22 rows.');
        },
        (query) => {
          expect(query.rangeArgs).toEqual([]);
          expect(query.selectArgs[0]?.[1]).toEqual({ count: 'exact', head: true });
          expect(query.eqArgs).toEqual([{ column: 'queue_id', value: 'queue-1' }]);
          return json(null, 22);
        },
        (query) => {
          expect(query.rangeArgs).toEqual([{ from: 20, to: 39 }]);
          return json(lastPageRows, 22);
        },
      ],
    });

    const response = await handleGetQueueSubmissions(
      createRequest('http://localhost/api/queues/queue-1/submissions?page=100'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => client as never }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      submissions: lastPageRows,
      total: 22,
      page: 2,
      pageSize: 20,
    });
  });

  it('returns a reviewer-safe 500 when the paged query fails or pagination data is malformed', async () => {
    const failedClient = new FakeSupabaseClient({
      submissions: () => failure('database offline'),
    });

    const failedResponse = await handleGetQueueSubmissions(
      createRequest('http://localhost/api/queues/queue-1/submissions?page=1'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => failedClient as never }
    );

    expect(failedResponse.status).toBe(500);
    expect(await failedResponse.json()).toEqual({ error: 'Failed to load queue submissions.' });

    const malformedCountClient = new FakeSupabaseClient({
      submissions: () => json([createSubmissionRow(1)], null),
    });

    const malformedCountResponse = await handleGetQueueSubmissions(
      createRequest('http://localhost/api/queues/queue-1/submissions?page=1'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => malformedCountClient as never }
    );

    expect(malformedCountResponse.status).toBe(500);
    expect(await malformedCountResponse.json()).toEqual({ error: 'Failed to load queue submissions.' });

    const malformedRowClient = new FakeSupabaseClient({
      submissions: () =>
        json(
          [
            {
              ...createSubmissionRow(1),
              created_at: null,
            },
          ],
          1
        ),
    });

    const malformedRowResponse = await handleGetQueueSubmissions(
      createRequest('http://localhost/api/queues/queue-1/submissions?page=1'),
      { params: Promise.resolve({ id: 'queue-1' }) },
      { createServiceClient: () => malformedRowClient as never }
    );

    expect(malformedRowResponse.status).toBe(500);
    expect(await malformedRowResponse.json()).toEqual({ error: 'Failed to load queue submissions.' });
  });
});
