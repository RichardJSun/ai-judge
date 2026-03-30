import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import type { JudgePageResponse, QueuePageResponse, ResultsResponse } from '../src/types/api';
import { ensureLocalAppReady } from './verify-m002-s02';
import {
  runLiveVerification as runS04LiveVerification,
  type LiveVerificationSummary as S04LiveVerificationSummary,
  type VerifierOptions as S04VerifierOptions,
  VerifierPhaseError as S04VerifierPhaseError,
} from './verify-s04-live';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;

type PhaseName =
  | 'live-proof'
  | 'schema-readiness'
  | 'upload'
  | 'judge-crud'
  | 'assignment-persistence'
  | 'run-start'
  | 'run-poll'
  | 'results-assertions'
  | 'page-confirmation'
  | 'judge-page-discovery'
  | 'queue-page-discovery'
  | 'proof-target-selection';

type PhaseRefs = {
  endpoint?: string;
  page?: string;
  url?: string;
  queueId?: string;
  queueLabel?: string;
  runId?: string;
  validJudgeId?: string;
  invalidJudgeId?: string;
  judgeId?: string;
  submissionId?: string;
  submissionExternalId?: string;
  filter?: string;
  pageBoundary?: string;
  host?: string;
};

type SummaryProofSeed = {
  queueId?: string;
  queueLabel?: string;
  run?: {
    runId?: string;
  };
  inspectionUrls?: {
    judges?: string;
    queues?: string;
    results?: string;
    submissionDetail?: string;
  };
  apiUrls?: {
    results?: string;
  };
  verifierJudgeIds?: {
    valid?: string;
    invalid?: string;
  };
};

type NormalizedUpstreamProofSeed = {
  baseUrl: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  judgesRootUrl: string;
  queuesRootUrl: string;
  resultsUrl: string;
  submissionDetailContextUrl: string;
  resultsApi: string;
};

export type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
  pollMs: number;
};

export type ProofSubmissionTarget = {
  submissionId: string;
  submissionExternalId: string;
  evaluationIds: string[];
  rowCount: number;
};

export type JudgePageTarget = {
  judgeId: string;
  judgesApi: string;
  judgesUrl: string;
  judgePage: number;
};

export type QueuePageTargets = {
  queuesApi: string;
  queuesUrl: string;
  positiveQueueId: string;
  positiveQueueLabel: string;
  zeroQueueId: string;
  zeroQueueLabel: string;
};

export type ProofTargets = {
  judgesUrl: string;
  judgesApi: string;
  judgePage: number;
  manageJudgeId: string;
  queuesUrl: string;
  queuesApi: string;
  positiveQueueId: string;
  positiveQueueLabel: string;
  zeroQueueId: string;
  zeroQueueLabel: string;
  resultsUrl: string;
  resultsApi: string;
  detailUrl: string;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  runId: string;
  verifierJudgeIds: {
    valid: string;
    invalid: string;
  };
  proofSubmission: ProofSubmissionTarget;
  proofTargets: ProofTargets;
  upstreamSummary: S04LiveVerificationSummary;
};

const JudgeRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  system_prompt: z.string().min(1),
  model: z.string().min(1),
  active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

const JudgePageResponseSchema = z.object({
  judges: z.array(JudgeRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

const QueuePageRowSchema = z.object({
  id: z.string().min(1),
  queue_id: z.string().min(1),
  created_at: z.string().min(1),
  submission_count: z.number().int().nonnegative(),
  question_count: z.number().int().nonnegative(),
  result_count: z.number().int().nonnegative(),
});

const QueuePageResponseSchema = z.object({
  queues: z.array(QueuePageRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

const DEFAULT_FIXTURE_PATH = 'scripts/verify-s04-live.fixture.json';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;

export class VerifierPhaseError extends Error {
  readonly phase: PhaseName;
  readonly refs: PhaseRefs;

  constructor(phase: PhaseName, message: string, refs: PhaseRefs = {}, cause?: unknown) {
    super(formatPhaseMessage(phase, message, refs), cause ? { cause } : undefined);
    this.name = 'VerifierPhaseError';
    this.phase = phase;
    this.refs = refs;
  }
}

function safeMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Unknown failure.';
}

function integerArg(rawValue: string | undefined, defaultValue: number, fieldName: string) {
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function normalizeBaseUrl(rawUrl: string | undefined) {
  if (!rawUrl?.trim()) {
    throw new Error('--base-url is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('--base-url must be a valid http:// or https:// URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--base-url must be a valid http:// or https:// URL.');
  }

  parsed.search = '';
  parsed.hash = '';

  const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return `${parsed.origin}${normalizedPath}`;
}

function formatPhaseRefs(refs: PhaseRefs) {
  const orderedEntries = Object.entries(refs).filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!orderedEntries.length) {
    return '';
  }

  return ` ${orderedEntries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

function formatPhaseMessage(phase: PhaseName, message: string, refs: PhaseRefs) {
  return `[verify:m007-s03] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
}

export async function runPhase<T>(phase: PhaseName, refs: PhaseRefs, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VerifierPhaseError) {
      throw error;
    }

    throw new VerifierPhaseError(phase, safeMessage(error), refs, error);
  }
}

function buildTimeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
  return controller.signal;
}

async function readJsonResponse(
  fetchImpl: FetchLike,
  url: string,
  phase: PhaseName,
  refs: PhaseRefs,
  timeoutMs: number
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetchImpl(url, { signal: buildTimeoutSignal(timeoutMs) });
  } catch (error) {
    throw new VerifierPhaseError(phase, `Request failed: ${safeMessage(error)}`, refs, error);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new VerifierPhaseError(phase, `Response was not valid JSON (${response.status}).`, refs, error);
  }

  if (!response.ok) {
    throw new VerifierPhaseError(
      phase,
      `Request failed (${response.status}): ${response.statusText || 'request failed'}`,
      refs
    );
  }

  return payload;
}

function requireNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Verification summary is missing ${fieldName}.`);
  }

  return value;
}

function stripVerifierPrefix(message: string) {
  const match = message.match(/^\[verify:[^\]]+\] phase=[^ ]+(?: [^ ]+=[^ ]+)* (.*)$/);
  return match?.[1] ?? message;
}

function parseAbsoluteVerifierUrl(value: unknown, fieldName: string, expectedBaseUrl: string) {
  const raw = requireNonEmptyString(value, fieldName);
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Verification summary ${fieldName} must be an absolute URL.`);
  }

  const expectedBase = new URL(expectedBaseUrl);
  if (parsed.origin !== expectedBase.origin) {
    throw new Error(`Verification summary ${fieldName} must resolve under ${expectedBaseUrl}.`);
  }

  if (expectedBase.pathname !== '/' && !parsed.pathname.startsWith(expectedBase.pathname)) {
    throw new Error(`Verification summary ${fieldName} must resolve under ${expectedBaseUrl}.`);
  }

  return parsed;
}

function setPageParam(url: string, page: number) {
  const parsed = new URL(url);
  parsed.searchParams.set('page', String(page));
  return parsed.toString();
}

function buildApiPageUrl(baseUrl: string, endpoint: string, page: number) {
  const parsed = new URL(`${baseUrl}${endpoint}`);
  parsed.searchParams.set('page', String(page));
  return parsed.toString();
}

function buildDetailUrlFromContext(contextUrl: string, queueId: string, submissionId: string) {
  const parsed = new URL(contextUrl);

  if (!/\/queues\/[^/]+\/submissions\/[^/]+$/.test(parsed.pathname)) {
    throw new Error('Verification summary inspectionUrls.submissionDetail did not include a queue submission route.');
  }

  parsed.pathname = parsed.pathname.replace(
    /\/queues\/[^/]+\/submissions\/[^/]+$/,
    `/queues/${queueId}/submissions/${submissionId}`
  );
  parsed.search = '';
  parsed.searchParams.set('source', 'results');
  return parsed.toString();
}

export function assertResultsApiTarget(resultsApi: string, validJudgeId: string, invalidJudgeId: string) {
  let parsed: URL;
  try {
    parsed = new URL(resultsApi);
  } catch {
    throw new Error('Verification summary results API target must be an absolute URL.');
  }

  const judgeIds = parsed.searchParams.getAll('judgeId');
  if (!judgeIds.includes(validJudgeId) || !judgeIds.includes(invalidJudgeId)) {
    throw new Error('Verification summary results API target must include both verifier judge ids.');
  }
}

export function parseJudgePageResponse(value: unknown, context: string): JudgePageResponse {
  const parsed = JudgePageResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function parseQueuePageResponse(value: unknown, context: string): QueuePageResponse {
  const parsed = QueuePageResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function assertFilteredResultsPayload(payload: unknown, context: string): ResultsResponse {
  return parseResultsResponse(payload, context);
}

export function parseVerifierOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): VerifierOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      fixture: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'poll-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    baseUrl: normalizeBaseUrl(parsed.values['base-url'] ?? env.BASE_URL),
    fixturePath: parsed.values.fixture ?? env.S04_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.S04_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.S04_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

export function normalizeUpstreamSummary(
  summary: SummaryProofSeed,
  expectedBaseUrl: string
): NormalizedUpstreamProofSeed {
  const baseUrl = normalizeBaseUrl(expectedBaseUrl);
  const queueId = requireNonEmptyString(summary.queueId, 'queueId');
  const queueLabel = requireNonEmptyString(summary.queueLabel, 'queueLabel');
  const runId = requireNonEmptyString(summary.run?.runId, 'run.runId');
  const validJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.valid, 'verifierJudgeIds.valid');
  const invalidJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.invalid, 'verifierJudgeIds.invalid');
  const judgesRootUrl = parseAbsoluteVerifierUrl(summary.inspectionUrls?.judges, 'inspectionUrls.judges', baseUrl);
  const queuesRootUrl = parseAbsoluteVerifierUrl(summary.inspectionUrls?.queues, 'inspectionUrls.queues', baseUrl);
  const resultsUrl = parseAbsoluteVerifierUrl(summary.inspectionUrls?.results, 'inspectionUrls.results', baseUrl);
  const submissionDetailContextUrl = parseAbsoluteVerifierUrl(
    summary.inspectionUrls?.submissionDetail,
    'inspectionUrls.submissionDetail',
    baseUrl
  );
  const resultsApi = parseAbsoluteVerifierUrl(summary.apiUrls?.results, 'apiUrls.results', baseUrl);

  if (submissionDetailContextUrl.searchParams.get('source') !== 'results') {
    throw new Error('Verification summary inspectionUrls.submissionDetail must include source=results.');
  }

  assertResultsApiTarget(resultsApi.toString(), validJudgeId, invalidJudgeId);

  return {
    baseUrl,
    queueId,
    queueLabel,
    runId,
    validJudgeId,
    invalidJudgeId,
    judgesRootUrl: judgesRootUrl.toString(),
    queuesRootUrl: queuesRootUrl.toString(),
    resultsUrl: resultsUrl.toString(),
    submissionDetailContextUrl: submissionDetailContextUrl.toString(),
    resultsApi: resultsApi.toString(),
  };
}

export async function resolveJudgePageTarget(input: {
  baseUrl: string;
  judgesRootUrl: string;
  judgeId: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<JudgePageTarget> {
  const firstPageApi = buildApiPageUrl(input.baseUrl, '/api/judges', 1);
  const firstPayload = await readJsonResponse(
    input.fetchImpl,
    firstPageApi,
    'judge-page-discovery',
    {
      endpoint: '/api/judges',
      page: '/judges?page=1',
      judgeId: input.judgeId,
      queueId: input.queueId,
      queueLabel: input.queueLabel,
      runId: input.runId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
    },
    input.timeoutMs
  );

  let firstPage: JudgePageResponse;
  try {
    firstPage = parseJudgePageResponse(firstPayload, `${firstPageApi} response`);
  } catch (error) {
    throw new VerifierPhaseError(
      'judge-page-discovery',
      safeMessage(error),
      {
        endpoint: '/api/judges',
        page: '/judges?page=1',
        judgeId: input.judgeId,
        queueId: input.queueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
      },
      error
    );
  }

  const totalPages = Math.max(1, Math.ceil(firstPage.total / firstPage.pageSize));
  const candidatePages: JudgePageResponse[] = [firstPage];

  for (let page = 2; page <= totalPages; page += 1) {
    const pageApi = buildApiPageUrl(input.baseUrl, '/api/judges', page);
    const payload = await readJsonResponse(
      input.fetchImpl,
      pageApi,
      'judge-page-discovery',
      {
        endpoint: '/api/judges',
        page: `/judges?page=${page}`,
        judgeId: input.judgeId,
        pageBoundary: `1-${totalPages}`,
        queueId: input.queueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
      },
      input.timeoutMs
    );

    try {
      candidatePages.push(parseJudgePageResponse(payload, `${pageApi} response`));
    } catch (error) {
      throw new VerifierPhaseError(
        'judge-page-discovery',
        safeMessage(error),
        {
          endpoint: '/api/judges',
          page: `/judges?page=${page}`,
          judgeId: input.judgeId,
          pageBoundary: `1-${totalPages}`,
          queueId: input.queueId,
          queueLabel: input.queueLabel,
          runId: input.runId,
          validJudgeId: input.validJudgeId,
          invalidJudgeId: input.invalidJudgeId,
        },
        error
      );
    }
  }

  const foundPage = candidatePages.find((page) => page.judges.some((judge) => judge.id === input.judgeId));
  if (!foundPage) {
    throw new VerifierPhaseError(
      'judge-page-discovery',
      `Verifier judge ${input.judgeId} was not found while scanning /api/judges pages 1-${totalPages}.`,
      {
        endpoint: '/api/judges',
        judgeId: input.judgeId,
        pageBoundary: `1-${totalPages}`,
        queueId: input.queueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
      }
    );
  }

  return {
    judgeId: input.judgeId,
    judgesApi: buildApiPageUrl(input.baseUrl, '/api/judges', foundPage.page),
    judgesUrl: setPageParam(input.judgesRootUrl, foundPage.page),
    judgePage: foundPage.page,
  };
}

export function selectQueuePageTargets(
  response: QueuePageResponse,
  proofQueueId: string,
  queuesRootUrl: string,
  baseUrl: string
): QueuePageTargets {
  const positiveRows = response.queues.filter((queue) => queue.result_count > 0);
  if (positiveRows.length === 0) {
    throw new Error('Paged queue discovery requires a positive-result row on /api/queues?page=1.');
  }

  const proofQueue = response.queues.find((queue) => queue.id === proofQueueId);
  if (!proofQueue || proofQueue.result_count <= 0) {
    throw new Error(`Proof queue ${proofQueueId} was not present on /api/queues?page=1 with result_count > 0.`);
  }

  const zeroQueue = response.queues.find((queue) => queue.result_count === 0);
  if (!zeroQueue) {
    throw new Error('Paged queue discovery requires a zero-result row on /api/queues?page=1.');
  }

  return {
    queuesApi: buildApiPageUrl(baseUrl, '/api/queues', 1),
    queuesUrl: setPageParam(queuesRootUrl, 1),
    positiveQueueId: proofQueue.id,
    positiveQueueLabel: proofQueue.queue_id,
    zeroQueueId: zeroQueue.id,
    zeroQueueLabel: zeroQueue.queue_id,
  };
}

async function resolveQueuePageTargets(input: {
  baseUrl: string;
  queuesRootUrl: string;
  proofQueueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const queuesApi = buildApiPageUrl(input.baseUrl, '/api/queues', 1);
  const payload = await readJsonResponse(
    input.fetchImpl,
    queuesApi,
    'queue-page-discovery',
    {
      endpoint: '/api/queues',
      page: '/queues?page=1',
      queueId: input.proofQueueId,
      queueLabel: input.queueLabel,
      runId: input.runId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
    },
    input.timeoutMs
  );

  let parsed: QueuePageResponse;
  try {
    parsed = parseQueuePageResponse(payload, `${queuesApi} response`);
  } catch (error) {
    throw new VerifierPhaseError(
      'queue-page-discovery',
      safeMessage(error),
      {
        endpoint: '/api/queues',
        page: '/queues?page=1',
        queueId: input.proofQueueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
      },
      error
    );
  }

  try {
    return selectQueuePageTargets(parsed, input.proofQueueId, input.queuesRootUrl, input.baseUrl);
  } catch (error) {
    throw new VerifierPhaseError(
      'queue-page-discovery',
      safeMessage(error),
      {
        endpoint: '/api/queues',
        page: '/queues?page=1',
        queueId: input.proofQueueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
      },
      error
    );
  }
}

async function fetchFilteredResultsResponse(input: {
  resultsApi: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const parsedUrl = new URL(input.resultsApi);
  const payload = await readJsonResponse(
    input.fetchImpl,
    input.resultsApi,
    'proof-target-selection',
    {
      endpoint: `/api/queues/${input.queueId}/results`,
      filter: parsedUrl.searchParams.toString() || 'page=1',
      queueId: input.queueId,
      queueLabel: input.queueLabel,
      runId: input.runId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
    },
    input.timeoutMs
  );

  try {
    return assertFilteredResultsPayload(payload, `${input.resultsApi} response`);
  } catch (error) {
    throw new VerifierPhaseError(
      'proof-target-selection',
      safeMessage(error),
      {
        endpoint: `/api/queues/${input.queueId}/results`,
        filter: parsedUrl.searchParams.toString() || 'page=1',
        queueId: input.queueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
      },
      error
    );
  }
}

export function selectProofSubmission(response: ResultsResponse): ProofSubmissionTarget {
  if (response.evaluations.length === 0) {
    throw new Error('Filtered current-proof results did not include any evaluations.');
  }

  const grouped = new Map<string, { submissionExternalId: string; evaluationIds: string[] }>();

  for (const row of response.evaluations) {
    const existing = grouped.get(row.submission.id);
    if (existing) {
      if (existing.submissionExternalId !== row.submission.external_id) {
        throw new Error(
          `Filtered current-proof results contained conflicting submission external ids for submission ${row.submission.id}.`
        );
      }

      existing.evaluationIds.push(row.id);
      continue;
    }

    grouped.set(row.submission.id, {
      submissionExternalId: row.submission.external_id,
      evaluationIds: [row.id],
    });
  }

  const candidates = [...grouped.entries()]
    .map(([submissionId, value]) => ({
      submissionId,
      submissionExternalId: value.submissionExternalId,
      evaluationIds: [...value.evaluationIds].sort(),
      rowCount: value.evaluationIds.length,
    }))
    .sort(
      (left, right) =>
        left.submissionExternalId.localeCompare(right.submissionExternalId) ||
        left.submissionId.localeCompare(right.submissionId)
    );

  return candidates[0];
}

export async function resolveProofTargets(input: {
  summary: S04LiveVerificationSummary;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<{ proofSubmission: ProofSubmissionTarget; proofTargets: ProofTargets }> {
  const normalized = normalizeUpstreamSummary(input.summary, input.baseUrl);

  const [judgePageTarget, queuePageTargets, filteredResults] = await Promise.all([
    resolveJudgePageTarget({
      baseUrl: normalized.baseUrl,
      judgesRootUrl: normalized.judgesRootUrl,
      judgeId: normalized.validJudgeId,
      queueId: normalized.queueId,
      queueLabel: normalized.queueLabel,
      runId: normalized.runId,
      validJudgeId: normalized.validJudgeId,
      invalidJudgeId: normalized.invalidJudgeId,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    }),
    resolveQueuePageTargets({
      baseUrl: normalized.baseUrl,
      queuesRootUrl: normalized.queuesRootUrl,
      proofQueueId: normalized.queueId,
      queueLabel: normalized.queueLabel,
      runId: normalized.runId,
      validJudgeId: normalized.validJudgeId,
      invalidJudgeId: normalized.invalidJudgeId,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    }),
    fetchFilteredResultsResponse({
      resultsApi: normalized.resultsApi,
      queueId: normalized.queueId,
      queueLabel: normalized.queueLabel,
      runId: normalized.runId,
      validJudgeId: normalized.validJudgeId,
      invalidJudgeId: normalized.invalidJudgeId,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    }),
  ]);

  let proofSubmission: ProofSubmissionTarget;
  try {
    proofSubmission = selectProofSubmission(filteredResults);
  } catch (error) {
    throw new VerifierPhaseError(
      'proof-target-selection',
      safeMessage(error),
      {
        endpoint: `/api/queues/${normalized.queueId}/results`,
        filter: new URL(normalized.resultsApi).searchParams.toString() || 'page=1',
        queueId: normalized.queueId,
        queueLabel: normalized.queueLabel,
        runId: normalized.runId,
        validJudgeId: normalized.validJudgeId,
        invalidJudgeId: normalized.invalidJudgeId,
      },
      error
    );
  }

  return {
    proofSubmission,
    proofTargets: buildProofTargets(normalized, judgePageTarget, queuePageTargets, proofSubmission),
  };
}

export function buildProofTargets(
  normalized: NormalizedUpstreamProofSeed,
  judgePageTarget: JudgePageTarget,
  queuePageTargets: QueuePageTargets,
  proofSubmission: ProofSubmissionTarget
): ProofTargets {
  return {
    judgesUrl: judgePageTarget.judgesUrl,
    judgesApi: judgePageTarget.judgesApi,
    judgePage: judgePageTarget.judgePage,
    manageJudgeId: judgePageTarget.judgeId,
    queuesUrl: queuePageTargets.queuesUrl,
    queuesApi: queuePageTargets.queuesApi,
    positiveQueueId: queuePageTargets.positiveQueueId,
    positiveQueueLabel: queuePageTargets.positiveQueueLabel,
    zeroQueueId: queuePageTargets.zeroQueueId,
    zeroQueueLabel: queuePageTargets.zeroQueueLabel,
    resultsUrl: normalized.resultsUrl,
    resultsApi: normalized.resultsApi,
    detailUrl: buildDetailUrlFromContext(
      normalized.submissionDetailContextUrl,
      normalized.queueId,
      proofSubmission.submissionId
    ),
  };
}

export function formatProofSubmission(target: ProofSubmissionTarget) {
  return [
    `submission=${target.submissionId}`,
    `submissionExternalId=${target.submissionExternalId}`,
    `submissionRows=${target.rowCount}`,
    `evaluationIds=${target.evaluationIds.join(',')}`,
  ].join(' ');
}

export function formatProofTargets(targets: ProofTargets) {
  return [
    `judgesUrl=${targets.judgesUrl}`,
    `judgesApi=${targets.judgesApi}`,
    `judgePage=${targets.judgePage}`,
    `manageJudge=${targets.manageJudgeId}`,
    `queuesUrl=${targets.queuesUrl}`,
    `queuesApi=${targets.queuesApi}`,
    `positiveQueue=${targets.positiveQueueId}`,
    `positiveQueueLabel=${targets.positiveQueueLabel}`,
    `zeroQueue=${targets.zeroQueueId}`,
    `zeroQueueLabel=${targets.zeroQueueLabel}`,
    `resultsUrl=${targets.resultsUrl}`,
    `resultsApi=${targets.resultsApi}`,
    `detailUrl=${targets.detailUrl}`,
  ].join(' ');
}

export function formatSetupSummary(summary: LiveVerificationSummary) {
  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `run=${summary.runId}`,
    `validJudge=${summary.verifierJudgeIds.valid}`,
    `invalidJudge=${summary.verifierJudgeIds.invalid}`,
    formatProofSubmission(summary.proofSubmission),
    formatProofTargets(summary.proofTargets),
  ].join(' ');
}

export function normalizeUpstreamError(error: unknown): never {
  if (error instanceof VerifierPhaseError) {
    throw error;
  }

  if (error instanceof S04VerifierPhaseError) {
    throw new VerifierPhaseError(
      error.phase as PhaseName,
      stripVerifierPrefix(error.message),
      error.refs as PhaseRefs,
      error
    );
  }

  throw new VerifierPhaseError('live-proof', safeMessage(error), {}, error);
}

async function runWrappedS04Verification(
  options: VerifierOptions,
  fetchImpl: FetchLike,
  readFileImpl: ReadFileLike
) {
  try {
    return await runS04LiveVerification(options as S04VerifierOptions, fetchImpl, readFileImpl);
  } catch (error) {
    normalizeUpstreamError(error);
  }
}

function log(message: string) {
  console.log(`[verify:m007-s03] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const localApp = await ensureLocalAppReady({ baseUrl: options.baseUrl, fetchImpl });

  try {
    const upstreamSummary = await runWrappedS04Verification(options, fetchImpl, readFileImpl);
    const { proofSubmission, proofTargets } = await resolveProofTargets({
      summary: upstreamSummary,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    log(
      `Reviewer loop proof targets resolved: ${formatProofSubmission(proofSubmission)} ${formatProofTargets(proofTargets)}.`
    );

    if (localApp.autoStarted) {
      localApp.keepAlive();
      log(`Local Next dev server remains available at ${options.baseUrl} for browser follow-up.`);
    }

    return {
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      verifierJudgeIds: upstreamSummary.verifierJudgeIds,
      proofSubmission,
      proofTargets,
      upstreamSummary,
    };
  } catch (error) {
    localApp.stop();
    throw error;
  }
}

const isDirectRun = /(^|\/)verify-m007-s03\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(`Browser proof targets: ${formatProofSubmission(summary.proofSubmission)} ${formatProofTargets(summary.proofTargets)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m007-s03] Unknown failure.');
    process.exit(1);
  }
}
