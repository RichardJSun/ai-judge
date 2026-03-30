import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'bun:test';
import { handleGetJudges } from './route';

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

function createRequest(url = 'http://localhost/api/judges'): NextRequest {
  return new Request(url) as NextRequest;
}

function createJudgeRow(id: number) {
  return {
    id: `judge-${id}`,
    name: `Judge ${id}`,
    system_prompt: `Judge ${id} prompt`,
    model: `gateway/model-${id}`,
    active: id % 2 === 0,
    created_at: `2026-03-${(id % 28) + 1}T10:00:00.000Z`,
    updated_at: `2026-03-${(id % 28) + 1}T11:00:00.000Z`,
  };
}

function getQueries(client: FakeSupabaseClient, table: string) {
  return client.queries.filter((query) => query.table === table);
}

describe('handleGetJudges', () => {
  it('keeps the legacy array contract when page is absent', async () => {
    const client = new FakeSupabaseClient({
      judges: () => json([createJudgeRow(1), createJudgeRow(2)]),
    });

    const response = await handleGetJudges(createRequest(), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([createJudgeRow(1), createJudgeRow(2)]);
  });

  it('returns paged judge metadata and normalizes malformed page input to page 1', async () => {
    const visibleRows = Array.from({ length: 25 }, (_, index) => createJudgeRow(index + 1));
    const client = new FakeSupabaseClient({
      judges: () => json(visibleRows, 30),
    });

    const response = await handleGetJudges(createRequest('http://localhost/api/judges?page=abc'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      judges: visibleRows,
      total: 30,
      page: 1,
      pageSize: 25,
    });
    expect(getQueries(client, 'judges')[0]?.rangeArgs).toEqual([{ from: 0, to: 24 }]);
  });

  it('clamps out-of-range pages to the last available page', async () => {
    const lastPageRows = [createJudgeRow(26), createJudgeRow(27)];
    const client = new FakeSupabaseClient({
      judges: [
        () => json([], 27),
        () => json(lastPageRows, 27),
      ],
    });

    const response = await handleGetJudges(createRequest('http://localhost/api/judges?page=99'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      judges: lastPageRows,
      total: 27,
      page: 2,
      pageSize: 25,
    });
    expect(getQueries(client, 'judges').map((query) => query.rangeArgs[0])).toEqual([
      { from: 2450, to: 2474 },
      { from: 25, to: 49 },
    ]);
  });

  it('clamps out-of-range pages when Supabase reports the requested range is not satisfiable', async () => {
    const lastPageRows = [createJudgeRow(26), createJudgeRow(27)];
    const client = new FakeSupabaseClient({
      judges: [
        () => rangeNotSatisfiable('An offset of 2475 was requested, but there are only 27 rows.'),
        () => json(null, 27),
        () => json(lastPageRows, 27),
      ],
    });

    const response = await handleGetJudges(createRequest('http://localhost/api/judges?page=100'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      judges: lastPageRows,
      total: 27,
      page: 2,
      pageSize: 25,
    });
    const judgeQueries = getQueries(client, 'judges');
    expect(judgeQueries[0]?.rangeArgs[0]).toEqual({ from: 2475, to: 2499 });
    expect(judgeQueries[1]?.rangeArgs).toEqual([]);
    expect(judgeQueries[2]?.rangeArgs[0]).toEqual({ from: 25, to: 49 });
  });

  it('returns a reviewer-safe 500 when the base judge query fails', async () => {
    const client = new FakeSupabaseClient({
      judges: () => failure('database offline'),
    });

    const response = await handleGetJudges(createRequest('http://localhost/api/judges?page=1'), {
      createServiceClient: () => client as never,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load judges.' });
  });

  it('returns a reviewer-safe 500 for malformed paged metadata or malformed judge rows', async () => {
    const malformedCountClient = new FakeSupabaseClient({
      judges: () => json([createJudgeRow(1)], null),
    });

    const malformedCountResponse = await handleGetJudges(createRequest('http://localhost/api/judges?page=1'), {
      createServiceClient: () => malformedCountClient as never,
    });

    expect(malformedCountResponse.status).toBe(500);
    expect(await malformedCountResponse.json()).toEqual({ error: 'Failed to load judges.' });

    const malformedRowClient = new FakeSupabaseClient({
      judges: () => json([{ ...createJudgeRow(1), active: 'yes' }], 1),
    });

    const malformedRowResponse = await handleGetJudges(createRequest('http://localhost/api/judges?page=1'), {
      createServiceClient: () => malformedRowClient as never,
    });

    expect(malformedRowResponse.status).toBe(500);
    expect(await malformedRowResponse.json()).toEqual({ error: 'Failed to load judges.' });
  });
});
