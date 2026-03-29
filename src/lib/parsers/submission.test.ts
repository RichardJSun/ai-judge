import { describe, expect, it } from 'bun:test';
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
import { createSubmissionAttachmentStoragePath } from '@/lib/submissions/attachment-storage';
import type { ValidatedSubmission } from '@/lib/validators/upload';

type PersistSubmissionsClient = Parameters<typeof persistSubmissions>[0];

type PersistenceTable =
  | 'queues'
  | 'question_templates'
  | 'submissions'
  | 'submission_answers'
  | 'submission_attachments';

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
type SubmissionAttachmentRow = {
  id: string;
  submission_id: string;
  external_attachment_id: string;
  source_kind: string;
  file_name: string;
  media_type: string;
  byte_size: number;
  storage_bucket: string;
  storage_path: string;
  storage_status: 'stored' | 'unavailable' | 'error';
  storage_error: string | null;
};
type StoredObject = {
  bucket: string;
  path: string;
  body: Uint8Array;
  contentType: string | undefined;
};

type FakeQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

const baseAttachmentPayload = Buffer.from('reviewer attachment').toString('base64');

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

  constructor(
    private readonly executeQuery: (options: {
      signal?: AbortSignal;
      filter: { column: string; values: unknown[] } | null;
    }) => FakeQueryResult<T>
  ) {}

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
    submission_attachments: [] as SubmissionAttachmentRow[],
    storageObjects: [] as StoredObject[],
  };

  readonly storage = {
    from: (bucket: string) => ({
      upload: async (
        path: string,
        body: ArrayBuffer | ArrayBufferView,
        options?: { contentType?: string; upsert?: boolean }
      ) => {
        if (this.storageDelayMs > 0) {
          await Bun.sleep(this.storageDelayMs);
        }

        if (this.storageFailure) {
          return { data: null, error: this.storageFailure };
        }

        if (this.returnMalformedStorageResponse) {
          return { data: {} as { path?: string }, error: null };
        }

        const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
        const existingIndex = this.state.storageObjects.findIndex(
          (candidate) => candidate.bucket === bucket && candidate.path === path
        );

        const stored: StoredObject = {
          bucket,
          path,
          body: bytes,
          contentType: options?.contentType,
        };

        if (existingIndex >= 0) {
          this.state.storageObjects[existingIndex] = stored;
        } else {
          this.state.storageObjects.push(stored);
        }

        return {
          data: {
            path,
            fullPath: `${bucket}/${path}`,
          },
          error: null,
        };
      },
    }),
  };

  private idCounter = 0;

  constructor(
    private readonly failures: Partial<Record<PersistenceTable, { message: string }>> = {},
    private readonly storageFailure: { message: string } | null = null,
    private readonly returnMalformedStorageResponse = false,
    private readonly storageDelayMs = 0
  ) {}

  from(table: PersistenceTable) {
    return {
      upsert: (rows: Record<string, unknown>[], options: { ignoreDuplicates?: boolean }) =>
        new FakeUpsertQuery<unknown>((queryOptions) => this.upsert(table, rows, options, queryOptions)),
      select: () =>
        new FakeSelectQuery<unknown>((queryOptions) =>
          this.select(table, queryOptions) as FakeQueryResult<unknown>
        ),
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

    if (table === 'submission_answers') {
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

    const written = rows.map((row) => {
      const submissionId = String(row.submission_id);
      const externalAttachmentId = String(row.external_attachment_id);
      const existing = this.state.submission_attachments.find(
        (candidate) =>
          candidate.submission_id === submissionId &&
          candidate.external_attachment_id === externalAttachmentId
      );

      if (existing) {
        if (!options.ignoreDuplicates) {
          existing.source_kind = String(row.source_kind);
          existing.file_name = String(row.file_name);
          existing.media_type = String(row.media_type);
          existing.byte_size = Number(row.byte_size);
          existing.storage_bucket = String(row.storage_bucket);
          existing.storage_path = String(row.storage_path);
          existing.storage_status = row.storage_status as SubmissionAttachmentRow['storage_status'];
          existing.storage_error = row.storage_error == null ? null : String(row.storage_error);
        }
        return existing;
      }

      const inserted = {
        id: this.nextId('attachment'),
        submission_id: submissionId,
        external_attachment_id: externalAttachmentId,
        source_kind: String(row.source_kind),
        file_name: String(row.file_name),
        media_type: String(row.media_type),
        byte_size: Number(row.byte_size),
        storage_bucket: String(row.storage_bucket),
        storage_path: String(row.storage_path),
        storage_status: row.storage_status as SubmissionAttachmentRow['storage_status'],
        storage_error: row.storage_error == null ? null : String(row.storage_error),
      };
      this.state.submission_attachments.push(inserted);
      return inserted;
    });

    return { data: queryOptions.select ? written : null, error: null };
  }

  private select(
    table: PersistenceTable,
    queryOptions: { signal?: AbortSignal; filter: { column: string; values: unknown[] } | null }
  ): FakeQueryResult<unknown> {
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

function createInlineAttachment(overrides: Partial<NonNullable<ValidatedSubmission['attachments']>[number]> = {}) {
  const base64 = overrides.source?.base64 ?? baseAttachmentPayload;

  return {
    id: 'attachment-1',
    fileName: 'evidence.txt',
    mediaType: 'text/plain',
    byteSize: Buffer.from(base64, 'base64').byteLength,
    source: {
      kind: 'inline_base64' as const,
      base64,
      ...overrides.source,
    },
    ...overrides,
  };
}

function createSubmissionWithAttachment(
  overrides: Partial<ValidatedSubmission> = {},
  attachmentOverrides: Partial<NonNullable<ValidatedSubmission['attachments']>[number]> = {}
): ValidatedSubmission {
  return {
    ...baseSubmission,
    ...overrides,
    attachments: [createInlineAttachment(attachmentOverrides)],
  };
}

describe('persistSubmissions', () => {
  it('persists one durable storage object and one attachment row per submission attachment', async () => {
    const supabase = new FakeSupabase();

    const result = await persistSubmissions(
      supabase as unknown as PersistSubmissionsClient,
      [createSubmissionWithAttachment()]
    );

    expect(result).toEqual({ queues: 1, submissions: 1, questions: 1, answers: 1, attachments: 1 });
    expect(supabase.state.submission_attachments).toHaveLength(1);
    expect(supabase.state.storageObjects).toHaveLength(1);

    const storedRow = supabase.state.submission_attachments[0];
    const storedObject = supabase.state.storageObjects[0];
    const submissionRow = supabase.state.submissions[0];

    expect(storedRow).toMatchObject({
      submission_id: submissionRow?.id,
      external_attachment_id: 'attachment-1',
      file_name: 'evidence.txt',
      media_type: 'text/plain',
      storage_bucket: 'submission-attachments',
      storage_status: 'stored',
      storage_error: null,
    });
    expect(storedObject).toMatchObject({
      bucket: 'submission-attachments',
      path: createSubmissionAttachmentStoragePath({
        submissionId: submissionRow?.id ?? 'missing-submission-id',
        attachmentId: 'attachment-1',
      }),
      contentType: 'text/plain',
    });

    expect(storedObject?.body).toEqual(new Uint8Array(Buffer.from(baseAttachmentPayload, 'base64')));
    expect(submissionRow?.raw_json).toEqual({
      ...createSubmissionWithAttachment(),
      attachments: [
        {
          id: 'attachment-1',
          fileName: 'evidence.txt',
          mediaType: 'text/plain',
          byteSize: Buffer.from(baseAttachmentPayload, 'base64').byteLength,
          source: { kind: 'inline_base64' },
        },
      ],
    });
  });

  it('keeps attachment-free uploads backward compatible', async () => {
    const supabase = new FakeSupabase();

    const result = await persistSubmissions(
      supabase as unknown as PersistSubmissionsClient,
      [baseSubmission]
    );

    expect(result).toEqual({ queues: 1, submissions: 1, questions: 1, answers: 1, attachments: 0 });
    expect(supabase.state.submission_attachments).toHaveLength(0);
    expect(supabase.state.storageObjects).toHaveLength(0);
  });

  it('overwrites stale answer rows and attachment metadata without duplicating rows or objects', async () => {
    const supabase = new FakeSupabase();

    await persistSubmissions(
      supabase as unknown as PersistSubmissionsClient,
      [createSubmissionWithAttachment()]
    );

    const updatedAttachmentPayload = Buffer.from('updated reviewer attachment').toString('base64');
    const updatedSubmission = createSubmissionWithAttachment(
      {
        answers: {
          'question-1': {
            value: 'Corrected answer',
          },
        },
      },
      {
        fileName: 'updated.pdf',
        mediaType: 'application/pdf',
        source: {
          kind: 'inline_base64',
          base64: updatedAttachmentPayload,
        },
        byteSize: Buffer.from(updatedAttachmentPayload, 'base64').byteLength,
      }
    );

    const result = await persistSubmissions(
      supabase as unknown as PersistSubmissionsClient,
      [updatedSubmission]
    );

    expect(result.answers).toBe(1);
    expect(result.attachments).toBe(1);
    expect(supabase.state.submission_answers).toHaveLength(1);
    expect(supabase.state.submission_attachments).toHaveLength(1);
    expect(supabase.state.storageObjects).toHaveLength(1);
    expect(supabase.state.submission_answers[0]?.answer_json).toEqual({ value: 'Corrected answer' });
    expect(supabase.state.submission_attachments[0]).toMatchObject({
      file_name: 'updated.pdf',
      media_type: 'application/pdf',
      byte_size: Buffer.from(updatedAttachmentPayload, 'base64').byteLength,
    });
    expect(supabase.state.storageObjects[0]?.contentType).toBe('application/pdf');
    expect(supabase.state.storageObjects[0]?.body).toEqual(
      new Uint8Array(Buffer.from(updatedAttachmentPayload, 'base64'))
    );
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

  it('rejects invalid attachment base64 before any write begins', async () => {
    const invalidPayload = [
      createSubmissionWithAttachment({}, {
        source: {
          kind: 'inline_base64',
          base64: '%%%not-base64%%%',
        },
        byteSize: 12,
      }),
    ];

    const response = await handleUpload(createUploadRequest(invalidPayload));
    const body = await jsonBody<{ error: string; details: Array<{ path?: unknown[]; message?: string }> }>(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid submission format');
    expect(
      body.details.some(
        (issue) =>
          Array.isArray(issue.path) &&
          issue.path.join('.') === '0.attachments.0.source.base64' &&
          issue.message?.includes('valid base64')
      )
    ).toBe(true);
  });

  it('rejects unsupported attachment source kinds explicitly', async () => {
    const invalidPayload = [
      {
        ...createSubmissionWithAttachment(),
        attachments: [
          {
            id: 'attachment-1',
            fileName: 'remote.pdf',
            mediaType: 'application/pdf',
            byteSize: 12,
            source: {
              kind: 'remote_url',
              url: 'https://example.com/evidence.pdf',
            },
          },
        ],
      },
    ];

    const response = await handleUpload(createUploadRequest(invalidPayload));
    const body = await jsonBody<{ error: string; details: Array<{ path?: unknown[]; message?: string }> }>(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid submission format');
    expect(
      body.details.some(
        (issue) =>
          Array.isArray(issue.path) &&
          issue.path.join('.') === '0.attachments.0.source.kind' &&
          issue.message?.includes('Only inline_base64 is supported')
      )
    ).toBe(true);
  });

  it('rejects duplicate attachment ids on one submission', async () => {
    const invalidPayload = [
      {
        ...createSubmissionWithAttachment(),
        attachments: [createInlineAttachment(), createInlineAttachment()],
      },
    ];

    const response = await handleUpload(createUploadRequest(invalidPayload));
    const body = await jsonBody<{ error: string; details: Array<{ path?: unknown[]; message?: string }> }>(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid submission format');
    expect(
      body.details.some(
        (issue) =>
          Array.isArray(issue.path) &&
          issue.path.join('.') === '0.attachments.1.id' &&
          issue.message === 'Duplicate attachment id attachment-1.'
      )
    ).toBe(true);
  });

  it('rejects unsupported attachment media types and empty filenames', async () => {
    const invalidPayload = [
      {
        ...createSubmissionWithAttachment(),
        attachments: [
          createInlineAttachment({
            fileName: '   ',
            mediaType: 'application/x-msdownload',
          }),
        ],
      },
    ];

    const response = await handleUpload(createUploadRequest(invalidPayload));
    const body = await jsonBody<{ error: string; details: Array<{ path?: unknown[]; message?: string }> }>(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid submission format');
    expect(
      body.details.some(
        (issue) => Array.isArray(issue.path) && issue.path.join('.') === '0.attachments.0.fileName'
      )
    ).toBe(true);
    expect(
      body.details.some(
        (issue) => Array.isArray(issue.path) && issue.path.join('.') === '0.attachments.0.mediaType'
      )
    ).toBe(true);
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
  it('surfaces schema drift on submission_attachments with an explicit schema phase and table name', async () => {
    const supabase = new FakeSupabase({
      submission_attachments: {
        message: "Could not find the table 'public.submission_attachments' in the schema cache",
      },
    });

    const response = await handleUpload(createUploadRequest([createSubmissionWithAttachment()]), {
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
    expect(body.table).toBe('submission_attachments');
    expect(body.error).toContain('schema');
    expect(body.detail).toContain('public.submission_attachments');
    expect(body.guidance).toContain('migrations');
  });

  it('surfaces attachment storage write failures with attachment and path context', async () => {
    const supabase = new FakeSupabase({}, { message: 'bucket not found' });

    const response = await handleUpload(createUploadRequest([createSubmissionWithAttachment()]), {
      createServiceClient: () => supabase as never,
      persistSubmissions,
    });
    const body = await jsonBody<{
      error: string;
      phase: string;
      table: string;
      detail: string;
      guidance: string;
      attachmentId: string;
      storageBucket: string;
      storagePath: string;
    }>(response);

    expect(response.status).toBe(500);
    expect(body.phase).toBe('storage');
    expect(body.table).toBe('storage');
    expect(body.error).toBe('Attachment attachment-1 failed to upload to durable storage.');
    expect(body.detail).toContain('bucket not found');
    expect(body.attachmentId).toBe('attachment-1');
    expect(body.storageBucket).toBe('submission-attachments');
    expect(body.storagePath).toContain('/attachments/attachment-1');
  });

  it('treats malformed storage responses as persistence failures instead of claiming success', async () => {
    const supabase = new FakeSupabase({}, null, true);

    const response = await handleUpload(createUploadRequest([createSubmissionWithAttachment()]), {
      createServiceClient: () => supabase as never,
      persistSubmissions,
    });
    const body = await jsonBody<{
      error: string;
      phase: string;
      table: string;
      detail: string;
      attachmentId: string;
    }>(response);

    expect(response.status).toBe(500);
    expect(body.phase).toBe('storage');
    expect(body.table).toBe('storage');
    expect(body.error).toBe('Attachment attachment-1 returned an invalid durable-storage response.');
    expect(body.detail).toContain('usable object path');
    expect(body.attachmentId).toBe('attachment-1');
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
        return {} as ParseResult;
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
