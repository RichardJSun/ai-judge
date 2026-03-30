import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import type { ResultsResponse } from '../src/types/api';
import type { VerdictEnum } from '../src/types/db';
import { ensureLocalAppReady } from './verify-m002-s02';
import {
  assertFilteredResultsResponse,
  runLiveVerification as runS03LiveVerification,
  type LiveVerificationSummary as S03LiveVerificationSummary,
  type VerifierOptions as S03VerifierOptions,
  ResultsVerifierPhaseError as S03ResultsVerifierPhaseError,
} from './verify-s03-live';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;

type PhaseName =
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
  | 'clamped-results-page';

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
  questionId?: string;
  verdict?: string;
  filter?: string;
  requestedPage?: string;
};

type SummaryProofSeed = {
  queueId?: string;
  queueLabel?: string;
  runId?: string;
  verifierJudgeIds?: {
    valid?: string;
    invalid?: string;
  };
  resultsProof?: {
    verdictFilter?: VerdictEnum;
  };
  pageUrl?: string;
};

type NormalizedUpstreamProofSeed = {
  baseUrl: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  verdictFilter: VerdictEnum;
  resultsUrl: string;
};

export type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
  pollMs: number;
};

export type FilteredProofState = {
  judgeId: string;
  questionId: string;
  verdict: VerdictEnum;
  total: number;
};

export type ClampedProofState = {
  requestedPage: number;
  canonicalPage: number;
  total: number;
};

export type ProofTargets = {
  results: string;
  filteredResults: string;
  clampedResults: string;
  resultsApi: string;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  runId: string;
  verifierJudgeIds: {
    valid: string;
    invalid: string;
  };
  filteredProof: FilteredProofState;
  clampedProof: ClampedProofState;
  proofTargets: ProofTargets;
  upstreamSummary: S03LiveVerificationSummary;
};

const DEFAULT_FIXTURE_PATH = 'scripts/verify-s03-live.fixture.json';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const CLAMPED_PAGE_REQUEST = 999_999;

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
  return `[verify:m008-s01] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

function assertResultsUrlPath(url: URL, queueId: string) {
  const expectedPath = `/queues/${queueId}/results`;
  if (url.pathname !== expectedPath) {
    throw new Error(`Verification summary pageUrl must point at ${expectedPath}.`);
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
    fixturePath: parsed.values.fixture ?? env.S03_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.S03_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.S03_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

export function normalizeUpstreamSummary(
  summary: SummaryProofSeed,
  expectedBaseUrl: string
): NormalizedUpstreamProofSeed {
  const baseUrl = normalizeBaseUrl(expectedBaseUrl);
  const queueId = requireNonEmptyString(summary.queueId, 'queueId');
  const queueLabel = requireNonEmptyString(summary.queueLabel, 'queueLabel');
  const runId = requireNonEmptyString(summary.runId, 'runId');
  const validJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.valid, 'verifierJudgeIds.valid');
  const invalidJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.invalid, 'verifierJudgeIds.invalid');
  const verdictFilter = summary.resultsProof?.verdictFilter;

  if (verdictFilter !== 'pass' && verdictFilter !== 'fail' && verdictFilter !== 'inconclusive') {
    throw new Error('Verification summary is missing resultsProof.verdictFilter.');
  }

  const resultsUrl = parseAbsoluteVerifierUrl(summary.pageUrl, 'pageUrl', baseUrl);
  assertResultsUrlPath(resultsUrl, queueId);

  return {
    baseUrl,
    queueId,
    queueLabel,
    runId,
    validJudgeId,
    invalidJudgeId,
    verdictFilter,
    resultsUrl: resultsUrl.toString(),
  };
}

function buildResultsApiUrl(normalized: NormalizedUpstreamProofSeed) {
  const parsed = new URL(`${normalized.baseUrl}/api/queues/${normalized.queueId}/results`);
  parsed.searchParams.set('page', '1');
  parsed.searchParams.append('judgeId', normalized.validJudgeId);
  parsed.searchParams.append('judgeId', normalized.invalidJudgeId);
  return parsed.toString();
}

function buildResultsPageUrl(baseUrl: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

function createFilteredParams(state: Pick<FilteredProofState, 'judgeId' | 'questionId' | 'verdict'>) {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.append('judgeId', state.judgeId);
  params.append('questionId', state.questionId);
  params.append('verdict', state.verdict);
  return params;
}

function createClampedParams(requestedPage: number) {
  const params = new URLSearchParams();
  params.set('page', String(requestedPage));
  return params;
}

function assertPageContract({
  body,
  expectedHeading,
}: {
  body: string;
  expectedHeading?: string;
}) {
  if (!expectedHeading) {
    return;
  }

  if (!body.includes(expectedHeading)) {
    throw new Error(`Page HTML did not include expected heading ${JSON.stringify(expectedHeading)}.`);
  }
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

function assertMetadataContainsFilteredState(response: ResultsResponse, filteredProof: FilteredProofState) {
  const judgeVisible = response.filterMetadata.judges.some((judge) => judge.id === filteredProof.judgeId);
  if (!judgeVisible) {
    throw new Error(`Filtered results metadata omitted selected judge ${filteredProof.judgeId}.`);
  }

  const questionVisible = response.filterMetadata.questions.some((question) => question.id === filteredProof.questionId);
  if (!questionVisible) {
    throw new Error(`Filtered results metadata omitted selected question ${filteredProof.questionId}.`);
  }

  if (!response.filterMetadata.verdicts.includes(filteredProof.verdict)) {
    throw new Error(`Filtered results metadata omitted selected verdict ${filteredProof.verdict}.`);
  }
}

export function selectFilteredProofState(
  response: ResultsResponse,
  validJudgeId: string,
  verdictFilter: VerdictEnum
): FilteredProofState {
  const selectedRow = response.evaluations.find(
    (row) => row.status === 'completed' && row.judge.id === validJudgeId && row.verdict === verdictFilter
  );

  if (!selectedRow) {
    throw new Error(
      `Current verifier results did not include a completed ${verdictFilter} row for judge ${validJudgeId}.`
    );
  }

  const total = response.evaluations.filter(
    (row) => row.judge.id === validJudgeId && row.question.id === selectedRow.question.id && row.verdict === verdictFilter
  ).length;

  return {
    judgeId: validJudgeId,
    questionId: selectedRow.question.id,
    verdict: verdictFilter,
    total,
  };
}

function assertClampedResultsResponse(response: ResultsResponse, requestedPage: number) {
  const lastPage = Math.max(1, Math.ceil(response.total / response.pageSize));

  if (response.page !== lastPage) {
    throw new Error(
      `Clamped results API returned page ${response.page} instead of the truthful last page ${lastPage}.`
    );
  }

  if (response.page === requestedPage) {
    throw new Error(`Clamped results API did not rewrite requested page ${requestedPage}.`);
  }

  return lastPage;
}

async function fetchResultsResponse(input: {
  url: string;
  phase: 'results-api-target' | 'filtered-results-target' | 'clamped-results-target';
  normalized: NormalizedUpstreamProofSeed;
  timeoutMs: number;
  fetchImpl: FetchLike;
  refs?: PhaseRefs;
}) {
  const payload = await readJsonResponse(
    input.fetchImpl,
    input.url,
    input.phase,
    {
      endpoint: `/api/queues/${input.normalized.queueId}/results`,
      filter: new URL(input.url).searchParams.toString() || 'page=1',
      queueId: input.normalized.queueId,
      queueLabel: input.normalized.queueLabel,
      runId: input.normalized.runId,
      validJudgeId: input.normalized.validJudgeId,
      invalidJudgeId: input.normalized.invalidJudgeId,
      ...input.refs,
    },
    input.timeoutMs
  );

  try {
    return parseResultsResponse(payload, `${input.url} response`);
  } catch (error) {
    throw new VerifierPhaseError(
      input.phase,
      safeMessage(error),
      {
        endpoint: `/api/queues/${input.normalized.queueId}/results`,
        filter: new URL(input.url).searchParams.toString() || 'page=1',
        queueId: input.normalized.queueId,
        queueLabel: input.normalized.queueLabel,
        runId: input.normalized.runId,
        validJudgeId: input.normalized.validJudgeId,
        invalidJudgeId: input.normalized.invalidJudgeId,
        ...input.refs,
      },
      error
    );
  }
}

async function verifyPage(input: {
  phase: 'results-page' | 'filtered-results-page' | 'clamped-results-page';
  url: string;
  page: string;
  normalized: NormalizedUpstreamProofSeed;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  return runPhase(
    input.phase,
    {
      page: input.page,
      url: input.url,
      queueId: input.normalized.queueId,
      queueLabel: input.normalized.queueLabel,
      runId: input.normalized.runId,
      validJudgeId: input.normalized.validJudgeId,
      invalidJudgeId: input.normalized.invalidJudgeId,
    },
    async () => {
      const body = await readPageBody(input.fetchImpl, input.url, input.timeoutMs);
      assertPageContract({ body, expectedHeading: 'Results' });
    }
  );
}

export async function resolveProofTargets(input: {
  summary: S03LiveVerificationSummary;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<{
  filteredProof: FilteredProofState;
  clampedProof: ClampedProofState;
  proofTargets: ProofTargets;
}> {
  const normalized = normalizeUpstreamSummary(input.summary, input.baseUrl);
  const resultsApi = buildResultsApiUrl(normalized);

  assertResultsApiTarget(resultsApi, normalized.validJudgeId, normalized.invalidJudgeId);

  const currentResults = await fetchResultsResponse({
    url: resultsApi,
    phase: 'results-api-target',
    normalized,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  if (currentResults.total === 0 || currentResults.evaluations.length === 0) {
    throw new VerifierPhaseError(
      'results-api-target',
      'Current verifier results API returned no rows for the emitted proof target.',
      {
        endpoint: `/api/queues/${normalized.queueId}/results`,
        filter: new URL(resultsApi).searchParams.toString(),
        queueId: normalized.queueId,
        queueLabel: normalized.queueLabel,
        runId: normalized.runId,
        validJudgeId: normalized.validJudgeId,
        invalidJudgeId: normalized.invalidJudgeId,
      }
    );
  }

  const filteredProof = selectFilteredProofState(
    currentResults,
    normalized.validJudgeId,
    normalized.verdictFilter
  );
  const filteredParams = createFilteredParams(filteredProof);
  const filteredResultsApi = new URL(`${normalized.baseUrl}/api/queues/${normalized.queueId}/results`);
  filteredResultsApi.search = filteredParams.toString();

  const filteredResults = await fetchResultsResponse({
    url: filteredResultsApi.toString(),
    phase: 'filtered-results-target',
    normalized,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    refs: {
      judgeId: filteredProof.judgeId,
      questionId: filteredProof.questionId,
      verdict: filteredProof.verdict,
    },
  });

  const expectedFilteredRows = currentResults.evaluations.filter(
    (row) =>
      row.judge.id === filteredProof.judgeId &&
      row.question.id === filteredProof.questionId &&
      row.verdict === filteredProof.verdict
  );

  if (expectedFilteredRows.length === 0) {
    throw new VerifierPhaseError(
      'filtered-results-target',
      'The selected filtered proof state did not match any current verifier rows.',
      {
        queueId: normalized.queueId,
        queueLabel: normalized.queueLabel,
        runId: normalized.runId,
        validJudgeId: normalized.validJudgeId,
        invalidJudgeId: normalized.invalidJudgeId,
        judgeId: filteredProof.judgeId,
        questionId: filteredProof.questionId,
        verdict: filteredProof.verdict,
      }
    );
  }

  assertFilteredResultsResponse({
    label: 'filtered deep-link proof',
    response: filteredResults,
    expectedRows: expectedFilteredRows,
    expectedJudgeIds: [filteredProof.judgeId],
    expectedQuestionIds: [filteredProof.questionId],
    expectedVerdicts: [filteredProof.verdict],
  });
  assertMetadataContainsFilteredState(filteredResults, filteredProof);

  const clampedParams = createClampedParams(CLAMPED_PAGE_REQUEST);
  const clampedResultsApi = new URL(`${normalized.baseUrl}/api/queues/${normalized.queueId}/results`);
  clampedResultsApi.search = clampedParams.toString();

  const clampedResults = await fetchResultsResponse({
    url: clampedResultsApi.toString(),
    phase: 'clamped-results-target',
    normalized,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    refs: {
      requestedPage: String(CLAMPED_PAGE_REQUEST),
    },
  });

  const canonicalPage = assertClampedResultsResponse(clampedResults, CLAMPED_PAGE_REQUEST);

  const proofTargets = {
    results: normalized.resultsUrl,
    filteredResults: buildResultsPageUrl(normalized.resultsUrl, filteredParams),
    clampedResults: buildResultsPageUrl(normalized.resultsUrl, clampedParams),
    resultsApi,
  } satisfies ProofTargets;

  await Promise.all([
    verifyPage({
      phase: 'results-page',
      url: proofTargets.results,
      page: `/queues/${normalized.queueId}/results`,
      normalized,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    }),
    verifyPage({
      phase: 'filtered-results-page',
      url: proofTargets.filteredResults,
      page: `/queues/${normalized.queueId}/results?${filteredParams.toString()}`,
      normalized,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    }),
    verifyPage({
      phase: 'clamped-results-page',
      url: proofTargets.clampedResults,
      page: `/queues/${normalized.queueId}/results?${clampedParams.toString()}`,
      normalized,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    }),
  ]);

  return {
    filteredProof: {
      ...filteredProof,
      total: filteredResults.total,
    },
    clampedProof: {
      requestedPage: CLAMPED_PAGE_REQUEST,
      canonicalPage,
      total: clampedResults.total,
    },
    proofTargets,
  };
}

export function formatProofTargets(targets: ProofTargets) {
  return [
    `results=${targets.results}`,
    `filteredResults=${targets.filteredResults}`,
    `clampedResults=${targets.clampedResults}`,
    `resultsApi=${targets.resultsApi}`,
  ].join(' ');
}

export function formatSetupSummary(summary: LiveVerificationSummary) {
  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `run=${summary.runId}`,
    `validJudge=${summary.verifierJudgeIds.valid}`,
    `invalidJudge=${summary.verifierJudgeIds.invalid}`,
    `filteredJudge=${summary.filteredProof.judgeId}`,
    `filteredQuestion=${summary.filteredProof.questionId}`,
    `filteredVerdict=${summary.filteredProof.verdict}`,
    `clampedPage=${summary.clampedProof.canonicalPage}`,
    formatProofTargets(summary.proofTargets),
  ].join(' ');
}

export function normalizeUpstreamError(error: unknown): never {
  if (error instanceof VerifierPhaseError) {
    throw error;
  }

  if (error instanceof S03ResultsVerifierPhaseError) {
    throw new VerifierPhaseError(
      error.phase as PhaseName,
      stripVerifierPrefix(error.message),
      error.refs as PhaseRefs,
      error
    );
  }

  throw new VerifierPhaseError('live-proof', safeMessage(error), {}, error);
}

async function runWrappedS03Verification(
  options: VerifierOptions,
  fetchImpl: FetchLike,
  readFileImpl: ReadFileLike
) {
  try {
    return await runS03LiveVerification(options as S03VerifierOptions, fetchImpl, readFileImpl);
  } catch (error) {
    normalizeUpstreamError(error);
  }
}

function log(message: string) {
  console.log(`[verify:m008-s01] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const localApp = await ensureLocalAppReady({ baseUrl: options.baseUrl, fetchImpl });

  try {
    const upstreamSummary = await runWrappedS03Verification(options, fetchImpl, readFileImpl);
    const { filteredProof, clampedProof, proofTargets } = await resolveProofTargets({
      summary: upstreamSummary,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    log(
      `Results deep-link proof targets resolved: filteredJudge=${filteredProof.judgeId} filteredQuestion=${filteredProof.questionId} filteredVerdict=${filteredProof.verdict} clampedPage=${clampedProof.canonicalPage} ${formatProofTargets(proofTargets)}.`
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
      clampedProof,
      proofTargets,
      upstreamSummary,
    };
  } catch (error) {
    localApp.stop();
    throw error;
  }
}

const isDirectRun = /(^|\/)verify-m008-s01\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(`Browser proof targets: ${formatProofTargets(summary.proofTargets)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m008-s01] Unknown failure.');
    process.exit(1);
  }
}
