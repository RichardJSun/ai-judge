import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildQueueSubmissionDetailHref, buildQueueSubmissionsPageHref, getQueueSubmissionsPath } from '../src/lib/queues/queue-submissions-page-url';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import { parseQueueSubmissionsResponse, parseSubmissionDetailResponse } from '../src/lib/submissions/fetch-json';
import type { QueueSubmissionsResponse, ResultsResponse } from '../src/types/api';
import { ensureLocalAppReady } from './verify-m002-s02';
import { loadFixture } from './verify-s02-live';
import {
  buildProofTargets as buildResultsProofTargets,
  formatProofSubmission,
  formatProofTargets as formatUpstreamProofTargets,
  normalizeUpstreamSummary,
  runLiveVerification as runUpstreamLiveVerification,
  type ContextualFilteredProofState,
  type LiveVerificationSummary as UpstreamLiveVerificationSummary,
  VerifierPhaseError as UpstreamVerifierPhaseError,
} from './verify-m008-s02';
import type { ProofSubmissionTarget } from './verify-m004-s03';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;
type FixtureItem = Awaited<ReturnType<typeof loadFixture>>[number];

type PhaseName =
  | 'fixture-validation'
  | 'live-proof'
  | 'schema-readiness'
  | 'upload'
  | 'judge-setup'
  | 'assignment-setup'
  | 'run-start'
  | 'run-poll'
  | 'results-assertions'
  | 'page-confirmation'
  | 'results-api-target'
  | 'filtered-results-target'
  | 'clamped-results-target'
  | 'results-page'
  | 'filtered-results-page'
  | 'clamped-results-page'
  | 'proof-target-selection'
  | 'detail-page'
  | 'queue-submissions-target'
  | 'queue-page'
  | 'queue-detail-page'
  | 'detail-target'
  | 'timestamp-proof';

type PhaseRefs = {
  endpoint?: string;
  page?: string;
  url?: string;
  queueId?: string;
  queueLabel?: string;
  runId?: string;
  validJudgeId?: string;
  invalidJudgeId?: string;
  submissionId?: string;
  submissionExternalId?: string;
  questionId?: string;
  verdict?: string;
  filter?: string;
  evaluationId?: string;
  queuePage?: string;
  queueSubmittedAt?: string;
  resultsCreatedAt?: string;
};

export type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
  pollMs: number;
};

export type QueuePageProof = {
  page: number;
  total: number;
  pageSize: number;
};

export type TimestampProofRefs = {
  submissionId: string;
  submissionExternalId: string;
  queueSubmittedAt: string;
  detailSubmittedAt: string;
  resultsCreatedAt: string;
  resultsEvaluationId: string;
};

export type ProofTargets = {
  queuePage: string;
  queueSubmissionsApi: string;
  queueDetailUrl: string;
  filteredResults: string;
  detailUrl: string;
  filteredResultsApi: string;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  runId: string;
  verifierJudgeIds: {
    valid: string;
    invalid: string;
  };
  filteredProof: ContextualFilteredProofState;
  queueProof: QueuePageProof;
  proofSubmission: ProofSubmissionTarget;
  proofTargets: ProofTargets;
  timestampProof: TimestampProofRefs;
  upstreamSummary: UpstreamLiveVerificationSummary;
};

const DEFAULT_FIXTURE_PATH = 'scripts/verify-m008-s03.fixture.json';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const TARGET_QUEUE_PAGE = 2;

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
  return `[verify:m008-s03] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

async function readPageBody(fetchImpl: FetchLike, url: string, timeoutMs: number) {
  let response: Response;

  try {
    response = await fetchImpl(url, { signal: buildTimeoutSignal(timeoutMs) });
  } catch (error) {
    throw new Error(`Page request failed: ${safeMessage(error)}`);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Page returned ${response.status}.`);
  }

  return body;
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

function buildAbsolutePathUrl(baseUrl: string, pathnamePrefix: string, pathname: string, search = '') {
  const url = new URL(baseUrl);
  url.pathname = `${pathnamePrefix}${pathname}`;
  url.search = search;
  url.hash = '';
  return url.toString();
}

function createVerificationTag() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

export function createRunScopedFixtureItems(items: FixtureItem[], verificationTag: string): FixtureItem[] {
  const scopedQueueLabel = `${items[0]?.queueId ?? 'queue'}-${verificationTag}`;
  return items.map((item) => ({
    ...item,
    queueId: scopedQueueLabel,
  }));
}

function createFixtureReadFileProxy(
  fixturePath: string,
  runtimeFixtureItems: FixtureItem[],
  readFileImpl: ReadFileLike
): ReadFileLike {
  const runtimeFixtureText = JSON.stringify(runtimeFixtureItems);

  return ((path: Parameters<ReadFileLike>[0], encoding?: Parameters<ReadFileLike>[1]) => {
    if (typeof path === 'string' && path === fixturePath) {
      return Promise.resolve(runtimeFixtureText) as ReturnType<ReadFileLike>;
    }

    return readFileImpl(path, encoding) as ReturnType<ReadFileLike>;
  }) as ReadFileLike;
}

function absolutizeAppHref(baseUrl: string, pathnamePrefix: string, relativeHref: string) {
  const relativeUrl = new URL(relativeHref, 'http://proof.local');
  return buildAbsolutePathUrl(baseUrl, pathnamePrefix, relativeUrl.pathname, relativeUrl.search);
}

export function assertHighCardinalityFixture(items: Array<{ queueId: string }>) {
  if (items.length <= 20) {
    throw new Error('Verification fixture must include more than 20 submissions to force a real queue page 2.');
  }

  const queueIds = [...new Set(items.map((item) => item.queueId))];
  if (queueIds.length !== 1) {
    throw new Error('Verification fixture must focus on exactly one queue so phase refs stay verifier-scoped.');
  }
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
    fixturePath: parsed.values.fixture ?? env.M008_S03_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(
      parsed.values['timeout-ms'] ?? env.M008_S03_VERIFY_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      '--timeout-ms'
    ),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.M008_S03_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

function assertQueuePageTarget(queuePage: string, baseUrl: string, queueId: string, expectedPage: number) {
  const parsed = parseAbsoluteVerifierUrl(queuePage, 'queuePage', baseUrl);
  const expectedPath = `/queues/${queueId}`;

  if (!parsed.pathname.endsWith(expectedPath)) {
    throw new Error(`Verification summary queuePage must point at ${expectedPath}.`);
  }

  if (parsed.searchParams.get('page') !== String(expectedPage)) {
    throw new Error(`Verification summary queuePage must include page=${expectedPage}.`);
  }
}

function assertQueueSubmissionsApiTarget(queueSubmissionsApi: string, baseUrl: string, queueId: string, expectedPage: number) {
  const parsed = parseAbsoluteVerifierUrl(queueSubmissionsApi, 'queueSubmissionsApi', baseUrl);
  const expectedPath = `/api/queues/${queueId}/submissions`;

  if (!parsed.pathname.endsWith(expectedPath)) {
    throw new Error(`Verification summary queueSubmissionsApi must point at ${expectedPath}.`);
  }

  if (parsed.searchParams.get('page') !== String(expectedPage)) {
    throw new Error(`Verification summary queueSubmissionsApi must include page=${expectedPage}.`);
  }
}

function assertQueueDetailTarget(
  queueDetailUrl: string,
  baseUrl: string,
  queueId: string,
  submissionId: string,
  expectedPage: number
) {
  const parsed = parseAbsoluteVerifierUrl(queueDetailUrl, 'queueDetailUrl', baseUrl);
  const expectedPath = `/queues/${queueId}/submissions/${submissionId}`;

  if (!parsed.pathname.endsWith(expectedPath)) {
    throw new Error(`Verification summary queueDetailUrl must point at ${expectedPath}.`);
  }

  if (parsed.searchParams.get('source') !== 'queue') {
    throw new Error('Verification summary queueDetailUrl must include source=queue.');
  }

  if (parsed.searchParams.get('page') !== String(expectedPage)) {
    throw new Error(`Verification summary queueDetailUrl must include page=${expectedPage}.`);
  }
}

function assertFilteredResultsTarget(filteredResults: string, baseUrl: string, queueId: string) {
  const parsed = parseAbsoluteVerifierUrl(filteredResults, 'filteredResults', baseUrl);
  const expectedPath = `/queues/${queueId}/results`;

  if (!parsed.pathname.endsWith(expectedPath)) {
    throw new Error(`Verification summary filteredResults must point at ${expectedPath}.`);
  }
}

function assertResultsDetailTarget(detailUrl: string, baseUrl: string, queueId: string, submissionId: string) {
  const parsed = parseAbsoluteVerifierUrl(detailUrl, 'detailUrl', baseUrl);
  const expectedPath = `/queues/${queueId}/submissions/${submissionId}`;

  if (!parsed.pathname.endsWith(expectedPath)) {
    throw new Error(`Verification summary detailUrl must point at ${expectedPath}.`);
  }

  if (parsed.searchParams.get('source') !== 'results') {
    throw new Error('Verification summary detailUrl must include source=results.');
  }
}

function sortMatchingRows(rows: ResultsResponse['evaluations']) {
  return [...rows].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
  );
}

function selectQueuePageProofSubmission(input: {
  queuePage: QueueSubmissionsResponse;
  filteredResults: ResultsResponse;
}): {
  submission: QueueSubmissionsResponse['submissions'][number];
  proofSubmission: ProofSubmissionTarget;
  resultsRow: ResultsResponse['evaluations'][number];
} {
  for (const submission of input.queuePage.submissions) {
    const matchingRows = sortMatchingRows(
      input.filteredResults.evaluations.filter((row) => row.submission.id === submission.id)
    );

    if (!matchingRows.length) {
      continue;
    }

    const externalIds = new Set(matchingRows.map((row) => row.submission.external_id));
    if (externalIds.size !== 1 || !externalIds.has(submission.external_id)) {
      throw new Error(
        `Queue page proof submission ${submission.id} did not match filtered results external id ${submission.external_id}.`
      );
    }

    return {
      submission,
      proofSubmission: {
        submissionId: submission.id,
        submissionExternalId: submission.external_id,
        evaluationIds: matchingRows.map((row) => row.id),
        rowCount: matchingRows.length,
      },
      resultsRow: matchingRows[0],
    };
  }

  throw new Error('Queue page 2 did not include a submission that is present in the filtered results proof set.');
}

async function fetchQueuePageProof(input: {
  summary: UpstreamLiveVerificationSummary;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const normalized = normalizeUpstreamSummary(input.summary, input.baseUrl);
  const queueSubmissionsApi = buildAbsolutePathUrl(
    input.baseUrl,
    normalized.pathnamePrefix,
    `/api/queues/${normalized.queueId}/submissions`,
    `?page=${TARGET_QUEUE_PAGE}`
  );
  const queuePage = absolutizeAppHref(
    input.baseUrl,
    normalized.pathnamePrefix,
    buildQueueSubmissionsPageHref(getQueueSubmissionsPath(normalized.queueId), { page: TARGET_QUEUE_PAGE })
  );

  const payload = await readJsonResponse(
    input.fetchImpl,
    queueSubmissionsApi,
    'queue-submissions-target',
    {
      endpoint: `/api/queues/${normalized.queueId}/submissions`,
      filter: `page=${TARGET_QUEUE_PAGE}`,
      queueId: normalized.queueId,
      queueLabel: normalized.queueLabel,
      runId: normalized.runId,
      validJudgeId: normalized.validJudgeId,
      invalidJudgeId: normalized.invalidJudgeId,
      queuePage: String(TARGET_QUEUE_PAGE),
    },
    input.timeoutMs
  );

  let response: QueueSubmissionsResponse;
  try {
    response = parseQueueSubmissionsResponse(
      payload,
      `${queueSubmissionsApi} response`
    );
  } catch (error) {
    throw new VerifierPhaseError(
      'queue-submissions-target',
      safeMessage(error),
      {
        endpoint: `/api/queues/${normalized.queueId}/submissions`,
        filter: `page=${TARGET_QUEUE_PAGE}`,
        queueId: normalized.queueId,
        queueLabel: normalized.queueLabel,
        runId: normalized.runId,
        validJudgeId: normalized.validJudgeId,
        invalidJudgeId: normalized.invalidJudgeId,
        queuePage: String(TARGET_QUEUE_PAGE),
      },
      error
    );
  }

  if (response.total <= response.pageSize || response.page !== TARGET_QUEUE_PAGE || response.submissions.length === 0) {
    throw new VerifierPhaseError(
      'queue-submissions-target',
      `Queue submissions did not expose page ${TARGET_QUEUE_PAGE}; received page=${response.page} total=${response.total} pageSize=${response.pageSize}.`,
      {
        endpoint: `/api/queues/${normalized.queueId}/submissions`,
        filter: `page=${TARGET_QUEUE_PAGE}`,
        queueId: normalized.queueId,
        queueLabel: normalized.queueLabel,
        runId: normalized.runId,
        validJudgeId: normalized.validJudgeId,
        invalidJudgeId: normalized.invalidJudgeId,
        queuePage: String(TARGET_QUEUE_PAGE),
      }
    );
  }

  assertQueuePageTarget(queuePage, input.baseUrl, normalized.queueId, TARGET_QUEUE_PAGE);
  assertQueueSubmissionsApiTarget(queueSubmissionsApi, input.baseUrl, normalized.queueId, TARGET_QUEUE_PAGE);

  return {
    normalized,
    queueProof: {
      page: response.page,
      total: response.total,
      pageSize: response.pageSize,
    } satisfies QueuePageProof,
    queuePage,
    queueSubmissionsApi,
    queueResponse: response,
  };
}

function buildFilteredResultsSearchParams(
  normalized: ReturnType<typeof normalizeUpstreamSummary>,
  page: number
) {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.append('judgeId', normalized.filteredProof.judgeId);
  searchParams.append('questionId', normalized.filteredProof.questionId);
  searchParams.append('verdict', normalized.filteredProof.verdict);
  return searchParams.toString();
}

async function fetchMatchingFilteredResults(input: {
  normalized: ReturnType<typeof normalizeUpstreamSummary>;
  queuePage: QueueSubmissionsResponse;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const queueSubmissionIds = new Set(input.queuePage.submissions.map((submission) => submission.id));
  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages) {
    const filter = buildFilteredResultsSearchParams(input.normalized, currentPage);
    const filteredResultsApi = buildAbsolutePathUrl(
      input.normalized.baseUrl,
      input.normalized.pathnamePrefix,
      `/api/queues/${input.normalized.queueId}/results`,
      `?${filter}`
    );
    const payload = await readJsonResponse(
      input.fetchImpl,
      filteredResultsApi,
      'proof-target-selection',
      {
        endpoint: `/api/queues/${input.normalized.queueId}/results`,
        filter,
        queueId: input.normalized.queueId,
        queueLabel: input.normalized.queueLabel,
        runId: input.normalized.runId,
        validJudgeId: input.normalized.validJudgeId,
        invalidJudgeId: input.normalized.invalidJudgeId,
        questionId: input.normalized.filteredProof.questionId,
        verdict: input.normalized.filteredProof.verdict,
      },
      input.timeoutMs
    );

    let filteredResults: ResultsResponse;
    try {
      filteredResults = parseResultsResponse(payload, `${filteredResultsApi} response`);
    } catch (error) {
      throw new VerifierPhaseError(
        'proof-target-selection',
        safeMessage(error),
        {
          endpoint: `/api/queues/${input.normalized.queueId}/results`,
          filter,
          queueId: input.normalized.queueId,
          queueLabel: input.normalized.queueLabel,
          runId: input.normalized.runId,
          validJudgeId: input.normalized.validJudgeId,
          invalidJudgeId: input.normalized.invalidJudgeId,
          questionId: input.normalized.filteredProof.questionId,
          verdict: input.normalized.filteredProof.verdict,
        },
        error
      );
    }

    const hasQueueIntersection = filteredResults.evaluations.some((row) => queueSubmissionIds.has(row.submission.id));
    if (hasQueueIntersection) {
      const filteredResultsUrl = buildAbsolutePathUrl(
        input.normalized.baseUrl,
        input.normalized.pathnamePrefix,
        `/queues/${input.normalized.queueId}/results`,
        `?${filter}`
      );

      return {
        filteredResultsApi,
        filteredResultsUrl,
        filteredResults,
      };
    }

    totalPages = Math.max(1, Math.ceil(filteredResults.total / filteredResults.pageSize));
    currentPage += 1;
  }

  throw new VerifierPhaseError(
    'proof-target-selection',
    'Queue page 2 did not include a submission that is present in any filtered results proof page.',
    {
      queueId: input.normalized.queueId,
      queueLabel: input.normalized.queueLabel,
      runId: input.normalized.runId,
      validJudgeId: input.normalized.validJudgeId,
      invalidJudgeId: input.normalized.invalidJudgeId,
      questionId: input.normalized.filteredProof.questionId,
      verdict: input.normalized.filteredProof.verdict,
      queuePage: String(TARGET_QUEUE_PAGE),
    }
  );
}

async function fetchDetailTimestampProof(input: {
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  submissionId: string;
  submissionExternalId: string;
  queueSubmittedAt: string | null;
  resultsCreatedAt: string;
  resultsEvaluationId: string;
  baseUrl: string;
  pathnamePrefix: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const detailApiUrl = buildAbsolutePathUrl(
    input.baseUrl,
    input.pathnamePrefix,
    `/api/queues/${input.queueId}/submissions/${input.submissionId}`
  );

  const payload = await readJsonResponse(
    input.fetchImpl,
    detailApiUrl,
    'detail-target',
    {
      endpoint: `/api/queues/${input.queueId}/submissions/${input.submissionId}`,
      queueId: input.queueId,
      queueLabel: input.queueLabel,
      runId: input.runId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
      submissionId: input.submissionId,
      submissionExternalId: input.submissionExternalId,
      resultsCreatedAt: input.resultsCreatedAt,
      evaluationId: input.resultsEvaluationId,
    },
    input.timeoutMs
  );

  const detail = parseSubmissionDetailResponse(payload, `${detailApiUrl} response`);
  const detailSubmittedAt = detail.submission.submitted_at;

  if (!input.queueSubmittedAt || !detailSubmittedAt || detailSubmittedAt !== input.queueSubmittedAt) {
    throw new VerifierPhaseError(
      'timestamp-proof',
      'Queue and submission-detail timestamps could not be matched for the selected proof submission.',
      {
        queueId: input.queueId,
        queueLabel: input.queueLabel,
        runId: input.runId,
        validJudgeId: input.validJudgeId,
        invalidJudgeId: input.invalidJudgeId,
        submissionId: input.submissionId,
        submissionExternalId: input.submissionExternalId,
        queueSubmittedAt: input.queueSubmittedAt ?? undefined,
        resultsCreatedAt: input.resultsCreatedAt,
        evaluationId: input.resultsEvaluationId,
      }
    );
  }

  return {
    submissionId: input.submissionId,
    submissionExternalId: input.submissionExternalId,
    queueSubmittedAt: input.queueSubmittedAt,
    detailSubmittedAt,
    resultsCreatedAt: input.resultsCreatedAt,
    resultsEvaluationId: input.resultsEvaluationId,
  } satisfies TimestampProofRefs;
}

async function verifyPage(input: {
  phase: 'queue-page' | 'queue-detail-page' | 'detail-page';
  url: string;
  page: string;
  expectedHeading: string;
  refs: PhaseRefs;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  return runPhase(input.phase, { ...input.refs, page: input.page, url: input.url }, async () => {
    const body = await readPageBody(input.fetchImpl, input.url, input.timeoutMs);
    if (!body.includes(input.expectedHeading)) {
      throw new Error(`Page HTML did not include expected heading ${JSON.stringify(input.expectedHeading)}.`);
    }
  });
}

export function formatTimestampProof(timestampProof: TimestampProofRefs) {
  return [
    `timestampSubmission=${timestampProof.submissionId}`,
    `timestampSubmissionExternalId=${timestampProof.submissionExternalId}`,
    `queueSubmittedAt=${timestampProof.queueSubmittedAt}`,
    `detailSubmittedAt=${timestampProof.detailSubmittedAt}`,
    `resultsEvaluation=${timestampProof.resultsEvaluationId}`,
    `resultsCreatedAt=${timestampProof.resultsCreatedAt}`,
  ].join(' ');
}

export function formatProofTargets(targets: ProofTargets) {
  return [
    `queuePage=${targets.queuePage}`,
    `queueSubmissionsApi=${targets.queueSubmissionsApi}`,
    `queueDetailUrl=${targets.queueDetailUrl}`,
    `filteredResults=${targets.filteredResults}`,
    `detailUrl=${targets.detailUrl}`,
    `filteredResultsApi=${targets.filteredResultsApi}`,
  ].join(' ');
}

export function formatSetupSummary(summary: LiveVerificationSummary) {
  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `run=${summary.runId}`,
    `validJudge=${summary.verifierJudgeIds.valid}`,
    `invalidJudge=${summary.verifierJudgeIds.invalid}`,
    `filteredPage=${summary.filteredProof.page}`,
    `filteredJudge=${summary.filteredProof.judgeId}`,
    `filteredQuestion=${summary.filteredProof.questionId}`,
    `filteredVerdict=${summary.filteredProof.verdict}`,
    `queuePage=${summary.queueProof.page}`,
    `queueTotal=${summary.queueProof.total}`,
    formatProofSubmission(summary.proofSubmission),
    formatProofTargets(summary.proofTargets),
    formatTimestampProof(summary.timestampProof),
  ].join(' ');
}

export function normalizeUpstreamError(error: unknown): never {
  if (error instanceof VerifierPhaseError) {
    throw error;
  }

  if (error instanceof UpstreamVerifierPhaseError) {
    throw new VerifierPhaseError(
      error.phase as PhaseName,
      stripVerifierPrefix(error.message),
      error.refs as PhaseRefs,
      error
    );
  }

  throw new VerifierPhaseError('live-proof', safeMessage(error), {}, error);
}

async function runWrappedUpstreamVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike,
  readFileImpl: ReadFileLike
) {
  try {
    return await runUpstreamLiveVerification(options, fetchImpl, readFileImpl);
  } catch (error) {
    normalizeUpstreamError(error);
  }
}

function log(message: string) {
  console.log(`[verify:m008-s03] ${message}`);
}

export async function resolveProofTargets(input: {
  summary: UpstreamLiveVerificationSummary;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const queueProof = await fetchQueuePageProof(input);
  const filteredResults = await fetchMatchingFilteredResults({
    normalized: queueProof.normalized,
    queuePage: queueProof.queueResponse,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });
  const selection = selectQueuePageProofSubmission({
    queuePage: queueProof.queueResponse,
    filteredResults: filteredResults.filteredResults,
  });

  const proofNormalized = {
    ...queueProof.normalized,
    filteredProof: {
      ...queueProof.normalized.filteredProof,
      page: filteredResults.filteredResults.page,
    },
  };

  const queueDetailUrl = absolutizeAppHref(
    input.baseUrl,
    queueProof.normalized.pathnamePrefix,
    buildQueueSubmissionDetailHref(
      queueProof.normalized.queueId,
      selection.proofSubmission.submissionId,
      { page: queueProof.queueProof.page }
    )
  );
  const upstreamTargets = buildResultsProofTargets(proofNormalized, selection.proofSubmission);
  const proofTargets: ProofTargets = {
    queuePage: queueProof.queuePage,
    queueSubmissionsApi: queueProof.queueSubmissionsApi,
    queueDetailUrl,
    filteredResults: filteredResults.filteredResultsUrl,
    detailUrl: upstreamTargets.detailUrl,
    filteredResultsApi: filteredResults.filteredResultsApi,
  };

  assertQueuePageTarget(proofTargets.queuePage, input.baseUrl, queueProof.normalized.queueId, queueProof.queueProof.page);
  assertQueueSubmissionsApiTarget(
    proofTargets.queueSubmissionsApi,
    input.baseUrl,
    queueProof.normalized.queueId,
    queueProof.queueProof.page
  );
  assertQueueDetailTarget(
    proofTargets.queueDetailUrl,
    input.baseUrl,
    queueProof.normalized.queueId,
    selection.proofSubmission.submissionId,
    queueProof.queueProof.page
  );
  assertFilteredResultsTarget(proofTargets.filteredResults, input.baseUrl, queueProof.normalized.queueId);
  assertResultsDetailTarget(proofTargets.detailUrl, input.baseUrl, queueProof.normalized.queueId, selection.proofSubmission.submissionId);

  const timestampProof = await fetchDetailTimestampProof({
    queueId: queueProof.normalized.queueId,
    queueLabel: queueProof.normalized.queueLabel,
    runId: queueProof.normalized.runId,
    validJudgeId: queueProof.normalized.validJudgeId,
    invalidJudgeId: queueProof.normalized.invalidJudgeId,
    submissionId: selection.proofSubmission.submissionId,
    submissionExternalId: selection.proofSubmission.submissionExternalId,
    queueSubmittedAt: selection.submission.submitted_at,
    resultsCreatedAt: selection.resultsRow.created_at,
    resultsEvaluationId: selection.resultsRow.id,
    baseUrl: input.baseUrl,
    pathnamePrefix: queueProof.normalized.pathnamePrefix,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  await verifyPage({
    phase: 'queue-page',
    page: `/queues/${queueProof.normalized.queueId}?page=${queueProof.queueProof.page}`,
    url: proofTargets.queuePage,
    expectedHeading: 'Submissions',
    refs: {
      queueId: queueProof.normalized.queueId,
      queueLabel: queueProof.normalized.queueLabel,
      runId: queueProof.normalized.runId,
      validJudgeId: queueProof.normalized.validJudgeId,
      invalidJudgeId: queueProof.normalized.invalidJudgeId,
      queuePage: String(queueProof.queueProof.page),
      submissionId: selection.proofSubmission.submissionId,
      submissionExternalId: selection.proofSubmission.submissionExternalId,
    },
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  await verifyPage({
    phase: 'queue-detail-page',
    page: `/queues/${queueProof.normalized.queueId}/submissions/${selection.proofSubmission.submissionId}?source=queue&page=${queueProof.queueProof.page}`,
    url: proofTargets.queueDetailUrl,
    expectedHeading: 'Submission detail',
    refs: {
      queueId: queueProof.normalized.queueId,
      queueLabel: queueProof.normalized.queueLabel,
      runId: queueProof.normalized.runId,
      validJudgeId: queueProof.normalized.validJudgeId,
      invalidJudgeId: queueProof.normalized.invalidJudgeId,
      queuePage: String(queueProof.queueProof.page),
      submissionId: selection.proofSubmission.submissionId,
      submissionExternalId: selection.proofSubmission.submissionExternalId,
    },
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  await verifyPage({
    phase: 'detail-page',
    page: `/queues/${queueProof.normalized.queueId}/submissions/${selection.proofSubmission.submissionId}`,
    url: proofTargets.detailUrl,
    expectedHeading: 'Submission detail',
    refs: {
      queueId: queueProof.normalized.queueId,
      queueLabel: queueProof.normalized.queueLabel,
      runId: queueProof.normalized.runId,
      validJudgeId: queueProof.normalized.validJudgeId,
      invalidJudgeId: queueProof.normalized.invalidJudgeId,
      submissionId: selection.proofSubmission.submissionId,
      submissionExternalId: selection.proofSubmission.submissionExternalId,
      evaluationId: timestampProof.resultsEvaluationId,
      resultsCreatedAt: timestampProof.resultsCreatedAt,
    },
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  return {
    filteredProof: {
      ...queueProof.normalized.filteredProof,
      total: filteredResults.filteredResults.total,
    },
    queueProof: queueProof.queueProof,
    proofSubmission: selection.proofSubmission,
    proofTargets,
    timestampProof,
  };
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const localApp = await ensureLocalAppReady({ baseUrl: options.baseUrl, fetchImpl });

  try {
    const fixtureItems = await runPhase('fixture-validation', { endpoint: options.fixturePath }, async () =>
      loadFixture(options.fixturePath, readFileImpl)
    );
    assertHighCardinalityFixture(fixtureItems);

    const verificationTag = createVerificationTag();
    const runtimeFixtureItems = createRunScopedFixtureItems(fixtureItems, verificationTag);
    const runtimeReadFileImpl = createFixtureReadFileProxy(options.fixturePath, runtimeFixtureItems, readFileImpl);

    log(
      `Using run-scoped high-cardinality fixture queue=${runtimeFixtureItems[0]?.queueId ?? 'unknown'} from ${options.fixturePath}.`
    );

    const upstreamSummary = await runWrappedUpstreamVerification(options, fetchImpl, runtimeReadFileImpl);
    const { filteredProof, queueProof, proofSubmission, proofTargets, timestampProof } = await resolveProofTargets({
      summary: upstreamSummary,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    log(
      `High-cardinality queue proof targets resolved: queuePage=${queueProof.page} queueTotal=${queueProof.total} filteredPage=${filteredProof.page} ${formatProofSubmission(proofSubmission)} ${formatProofTargets(proofTargets)} ${formatTimestampProof(timestampProof)}.`
    );

    if (localApp.autoStarted) {
      localApp.keepAlive();
      log(`Local Next dev server remains available at ${options.baseUrl} for browser follow-up.`);
    }

    return {
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.runId,
      verifierJudgeIds: upstreamSummary.verifierJudgeIds,
      filteredProof,
      queueProof,
      proofSubmission,
      proofTargets,
      timestampProof,
      upstreamSummary,
    };
  } catch (error) {
    localApp.stop();
    throw error;
  }
}

const isDirectRun = /(^|\/)verify-m008-s03\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(
      `Browser proof targets: ${formatProofSubmission(summary.proofSubmission)} ${formatProofTargets(summary.proofTargets)} ${formatTimestampProof(summary.timestampProof)}.`
    );
    log(
      `Upstream filtered targets: ${formatUpstreamProofTargets(summary.upstreamSummary.proofTargets)}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m008-s03] Unknown failure.');
    process.exit(1);
  }
}
