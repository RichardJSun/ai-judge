import type { SubmissionDetailAnswer, SubmissionDetailQuestion, SubmissionDetailResponse } from '@/types/api';

export interface SubmissionDetailInput {
  queue: unknown;
  submission: unknown;
  questionTemplates: unknown[];
  submissionAnswers: unknown[];
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

function compareQuestionTemplates(a: QuestionTemplateRecord, b: QuestionTemplateRecord): number {
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

function asJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new SubmissionDetailError(`Expected ${label} to be an object.`);
}
