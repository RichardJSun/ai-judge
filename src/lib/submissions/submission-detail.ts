import type {
  SubmissionDetailAnswer,
  SubmissionDetailAttachment,
  SubmissionDetailQuestion,
  SubmissionDetailResponse,
} from '@/types/api';
import type { AttachmentStorageStatusEnum } from '@/types/db';

export interface SubmissionDetailInput {
  queue: unknown;
  submission: unknown;
  questionTemplates: unknown[];
  submissionAnswers: unknown[];
  submissionAttachments: unknown[];
}

interface QueueRecord {
  id: string;
  queue_id: string;
  created_at: string;
}

interface SubmissionRecord {
  id: string;
  queue_id: string;
  external_id: string;
  labeling_task_id: string | null;
  submitted_at: string | null;
  created_at: string;
}

interface QuestionTemplateRecord {
  id: string;
  queue_id: string;
  external_id: string;
  question_type: string | null;
  question_text: string;
  created_at: string;
}

interface SubmissionAnswerRecord {
  id: string;
  submission_id: string;
  question_template_id: string;
  answer_json: Record<string, unknown>;
  created_at: string;
}

interface SubmissionAttachmentRecord {
  id: string;
  submission_id: string;
  external_attachment_id: string;
  source_kind: string;
  file_name: string;
  media_type: string;
  byte_size: number;
  storage_status: AttachmentStorageStatusEnum;
  storage_error: string | null;
  created_at: string;
}

export class SubmissionDetailError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(message: string, options?: { status?: number; publicMessage?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'SubmissionDetailError';
    this.status = options?.status ?? 500;
    this.publicMessage = options?.publicMessage ?? 'Malformed submission detail returned from storage.';
  }
}

export function createSubmissionDetailResponse({
  queue,
  submission,
  questionTemplates,
  submissionAnswers,
  submissionAttachments,
}: SubmissionDetailInput): SubmissionDetailResponse {
  const normalizedQueue = normalizeQueue(queue);
  const normalizedSubmission = normalizeSubmission(submission);

  if (normalizedSubmission.queue_id !== normalizedQueue.id) {
    throw new SubmissionDetailError(
      `Submission ${normalizedSubmission.id} belongs to queue ${normalizedSubmission.queue_id}, not queue ${normalizedQueue.id}.`
    );
  }

  const orderedQuestions = [...questionTemplates]
    .map((row) => normalizeQuestionTemplate(row, normalizedQueue.id))
    .sort(compareQuestionTemplates);
  const answersByQuestionId = buildAnswerMap(submissionAnswers, normalizedSubmission.id);
  const attachments = normalizeSubmissionAttachments(submissionAttachments, normalizedSubmission.id);

  const questions: SubmissionDetailQuestion[] = orderedQuestions.map((question) => {
    const answer = answersByQuestionId.get(question.id);
    answersByQuestionId.delete(question.id);

    if (!answer) {
      return {
        id: question.id,
        external_id: question.external_id,
        question_type: question.question_type,
        question_text: question.question_text,
        created_at: question.created_at,
        answerState: 'missing',
        answer: null,
        rawAnswer: null,
      };
    }

    return {
      id: question.id,
      external_id: question.external_id,
      question_type: question.question_type,
      question_text: question.question_text,
      created_at: question.created_at,
      answerState: 'answered',
      answer: normalizeAnswer(answer.answer_json),
      rawAnswer: answer.answer_json,
    };
  });

  if (answersByQuestionId.size > 0) {
    const [orphanQuestionTemplateId] = answersByQuestionId.keys();
    throw new SubmissionDetailError(
      `Submission answer for question_template_id ${orphanQuestionTemplateId} did not match any queue question.`
    );
  }

  const answeredQuestions = questions.filter((question) => question.answerState === 'answered').length;
  const totalQuestions = questions.length;
  const missingQuestions = totalQuestions - answeredQuestions;

  return {
    queue: normalizedQueue,
    submission: normalizedSubmission,
    summary: {
      totalQuestions,
      answeredQuestions,
      missingQuestions,
    },
    questions,
    attachments,
  };
}

function buildAnswerMap(rows: unknown[], submissionId: string): Map<string, SubmissionAnswerRecord> {
  const answers = new Map<string, SubmissionAnswerRecord>();

  for (const row of rows) {
    const answer = normalizeSubmissionAnswer(row, submissionId);
    if (answers.has(answer.question_template_id)) {
      throw new SubmissionDetailError(
        `Submission ${submissionId} returned duplicate answers for question_template_id ${answer.question_template_id}.`
      );
    }

    answers.set(answer.question_template_id, answer);
  }

  return answers;
}

function normalizeSubmissionAttachments(rows: unknown[], submissionId: string): SubmissionDetailAttachment[] {
  const attachments = new Map<string, SubmissionAttachmentRecord>();
  const externalAttachmentIds = new Set<string>();

  for (const row of rows) {
    const attachment = normalizeSubmissionAttachment(row, submissionId);

    if (attachments.has(attachment.id)) {
      throw new SubmissionDetailError(
        `Submission ${submissionId} returned duplicate attachment ids for ${attachment.id}.`
      );
    }

    if (externalAttachmentIds.has(attachment.external_attachment_id)) {
      throw new SubmissionDetailError(
        `Submission ${submissionId} returned duplicate external attachment ids for ${attachment.external_attachment_id}.`
      );
    }

    attachments.set(attachment.id, attachment);
    externalAttachmentIds.add(attachment.external_attachment_id);
  }

  return [...attachments.values()].sort(compareSubmissionAttachments).map((attachment) => ({
    id: attachment.id,
    external_attachment_id: attachment.external_attachment_id,
    source_kind: attachment.source_kind,
    file_name: attachment.file_name,
    media_type: attachment.media_type,
    byte_size: attachment.byte_size,
    storage_status: attachment.storage_status,
    storage_error: attachment.storage_error,
  }));
}

function compareQuestionTemplates(a: QuestionTemplateRecord, b: QuestionTemplateRecord): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function compareSubmissionAttachments(a: SubmissionAttachmentRecord, b: SubmissionAttachmentRecord): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function normalizeQueue(row: unknown): QueueRecord {
  const record = asRecord(row, 'queue');

  return {
    id: asString(record.id, 'queue.id'),
    queue_id: asString(record.queue_id, 'queue.queue_id'),
    created_at: asString(record.created_at, 'queue.created_at'),
  };
}

function normalizeSubmission(row: unknown): SubmissionRecord {
  const record = asRecord(row, 'submission');

  return {
    id: asString(record.id, 'submission.id'),
    queue_id: asString(record.queue_id, 'submission.queue_id'),
    external_id: asString(record.external_id, 'submission.external_id'),
    labeling_task_id: asNullableString(record.labeling_task_id, 'submission.labeling_task_id'),
    submitted_at: asNullableString(record.submitted_at, 'submission.submitted_at'),
    created_at: asString(record.created_at, 'submission.created_at'),
  };
}

function normalizeQuestionTemplate(row: unknown, queueId: string): QuestionTemplateRecord {
  const record = asRecord(row, 'question template');
  const questionQueueId = asString(record.queue_id, 'question_template.queue_id');

  if (questionQueueId !== queueId) {
    throw new SubmissionDetailError(
      `Question template ${asString(record.id, 'question_template.id')} belongs to queue ${questionQueueId}, not queue ${queueId}.`
    );
  }

  return {
    id: asString(record.id, 'question_template.id'),
    queue_id: questionQueueId,
    external_id: asString(record.external_id, 'question_template.external_id'),
    question_type: asNullableString(record.question_type, 'question_template.question_type'),
    question_text: asString(record.question_text, 'question_template.question_text'),
    created_at: asString(record.created_at, 'question_template.created_at'),
  };
}

function normalizeSubmissionAnswer(row: unknown, submissionId: string): SubmissionAnswerRecord {
  const record = asRecord(row, 'submission answer');
  const answerSubmissionId = asString(record.submission_id, 'submission_answer.submission_id');

  if (answerSubmissionId !== submissionId) {
    throw new SubmissionDetailError(
      `Submission answer ${asString(record.id, 'submission_answer.id')} belongs to submission ${answerSubmissionId}, not submission ${submissionId}.`
    );
  }

  return {
    id: asString(record.id, 'submission_answer.id'),
    submission_id: answerSubmissionId,
    question_template_id: asString(record.question_template_id, 'submission_answer.question_template_id'),
    answer_json: asJsonObject(record.answer_json, 'submission_answer.answer_json'),
    created_at: asString(record.created_at, 'submission_answer.created_at'),
  };
}

function normalizeSubmissionAttachment(row: unknown, submissionId: string): SubmissionAttachmentRecord {
  const record = asRecord(row, 'submission attachment');
  const attachmentSubmissionId = asString(record.submission_id, 'submission_attachment.submission_id');

  if (attachmentSubmissionId !== submissionId) {
    throw new SubmissionDetailError(
      `Submission attachment ${asString(record.id, 'submission_attachment.id')} belongs to submission ${attachmentSubmissionId}, not submission ${submissionId}.`
    );
  }

  const storageStatus = asAttachmentStorageStatus(
    record.storage_status,
    'submission_attachment.storage_status'
  );
  const storageError = asNullableNonEmptyString(
    record.storage_error,
    'submission_attachment.storage_error'
  );

  if (storageStatus === 'stored' && storageError) {
    throw new SubmissionDetailError(
      `Submission attachment ${asString(record.id, 'submission_attachment.id')} reported storage_status stored with a storage_error.`
    );
  }

  return {
    id: asString(record.id, 'submission_attachment.id'),
    submission_id: attachmentSubmissionId,
    external_attachment_id: asString(
      record.external_attachment_id,
      'submission_attachment.external_attachment_id'
    ),
    source_kind: asString(record.source_kind, 'submission_attachment.source_kind'),
    file_name: asString(record.file_name, 'submission_attachment.file_name'),
    media_type: asString(record.media_type, 'submission_attachment.media_type'),
    byte_size: asPositiveInteger(record.byte_size, 'submission_attachment.byte_size'),
    storage_status: storageStatus,
    storage_error: storageError,
    created_at: asString(record.created_at, 'submission_attachment.created_at'),
  };
}

function normalizeAnswer(answerJson: Record<string, unknown>): SubmissionDetailAnswer {
  const directValue = normalizeAnswerValue(answerJson.value);
  if (directValue !== undefined) {
    return directValue;
  }

  return null;
}

function normalizeAnswerValue(value: unknown): SubmissionDetailAnswer | undefined {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value) && value.every(isAnswerPrimitive)) {
    return [...value];
  }

  return undefined;
}

function isAnswerPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new SubmissionDetailError(`Expected ${label} to be an object.`);
}

function asString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new SubmissionDetailError(`Expected ${label} to be a non-empty string.`);
}

function asNullableString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new SubmissionDetailError(`Expected ${label} to be a string or null.`);
}

function asNullableNonEmptyString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new SubmissionDetailError(`Expected ${label} to be a non-empty string or null.`);
}

function asPositiveInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new SubmissionDetailError(`Expected ${label} to be a positive integer.`);
}

function asAttachmentStorageStatus(value: unknown, label: string): AttachmentStorageStatusEnum {
  if (value === 'stored' || value === 'unavailable' || value === 'error') {
    return value;
  }

  throw new SubmissionDetailError(
    `Expected ${label} to be one of stored, unavailable, or error.`
  );
}

function asJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new SubmissionDetailError(`Expected ${label} to be an object.`);
}
