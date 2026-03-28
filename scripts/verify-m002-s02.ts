import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  runLiveVerification as runS04LiveVerification,
  type LiveVerificationSummary as S04LiveVerificationSummary,
  type VerifierOptions as S04VerifierOptions,
  VerifierPhaseError as S04VerifierPhaseError,
} from './verify-s04-live';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;
type SpawnLike = typeof spawn;

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
  | 'assign-page'
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
  filter?: string;
};

type SummaryProofSeed = {
  inspectionUrls?: {
    assign?: string;
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

export type ProofTargets = {
  assign: string;
  results: string;
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
  proofTargets: ProofTargets;
  upstreamSummary: S04LiveVerificationSummary;
};

const DEFAULT_FIXTURE_PATH = 'scripts/verify-s04-live.fixture.json';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const LOCAL_APP_PROBE_TIMEOUT_MS = 1_500;
const LOCAL_APP_START_TIMEOUT_MS = 45_000;
const LOCAL_APP_POLL_MS = 500;
const CONNECTION_FAILURE_PATTERN =
  /(Unable to connect|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|network error|Failed to fetch|fetch failed|Connection refused)/i;

export type LocalAppGuard = {
  autoStarted: boolean;
  keepAlive: () => void;
  stop: () => void;
};

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
  return `[verify:m002-s02] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isLocalBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function collectErrorMessages(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (!(current instanceof Error)) {
      if (typeof current === 'string' && current.trim()) {
        messages.push(current);
      }
      break;
    }

    if (current.message.trim()) {
      messages.push(current.message);
    }

    current = 'cause' in current ? current.cause : null;
  }

  return messages;
}

function isConnectionError(error: unknown) {
  return collectErrorMessages(error).some((message) => CONNECTION_FAILURE_PATTERN.test(message));
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

type Reachability = 'reachable' | 'unreachable' | 'timeout';

async function probeReachability(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<Reachability> {
  try {
    const response = await fetchImpl(url, { signal: buildTimeoutSignal(timeoutMs) });
    await response.body?.cancel?.();
    return 'reachable';
  } catch (error) {
    if (isTimeoutError(error)) {
      return 'timeout';
    }

    if (isConnectionError(error)) {
      return 'unreachable';
    }

    throw error;
  }
}

function createNoopLocalAppGuard(): LocalAppGuard {
  return {
    autoStarted: false,
    keepAlive: () => {},
    stop: () => {},
  };
}

export async function ensureLocalAppReady({
  baseUrl,
  fetchImpl = fetch,
  spawnImpl = spawn,
  startupTimeoutMs = LOCAL_APP_START_TIMEOUT_MS,
  probeTimeoutMs = LOCAL_APP_PROBE_TIMEOUT_MS,
  pollMs = LOCAL_APP_POLL_MS,
  cwd = process.cwd(),
  execPath = process.execPath,
  env = process.env,
}: {
  baseUrl: string;
  fetchImpl?: FetchLike;
  spawnImpl?: SpawnLike;
  startupTimeoutMs?: number;
  probeTimeoutMs?: number;
  pollMs?: number;
  cwd?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LocalAppGuard> {
  if (!isLocalBaseUrl(baseUrl)) {
    return createNoopLocalAppGuard();
  }

  const healthUrl = `${baseUrl.replace(/\/$/, '')}/api/queues`;
  const initialReachability = await probeReachability(fetchImpl, healthUrl, probeTimeoutMs);

  if (initialReachability !== 'unreachable') {
    return createNoopLocalAppGuard();
  }

  const parsedBaseUrl = new URL(baseUrl);
  const port = parsedBaseUrl.port || '3000';
  const child = spawnImpl(execPath, ['run', 'dev', '--', '--hostname', parsedBaseUrl.hostname, '--port', port], {
    cwd,
    env,
    stdio: 'ignore',
    detached: true,
  }) as ChildProcess;

  let released = false;
  const keepAlive = () => {
    if (!released) {
      child.unref();
      released = true;
    }
  };
  const stop = () => {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
    }
    keepAlive();
  };

  try {
    const deadline = Date.now() + startupTimeoutMs;

    while (Date.now() < deadline) {
      const reachability = await probeReachability(fetchImpl, healthUrl, probeTimeoutMs);
      if (reachability === 'reachable') {
        log(`Local app was unreachable; auto-started \`bun run dev\` at ${baseUrl}.`);
        return {
          autoStarted: true,
          keepAlive,
          stop,
        };
      }

      await wait(pollMs);
    }
  } catch (error) {
    stop();
    throw error;
  }

  stop();
  throw new Error(`Local Next dev server did not become reachable at ${healthUrl} within ${startupTimeoutMs}ms after auto-start.`);
}

async function readPageBody(fetchImpl: FetchLike, url: string, timeoutMs: number) {
  let response: Response;

  try {
    response = await fetchImpl(url, { signal: buildTimeoutSignal(timeoutMs) });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`Page request timed out after ${timeoutMs}ms.`);
    }

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

function assertResultsApiTarget(resultsApi: string, validJudgeId: string, invalidJudgeId: string) {
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
  expectedHeading: string;
}) {
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

export function buildProofTargets(summary: SummaryProofSeed): ProofTargets {
  const validJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.valid, 'verifierJudgeIds.valid');
  const invalidJudgeId = requireNonEmptyString(summary.verifierJudgeIds?.invalid, 'verifierJudgeIds.invalid');
  const assign = requireNonEmptyString(summary.inspectionUrls?.assign, 'inspectionUrls.assign');
  const results = requireNonEmptyString(summary.inspectionUrls?.results, 'inspectionUrls.results');
  const resultsApi = requireNonEmptyString(summary.apiUrls?.results, 'apiUrls.results');

  assertResultsApiTarget(resultsApi, validJudgeId, invalidJudgeId);

  return {
    assign,
    results,
    resultsApi,
  };
}

export function formatProofTargets(targets: ProofTargets) {
  return [`assign=${targets.assign}`, `results=${targets.results}`, `resultsApi=${targets.resultsApi}`].join(' ');
}

export function formatSetupSummary(summary: LiveVerificationSummary) {
  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `run=${summary.runId}`,
    `validJudge=${summary.verifierJudgeIds.valid}`,
    `invalidJudge=${summary.verifierJudgeIds.invalid}`,
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

async function verifyPage(input: {
  phase: 'assign-page' | 'results-page';
  url: string;
  page: string;
  expectedHeading: string;
  queueId: string;
  queueLabel: string;
  runId: string;
  validJudgeId: string;
  invalidJudgeId: string;
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
  console.log(`[verify:m002-s02] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const localApp = await ensureLocalAppReady({ baseUrl: options.baseUrl, fetchImpl });

  try {
    const upstreamSummary = await runWrappedS04Verification(options, fetchImpl, readFileImpl);
    const proofTargets = buildProofTargets(upstreamSummary);

    await verifyPage({
      phase: 'assign-page',
      page: `/queues/${upstreamSummary.queueId}/assign`,
      url: proofTargets.assign,
      expectedHeading: 'Assign Judges',
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      validJudgeId: upstreamSummary.verifierJudgeIds.valid,
      invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    await verifyPage({
      phase: 'results-page',
      page: `/queues/${upstreamSummary.queueId}/results`,
      url: proofTargets.results,
      expectedHeading: 'Results',
      queueId: upstreamSummary.queueId,
      queueLabel: upstreamSummary.queueLabel,
      runId: upstreamSummary.run.runId,
      validJudgeId: upstreamSummary.verifierJudgeIds.valid,
      invalidJudgeId: upstreamSummary.verifierJudgeIds.invalid,
      timeoutMs: options.timeoutMs,
      fetchImpl,
    });

    log(
      `Reviewer proof routes are reachable: assign=${proofTargets.assign} results=${proofTargets.results} resultsApi=${proofTargets.resultsApi}.`
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
      proofTargets,
      upstreamSummary,
    };
  } catch (error) {
    localApp.stop();
    throw error;
  }
}

const isDirectRun = /(^|\/)verify-m002-s02\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(`Browser proof targets: ${formatProofTargets(summary.proofTargets)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m002-s02] Unknown failure.');
    process.exit(1);
  }
}
