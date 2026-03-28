import type { Judge } from '@/types/db';

export const DEFAULT_PROMPT_FIELDS = ['questionText', 'answer'] as const;

export class QueueAssignmentStateError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(message: string, options?: { status?: number; publicMessage?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'QueueAssignmentStateError';
    this.status = options?.status ?? 500;
    this.publicMessage = options?.publicMessage ?? message;
  }
}

export interface QueueAssignmentJudge {
  id: string;
  name: string;
  model: string;
  active: boolean;
  system_prompt?: string;
}

export interface QueueAssignmentQuestion {
  id: string;
  external_id: string | null;
  question_text: string;
  question_type: string | null;
  created_at: string | null;
}

export interface QueueAssignmentRecord {
  id: string | null;
  queue_id: string | null;
  question_template_id: string;
  judge_id: string;
  prompt_fields: string[];
  attachment_forwarding: boolean;
  created_at: string | null;
  judge: QueueAssignmentJudge;
  question?: QueueAssignmentQuestion;
  judge_status: 'active' | 'inactive';
}

export interface QueueQuestionWithAssignments extends QueueAssignmentQuestion {
  assignments: QueueAssignmentRecord[];
}

export interface VisibleAssignmentJudge extends Pick<Judge, 'id' | 'name' | 'model' | 'active'> {
  inactive_assigned: boolean;
  persisted_assignment_count: number;
}

export function parseQueueAssignmentList(
  value: unknown,
  options: {
    context?: string;
    requireQuestion?: boolean;
    requireJudgeSystemPrompt?: boolean;
  } = {}
): QueueAssignmentRecord[] {
  if (!Array.isArray(value)) {
    throw malformedAssignmentState(options.context ?? 'queue assignments response');
  }

  return value.map((row, index) =>
    normalizeQueueAssignment(row, {
      context: `${options.context ?? 'queue assignments response'}[${index}]`,
      requireQuestion: options.requireQuestion,
      requireJudgeSystemPrompt: options.requireJudgeSystemPrompt,
    })
  );
}

export function parseQueueQuestionList(
  value: unknown,
  context = 'queue questions response'
): QueueQuestionWithAssignments[] {
  if (!Array.isArray(value)) {
    throw malformedAssignmentState(context);
  }

  return value.map((row, index) => {
    const record = asRecord(row, `${context}[${index}]`);
    const question = normalizeQuestion(record, `${context}[${index}]`);
    const assignmentsValue = record.assignments;

    if (!Array.isArray(assignmentsValue)) {
      throw malformedAssignmentState(`${context}[${index}].assignments`);
    }

    const assignments = assignmentsValue.map((assignment, assignmentIndex) =>
      normalizeQueueAssignment(assignment, {
        context: `${context}[${index}].assignments[${assignmentIndex}]`,
        fallbackQuestion: question,
      })
    );

    return {
      ...question,
      assignments,
    };
  });
}

export function hydrateQuestionsWithAssignments(
  questionRows: unknown,
  assignments: QueueAssignmentRecord[]
): QueueQuestionWithAssignments[] {
  if (!Array.isArray(questionRows)) {
    throw malformedAssignmentState('queue questions response');
  }

  const questions = questionRows.map((row, index) => {
    const record = asRecord(row, `queue questions response[${index}]`);
    return normalizeQuestion(record, `queue questions response[${index}]`);
  });

  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const assignmentsByQuestionId = new Map<string, QueueAssignmentRecord[]>();

  for (const assignment of assignments) {
    const question = questionsById.get(assignment.question_template_id);
    if (!question) {
      throw new QueueAssignmentStateError(
        `Assignment ${assignment.id ?? assignment.question_template_id} referenced question ${assignment.question_template_id}, but that question was not returned by storage.`,
        {
          status: 500,
          publicMessage: 'Malformed assignment/question relation returned from storage.',
        }
      );
    }

    const list = assignmentsByQuestionId.get(assignment.question_template_id) ?? [];
    list.push({
      ...assignment,
      question,
    });
    assignmentsByQuestionId.set(assignment.question_template_id, list);
  }

  return questions.map((question) => ({
    ...question,
    assignments: sortAssignments(assignmentsByQuestionId.get(question.id) ?? []),
  }));
}

export function getActiveQueueAssignments(assignments: QueueAssignmentRecord[]) {
  return assignments.filter((assignment) => assignment.judge_status === 'active');
}

export function getInactiveQueueAssignments(assignments: QueueAssignmentRecord[]) {
  return assignments.filter((assignment) => assignment.judge_status === 'inactive');
}

export function buildVisibleJudgeRoster(
  judges: Array<Pick<Judge, 'id' | 'name' | 'model' | 'active'>>,
  assignments: QueueAssignmentRecord[]
): VisibleAssignmentJudge[] {
  const roster = new Map<string, VisibleAssignmentJudge>();

  for (const judge of judges) {
    if (!judge.active) {
      continue;
    }

    roster.set(judge.id, {
      id: judge.id,
      name: judge.name,
      model: judge.model,
      active: judge.active,
      inactive_assigned: false,
      persisted_assignment_count: 0,
    });
  }

  for (const assignment of assignments) {
    const existing = roster.get(assignment.judge_id);
    const next = existing ?? {
      id: assignment.judge.id,
      name: assignment.judge.name,
      model: assignment.judge.model,
      active: assignment.judge.active,
      inactive_assigned: assignment.judge_status === 'inactive',
      persisted_assignment_count: 0,
    };

    next.persisted_assignment_count += 1;
    next.active = assignment.judge.active;
    next.inactive_assigned = next.inactive_assigned || assignment.judge_status === 'inactive';
    roster.set(assignment.judge_id, next);
  }

  return [...roster.values()]
    .filter((judge) => judge.active || judge.persisted_assignment_count > 0)
    .sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }

      if (left.persisted_assignment_count !== right.persisted_assignment_count) {
        return right.persisted_assignment_count - left.persisted_assignment_count;
      }

      return left.name.localeCompare(right.name);
    });
}

export function getQuestionPromptFieldDefaults(assignments: QueueAssignmentRecord[]) {
  const defaults = new Map<string, string[]>();
  const groupedAssignments = new Map<string, QueueAssignmentRecord[]>();

  for (const assignment of assignments) {
    const list = groupedAssignments.get(assignment.question_template_id) ?? [];
    list.push(assignment);
    groupedAssignments.set(assignment.question_template_id, list);
  }

  for (const [questionId, questionAssignments] of groupedAssignments.entries()) {
    const preferred =
      questionAssignments.find((assignment) => assignment.judge_status === 'active') ??
      questionAssignments[0];

    defaults.set(questionId, [...preferred.prompt_fields]);
  }

  return Object.fromEntries(defaults);
}

export function summarizeAssignmentsByQuestion(assignments: QueueAssignmentRecord[]) {
  const summary = new Map<
    string,
    {
      questionText: string;
      activeJudgeCount: number;
      inactiveJudgeCount: number;
    }
  >();

  for (const assignment of assignments) {
    const questionText = assignment.question?.question_text ?? 'Unknown question';
    const existing = summary.get(assignment.question_template_id) ?? {
      questionText,
      activeJudgeCount: 0,
      inactiveJudgeCount: 0,
    };

    if (assignment.judge_status === 'active') {
      existing.activeJudgeCount += 1;
    } else {
      existing.inactiveJudgeCount += 1;
    }

    summary.set(assignment.question_template_id, existing);
  }

  return summary;
}

function normalizeQueueAssignment(
  row: unknown,
  options: {
    context: string;
    requireQuestion?: boolean;
    requireJudgeSystemPrompt?: boolean;
    fallbackQuestion?: QueueAssignmentQuestion;
  }
): QueueAssignmentRecord {
  const record = asRecord(row, options.context);
  const judge = normalizeJudge(
    unwrapRelation(record.judge ?? record.judges, 'judge', options.context),
    options.context,
    options.requireJudgeSystemPrompt ?? false
  );
  const questionValue = record.question ?? record.question_templates;
  const question =
    questionValue == null
      ? options.fallbackQuestion
      : normalizeQuestion(
          asRecord(unwrapRelation(questionValue, 'question template', options.context), options.context),
          options.context
        );

  if (options.requireQuestion && !question) {
    throw new QueueAssignmentStateError(`Expected ${options.context} to include a question relation.`, {
      status: 500,
      publicMessage: 'Malformed assignment/question relation returned from storage.',
    });
  }

  return {
    id: asOptionalString(record.id),
    queue_id: asOptionalString(record.queue_id),
    question_template_id: asString(record.question_template_id, `${options.context}.question_template_id`),
    judge_id: asString(record.judge_id, `${options.context}.judge_id`),
    prompt_fields: normalizePromptFields(record.prompt_fields),
    attachment_forwarding: asBoolean(record.attachment_forwarding, `${options.context}.attachment_forwarding`, false),
    created_at: asOptionalString(record.created_at),
    judge,
    question,
    judge_status: judge.active ? 'active' : 'inactive',
  };
}

function normalizeJudge(row: unknown, context: string, requireSystemPrompt: boolean): QueueAssignmentJudge {
  const record = asRecord(row, `${context}.judge`);
  const systemPrompt = record.system_prompt;

  if (requireSystemPrompt && typeof systemPrompt !== 'string') {
    throw new QueueAssignmentStateError(`Expected ${context}.judge.system_prompt to be a non-empty string.`, {
      status: 500,
      publicMessage: 'Malformed judge returned from storage.',
    });
  }

  return {
    id: asString(record.id, `${context}.judge.id`),
    name: asString(record.name, `${context}.judge.name`),
    model: asString(record.model, `${context}.judge.model`),
    active: asBoolean(record.active, `${context}.judge.active`),
    ...(typeof systemPrompt === 'string' && systemPrompt.length > 0
      ? { system_prompt: systemPrompt }
      : {}),
  };
}

function normalizeQuestion(record: Record<string, unknown>, context: string): QueueAssignmentQuestion {
  return {
    id: asString(record.id, `${context}.id`),
    external_id: asNullableString(record.external_id, `${context}.external_id`),
    question_text: asString(record.question_text, `${context}.question_text`),
    question_type: asNullableString(record.question_type, `${context}.question_type`),
    created_at: asNullableString(record.created_at, `${context}.created_at`),
  };
}

function unwrapRelation(value: unknown, label: string, context: string): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new QueueAssignmentStateError(
        `Expected exactly one ${label} relation in ${context}, received ${value.length}.`,
        {
          status: 500,
          publicMessage: `Malformed ${label} relation returned from storage.`,
        }
      );
    }

    return value[0];
  }

  if (value == null) {
    throw new QueueAssignmentStateError(`Expected ${context} to include a ${label} relation.`, {
      status: 500,
      publicMessage: `Malformed ${label} relation returned from storage.`,
    });
  }

  return value;
}

function normalizePromptFields(value: unknown): string[] {
  if (value == null) {
    return [...DEFAULT_PROMPT_FIELDS];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new QueueAssignmentStateError('Assignment prompt_fields must be an array of strings.', {
      status: 500,
      publicMessage: 'Malformed assignment prompt field configuration.',
    });
  }

  return [...value];
}

function sortAssignments(assignments: QueueAssignmentRecord[]) {
  return [...assignments].sort((left, right) => {
    if (left.judge_status !== right.judge_status) {
      return left.judge_status === 'active' ? -1 : 1;
    }

    return left.judge.name.localeCompare(right.judge.name);
  });
}

function malformedAssignmentState(context: string) {
  return new QueueAssignmentStateError(`Expected ${context} to be an array.`, {
    status: 500,
    publicMessage: `Malformed ${context}.`,
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new QueueAssignmentStateError(`Expected ${label} to be an object.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new QueueAssignmentStateError(`Expected ${label} to be a non-empty string.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new QueueAssignmentStateError(`Expected ${label} to be a string or null.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asBoolean(value: unknown, label: string, fallback?: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (fallback != null && value == null) {
    return fallback;
  }

  throw new QueueAssignmentStateError(`Expected ${label} to be a boolean.`, {
    status: 500,
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}
