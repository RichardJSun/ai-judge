import { readFile } from 'node:fs/promises';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import {
  buildSubmissionDetailResultsHref,
  normalizeResultsPageSearchParams,
  type ResultsPageSearchParams,
  type ResultsPageUrlState,
} from '../src/lib/results/results-page-url';
import type { ResultsResponse } from '../src/types/api';
import type { VerdictEnum } from '../src/types/db';
import { ensureLocalAppReady } from './verify-m002-s02';
import {
  parseVerifierOptions as parseUpstreamVerifierOptions,
  runLiveVerification as runS01LiveVerification,
  type LiveVerificationSummary as S01LiveVerificationSummary,
  type VerifierOptions as UpstreamVerifierOptions,
  VerifierPhaseError as S01VerifierPhaseError,
} from './verify-m008-s01';
import { selectProofSubmission, type ProofSubmissionTarget } from './verify-m004-s03';

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
  | 'clamped-results-page'
  | 'proof-target-selection'
  | 'detail-page';

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
  judgeId?: string;
  questionId?: string;
  verdict?: string;
  filter?: string;
};

type SummaryProofSeed = {
  queueId?: string;
  queueLabel?: string;
  runId?: string;
  verifierJudgeIds?: {
    valid?: string;
    invalid?: string;
  };
  filteredProof?: {
    judgeId?: string;
    questionId?: string;
    verdict?: VerdictEnum;
    total?: number;
  };
  proofTargets?: {
    filteredResults?: string;
  };
};

type NormalizedUpstreamProofSeed = {
  baseUrl: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  filteredProof: ContextualFilteredProofState;
  filteredResultsUrl: string;
  filteredResultsApi: string;
  pathnamePrefix: string;
};

export type VerifierOptions = UpstreamVerifierOptions;

export type ContextualFilteredProofState = {
  page: number;
  judgeId: string;
  questionId: string;
  verdict: VerdictEnum;
  total: number;
};

export type ProofTargets = {
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
  proofSubmission: ProofSubmissionTarget;
  proofTargets: ProofTargets;
  upstreamSummary: S01LiveVerificationSummary;
};

const ALLOWED_RESULTS_CONTEXT_KEYS = new Set(['page', 'judgeId', 'questionId', 'verdict']);
const ALLOWED_DETAIL_CONTEXT_KEYS = new Set(['source', 'page', 'judgeId', 'questionId', 'verdict']);

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

export const parseVerifierOptions = parseUpstreamVerifierOptions;

function safeMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Unknown failure.';
}

function formatPhaseRefs(refs: PhaseRefs) {
  const orderedEntries = Object.entries(refs).filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!orderedEntries.length) {
    return '';
  }

  return ` ${orderedEntries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

function formatPhaseMessage(phase: PhaseName, message: string, refs: PhaseRefs) {
  return `[verify:m008-s02] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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
  const expectedSuffix = `/queues/${queueId}/results`;
  if (!url.pathname.endsWith(expectedSuffix)) {
    throw new Error(`Verification summary proofTargets.filteredResults must point at ${expectedSuffix}.`);
  }

  return url.pathname.slice(0, -expectedSuffix.length);
}

function toResultsPageSearchParams(searchParams: URLSearchParams): ResultsPageSearchParams {
  const valuesByKey = new Map<string, string[]>();

  for (const [key, value] of searchParams.entries()) {
    const current = valuesByKey.get(key);
    if (current) {
      current.push(value);
      continue;
    }

    valuesByKey.set(key, [value]);
  }

  const record: ResultsPageSearchParams = {};
  for (const [key, values] of valuesByKey.entries()) {
    record[key] = values.length === 1 ? values[0] : values;
  }

  return record;
}

function areStringListsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areResultsPageStatesEqual(left: ResultsPageUrlState, right: ResultsPageUrlState) {
  return (
    left.page === right.page &&
    areStringListsEqual(left.selectedJudges, right.selectedJudges) &&
    areStringListsEqual(left.selectedQuestions, right.selectedQuestions) &&
    areStringListsEqual(left.selectedVerdicts, right.selectedVerdicts)
  );
}

function normalizeResultsContext(searchParams: URLSearchParams) {
  return normalizeResultsPageSearchParams(toResultsPageSearchParams(searchParams));
}

function assertOnlyAllowedSearchParamKeys(searchParams: URLSearchParams, allowedKeys: Set<string>, fieldName: string) {
  for (const key of new Set(searchParams.keys())) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Verification summary ${fieldName} included unsupported search param ${key}.`);
    }
  }
}

function buildFilteredResultsApiUrl(filteredResultsUrl: URL, pathnamePrefix: string, queueId: string) {
  const apiUrl = new URL(filteredResultsUrl.toString());
  apiUrl.pathname = `${pathnamePrefix}/api/queues/${queueId}/results`;
  apiUrl.hash = '';
  return apiUrl.toString();
}

function assertMetadataContainsFilteredState(
  response: ResultsResponse,
  filteredProof: Pick<ContextualFilteredProofState, 'judgeId' | 'questionId' | 'verdict'>
) {
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

function assertFilteredResultsResponse(
  response: ResultsResponse,
  filteredProof: ContextualFilteredProofState,
  proofTargets: Pick<ProofTargets, 'filteredResults' | 'filteredResultsApi'>
) {
  if (response.page !== filteredProof.page) {
    throw new Error(
      `Filtered results API returned page ${response.page} instead of contextual page ${filteredProof.page}.`
    );
  }

  if (response.total === 0 || response.evaluations.length === 0) {
    throw new Error('Filtered current-proof results did not include any evaluations.');
  }

  const mismatch = response.evaluations.find(
    (row) =>
      row.judge.id !== filteredProof.judgeId ||
      row.question.id !== filteredProof.questionId ||
      row.verdict !== filteredProof.verdict
  );

  if (mismatch) {
    throw new Error(
      `Filtered results row ${mismatch.id} for submission ${mismatch.submission.id} did not match ${proofTargets.filteredResults}.`
    );
  }

  assertMetadataContainsFilteredState(response, filteredProof);
}

export function normalizeUpstreamSummary(
  summary: SummaryProofSeed,
  expectedBaseUrl: string
): NormalizedUpstreamProofSeed {
  const baseUrl = parseVerifierOptions(['--base-url', expectedBaseUrl]).baseUrl;
  const queueId = requireNonEmptyString(summary.queueId, 'queueId');
  const queueLabel = requireNonEmptyString(summary.queueLabel, 'queueLabel');
  const runId = requireNonEmptyString(summary.runId, 'runId');
  const validJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.valid, 'verifierJudgeIds.valid');
  const invalidJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.invalid, 'verifierJudgeIds.invalid');
  const filteredResultsUrl = parseAbsoluteVerifierUrl(
    summary.proofTargets?.filteredResults,
    'proofTargets.filteredResults',
    baseUrl
  );
  const pathnamePrefix = assertResultsUrlPath(filteredResultsUrl, queueId);

  assertOnlyAllowedSearchParamKeys(filteredResultsUrl.searchParams, ALLOWED_RESULTS_CONTEXT_KEYS, 'proofTargets.filteredResults');

  const filteredContext = normalizeResultsContext(filteredResultsUrl.searchParams);
  const filteredJudgeId = requireNonEmptyString(summary.filteredProof?.judgeId, 'filteredProof.judgeId');
  const filteredQuestionId = requireNonEmptyString(summary.filteredProof?.questionId, 'filteredProof.questionId');
  const filteredVerdict = summary.filteredProof?.verdict;

  if (filteredVerdict !== 'pass' && filteredVerdict !== 'fail' && filteredVerdict !== 'inconclusive') {
    throw new Error('Verification summary is missing filteredProof.verdict.');
  }

  if (
    filteredContext.selectedJudges.length !== 1 ||
    filteredContext.selectedJudges[0] !== filteredJudgeId ||
    filteredContext.selectedQuestions.length !== 1 ||
    filteredContext.selectedQuestions[0] !== filteredQuestionId ||
    filteredContext.selectedVerdicts.length !== 1 ||
    filteredContext.selectedVerdicts[0] !== filteredVerdict
  ) {
    throw new Error(
      'Verification summary proofTargets.filteredResults must preserve the selected page, judge, question, and verdict context.'
    );
  }

  const filteredResultsApi = buildFilteredResultsApiUrl(filteredResultsUrl, pathnamePrefix, queueId);

  return {
    baseUrl,
    queueId,
    queueLabel,
    runId,
    validJudgeId,
    invalidJudgeId,
    filteredProof: {
      page: filteredContext.page,
      judgeId: filteredJudgeId,
      questionId: filteredQuestionId,
      verdict: filteredVerdict,
      total: typeof summary.filteredProof?.total === 'number' ? summary.filteredProof.total : 0,
    },
    filteredResultsUrl: filteredResultsUrl.toString(),
    filteredResultsApi,
    pathnamePrefix,
  };
}

export function buildProofTargets(
  normalized: NormalizedUpstreamProofSeed,
  proofSubmission: ProofSubmissionTarget
): ProofTargets {
  const relativeDetailHref = buildSubmissionDetailResultsHref(
    normalized.queueId,
    proofSubmission.submissionId,
    {
      page: normalized.filteredProof.page,
      selectedJudges: [normalized.filteredProof.judgeId],
      selectedQuestions: [normalized.filteredProof.questionId],
      selectedVerdicts: [normalized.filteredProof.verdict],
    }
  );
  const relativeDetailUrl = new URL(relativeDetailHref, 'http://proof.local');
  const detailUrl = new URL(normalized.filteredResultsUrl);
  detailUrl.pathname = `${normalized.pathnamePrefix}/queues/${normalized.queueId}/submissions/${proofSubmission.submissionId}`;
  detailUrl.search = relativeDetailUrl.search;
  detailUrl.hash = '';

  assertProofDetailUrl(detailUrl.toString(), normalized, proofSubmission);

  return {
    filteredResults: normalized.filteredResultsUrl,
    detailUrl: detailUrl.toString(),
    filteredResultsApi: normalized.filteredResultsApi,
  };
}

function assertProofDetailUrl(
  detailUrl: string,
  normalized: NormalizedUpstreamProofSeed,
  proofSubmission: ProofSubmissionTarget
) {
  const parsed = parseAbsoluteVerifierUrl(detailUrl, 'detailUrl', normalized.baseUrl);
  const expectedPath = `${normalized.pathnamePrefix}/queues/${normalized.queueId}/submissions/${proofSubmission.submissionId}`;

  if (parsed.pathname !== expectedPath) {
    throw new Error(`Verification proof detailUrl must point at ${expectedPath}.`);
  }

  assertOnlyAllowedSearchParamKeys(parsed.searchParams, ALLOWED_DETAIL_CONTEXT_KEYS, 'detailUrl');

  if (parsed.searchParams.get('source') !== 'results') {
    throw new Error('Verification proof detailUrl must include source=results.');
  }

  const detailContextParams = new URLSearchParams(parsed.search);
  detailContextParams.delete('source');
  const detailContext = normalizeResultsContext(detailContextParams);
  const expectedContext: ResultsPageUrlState = {
    page: normalized.filteredProof.page,
    selectedJudges: [normalized.filteredProof.judgeId],
    selectedQuestions: [normalized.filteredProof.questionId],
    selectedVerdicts: [normalized.filteredProof.verdict],
  };

  if (!areResultsPageStatesEqual(detailContext, expectedContext)) {
    throw new Error(
      'Verification proof detailUrl must preserve the whitelisted page and filter params from filteredResults.'
    );
  }
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
    formatProofSubmission(summary.proofSubmission),
    formatProofTargets(summary.proofTargets),
  ].join(' ');
}

export function normalizeUpstreamError(error: unknown): never {
  if (error instanceof VerifierPhaseError) {
    throw error;
  }

  if (error instanceof S01VerifierPhaseError) {
    throw new VerifierPhaseError(
      error.phase as PhaseName,
      stripVerifierPrefix(error.message),
      error.refs as PhaseRefs,
      error
    );
  }

  throw new VerifierPhaseError('live-proof', safeMessage(error), {}, error);
}

async function fetchFilteredResultsResponse(input: {
  normalized: NormalizedUpstreamProofSeed;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const payload = await readJsonResponse(
    input.fetchImpl,
    input.normalized.filteredResultsApi,
    'proof-target-selection',
    {
      endpoint: `/api/queues/${input.normalized.queueId}/results`,
      filter: new URL(input.normalized.filteredResultsApi).searchParams.toString() || 'page=1',
      queueId: input.normalized.queueId,
      queueLabel: input.normalized.queueLabel,
      runId: input.normalized.runId,
      validJudgeId: input.normalized.validJudgeId,
      invalidJudgeId: input.normalized.invalidJudgeId,
      judgeId: input.normalized.filteredProof.judgeId,
      questionId: input.normalized.filteredProof.questionId,
      verdict: input.normalized.filteredProof.verdict,
    },
    input.timeoutMs
  );

  try {
    const response = parseResultsResponse(payload, `${input.normalized.filteredResultsApi} response`);
    assertFilteredResultsResponse(response, input.normalized.filteredProof, {
      filteredResults: input.normalized.filteredResultsUrl,
      filteredResultsApi: input.normalized.filteredResultsApi,
    });
    return response;
  } catch (error) {
    throw new VerifierPhaseError(
      'proof-target-selection',
      safeMessage(error),
      {
        endpoint: `/api/queues/${input.normalized.queueId}/results`,
        filter: new URL(input.normalized.filteredResultsApi).searchParams.toString() || 'page=1',
        queueId: input.normalized.queueId,
        queueLabel: input.normalized.queueLabel,
        runId: input.normalized.runId,
        validJudgeId: input.normalized.validJudgeId,
        invalidJudgeId: input.normalized.invalidJudgeId,
        judgeId: input.normalized.filteredProof.judgeId,
        questionId: input.normalized.filteredProof.questionId,
        verdict: input.normalized.filteredProof.verdict,
      },
      error
    );
  }
}

async function verifyPage(input: {
  phase: 'filtered-results-page' | 'detail-page';
  url: string;
  page: string;
  expectedHeading: string;
  normalized: NormalizedUpstreamProofSeed;
  submission?: ProofSubmissionTarget;
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
      submissionId: input.submission?.submissionId,
      submissionExternalId: input.submission?.submissionExternalId,
      judgeId: input.normalized.filteredProof.judgeId,
      questionId: input.normalized.filteredProof.questionId,
      verdict: input.normalized.filteredProof.verdict,
    },
    async () => {
      const body = await readPageBody(input.fetchImpl, input.url, input.timeoutMs);
      if (!body.includes(input.expectedHeading)) {
        throw new Error(`Page HTML did not include expected heading ${JSON.stringify(input.expectedHeading)}.`);
      }
    }
  );
}

export async function resolveProofTargets(input: {
  summary: S01LiveVerificationSummary;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<{
  filteredProof: ContextualFilteredProofState;
  proofSubmission: ProofSubmissionTarget;
  proofTargets: ProofTargets;
}> {
  const normalized = normalizeUpstreamSummary(input.summary, input.baseUrl);
  const filteredResults = await fetchFilteredResultsResponse({
    normalized,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });
  const proofSubmission = selectProofSubmission(filteredResults);
  const proofTargets = buildProofTargets(normalized, proofSubmission);
  const matchingRows = filteredResults.evaluations.filter((row) => row.submission.id === proofSubmission.submissionId);

  if (
    matchingRows.length === 0 ||
    matchingRows.length !== proofSubmission.rowCount ||
    matchingRows.some((row) => row.submission.external_id !== proofSubmission.submissionExternalId)
  ) {
    throw new VerifierPhaseError(
      'proof-target-selection',
      `Chosen proof submission ${proofSubmission.submissionId} did not match ${proofTargets.filteredResults}.`,
      {
        queueId: normalized.queueId,
        queueLabel: normalized.queueLabel,
        runId: normalized.runId,
        validJudgeId: normalized.validJudgeId,
        invalidJudgeId: normalized.invalidJudgeId,
        submissionId: proofSubmission.submissionId,
        submissionExternalId: proofSubmission.submissionExternalId,
        judgeId: normalized.filteredProof.judgeId,
        questionId: normalized.filteredProof.questionId,
        verdict: normalized.filteredProof.verdict,
      }
    );
  }

  await verifyPage({
    phase: 'filtered-results-page',
    page: `/queues/${normalized.queueId}/results?${new URL(proofTargets.filteredResults).searchParams.toString()}`,
    url: proofTargets.filteredResults,
    expectedHeading: 'Results',
    normalized,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  await verifyPage({
    phase: 'detail-page',
    page: `/queues/${normalized.queueId}/submissions/${proofSubmission.submissionId}`,
    url: proofTargets.detailUrl,
    expectedHeading: 'Submission detail',
    normalized,
    submission: proofSubmission,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  return {
    filteredProof: {
      ...normalized.filteredProof,
      total: filteredResults.total,
    },
    proofSubmission,
    proofTargets,
  };
}

async function runWrappedS01Verification(
  options: VerifierOptions,
  fetchImpl: FetchLike,
  readFileImpl: ReadFileLike
) {
  try {
    return await runS01LiveVerification(options, fetchImpl, readFileImpl);
  } catch (error) {
    normalizeUpstreamError(error);
  }
}

function log(message: string) {
  console.log(`[verify:m008-s02] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const localApp = await ensureLocalAppReady({ baseUrl: options.baseUrl, fetchImpl });

  try {
    const upstreamSummary = await runWrappedS01Verification(options, fetchImpl, readFileImpl);
    const { filteredProof, proofSubmission, proofTargets } = await resolveProofTargets({
      summary: upstreamSummary,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    log(
      `Dense inspection continuity proof targets resolved: filteredPage=${filteredProof.page} filteredJudge=${filteredProof.judgeId} filteredQuestion=${filteredProof.questionId} filteredVerdict=${filteredProof.verdict} ${formatProofSubmission(proofSubmission)} ${formatProofTargets(proofTargets)}.`
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
      proofSubmission,
      proofTargets,
      upstreamSummary,
    };
  } catch (error) {
    localApp.stop();
    throw error;
  }
}

const isDirectRun = /(^|\/)verify-m008-s02\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(
      `Browser proof targets: ${formatProofSubmission(summary.proofSubmission)} ${formatProofTargets(summary.proofTargets)}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m008-s02] Unknown failure.');
    process.exit(1);
  }
}
