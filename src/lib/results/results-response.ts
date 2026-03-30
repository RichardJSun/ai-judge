import { normalizeListPageRequest, resolveListPage, type ResolvedListPage } from '@/lib/pagination/list-page';
import type {
  JudgePassRate,
  ResultsEvaluation,
  ResultsFilterMetadata,
  ResultsResponse,
} from '@/types/api';
import type { EvalStatusEnum, VerdictEnum } from '@/types/db';

const VALID_VERDICTS: readonly VerdictEnum[] = ['pass', 'fail', 'inconclusive'];

export const DEFAULT_RESULTS_PAGE_SIZE = 25;

export interface ResultsQueryFilters {
  judgeIds: string[];
  questionIds: string[];
  verdicts: VerdictEnum[];
  page: number;
  pageSize: number;
  from: number;
  to: number;
}

export interface ResultsResponseInput {
  queueId: string;
  evaluationRows: unknown[];
  aggregateRows: unknown[];
  filterMetadataRows: unknown[];
  total: number | null | undefined;
  page: number;
  pageSize: number;
}

export class ResultsResponseError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(message: string, options?: { status?: number; publicMessage?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ResultsResponseError';
    this.status = options?.status ?? 500;
    this.publicMessage = options?.publicMessage ?? 'Failed to load queue results.';
  }
}

export function normalizeResultsFilters(
  searchParams: URLSearchParams,
  options: { pageSize?: number } = {}
): ResultsQueryFilters {
  const pageRequest = normalizeListPageRequest(searchParams, {
    pageSize: options.pageSize ?? DEFAULT_RESULTS_PAGE_SIZE,
  });
  const judgeIds = normalizeStringList(searchParams.getAll('judgeId'));
  const questionIds = normalizeStringList(searchParams.getAll('questionId'));
  const verdictParams = normalizeStringList(searchParams.getAll('verdict'));
  const invalidVerdicts = verdictParams.filter(
    (verdict): verdict is string => !VALID_VERDICTS.includes(verdict as VerdictEnum)
  );

  if (invalidVerdicts.length > 0) {
    throw new ResultsResponseError(`Unsupported verdict filters: ${invalidVerdicts.join(', ')}.`, {
      status: 400,
      publicMessage: 'Invalid verdict filter.',
    });
  }

  return {
    judgeIds,
    questionIds,
    verdicts: verdictParams as VerdictEnum[],
    ...pageRequest,
  };
}

export function resolveResultsPage(
  request: Pick<ResultsQueryFilters, 'page' | 'pageSize'>,
  total: unknown
): ResolvedListPage {
  return resolveListPage(request, total);
}

export function applyResultsFilters<T extends { in(column: string, values: readonly string[]): T }>(
  query: T,
  filters: Pick<ResultsQueryFilters, 'judgeIds' | 'questionIds' | 'verdicts'>
): T {
  let next = query;

  if (filters.judgeIds.length > 0) {
    next = next.in('judge_id', filters.judgeIds);
  }

  if (filters.questionIds.length > 0) {
    next = next.in('question_template_id', filters.questionIds);
  }

  if (filters.verdicts.length > 0) {
    next = next.in('verdict', filters.verdicts);
  }

  return next;
}

export function createResultsResponse({
  queueId,
  evaluationRows,
  aggregateRows,
  filterMetadataRows,
  total,
  page,
  pageSize,
}: ResultsResponseInput): ResultsResponse {
  const resolvedPage = normalizeCanonicalResultsPage({ page, pageSize }, total);
  const evaluations = evaluationRows.map((row) => normalizeResultsEvaluation(row, queueId));
  const aggregates = aggregateRows.map((row) => normalizeAggregateRow(row, queueId));
  const completedAggregates = aggregates.filter((row) => row.status === 'completed');
  const passCount = completedAggregates.filter((row) => row.verdict === 'pass').length;

  return {
    evaluations,
    total: resolvedPage.total,
    passRate: completedAggregates.length > 0 ? Math.round((passCount / completedAggregates.length) * 100) : 0,
    judgePassRates: buildJudgePassRates(completedAggregates),
    page: resolvedPage.page,
    pageSize: resolvedPage.pageSize,
    filterMetadata: buildFilterMetadata(filterMetadataRows, queueId),
  };
}

interface AggregateRow {
  judgeId: string;
  verdict: VerdictEnum | null;
  status: EvalStatusEnum;
  judge: {
    id: string;
    name: string;
  };
}

interface FilterMetadataRow {
  verdict: VerdictEnum | null;
  judge: {
    id: string;
    name: string;
    model: string;
  };
  question: {
    id: string;
    external_id: string | null;
    question_text: string;
  };
}

function normalizeCanonicalResultsPage(
  request: Pick<ResultsResponseInput, 'page' | 'pageSize'>,
  total: unknown
): ResolvedListPage {
  try {
    const resolvedPage = resolveResultsPage(
      {
        page: normalizePositiveInteger(request.page, 'results.page'),
        pageSize: normalizePositiveInteger(request.pageSize, 'results.pageSize'),
      },
      total
    );

    if (resolvedPage.wasClamped) {
      throw new ResultsResponseError(
        `Results page ${request.page} was not canonical for total ${String(total)} and page size ${request.pageSize}.`,
        {
          publicMessage: 'Malformed results pagination returned from storage.',
        }
      );
    }

    return resolvedPage;
  } catch (error) {
    if (error instanceof ResultsResponseError) {
      throw error;
    }

    throw new ResultsResponseError('Failed to normalize results pagination metadata.', {
      publicMessage: 'Malformed results pagination returned from storage.',
      cause: error,
    });
  }
}

function buildJudgePassRates(rows: AggregateRow[]): JudgePassRate[] {
  const judgeAgg = new Map<string, { judgeId: string; name: string; total: number; passCount: number }>();

  for (const row of rows) {
    if (row.judge.id !== row.judgeId) {
      throw new ResultsResponseError(
        `Aggregate judge relation ${row.judge.id} did not match judge_id ${row.judgeId}.`,
        { publicMessage: 'Malformed judge relation returned from storage.' }
      );
    }

    const existing = judgeAgg.get(row.judgeId);
    if (existing && existing.name !== row.judge.name) {
      throw new ResultsResponseError(
        `Aggregate judge relation ${row.judgeId} returned conflicting names.`,
        { publicMessage: 'Malformed judge relation returned from storage.' }
      );
    }

    const entry = existing ?? {
      judgeId: row.judgeId,
      name: row.judge.name,
      total: 0,
      passCount: 0,
    };

    entry.total += 1;
    if (row.verdict === 'pass') {
      entry.passCount += 1;
    }

    judgeAgg.set(row.judgeId, entry);
  }

  return [...judgeAgg.values()]
    .map<JudgePassRate>((entry) => ({
      judgeId: entry.judgeId,
      name: entry.name,
      passRate: entry.total > 0 ? Math.round((entry.passCount / entry.total) * 100) : 0,
      total: entry.total,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.judgeId.localeCompare(b.judgeId));
}

function buildFilterMetadata(rows: unknown[], queueId: string): ResultsFilterMetadata {
  const judges = new Map<string, ResultsFilterMetadata['judges'][number]>();
  const questions = new Map<string, ResultsFilterMetadata['questions'][number]>();
  const verdicts = new Set<VerdictEnum>();

  for (const row of rows) {
    const metadata = normalizeFilterMetadataRow(row, queueId);
    const existingJudge = judges.get(metadata.judge.id);
    const existingQuestion = questions.get(metadata.question.id);

    if (
      existingJudge &&
      (existingJudge.name !== metadata.judge.name || existingJudge.model !== metadata.judge.model)
    ) {
      throw new ResultsResponseError(
        `Filter metadata judge ${metadata.judge.id} returned conflicting values.`,
        { publicMessage: 'Malformed filter metadata returned from storage.' }
      );
    }

    if (
      existingQuestion &&
      (
        existingQuestion.external_id !== metadata.question.external_id ||
        existingQuestion.question_text !== metadata.question.question_text
      )
    ) {
      throw new ResultsResponseError(
        `Filter metadata question ${metadata.question.id} returned conflicting values.`,
        { publicMessage: 'Malformed filter metadata returned from storage.' }
      );
    }

    judges.set(metadata.judge.id, metadata.judge);
    questions.set(metadata.question.id, metadata.question);

    if (metadata.verdict) {
      verdicts.add(metadata.verdict);
    }
  }

  return {
    judges: [...judges.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    ),
    questions: [...questions.values()].sort((a, b) => {
      const externalIdComparison = (a.external_id ?? '').localeCompare(b.external_id ?? '');
      if (externalIdComparison !== 0) {
        return externalIdComparison;
      }

      return a.id.localeCompare(b.id);
    }),
    verdicts: VALID_VERDICTS.filter((verdict) => verdicts.has(verdict)),
  };
}

function normalizeResultsEvaluation(row: unknown, queueId: string): ResultsEvaluation {
  const record = asRecord(row, 'results evaluation');
  const submission = asRecord(unwrapRelation(record.submissions, 'submission'), 'submission');
  const question = asRecord(unwrapRelation(record.question_templates, 'question'), 'question');
  const judge = asRecord(unwrapRelation(record.judges, 'judge'), 'judge');

  assertQueueScope(submission, queueId, 'evaluation submission');

  return {
    id: asString(record.id, 'evaluation.id'),
    verdict: asNullableVerdict(record.verdict, 'evaluation.verdict'),
    reasoning: asNullableString(record.reasoning, 'evaluation.reasoning'),
    prompt_snapshot: asNullableString(record.prompt_snapshot, 'evaluation.prompt_snapshot'),
    model_used: asNullableString(record.model_used, 'evaluation.model_used'),
    tokens_used: asNullableNumber(record.tokens_used, 'evaluation.tokens_used'),
    latency_ms: asNullableNumber(record.latency_ms, 'evaluation.latency_ms'),
    retry_count: normalizeNonNegativeInteger(record.retry_count, 'evaluation.retry_count'),
    error_message: asNullableString(record.error_message, 'evaluation.error_message'),
    created_at: asString(record.created_at, 'evaluation.created_at'),
    status: asEvalStatus(record.status, 'evaluation.status'),
    submission: {
      id: asString(submission.id, 'submission.id'),
      external_id: asString(submission.external_id, 'submission.external_id'),
    },
    question: {
      id: asString(question.id, 'question.id'),
      external_id: asString(question.external_id, 'question.external_id'),
      question_text: asString(question.question_text, 'question.question_text'),
    },
    judge: {
      id: asString(judge.id, 'judge.id'),
      name: asString(judge.name, 'judge.name'),
      model: asString(judge.model, 'judge.model'),
    },
  };
}

function normalizeAggregateRow(row: unknown, queueId: string): AggregateRow {
  const record = asRecord(row, 'results aggregate row');
  const judge = asRecord(unwrapRelation(record.judges, 'judge'), 'judge');
  const submission = asRecord(unwrapRelation(record.submissions, 'aggregate submission'), 'aggregate submission');

  assertQueueScope(submission, queueId, 'aggregate submission');

  return {
    judgeId: asString(record.judge_id, 'aggregate.judge_id'),
    verdict: asNullableVerdict(record.verdict, 'aggregate.verdict'),
    status: asEvalStatus(record.status, 'aggregate.status'),
    judge: {
      id: asString(judge.id, 'judge.id'),
      name: asString(judge.name, 'judge.name'),
    },
  };
}

function normalizeFilterMetadataRow(row: unknown, queueId: string): FilterMetadataRow {
  const record = asRecord(row, 'results filter metadata row');
  const submission = asRecord(unwrapRelation(record.submissions, 'filter metadata submission'), 'filter metadata submission');
  const question = asRecord(unwrapRelation(record.question_templates, 'filter metadata question'), 'filter metadata question');
  const judge = asRecord(unwrapRelation(record.judges, 'filter metadata judge'), 'filter metadata judge');

  assertQueueScope(submission, queueId, 'filter metadata submission');

  return {
    verdict: asNullableVerdict(record.verdict, 'filter metadata verdict'),
    judge: {
      id: asString(judge.id, 'filter metadata judge.id'),
      name: asString(judge.name, 'filter metadata judge.name'),
      model: asString(judge.model, 'filter metadata judge.model'),
    },
    question: {
      id: asString(question.id, 'filter metadata question.id'),
      external_id: asNullableString(question.external_id, 'filter metadata question.external_id'),
      question_text: asString(question.question_text, 'filter metadata question.question_text'),
    },
  };
}

function assertQueueScope(value: Record<string, unknown>, queueId: string, label: string) {
  const relationQueueId = asString(value.queue_id, `${label}.queue_id`);

  if (relationQueueId !== queueId) {
    throw new ResultsResponseError(
      `Expected ${label}.queue_id to equal ${queueId}, received ${relationQueueId}.`,
      {
        publicMessage: 'Malformed queue-scoped results returned from storage.',
      }
    );
  }
}

function unwrapRelation(value: unknown, label: string): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new ResultsResponseError(`Expected exactly one ${label} relation, received ${value.length}.`, {
        publicMessage: `Malformed ${label} relation returned from storage.`,
      });
    }

    return value[0];
  }

  return value;
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new ResultsResponseError(`Expected ${label} to be an object.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new ResultsResponseError(`Expected ${label} to be a non-empty string.`, {
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

  throw new ResultsResponseError(`Expected ${label} to be a string or null.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asNullableNumber(value: unknown, label: string): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new ResultsResponseError(`Expected ${label} to be a number or null.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asNullableVerdict(value: unknown, label: string): VerdictEnum | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string' && VALID_VERDICTS.includes(value as VerdictEnum)) {
    return value as VerdictEnum;
  }

  throw new ResultsResponseError(`Expected ${label} to be a supported verdict or null.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function asEvalStatus(value: unknown, label: string): EvalStatusEnum {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'error') {
    return value;
  }

  throw new ResultsResponseError(`Expected ${label} to be a supported evaluation status.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function normalizePositiveInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new ResultsResponseError(`Expected ${label} to be a positive integer.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new ResultsResponseError(`Expected ${label} to be a non-negative integer.`, {
    publicMessage: `Malformed ${label} returned from storage.`,
  });
}
