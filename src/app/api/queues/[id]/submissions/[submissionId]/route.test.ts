import { afterEach, describe, expect, it } from 'bun:test';
import { handleGetSubmissionDetail, SUBMISSION_DETAIL_TIMEOUT_MS } from './route';

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

class FakeQuery<T> implements PromiseLike<QueryResult<T>> {
  private signal?: AbortSignal;

  constructor(private readonly execute: () => Promise<QueryResult<T>> | QueryResult<T>) {}

  select(..._args: unknown[]) {
    return this;
  }

  eq(..._args: unknown[]) {
    return this;
  }

  order(..._args: unknown[]) {
    return this;
  }

  maybeSingle() {
    return this;
  }

  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const promise = Promise.resolve().then(async () => {
      if (this.signal?.aborted) {
        throw this.signal.reason;
      }

      return await this.execute();
    });

    return promise.then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class FakeSupabaseClient {
  constructor(private readonly fixtures: Record<string, () => Promise<QueryResult<unknown>> | QueryResult<unknown>>) {}

  from(table: string) {
    const execute = this.fixtures[table];
    if (!execute) {
      throw new Error(`Missing test fixture for table ${table}.`);
    }

    return new FakeQuery(execute);
  }
}

function json<T>(value: T): QueryResult<T> {
  return { data: value, error: null };
}

function failure(message: string): QueryResult<never> {
  return { data: null, error: { message } };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function createRequest(url = 'http://localhost/api/queues/queue-1/submissions/submission-1') {
  return new Request(url);
}

afterEach(() => {
  // No shared global state to reset; keep afterEach so future extensions stay local.
});

describe('handleGetSubmissionDetail', () => {
  it('returns the queue-scoped submission detail contract with explicit missing answers', async () => {
    const response = await handleGetSubmissionDetail(
      createRequest(),
      {
        params: Promise.resolve({ id: 'queue-1', submissionId: 'submission-1' }),
      },
      {
        createServiceClient: () =>
          new FakeSupabaseClient({
            queues: () =>
              json({
                id: 'queue-1',
                queue_id: 'queue-external-1',
                created_at: '2026-03-28T10:00:00.000Z',
              }),
            submissions: () =>
              json({
                id: 'submission-1',
                queue_id: 'queue-1',
                external_id: 'submission-external-1',
                labeling_task_id: 'task-1',
                submitted_at: '2026-03-28T10:05:00.000Z',
                created_at: '2026-03-28T10:05:00.000Z',
              }),
            question_templates: () =>
              json([
                {
                  id: 'question-2',
                  queue_id: 'queue-1',
                  external_id: 'question-external-2',
                  question_type: 'short_text',
                  question_text: 'Second question?',
                  created_at: '2026-03-28T10:02:00.000Z',
                },
                {
                  id: 'question-1',
                  queue_id: 'queue-1',
                  external_id: 'question-external-1',
                  question_type: 'short_text',
                  question_text: 'First question?',
                  created_at: '2026-03-28T10:01:00.000Z',
                },
              ]),
            submission_answers: () =>
              json([
                {
                  id: 'answer-1',
                  submission_id: 'submission-1',
                  question_template_id: 'question-2',
                  answer_json: { value: 'Answered second.' },
                  created_at: '2026-03-28T10:06:00.000Z',
                },
              ]),
          }) as never,
        timeoutMs: SUBMISSION_DETAIL_TIMEOUT_MS,
      }
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      queue: {
        id: 'queue-1',
        queue_id: 'queue-external-1',
        created_at: '2026-03-28T10:00:00.000Z',
      },
      submission: {
        id: 'submission-1',
        queue_id: 'queue-1',
        external_id: 'submission-external-1',
        labeling_task_id: 'task-1',
        submitted_at: '2026-03-28T10:05:00.000Z',
        created_at: '2026-03-28T10:05:00.000Z',
      },
      summary: {
        totalQuestions: 2,
        answeredQuestions: 1,
        missingQuestions: 1,
      },
      questions: [
        {
          id: 'question-1',
          external_id: 'question-external-1',
          question_type: 'short_text',
          question_text: 'First question?',
          created_at: '2026-03-28T10:01:00.000Z',
          answerState: 'missing',
          answer: null,
          rawAnswer: null,
        },
        {
          id: 'question-2',
          external_id: 'question-external-2',
          question_type: 'short_text',
          question_text: 'Second question?',
          created_at: '2026-03-28T10:02:00.000Z',
          answerState: 'answered',
          answer: 'Answered second.',
          rawAnswer: { value: 'Answered second.' },
        },
      ],
    });
  });

  it('returns 404 when the queue row or queue-scoped submission row is missing', async () => {
    const response = await handleGetSubmissionDetail(
      createRequest('http://localhost/api/queues/queue-1/submissions/submission-missing'),
      {
        params: Promise.resolve({ id: 'queue-1', submissionId: 'submission-missing' }),
      },
      {
        createServiceClient: () =>
          new FakeSupabaseClient({
            queues: () => json({ id: 'queue-1', queue_id: 'queue-external-1', created_at: '2026-03-28T10:00:00.000Z' }),
            submissions: () => json(null),
            question_templates: () => json([]),
            submission_answers: () => json([]),
          }) as never,
      }
    );

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({
      error: 'Submission not found for queue.',
      phase: 'lookup',
      detail: 'No submission detail row matched queue queue-1 and submission submission-missing.',
    });
  });

  it('keeps storage failures reviewer-safe and phase-localized instead of echoing raw query text', async () => {
    const response = await handleGetSubmissionDetail(
      createRequest(),
      {
        params: Promise.resolve({ id: 'queue-1', submissionId: 'submission-1' }),
      },
      {
        createServiceClient: () =>
          new FakeSupabaseClient({
            queues: () => json({ id: 'queue-1', queue_id: 'queue-external-1', created_at: '2026-03-28T10:00:00.000Z' }),
            submissions: () => json({
              id: 'submission-1',
              queue_id: 'queue-1',
              external_id: 'submission-external-1',
              labeling_task_id: null,
              submitted_at: null,
              created_at: '2026-03-28T10:05:00.000Z',
            }),
            question_templates: () => failure('select * from question_templates where queue_id = queue-1 leaked'),
            submission_answers: () => json([]),
          }) as never,
      }
    );

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({
      error: 'Failed to load submission detail.',
      phase: 'questions',
      detail: 'The questions read failed before a complete submission detail response could be built.',
    });
  });

  it('surfaces helper-thrown contract errors with the normalizer public message', async () => {
    const response = await handleGetSubmissionDetail(
      createRequest(),
      {
        params: Promise.resolve({ id: 'queue-1', submissionId: 'submission-1' }),
      },
      {
        createServiceClient: () =>
          new FakeSupabaseClient({
            queues: () => json({ id: 'queue-1', queue_id: 'queue-external-1', created_at: '2026-03-28T10:00:00.000Z' }),
            submissions: () => json({
              id: 'submission-1',
              queue_id: 'queue-1',
              external_id: 'submission-external-1',
              labeling_task_id: null,
              submitted_at: null,
              created_at: '2026-03-28T10:05:00.000Z',
            }),
            question_templates: () => ({ data: {} as never, error: null }),
            submission_answers: () => json([]),
          }) as never,
      }
    );

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({
      error: 'Malformed submission detail returned from storage.',
      phase: 'normalize',
      detail: 'Expected question templates to be an array.',
    });
  });
});
