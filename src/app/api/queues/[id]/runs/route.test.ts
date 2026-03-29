import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'bun:test';
import { handlePostRun } from './route';
import { StartRunError, type StartRunDeps } from '@/lib/run/start-run';

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

class FakeQuery<T> implements PromiseLike<QueryResult<T>> {
  selectArgs: unknown[][] = [];
  eqArgs: unknown[][] = [];
  inArgs: Array<{ column: string; values: unknown[] }> = [];

  constructor(
    private readonly executor: (query: FakeQuery<T>) => QueryResult<T> | Promise<QueryResult<T>>,
    readonly table: string
  ) {}

  select(...args: unknown[]) {
    this.selectArgs.push(args);
    return this;
  }

  eq(...args: unknown[]) {
    this.eqArgs.push(args);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.inArgs.push({ column, values });
    return this;
  }

  maybeSingle() {
    return this;
  }

  single() {
    return this;
  }

  order(..._args: unknown[]) {
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
  constructor(
    private readonly executors: Record<
      string,
      (query: FakeQuery<unknown>) => QueryResult<unknown> | Promise<QueryResult<unknown>>
    > = {}
  ) {}

  from(table: string) {
    const executor = this.executors[table];
    if (!executor) {
      throw new Error(`Missing fixture for table ${table}.`);
    }

    return new FakeQuery(executor, table);
  }
}

function json<T>(value: T): QueryResult<T> {
  return { data: value, error: null };
}

function createRequest(): NextRequest {
  return new Request('http://localhost/api/queues/queue-1/runs', { method: 'POST' }) as NextRequest;
}

describe('handlePostRun', () => {
  it('performs a batched attachment read and dispatches a run start', async () => {
    const submissions = [{ id: 'submission-1', external_id: 'external-1' }];
    let attachmentsQuery: FakeQuery<unknown> | undefined;
    const executorMap = {
      submissions: () => json(submissions),
      submission_attachments: (query: FakeQuery<unknown>) => {
        attachmentsQuery = query;
        return json([
          {
            id: 'attachment-1',
            submission_id: 'submission-1',
            external_attachment_id: 'attachment-external-1',
            source_kind: 'inline_base64',
            file_name: 'first.pdf',
            media_type: 'application/pdf',
            byte_size: 1024,
            storage_bucket: 'submission-attachments',
            storage_path: 'submissions/submission-1/attachments/first.pdf',
            storage_status: 'stored',
            storage_error: null,
            created_at: '2026-03-28T00:00:00.000Z',
          },
        ]);
      },
    };

    const fakeClient = new FakeSupabaseClient(executorMap);
    const scheduleCalls: unknown[] = [];
    const deps = {
      createServiceClient: () => fakeClient as never,
      startRun: async (startDeps: StartRunDeps, queueId: string) => {
        const submissions = (await startDeps.getSubmissions(queueId)) as Array<{ id: string }>;
        await startDeps.getSubmissionAttachments(submissions.map((submission) => submission.id));
        return { runId: 'run-1', total: submissions.length, tasks: [] };
      },
      scheduleRunExecution: async (options: unknown) => {
        scheduleCalls.push(options);
      },
    } as const;

    const response = await handlePostRun(createRequest(), { params: Promise.resolve({ id: 'queue-1' }) }, deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runId: 'run-1', total: 1 });
    expect(scheduleCalls).toHaveLength(1);
    expect(attachmentsQuery?.inArgs[0].column).toBe('submission_id');
    expect(attachmentsQuery?.inArgs[0].values).toEqual(['submission-1']);
  });

  it('propagates start-run attachment errors through the route response', async () => {
    const fakeClient = new FakeSupabaseClient();
    let scheduled = false;

    const deps = {
      createServiceClient: () => fakeClient as never,
      startRun: async () => {
        throw new StartRunError('Malformed attachments', {
          status: 422,
          publicMessage: 'Malformed attachment metadata.',
        });
      },
      scheduleRunExecution: async () => {
        scheduled = true;
      },
    } as const;

    const response = await handlePostRun(createRequest(), { params: Promise.resolve({ id: 'queue-1' }) }, deps);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Malformed attachment metadata.' });
    expect(scheduled).toBe(false);
  });

  it('marks the run errored when dispatch fails before execution', async () => {
    let markRunErrorCalled = false;
    let markedRunId: string | undefined;

    const deps = {
      createServiceClient: () => new FakeSupabaseClient() as never,
      startRun: async (startDeps: StartRunDeps) => {
        startDeps.markRunError = async (runId) => {
          markRunErrorCalled = true;
          markedRunId = runId;
        };
        return { runId: 'run-error', total: 0, tasks: [] };
      },
      scheduleRunExecution: async (options) => {
        await options.onScheduleError?.();
        throw new Error('Dispatch failed to schedule.');
      },
    } as const;

    const response = await handlePostRun(createRequest(), { params: Promise.resolve({ id: 'queue-1' }) }, deps);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to dispatch evaluation run.' });
    expect(markRunErrorCalled).toBe(true);
    expect(markedRunId).toBe('run-error');
  });
});
