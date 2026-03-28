import type { EvaluateParams } from '@/lib/ai/evaluator';

const DEFAULT_PROMPT_FIELDS = ['questionText', 'answer'] as const;

export class StartRunError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(message: string, options?: { status?: number; publicMessage?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'StartRunError';
    this.status = options?.status ?? 500;
    this.publicMessage = options?.publicMessage ?? message;
  }
}

export interface RunAssignment {
  questionTemplateId: string;
  judgeId: string;
  promptFields: string[];
  judge: {
    id: string;
    name: string;
    system_prompt: string;
    model: string;
  };
  question: {
    id: string;
    question_text: string;
    question_type: string | null;
  };
}

export interface RunSubmission {
  id: string;
  externalId?: string;
}

export interface RunAnswer {
  submissionId: string;
  questionTemplateId: string;
  answerJson: Record<string, unknown>;
}

export interface RunInsert {
  id: string;
}

export interface EvaluationInsert {
  runId: string;
  submissionId: string;
  questionTemplateId: string;
  judgeId: string;
  status: 'pending';
}

export interface PersistedEvaluation {
  id: string;
  submissionId: string;
  questionTemplateId: string;
  judgeId: string;
}

export interface StartRunDeps {
  getAssignments(queueId: string): Promise<unknown[]>;
  getSubmissions(queueId: string): Promise<unknown[]>;
  getAnswers(submissionIds: string[]): Promise<unknown[]>;
  createRun(input: { queueId: string; total: number }): Promise<RunInsert>;
  insertEvaluations(rows: EvaluationInsert[]): Promise<unknown[]>;
  markRunError(runId: string): Promise<void>;
}

export interface StartRunResult {
  runId: string;
  total: number;
  tasks: EvaluateParams[];
}

export interface ScheduleRunExecutionOptions {
  schedule(work: () => void | Promise<void>): void;
  execute(): Promise<void>;
  onScheduleError(error: unknown): Promise<void>;
  onExecutionError?(error: unknown): Promise<void>;
}

type DraftEvaluation = {
  submissionId: string;
  questionTemplateId: string;
  judgeId: string;
  answerJson: Record<string, unknown>;
  assignment: RunAssignment;
};

export async function startRun(deps: StartRunDeps, queueId: string): Promise<StartRunResult> {
  const assignmentsRaw = await deps.getAssignments(queueId);
  if (!assignmentsRaw.length) {
    throw new StartRunError('No judge assignments found for this queue.', {
      status: 400,
      publicMessage: 'No judge assignments found for this queue.',
    });
  }

  const assignments = assignmentsRaw.map(normalizeAssignment);

  const submissionsRaw = await deps.getSubmissions(queueId);
  if (!submissionsRaw.length) {
    throw new StartRunError('No submissions in this queue.', {
      status: 400,
      publicMessage: 'No submissions in this queue.',
    });
  }

  const submissions = submissionsRaw.map(normalizeSubmission);
  const answers = (await deps.getAnswers(submissions.map((submission) => submission.id))).map(normalizeAnswer);
  const answersByPair = new Map(
    answers.map((answer) => [`${answer.submissionId}::${answer.questionTemplateId}`, answer])
  );

  const drafts: DraftEvaluation[] = [];
  for (const submission of submissions) {
    for (const assignment of assignments) {
      const answer = answersByPair.get(`${submission.id}::${assignment.questionTemplateId}`);
      if (!answer) continue;

      drafts.push({
        submissionId: submission.id,
        questionTemplateId: assignment.questionTemplateId,
        judgeId: assignment.judgeId,
        answerJson: answer.answerJson,
        assignment,
      });
    }
  }

  const total = drafts.length;
  const run = await deps.createRun({ queueId, total });

  try {
    const persistedRows = total
      ? (await deps.insertEvaluations(
          drafts.map((draft) => ({
            runId: run.id,
            submissionId: draft.submissionId,
            questionTemplateId: draft.questionTemplateId,
            judgeId: draft.judgeId,
            status: 'pending',
          }))
        )).map(normalizePersistedEvaluation)
      : [];

    const draftByKey = new Map(
      drafts.map((draft) => [draftKey(draft.submissionId, draft.questionTemplateId, draft.judgeId), draft])
    );

    const tasks = persistedRows.map((row) => {
      const draft = draftByKey.get(draftKey(row.submissionId, row.questionTemplateId, row.judgeId));
      if (!draft) {
        throw new StartRunError('Persisted evaluation row did not match a prepared draft.', {
          status: 500,
          publicMessage: 'Failed to prepare evaluation tasks.',
        });
      }

      return {
        evaluationId: row.id,
        submissionId: row.submissionId,
        questionText: draft.assignment.question.question_text,
        questionType: draft.assignment.question.question_type,
        answerJson: draft.answerJson,
        judge: draft.assignment.judge,
        promptFields: draft.assignment.promptFields,
      } satisfies EvaluateParams;
    });

    return { runId: run.id, total, tasks };
  } catch (error) {
    await deps.markRunError(run.id);
    throw error;
  }
}

export async function scheduleRunExecution(options: ScheduleRunExecutionOptions): Promise<void> {
  try {
    options.schedule(async () => {
      try {
        await options.execute();
      } catch (error) {
        await options.onExecutionError?.(error);
      }
    });
  } catch (error) {
    await options.onScheduleError(error);
    throw error;
  }
}

function draftKey(submissionId: string, questionTemplateId: string, judgeId: string) {
  return `${submissionId}::${questionTemplateId}::${judgeId}`;
}

function normalizeAssignment(row: unknown): RunAssignment {
  const record = asRecord(row, 'judge assignment');
  const judge = asRecord(unwrapRelation(record.judges, 'judge'), 'judge');
  const question = asRecord(unwrapRelation(record.question_templates, 'question template'), 'question template');

  return {
    questionTemplateId: asString(record.question_template_id, 'assignment.question_template_id'),
    judgeId: asString(record.judge_id, 'assignment.judge_id'),
    promptFields: normalizePromptFields(record.prompt_fields),
    judge: {
      id: asString(judge.id, 'judge.id'),
      name: asString(judge.name, 'judge.name'),
      system_prompt: asString(judge.system_prompt, 'judge.system_prompt'),
      model: asString(judge.model, 'judge.model'),
    },
    question: {
      id: asString(question.id, 'question.id'),
      question_text: asString(question.question_text, 'question.question_text'),
      question_type: asNullableString(question.question_type, 'question.question_type'),
    },
  };
}

function normalizeSubmission(row: unknown): RunSubmission {
  const record = asRecord(row, 'submission');
  return {
    id: asString(record.id, 'submission.id'),
    externalId: typeof record.external_id === 'string' ? record.external_id : undefined,
  };
}

function normalizeAnswer(row: unknown): RunAnswer {
  const record = asRecord(row, 'submission answer');
  return {
    submissionId: asString(record.submission_id, 'submission_answer.submission_id'),
    questionTemplateId: asString(record.question_template_id, 'submission_answer.question_template_id'),
    answerJson: asJsonObject(record.answer_json),
  };
}

function normalizePersistedEvaluation(row: unknown): PersistedEvaluation {
  const record = asRecord(row, 'persisted evaluation');
  return {
    id: asString(record.id, 'evaluation.id'),
    submissionId: asString(record.submission_id, 'evaluation.submission_id'),
    questionTemplateId: asString(record.question_template_id, 'evaluation.question_template_id'),
    judgeId: asString(record.judge_id, 'evaluation.judge_id'),
  };
}

function unwrapRelation(value: unknown, label: string): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new StartRunError(`Expected exactly one ${label} relation, received ${value.length}.`, {
        status: 500,
        publicMessage: `Malformed ${label} relation returned from storage.`,
      });
    }

    return value[0];
  }

  return value;
}

function normalizePromptFields(value: unknown): string[] {
  if (value == null) {
    return [...DEFAULT_PROMPT_FIELDS];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new StartRunError('Assignment prompt_fields must be an array of strings.', {
      status: 500,
      publicMessage: 'Malformed assignment prompt field configuration.',
    });
  }

  return [...value];
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {};
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new StartRunError(`Expected ${label} to be an object.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new StartRunError(`Expected ${label} to be a non-empty string.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asNullableString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new StartRunError(`Expected ${label} to be a string or null.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
