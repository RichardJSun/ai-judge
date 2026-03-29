import { describe, expect, it } from 'bun:test';
import { handleGetAssignments, handlePostAssignments } from './route';
import { handleGetQuestions } from '../questions/route';

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type QueryExecutor<T> = (query: FakeQuery<T>) => QueryResult<T>;

class FakeQuery<T> implements PromiseLike<QueryResult<T>> {
  payload?: unknown;
  options?: unknown;

  constructor(private readonly executor: QueryExecutor<T>) {}

  select(..._args: unknown[]) {
    return this;
  }

  eq(..._args: unknown[]) {
    return this;
  }

  order(..._args: unknown[]) {
    return this;
  }

  upsert(payload: unknown, options: unknown) {
    this.payload = payload;
    this.options = options;
    return this;
  }

  single() {
    return this;
  }

  maybeSingle() {
    return this;
  }

  then(onFulfilled?: (value: QueryResult<T>) => unknown, onRejected?: (reason: unknown) => unknown) {
    const promise = Promise.resolve().then(() => this.executor(this));
    return promise.then(onFulfilled ?? undefined, onRejected ?? undefined);
  }
}

class FakeSupabaseClient {
  constructor(private readonly executors: Record<string, QueryExecutor<unknown>>) {}

  from(table: string) {
    const executor = this.executors[table];
    if (!executor) {
      throw new Error(`Missing fixture for table ${table}.`);
    }

    return new FakeQuery(executor as QueryExecutor<unknown>);
  }
}

function json<T>(value: T): QueryResult<T> {
  return { data: value, error: null };
}

function createAssignmentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'assignment-uuid-1',
    queue_id: 'queue-uuid-1',
    question_template_id: '22222222-2222-4222-8222-222222222222',
    judge_id: '11111111-1111-4111-8111-111111111111',
    prompt_fields: ['questionText', 'answer'],
    attachment_forwarding: false,
    created_at: '2026-03-28T10:00:00.000Z',
    judges: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Judge One',
      model: 'gateway/model-a',
      active: true,
    },
    question_templates: {
      id: '22222222-2222-4222-8222-222222222222',
      external_id: 'question-external-1',
      question_text: 'Describe something.',
      question_type: 'short_text',
      created_at: '2026-03-28T10:01:00.000Z',
    },
    ...overrides,
  };
}

function createQuestionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    external_id: 'question-external-1',
    question_text: 'Describe something.',
    question_type: 'short_text',
    created_at: '2026-03-28T10:01:00.000Z',
    ...overrides,
  };
}

function createQuestionClient(forwarding: boolean) {
  return new FakeSupabaseClient({
    question_templates: () => json([createQuestionRow()]),
    judge_assignments: () => json([createAssignmentRow({ attachment_forwarding: forwarding })]),
  }) as never;
}

function createGetRequest() {
  return new Request('http://localhost/api/queues/queue-uuid-1/assignments');
}

function createPostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/queues/queue-uuid-1/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleGetAssignments', () => {
  it('returns persisted assignments with attachment forwarding metadata', async () => {
    const client = new FakeSupabaseClient({
      judge_assignments: () => json([createAssignmentRow({ attachment_forwarding: true })]),
    }) as never;

    const response = await handleGetAssignments(createGetRequest(), {
      params: Promise.resolve({ id: 'queue-uuid-1' }),
    },
    {
      createServiceClient: () => client,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      expect.objectContaining({
        queue_id: 'queue-uuid-1',
        attachment_forwarding: true,
      }),
    ]);
  });
});

describe('handlePostAssignments', () => {
  it('persists attachment_forwarding through create and update flows', async () => {
    const context = { params: Promise.resolve({ id: 'queue-uuid-1' }) };

    const expectQuestionForwarding = async (state: boolean) => {
      const questionResponse = await handleGetQuestions(createGetRequest(), context, {
        createServiceClient: () => createQuestionClient(state),
      });
      const [payload] = await questionResponse.json();
      expect(payload.assignments[0].attachment_forwarding).toBe(state);
    };

    const postClientFalse = new FakeSupabaseClient({
      judge_assignments: (query) => {
        expect(query.payload).toMatchObject({
          attachment_forwarding: false,
          queue_id: 'queue-uuid-1',
          question_template_id: '22222222-2222-4222-8222-222222222222',
          judge_id: '11111111-1111-4111-8111-111111111111',
        });
        expect(query.options).toEqual({ onConflict: 'queue_id,question_template_id,judge_id' });
        return json(createAssignmentRow({ attachment_forwarding: false }));
      },
    }) as never;

    const createResponse = await handlePostAssignments(
      createPostRequest({
        judge_id: '11111111-1111-4111-8111-111111111111',
        question_template_id: '22222222-2222-4222-8222-222222222222',
        attachment_forwarding: false,
      }),
      context,
      { createServiceClient: () => postClientFalse }
    );

    const createPayload = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect(createPayload).toMatchObject({ attachment_forwarding: false });

    await expectQuestionForwarding(false);

    const getResponseBeforeUpdate = await handleGetAssignments(createGetRequest(), context, {
      createServiceClient: () =>
        new FakeSupabaseClient({
          judge_assignments: () => json([createAssignmentRow({ attachment_forwarding: false })]),
        }) as never,
    });

    expect((await getResponseBeforeUpdate.json())[0].attachment_forwarding).toBe(false);

    const postClientTrue = new FakeSupabaseClient({
      judge_assignments: (query) => {
        expect(query.payload).toMatchObject({ attachment_forwarding: true });
        return json(createAssignmentRow({ attachment_forwarding: true }));
      },
    }) as never;

    const updateResponse = await handlePostAssignments(
      createPostRequest({
        judge_id: '11111111-1111-4111-8111-111111111111',
        question_template_id: '22222222-2222-4222-8222-222222222222',
        attachment_forwarding: true,
      }),
      context,
      { createServiceClient: () => postClientTrue }
    );

    expect(updateResponse.status).toBe(201);
    expect((await updateResponse.json()).attachment_forwarding).toBe(true);

    await expectQuestionForwarding(true);

    const getResponseAfterUpdate = await handleGetAssignments(createGetRequest(), context, {
      createServiceClient: () =>
        new FakeSupabaseClient({
          judge_assignments: () => json([createAssignmentRow({ attachment_forwarding: true })]),
        }) as never,
    });

    expect((await getResponseAfterUpdate.json())[0].attachment_forwarding).toBe(true);

    const postClientRevert = new FakeSupabaseClient({
      judge_assignments: (query) => {
        expect(query.payload).toMatchObject({ attachment_forwarding: false });
        return json(createAssignmentRow({ attachment_forwarding: false }));
      },
    }) as never;

    const revertResponse = await handlePostAssignments(
      createPostRequest({
        judge_id: '11111111-1111-4111-8111-111111111111',
        question_template_id: '22222222-2222-4222-8222-222222222222',
        attachment_forwarding: false,
      }),
      context,
      { createServiceClient: () => postClientRevert }
    );

    expect(revertResponse.status).toBe(201);
    expect((await revertResponse.json()).attachment_forwarding).toBe(false);

    await expectQuestionForwarding(false);

    const getResponseAfterRevert = await handleGetAssignments(createGetRequest(), context, {
      createServiceClient: () =>
        new FakeSupabaseClient({
          judge_assignments: () => json([createAssignmentRow({ attachment_forwarding: false })]),
        }) as never,
    });

    expect((await getResponseAfterRevert.json())[0].attachment_forwarding).toBe(false);
  });
});
