import { parseArgs } from 'node:util';

type FetchLike = typeof fetch;

type PhaseName = 'judges-page' | 'queues-page' | 'queue-detail-page';

type PhaseRefs = {
  page?: string;
  url?: string;
  queueId?: string;
};

export type VerifierOptions = {
  baseUrl: string;
  queueId: string;
  timeoutMs: number;
};

export type InspectionUrls = {
  judges: string;
  queues: string;
  queueDetail: string;
};

export type LiveVerificationSummary = {
  queueId: string;
  inspectionUrls: InspectionUrls;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOVED_JUDGES_COPY = ['reviewer-facing lifecycle surface', 'now a bug'] as const;

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

function normalizeQueueId(rawQueueId: string | undefined) {
  if (!rawQueueId?.trim()) {
    throw new Error('--queue-id is required.');
  }

  if (!UUID_PATTERN.test(rawQueueId)) {
    throw new Error('--queue-id must be a valid UUID.');
  }

  return rawQueueId;
}

function formatPhaseRefs(refs: PhaseRefs) {
  const orderedEntries = Object.entries(refs).filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!orderedEntries.length) {
    return '';
  }

  return ` ${orderedEntries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

function formatPhaseMessage(phase: PhaseName, message: string, refs: PhaseRefs) {
  return `[verify:m002-s01] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
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

export function assertPageContract({
  body,
  expectedHeading,
  forbiddenText = [],
}: {
  body: string;
  expectedHeading: string;
  forbiddenText?: readonly string[];
}) {
  if (!body.includes(expectedHeading)) {
    throw new Error(`Page HTML did not include expected heading ${JSON.stringify(expectedHeading)}.`);
  }

  const staleCopy = forbiddenText.find((text) => body.includes(text));
  if (staleCopy) {
    throw new Error(`Page HTML still included removed copy ${JSON.stringify(staleCopy)}.`);
  }
}

export function parseVerifierOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): VerifierOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      'queue-id': { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    baseUrl: normalizeBaseUrl(parsed.values['base-url']),
    queueId: normalizeQueueId(parsed.values['queue-id']),
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.M002_S01_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
  };
}

export function buildInspectionUrls(baseUrl: string, queueId: string): InspectionUrls {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  return {
    judges: `${normalizedBaseUrl}/judges`,
    queues: `${normalizedBaseUrl}/queues`,
    queueDetail: `${normalizedBaseUrl}/queues/${queueId}`,
  };
}

export function assertInspectionUrls(urls: Partial<InspectionUrls>): InspectionUrls {
  const requiredKeys: Array<keyof InspectionUrls> = ['judges', 'queues', 'queueDetail'];

  for (const key of requiredKeys) {
    const value = urls[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Verification summary is missing inspection URL ${key}.`);
    }
  }

  return urls as InspectionUrls;
}

export function formatInspectionTargets(urls: Partial<InspectionUrls>) {
  const validated = assertInspectionUrls(urls);

  return [
    `judges=${validated.judges}`,
    `queues=${validated.queues}`,
    `queueDetail=${validated.queueDetail}`,
  ].join(' ');
}

async function verifyPage(input: {
  phase: PhaseName;
  url: string;
  page: string;
  expectedHeading: string;
  forbiddenText?: readonly string[];
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  return runPhase(input.phase, { page: input.page, url: input.url }, async () => {
    const body = await readPageBody(input.fetchImpl, input.url, input.timeoutMs);
    assertPageContract({
      body,
      expectedHeading: input.expectedHeading,
      forbiddenText: input.forbiddenText,
    });
  });
}

function log(message: string) {
  console.log(`[verify:m002-s01] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch
): Promise<LiveVerificationSummary> {
  const inspectionUrls = buildInspectionUrls(options.baseUrl, options.queueId);

  await verifyPage({
    phase: 'judges-page',
    page: '/judges',
    url: inspectionUrls.judges,
    expectedHeading: 'Judges',
    forbiddenText: REMOVED_JUDGES_COPY,
    timeoutMs: options.timeoutMs,
    fetchImpl,
  });

  await verifyPage({
    phase: 'queues-page',
    page: '/queues',
    url: inspectionUrls.queues,
    expectedHeading: 'Queues',
    timeoutMs: options.timeoutMs,
    fetchImpl,
  });

  await verifyPage({
    phase: 'queue-detail-page',
    page: `/queues/${options.queueId}`,
    url: inspectionUrls.queueDetail,
    expectedHeading: 'Submissions',
    timeoutMs: options.timeoutMs,
    fetchImpl,
  });

  return {
    queueId: options.queueId,
    inspectionUrls,
  };
}

const isDirectRun = /(^|\/)verify-m002-s01-shell\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK queue=${summary.queueId} headings=Judges,Queues,Submissions.`);
    log(`Browser proof targets: ${formatInspectionTargets(summary.inspectionUrls)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m002-s01] Unknown failure.');
    process.exit(1);
  }
}
