import { describe, expect, it } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleUpload,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from '@/app/api/upload/route';
import {
  persistSubmissions,
  UploadPersistenceError,
  type ParseResult,
  type PersistSubmissionsOptions,
} from '@/lib/parsers/submission';
import type { ValidatedSubmission } from '@/lib/validators/upload';

type PersistenceTable = 'queues' | 'question_templates' | 'submissions' | 'submission_answers';

type QueueRow = { id: string; queue_id: string };
type QuestionTemplateRow = {
  id: string;
  queue_id: string;
  external_id: string;
  question_type: string | null;
  question_text: string;
};
type SubmissionRow = {
  id: string;
  queue_id: string;
  external_id: string;
  labeling_task_id: string | null;
  submitted_at: string | null;
  raw_json: unknown;
};
type SubmissionAnswerRow = {
  id: string;
  submission_id: string;
  question_template_id: string;
  answer_json: unknown;
};

type FakeQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

const baseSubmission: ValidatedSubmission = {
  id: 'submission-1',
  queueId: 'queue-1',
  labelingTaskId: 'task-1',
  createdAt: 1_710_000_000_000,
  questions: [
    {
      rev: 1,
      data: {
        id: 'question-1',
        questionType: 'short_text',
        questionText: 'What happened?',
      },
    },
  ],
  answers: {
    'question-1': {
      value: 'Original answer',
    },
  },
};

class FakeUpsertQuery<T> implements PromiseLike<FakeQueryResult<T>> {
  private signal?: AbortSignal;
  private shouldSelect = false;

  constructor(private readonly executeQuery: (options: { signal?: AbortSignal; select: boolean }) => FakeQueryResult<T>) {}

  select() {
    this.shouldSelect = true;
    return this;
  }

  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }

  then<TResult1 = FakeQueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: FakeQueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.executeQuery({ signal: this.signal, select: this.shouldSelect })).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined
    );
  }
}

class FakeSelectQuery<T> implements PromiseLike<FakeQueryResult<T>> {
  private signal?: AbortSignal;
  private filter: { column: string; values: unknown[] } | null = null;

  constructor(private readonly executeQuery: (options: {
    signal?: AbortSignal;
    filter: { column: string; values: unknown[] } | null;
  }) => FakeQueryResult<T>) {}

  in(column: string, values: unknown[]) {
    this.filter = { column, values };
    return this;
  }

  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }

  then<TResult1 = FakeQueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: FakeQueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.executeQuery({ signal: this.signal, filter: this.filter })).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined
    );
  }
}

class FakeSupabase {
  readonly state = {
    queues: [] as QueueRow[],
    question_templates: [] as QuestionTemplateRow[],
    submissions: [] as SubmissionRow[],
    submission_answers: [] as SubmissionAnswerRow[],
  };

  private idCounter = 0;

  constructor(
    private readonly failures: Partial<Record<PersistenceTable, { message: string }>> = {}
  ) {}

  from(table: PersistenceTable) {
    return {
      upsert: (rows: Record<string, unknown>[], options: { ignoreDuplicates?: boolean }) =>
        new FakeUpsertQuery((queryOptions) => this.upsert(table, rows, options, queryOptions)),
      select: () => new FakeSelectQuery((queryOptions) => this.select(table, queryOptions)),
    };
  }

  private nextId(prefix: string) {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  private maybeAbort(signal?: AbortSignal) {
    if (signal?.aborted) {
      return {
        data: null,
        error: { message: 'Request was aborted (timeout or manual cancellation)' },
      } satisfies FakeQueryResult<never>;
    }

    return null;
  }

  private upsert(
    table: PersistenceTable,
    rows: Record<string, unknown>[],
    options: { ignoreDuplicates?: boolean },
    queryOptions: { signal?: AbortSignal; select: boolean }
  ) {
    const aborted = this.maybeAbort(queryOptions.signal);
    if (aborted) {
      return aborted;
    }

    const failure = this.failures[table];
    if (failure) {
      return { data: null, error: failure };
    }

    if (table === 'queues') {
      const written = rows.map((row) => {
        const queueId = String(row.queue_id);
        const existing = this.state.queues.find((candidate) => candidate.queue_id === queueId);
        if (existing) {
          if (!options.ignoreDuplicates) {
            existing.queue_id = queueId;
          }
          return existing;
        }

        const inserted = { id: this.nextId('queue'), queue_id: queueId };
        this.state.queues.push(inserted);
        return inserted;
      });

      return { data: queryOptions.select ? written : null, error: null };
    }

    if (table === 'question_templates') {
      const written = rows.map((row) => {
        const queueId = String(row.queue_id);
        const externalId = String(row.external_id);
        const existing = this.state.question_templates.find(
          (candidate) => candidate.queue_id === queueId && candidate.external_id === externalId
        );

        if (existing) {
          if (!options.ignoreDuplicates) {
            existing.question_type = row.question_type == null ? null : String(row.question_type);
            existing.question_text = String(row.question_text);
          }
          return existing;
        }

        const inserted = {
          id: this.nextId('question'),
          queue_id: queueId,
          external_id: externalId,
          question_type: row.question_type == null ? null : String(row.question_type),
          question_text: String(row.question_text),
        };
        this.state.question_templates.push(inserted);
        return inserted;
      });

      return { data: queryOptions.select ? written : null, error: null };
    }

    if (table === 'submissions') {
      const written = rows.map((row) => {
        const queueId = String(row.queue_id);
        const externalId = String(row.external_id);
        const existing = this.state.submissions.find(
          (candidate) => candidate.queue_id === queueId && candidate.external_id === externalId
        );

        if (existing) {
          if (!options.ignoreDuplicates) {
            existing.labeling_task_id = row.labeling_task_id == null ? null : String(row.labeling_task_id);
            existing.submitted_at = row.submitted_at == null ? null : String(row.submitted_at);
            existing.raw_json = row.raw_json;
          }
          return existing;
        }

        const inserted = {
          id: this.nextId('submission'),
          queue_id: queueId,
          external_id: externalId,
          labeling_task_id: row.labeling_task_id == null ? null : String(row.labeling_task_id),
          submitted_at: row.submitted_at == null ? null : String(row.submitted_at),
          raw_json: row.raw_json,
        };
        this.state.submissions.push(inserted);
        return inserted;
      });

      return { data: queryOptions.select ? written : null, error: null };
    }

    const written = rows.map((row) => {
      const submissionId = String(row.submission_id);
      const questionTemplateId = String(row.question_template_id);
      const existing = this.state.submission_answers.find(
        (candidate) =>
          candidate.submission_id === submissionId &&
          candidate.question_template_id === questionTemplateId
      );

      if (existing) {
        if (!options.ignoreDuplicates) {
          existing.answer_json = row.answer_json;
        }
        return existing;
      }

      const inserted = {
        id: this.nextId('answer'),
        submission_id: submissionId,
        question_template_id: questionTemplateId,
        answer_json: row.answer_json,
      };
      this.state.submission_answers.push(inserted);
      return inserted;
    });

    return { data: queryOptions.select ? written : null, error: null };
  }

  private select(
    table: PersistenceTable,
    queryOptions: { signal?: AbortSignal; filter: { column: string; values: unknown[] } | null }
  ) {
    const aborted = this.maybeAbort(queryOptions.signal);
    if (aborted) {
      return aborted;
    }

    const failure = this.failures[table];
    if (failure) {
      return { data: null, error: failure };
    }

    if (table === 'question_templates' && queryOptions.filter?.column === 'queue_id') {
      const queueIds = new Set(queryOptions.filter.values.map(String));
      return {
        data: this.state.question_templates.filter((row) => queueIds.has(row.queue_id)),
        error: null,
      };
    }

    return { data: null, error: null };
  }
}

function createUploadRequest(contents: string | object, fileName = 'submissions.json') {
  const serialized = typeof contents === 'string' ? contents : JSON.stringify(contents);
  const formData = new FormData();
  formData.append('file', new File([serialized], fileName, { type: 'application/json' }));

  return new Request('http://localhost/api/upload', {
    method: 'POST',
    body: formData,
  });
}

async function jsonBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('persistSubmissions', () => {
  it('overwrites stale answer rows when the same submission is re-uploaded', async () => {
    const supabase = new FakeSupabase();

    const firstWrite = await persistSubmissions(
      supabase as unknown as SupabaseClient,
      [baseSubmission]
    );
    expect(firstWrite).toEqual({ queues: 1, submissions: 1, questions: 1, answers: 1 });

    const correctedSubmission: ValidatedSubmission = {
      ...baseSubmission,
      answers: {
        'question-1': {
          value: 'Corrected answer',
        },
      },
    };

    const secondWrite = await persistSubmissions(
      supabase as unknown as SupabaseClient,
      [correctedSubmission]
    );

    expect(secondWrite.answers).toBe(1);
    expect(supabase.state.submission_answers).toHaveLength(1);
    expect(supabase.state.submission_answers[0]?.answer_json).toEqual({ value: 'Corrected answer' });
  });
});

describe('handleUpload validation', () => {
  it('rejects invalid JSON files', async () => {
    const response = await handleUpload(createUploadRequest('{not-json')); 
    const body = await jsonBody<{ error: string }>(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid JSON file');
  });

  it('rejects payloads that omit queueId', async () => {
    const invalidPayload = [
      {
        id: 'submission-1',
        questions: baseSubmission.questions,
        answers: baseSubmission.answers,
      },
    ];

    const response = await handleUpload(createUploadRequest(invalidPayload));
    const body = await jsonBody<{ error: string; details: Array<{ path?: unknown[] }> }>(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid submission format');
    expect(body.details.some((issue) => Array.isArray(issue.path) && issue.path.join('.') === '0.queueId')).toBe(true);
  });

  it('rejects payloads that omit answers', async () => {
    const invalidPayload = [
      {
        id: 'submission-1',
        queueId: 'queue-1',
        questions: baseSubmission.questions,
      },
    ];

    const response = await handleUpload(createUploadRequest(invalidPayload));
    const body = await jsonBody<{ error: string; details: Array<{ path?: unknown[] }> }>(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid submission format');
    expect(body.details.some((issue) => Array.isArray(issue.path) && issue.path.join('.') === '0.answers')).toBe(true);
  });

  it('rejects files over the upload size limit', async () => {
    const oversized = 'x'.repeat(MAX_UPLOAD_FILE_SIZE_BYTES + 1);
    const response = await handleUpload(createUploadRequest(oversized, 'oversized.json'));
    const body = await jsonBody<{ error: string }>(response);

    expect(response.status).toBe(413);
    expect(body.error).toBe('File too large. Maximum size is 10MB.');
  });
});

describe('handleUpload storage diagnostics', () => {
  it('surfaces schema drift with an explicit schema phase and table name', async () => {
    const supabase = new FakeSupabase({
      queues: { message: "Could not find the table 'public.queues' in the schema cache" },
    });

    const response = await handleUpload(createUploadRequest([baseSubmission]), {
      createServiceClient: () => supabase as never,
      persistSubmissions,
    });
    const body = await jsonBody<{
      error: string;
      phase: string;
      table: string;
      detail: string;
      guidance: string;
    }>(response);

    expect(response.status).toBe(500);
    expect(body.phase).toBe('schema');
    expect(body.table).toBe('queues');
    expect(body.error).toContain('schema');
    expect(body.detail).toContain('public.queues');
    expect(body.guidance).toContain('migrations');
  });

  it('surfaces non-schema write failures with upload-phase detail', async () => {
    const supabase = new FakeSupabase({
      submission_answers: { message: 'permission denied for table submission_answers' },
    });

    const response = await handleUpload(createUploadRequest([baseSubmission]), {
      createServiceClient: () => supabase as never,
      persistSubmissions,
    });
    const body = await jsonBody<{
      error: string;
      phase: string;
      table: string;
      detail: string;
      guidance: string;
    }>(response);

    expect(response.status).toBe(500);
    expect(body.phase).toBe('upload');
    expect(body.table).toBe('submission_answers');
    expect(body.error).toBe('Upload failed while writing submission_answers.');
    expect(body.detail).toContain('permission denied');
    expect(body.guidance).toContain('storage error detail');
  });

  it('returns a 504 when persistence exceeds the upload timeout', async () => {
    let receivedSignal = false;

    const response = await handleUpload(createUploadRequest([baseSubmission]), {
      createServiceClient: () => ({}) as never,
      timeoutMs: 1,
      persistSubmissions: async (_client, _items, options?: PersistSubmissionsOptions): Promise<ParseResult> => {
        receivedSignal = options?.signal instanceof AbortSignal;

        await new Promise<never>((_, reject) => {
          const signal = options?.signal;
          if (!signal) {
            reject(new Error('Missing abort signal'));
            return;
          }

          const abortWithTimeout = () => {
            reject(
              new UploadPersistenceError({
                message: 'Upload timed out while writing submission_answers.',
                phase: 'upload',
                table: 'submission_answers',
                detail: 'Request was aborted (timeout or manual cancellation)',
                guidance: 'Retry the upload after confirming the queue data did not partially persist.',
                status: 504,
              })
            );
          };

          if (signal.aborted) {
            abortWithTimeout();
            return;
          }

          const fallbackTimer = setTimeout(() => {
            reject(new Error('Timed out waiting for upload abort signal in test.'));
          }, 50);

          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(fallbackTimer);
              abortWithTimeout();
            },
            { once: true }
          );
        });
      },
    });
    const body = await jsonBody<{ error: string; phase: string; detail: string }>(response);

    expect(receivedSignal).toBe(true);
    expect(response.status).toBe(504);
    expect(body.phase).toBe('upload');
    expect(body.error).toBe('Upload timed out while writing submission_answers.');
    expect(body.detail).toContain('aborted');
  });
});
