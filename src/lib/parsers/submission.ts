import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SubmissionAttachmentStorageError,
  uploadSubmissionAttachment,
} from '@/lib/submissions/attachment-storage';
import type { ValidatedSubmission } from '@/lib/validators/upload';

export interface ParseResult {
  queues: number;
  submissions: number;
  questions: number;
  answers: number;
  attachments: number;
}

export interface PersistSubmissionsOptions {
  signal?: AbortSignal;
}

type PersistenceSurface =
  | 'queues'
  | 'question_templates'
  | 'submissions'
  | 'submission_answers'
  | 'submission_attachments'
  | 'storage';
type PersistencePhase = 'schema' | 'upload' | 'storage';

type QueryResult<T> = {
  data: T | null;
  error: { message?: string | null } | null;
};

export class UploadPersistenceError extends Error {
  readonly phase: PersistencePhase;
  readonly table: PersistenceSurface;
  readonly detail: string;
  readonly guidance: string;
  readonly status: number;
  readonly attachmentId: string | null;
  readonly storageBucket: string | null;
  readonly storagePath: string | null;

  constructor({
    message,
    phase,
    table,
    detail,
    guidance,
    status,
    attachmentId,
    storageBucket,
    storagePath,
  }: {
    message: string;
    phase: PersistencePhase;
    table: PersistenceSurface;
    detail: string;
    guidance: string;
    status: number;
    attachmentId?: string | null;
    storageBucket?: string | null;
    storagePath?: string | null;
  }) {
    super(message);
    this.name = 'UploadPersistenceError';
    this.phase = phase;
    this.table = table;
    this.detail = detail;
    this.guidance = guidance;
    this.status = status;
    this.attachmentId = attachmentId ?? null;
    this.storageBucket = storageBucket ?? null;
    this.storagePath = storagePath ?? null;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown storage error.';
}

function isSchemaDrift(detail: string, table: Exclude<PersistenceSurface, 'storage'>) {
  const lowerDetail = detail.toLowerCase();
  const publicTable = `public.${table}`;

  return (
    lowerDetail.includes('schema cache') ||
    lowerDetail.includes(`relation \"${publicTable}\" does not exist`) ||
    lowerDetail.includes(`table '${publicTable}'`) ||
    (lowerDetail.includes(publicTable) && lowerDetail.includes('does not exist'))
  );
}

function isAbortLike(detail: string, signal?: AbortSignal) {
  const lowerDetail = detail.toLowerCase();

  return (
    signal?.aborted === true ||
    lowerDetail.includes('abort') ||
    lowerDetail.includes('timed out') ||
    lowerDetail.includes('timeout')
  );
}

function createPersistenceError(
  table: Exclude<PersistenceSurface, 'storage'>,
  cause: unknown,
  signal?: AbortSignal
) {
  const detail = errorMessage(cause);

  if (isSchemaDrift(detail, table)) {
    return new UploadPersistenceError({
      message: `Upload failed because the Supabase ${table} table is missing or the schema cache is stale.`,
      phase: 'schema',
      table,
      detail,
      guidance: 'Run the latest Supabase migrations, refresh the schema cache, and retry the upload.',
      status: 500,
    });
  }

  if (isAbortLike(detail, signal)) {
    return new UploadPersistenceError({
      message: `Upload timed out while writing ${table}.`,
      phase: 'upload',
      table,
      detail,
      guidance: 'Retry the upload after confirming the queue data did not partially persist.',
      status: 504,
    });
  }

  return new UploadPersistenceError({
    message: `Upload failed while writing ${table}.`,
    phase: 'upload',
    table,
    detail,
    guidance: 'Check the storage error detail and retry after fixing the underlying Supabase issue.',
    status: 500,
  });
}

function createAttachmentStoragePersistenceError(error: SubmissionAttachmentStorageError) {
  return new UploadPersistenceError({
    message: error.message,
    phase: 'storage',
    table: 'storage',
    detail: error.detail,
    guidance:
      error.status === 504
        ? 'Retry the upload after confirming the attachment object was not partially written.'
        : 'Check the attachment storage bucket/path and retry after fixing the underlying storage issue.',
    status: error.status,
    attachmentId: error.attachmentId,
    storageBucket: error.bucket,
    storagePath: error.path,
  });
}

function assertArrayResult<T>(table: PersistenceSurface, data: T[] | null, operation: string): T[] {
  if (!Array.isArray(data)) {
    throw new UploadPersistenceError({
      message: `Upload failed because ${table} returned an invalid ${operation} response.`,
      phase: table === 'storage' ? 'storage' : 'upload',
      table,
      detail: `Expected an array response from ${table} ${operation}.`,
      guidance: 'Check the Supabase query contract and update the parser if the selected columns changed.',
      status: 500,
    });
  }

  return data;
}

async function runQuery<T>(
  query: PromiseLike<QueryResult<T>> & { abortSignal?: (signal: AbortSignal) => PromiseLike<QueryResult<T>> },
  signal?: AbortSignal
) {
  if (signal && typeof query.abortSignal === 'function') {
    return await query.abortSignal(signal);
  }

  return await query;
}

export async function persistSubmissions(
  supabase: SupabaseClient,
  items: ValidatedSubmission[],
  options: PersistSubmissionsOptions = {}
): Promise<ParseResult> {
  const { signal } = options;
  const counts: ParseResult = { queues: 0, submissions: 0, questions: 0, answers: 0, attachments: 0 };

  const queueIds = [...new Set(items.map((submission) => submission.queueId))];

  const queueQuery = supabase
    .from('queues')
    .upsert(
      queueIds.map((queueId) => ({ queue_id: queueId })),
      { onConflict: 'queue_id', ignoreDuplicates: false }
    )
    .select('id, queue_id');
  const { data: queuesData, error: queueError } = await runQuery(queueQuery, signal);
  if (queueError) {
    throw createPersistenceError('queues', queueError, signal);
  }

  const queues = assertArrayResult<{ queue_id: string; id: string }>('queues', queuesData, 'upsert');
  counts.queues = queues.length;
  const queueMap = new Map(queues.map((queue) => [queue.queue_id, queue.id]));

  const allQuestionRows: Array<{
    queue_id: string;
    external_id: string;
    question_type: string | null;
    question_text: string;
  }> = [];
  for (const item of items) {
    const queueUuid = queueMap.get(item.queueId);
    if (!queueUuid) {
      continue;
    }

    for (const question of item.questions) {
      allQuestionRows.push({
        queue_id: queueUuid,
        external_id: question.data.id,
        question_type: question.data.questionType ?? null,
        question_text: question.data.questionText,
      });
    }
  }

  if (allQuestionRows.length > 0) {
    const deduplicatedQuestionRows = new Map(
      allQuestionRows.map((row) => [`${row.queue_id}::${row.external_id}`, row])
    );
    const uniqueQuestions = [...deduplicatedQuestionRows.values()];

    const questionUpsertQuery = supabase
      .from('question_templates')
      .upsert(uniqueQuestions, { onConflict: 'queue_id,external_id', ignoreDuplicates: false })
      .select('id, external_id, queue_id');
    const { data: questionData, error: questionError } = await runQuery(questionUpsertQuery, signal);
    if (questionError) {
      throw createPersistenceError('question_templates', questionError, signal);
    }

    const questionTemplates = assertArrayResult<{ id: string; external_id: string; queue_id: string }>(
      'question_templates',
      questionData,
      'upsert'
    );
    counts.questions = questionTemplates.length;
  }

  const submissionRows = items
    .map((item) => {
      const queueUuid = queueMap.get(item.queueId);
      if (!queueUuid) {
        return null;
      }

      return {
        queue_id: queueUuid,
        external_id: item.id,
        labeling_task_id: item.labelingTaskId ?? null,
        submitted_at: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        raw_json: createStoredSubmissionRawJson(item),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (submissionRows.length === 0) {
    return counts;
  }

  const submissionUpsertQuery = supabase
    .from('submissions')
    .upsert(submissionRows, { onConflict: 'queue_id,external_id', ignoreDuplicates: false })
    .select('id, external_id, queue_id');
  const { data: submissionData, error: submissionError } = await runQuery(submissionUpsertQuery, signal);
  if (submissionError) {
    throw createPersistenceError('submissions', submissionError, signal);
  }

  const submissions = assertArrayResult<{ id: string; external_id: string; queue_id: string }>(
    'submissions',
    submissionData,
    'upsert'
  );
  counts.submissions = submissions.length;

  const affectedQueueUuids = [...new Set(submissionRows.map((row) => row.queue_id))];
  const questionLookupQuery = supabase
    .from('question_templates')
    .select('id, external_id, queue_id')
    .in('queue_id', affectedQueueUuids);
  const { data: questionLookupData, error: questionLookupError } = await runQuery(questionLookupQuery, signal);
  if (questionLookupError) {
    throw createPersistenceError('question_templates', questionLookupError, signal);
  }

  const questionTemplateRows = assertArrayResult<{ id: string; external_id: string; queue_id: string }>(
    'question_templates',
    questionLookupData,
    'select'
  );
  const questionTemplateMap = new Map(
    questionTemplateRows.map((questionTemplate) => [
      `${questionTemplate.queue_id}::${questionTemplate.external_id}`,
      questionTemplate.id,
    ])
  );

  const submissionMap = new Map(
    submissions.map((submission) => [`${submission.queue_id}::${submission.external_id}`, submission.id])
  );

  const allAnswerRows: Array<{
    submission_id: string;
    question_template_id: string;
    answer_json: unknown;
  }> = [];
  for (const item of items) {
    const queueUuid = queueMap.get(item.queueId);
    if (!queueUuid) {
      continue;
    }

    const submissionId = submissionMap.get(`${queueUuid}::${item.id}`);
    if (!submissionId) {
      continue;
    }

    for (const [questionExternalId, answerData] of Object.entries(item.answers)) {
      const questionTemplateId = questionTemplateMap.get(`${queueUuid}::${questionExternalId}`);
      if (!questionTemplateId) {
        continue;
      }

      allAnswerRows.push({
        submission_id: submissionId,
        question_template_id: questionTemplateId,
        answer_json: answerData,
      });
    }
  }

  if (allAnswerRows.length > 0) {
    const answerUpsertQuery = supabase
      .from('submission_answers')
      .upsert(allAnswerRows, { onConflict: 'submission_id,question_template_id', ignoreDuplicates: false });
    const { error: answerError } = await runQuery(answerUpsertQuery, signal);
    if (answerError) {
      throw createPersistenceError('submission_answers', answerError, signal);
    }

    counts.answers = allAnswerRows.length;
  }

  const attachmentRows: Array<{
    submission_id: string;
    external_attachment_id: string;
    source_kind: string;
    file_name: string;
    media_type: string;
    byte_size: number;
    storage_bucket: string;
    storage_path: string;
    storage_status: 'stored';
    storage_error: null;
  }> = [];

  for (const item of items) {
    const queueUuid = queueMap.get(item.queueId);
    if (!queueUuid) {
      continue;
    }

    const submissionId = submissionMap.get(`${queueUuid}::${item.id}`);
    if (!submissionId) {
      continue;
    }

    for (const attachment of item.attachments ?? []) {
      try {
        const object = await uploadSubmissionAttachment(supabase, {
          attachmentId: attachment.id,
          mediaType: attachment.mediaType,
          bytes: Buffer.from(attachment.source.base64, 'base64'),
          submissionId,
          signal,
        });

        attachmentRows.push({
          submission_id: submissionId,
          external_attachment_id: attachment.id,
          source_kind: attachment.source.kind,
          file_name: attachment.fileName,
          media_type: attachment.mediaType,
          byte_size: attachment.byteSize,
          storage_bucket: object.bucket,
          storage_path: object.path,
          storage_status: 'stored',
          storage_error: null,
        });
      } catch (error) {
        if (error instanceof SubmissionAttachmentStorageError) {
          throw createAttachmentStoragePersistenceError(error);
        }

        throw error;
      }
    }
  }

  if (attachmentRows.length > 0) {
    const attachmentUpsertQuery = supabase
      .from('submission_attachments')
      .upsert(attachmentRows, {
        onConflict: 'submission_id,external_attachment_id',
        ignoreDuplicates: false,
      })
      .select('id');
    const { data: attachmentData, error: attachmentError } = await runQuery(attachmentUpsertQuery, signal);
    if (attachmentError) {
      throw createPersistenceError('submission_attachments', attachmentError, signal);
    }

    const persistedAttachments = assertArrayResult<{ id: string }>(
      'submission_attachments',
      attachmentData,
      'upsert'
    );
    counts.attachments = persistedAttachments.length;
  }

  return counts;
}

function createStoredSubmissionRawJson(item: ValidatedSubmission) {
  return {
    ...item,
    attachments: (item.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      byteSize: attachment.byteSize,
      source: {
        kind: attachment.source.kind,
      },
    })),
  };
}
