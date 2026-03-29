import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import type { ResultsResponse } from '../src/types/api';
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
  | 'proof-target-selection'
  | 'queue-page'
  | 'detail-page'
  | 'results-page';

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
  filter?: string;
};

type SummaryProofSeed = {
  queueId?: string;
  queueLabel?: string;
  inspectionUrls?: {
    queueDetail?: string;
    results?: string;
  };
  apiUrls?: {
    results?: string;
  };
  verifierJudgeIds?: {
    valid?: string;
    invalid?: string;
  };
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

export type ProofTargets = {
  queueUrl: string;
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
  return `[verify:m004-s03] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

export function assertPageContract({
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

export function assertFilteredResultsPayload(payload: unknown, context: string): ResultsResponse {
  return parseResultsResponse(payload, context);
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

export function buildProofTargets(summary: SummaryProofSeed, proofSubmission: ProofSubmissionTarget): ProofTargets {
  const queueId = requireNonEmptyString(summary.queueId, 'queueId');
  const validJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.valid, 'verifierJudgeIds.valid');
  const invalidJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.invalid, 'verifierJudgeIds.invalid');
  const queueUrl = requireNonEmptyString(summary.inspectionUrls?.queueDetail, 'inspectionUrls.queueDetail');
  const resultsUrl = requireNonEmptyString(summary.inspectionUrls?.results, 'inspectionUrls.results');
  const resultsApi = requireNonEmptyString(summary.apiUrls?.results, 'apiUrls.results');

  assertResultsApiTarget(resultsApi, validJudgeId, invalidJudgeId);

  let queueUrlParsed: URL;
  try {
    queueUrlParsed = new URL(queueUrl);
  } catch {
    throw new Error('Verification summary queue detail target must be an absolute URL.');
  }

  const detailUrl = `${queueUrlParsed.origin}/queues/${queueId}/submissions/${proofSubmission.submissionId}?source=results`;

  return {
    queueUrl,
    resultsUrl,
    resultsApi,
    detailUrl,
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
    `queueUrl=${targets.queueUrl}`,
    `detailUrl=${targets.detailUrl}`,
    `resultsUrl=${targets.resultsUrl}`,
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
  const payload = await readJsonResponse(
    input.fetchImpl,
    input.resultsApi,
    'proof-target-selection',
    {
      endpoint: `/api/queues/${input.queueId}/results`,
      filter: new URL(input.resultsApi).searchParams.toString() || 'page=1',
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
        filter: new URL(input.resultsApi).searchParams.toString() || 'page=1',
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

async function verifyPage(input: {
  phase: 'queue-page' | 'detail-page' | 'results-page';
  url: string;
  page: string;
  expectedHeading?: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  submissionId?: string;
  submissionExternalId?: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  return runPhase(
    input.phase,
    {
      page: input.page,
      url: input.url,
      queueId: input.queueId,
      queueLabel: input.queueLabel,
      runId: input.runId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
      submissionId: input.submissionId,
      submissionExternalId: input.submissionExternalId,
    },
    async () => {
      const body = await readPageBody(input.fetchImpl, input.url, input.timeoutMs);
      assertPageContract({ body, expectedHeading: input.expectedHeading });
    }
  );
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
  console.log(`[verify:m004-s03] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const localApp = await ensureLocalAppReady({ baseUrl: options.baseUrl, fetchImpl });

  try {
    const upstreamSummary = await runWrappedS04Verification(options, fetchImpl, readFileImpl);
    const resultsApi = requireNonEmptyString(upstreamSummary.apiUrls?.results, 'apiUrls.results');

    const filteredResults = await fetchFilteredResultsResponse({
      resultsApi,
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      validJudgeId: upstreamSummary.verifierJudgeIds.valid,
      invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });
    const proofSubmission = selectProofSubmission(filteredResults);
    const proofTargets = buildProofTargets(upstreamSummary, proofSubmission);

    const matchingRows = filteredResults.evaluations.filter((row) => row.submission.id === proofSubmission.submissionId);
    if (
      matchingRows.length === 0 ||
      matchingRows.some((row) => row.submission.external_id !== proofSubmission.submissionExternalId)
    ) {
      throw new VerifierPhaseError(
        'proof-target-selection',
        'Chosen proof submission did not match the filtered results row set.',
        {
          queueId: upstreamSummary.queueId,
          queueLabel: upstreamSummary.queueLabel,
          runId: upstreamSummary.run.runId,
          validJudgeId: upstreamSummary.verifierJudgeIds.valid,
          invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
          submissionId: proofSubmission.submissionId,
          submissionExternalId: proofSubmission.submissionExternalId,
        }
      );
    }

    await verifyPage({
      phase: 'queue-page',
      page: `/queues/${upstreamSummary.queueId}`,
      url: proofTargets.queueUrl,
      expectedHeading: 'Submissions',
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      validJudgeId: upstreamSummary.verifierJudgeIds.valid,
      invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    await verifyPage({
      phase: 'detail-page',
      page: `/queues/${upstreamSummary.queueId}/submissions/${proofSubmission.submissionId}`,
      url: proofTargets.detailUrl,
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      validJudgeId: upstreamSummary.verifierJudgeIds.valid,
      invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
      submissionId: proofSubmission.submissionId,
      submissionExternalId: proofSubmission.submissionExternalId,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    await verifyPage({
      phase: 'results-page',
      page: `/queues/${upstreamSummary.queueId}/results`,
      url: proofTargets.resultsUrl,
      expectedHeading: 'Results',
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      validJudgeId: upstreamSummary.verifierJudgeIds.valid,
      invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
      submissionId: proofSubmission.submissionId,
      submissionExternalId: proofSubmission.submissionExternalId,
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

const isDirectRun = /(^|\/)verify-m004-s03\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(
      `Browser proof targets: ${formatProofSubmission(summary.proofSubmission)} ${formatProofTargets(summary.proofTargets)}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m004-s03] Unknown failure.');
    process.exit(1);
  }
}
