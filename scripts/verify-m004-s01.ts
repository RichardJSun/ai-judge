import { spawn, type ChildProcess } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  parseQueueQuestionList,
  QueueAssignmentStateError,
} from '../src/lib/assignments/queue-assignment-state';
import { fetchJson, parseSubmissionDetailResponse } from '../src/lib/submissions/fetch-json';
import type { SubmissionDetailResponse } from '../src/types/api';

type FetchLike = typeof fetch;
type SpawnLike = typeof spawn;

type PhaseName = 'local-app' | 'queue-discovery' | 'submission-discovery' | 'detail-fetch' | 'question-coverage';

type PhaseRefs = {
  url?: string;
  queueId?: string;
  queueLabel?: string;
  submissionId?: string;
  detailUrl?: string;
  questionsUrl?: string;
};

type QueueListItem = {
  id: string;
  queue_id: string;
  created_at: string;
  submission_count: number;
  question_count: number;
};

type QueueSubmissionListResponse = {
  submissions: Array<{
    id: string;
    external_id: string;
    labeling_task_id: string | null;
    submitted_at: string | null;
    created_at: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
};

export type VerifierOptions = {
  baseUrl: string;
  timeoutMs: number;
  startupTimeoutMs: number;
  probeTimeoutMs: number;
  pollMs: number;
};

export type ProofTarget = {
  queueId: string;
  queueLabel: string;
  submissionId: string;
  submissionExternalId: string;
  detailUrl: string;
  questionsUrl: string;
};

export type LiveVerificationSummary = ProofTarget & {
  totalQuestions: number;
  answeredQuestions: number;
  missingQuestions: number;
};

export type LocalAppGuard = {
  autoStarted: boolean;
  keepAlive: () => void;
  stop: () => void;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_POLL_MS = 500;
const CONNECTION_FAILURE_PATTERN =
  /(Unable to connect|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|network error|Failed to fetch|fetch failed|Connection refused)/i;

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
  return `[verify:m004-s01] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

function isLocalBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
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
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
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

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`${label} was not an object.`);
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireNullableString(value: unknown, fieldName: string) {
  if (value == null) {
    return null;
  }

  return requireString(value, fieldName);
}

function requireNonNegativeInteger(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return value;
}

function parseQueueList(value: unknown, context = 'queue list response'): QueueListItem[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed ${context}: expected an array.`);
  }

  return value.map((row, index) => {
    const record = requireObject(row, `${context}[${index}]`);

    return {
      id: requireString(record.id, `${context}[${index}].id`),
      queue_id: requireString(record.queue_id, `${context}[${index}].queue_id`),
      created_at: requireString(record.created_at, `${context}[${index}].created_at`),
      submission_count: requireNonNegativeInteger(record.submission_count, `${context}[${index}].submission_count`),
      question_count: requireNonNegativeInteger(record.question_count, `${context}[${index}].question_count`),
    };
  });
}

function parseQueueSubmissionList(value: unknown, context = 'queue submissions response'): QueueSubmissionListResponse {
  const record = requireObject(value, context);
  const submissionsValue = record.submissions;

  if (!Array.isArray(submissionsValue)) {
    throw new Error(`Malformed ${context}: submissions must be an array.`);
  }

  return {
    submissions: submissionsValue.map((row, index) => {
      const submission = requireObject(row, `${context}.submissions[${index}]`);
      return {
        id: requireString(submission.id, `${context}.submissions[${index}].id`),
        external_id: requireString(submission.external_id, `${context}.submissions[${index}].external_id`),
        labeling_task_id: requireNullableString(
          submission.labeling_task_id,
          `${context}.submissions[${index}].labeling_task_id`
        ),
        submitted_at: requireNullableString(submission.submitted_at, `${context}.submissions[${index}].submitted_at`),
        created_at: requireString(submission.created_at, `${context}.submissions[${index}].created_at`),
      };
    }),
    total: requireNonNegativeInteger(record.total, `${context}.total`),
    page: requireNonNegativeInteger(record.page, `${context}.page`),
    pageSize: requireNonNegativeInteger(record.pageSize, `${context}.pageSize`),
  };
}

async function readJsonResponse(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  parse: (value: unknown) => unknown,
  fallbackMessage: string
) {
  const response = await fetchImpl(url, {
    signal: buildTimeoutSignal(timeoutMs),
  });
  const text = await response.text();

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${fallbackMessage} The server returned invalid JSON.`);
    }
  }

  if (!response.ok) {
    if (typeof body === 'object' && body !== null) {
      const candidate = body as { error?: unknown; detail?: unknown };
      if (typeof candidate.error === 'string' && typeof candidate.detail === 'string') {
        throw new Error(`${candidate.error} ${candidate.detail}`);
      }
      if (typeof candidate.error === 'string') {
        throw new Error(candidate.error);
      }
    }

    throw new Error(fallbackMessage);
  }

  return parse(body);
}

function buildProofTarget(baseUrl: string, queueId: string, queueLabel: string, submission: QueueSubmissionListResponse['submissions'][number]): ProofTarget {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  return {
    queueId,
    queueLabel,
    submissionId: submission.id,
    submissionExternalId: submission.external_id,
    detailUrl: `${normalizedBaseUrl}/api/queues/${queueId}/submissions/${submission.id}`,
    questionsUrl: `${normalizedBaseUrl}/api/queues/${queueId}/questions`,
  };
}

export function formatProofTarget(target: ProofTarget) {
  return [
    `queue=${target.queueId}`,
    `queueLabel=${target.queueLabel}`,
    `submission=${target.submissionId}`,
    `submissionExternalId=${target.submissionExternalId}`,
    `detailUrl=${target.detailUrl}`,
    `questionsUrl=${target.questionsUrl}`,
  ].join(' ');
}

export function formatVerificationSummary(summary: LiveVerificationSummary) {
  return [
    formatProofTarget(summary),
    `summary=${summary.answeredQuestions}/${summary.missingQuestions}/${summary.totalQuestions}`,
  ].join(' ');
}

export function assertSubmissionDetailCoverage(detail: SubmissionDetailResponse, questionsUrlPayload: unknown) {
  let queueQuestions: ReturnType<typeof parseQueueQuestionList>;

  try {
    queueQuestions = parseQueueQuestionList(questionsUrlPayload, 'queue questions response');
  } catch (error) {
    if (error instanceof QueueAssignmentStateError) {
      throw new Error(error.publicMessage);
    }

    throw error;
  }

  if (detail.queue.id !== detail.submission.queue_id) {
    throw new Error(
      `Submission queue_id ${detail.submission.queue_id} did not match detail queue ${detail.queue.id}.`
    );
  }

  if (detail.questions.length !== queueQuestions.length) {
    throw new Error(
      `Submission detail returned ${detail.questions.length} questions but ${queueQuestions.length} queue questions exist.`
    );
  }

  const answeredQuestions = detail.questions.filter((question) => question.answerState === 'answered').length;
  const missingQuestions = detail.questions.filter((question) => question.answerState === 'missing').length;

  if (detail.summary.totalQuestions !== detail.questions.length) {
    throw new Error(
      `Submission detail summary totalQuestions=${detail.summary.totalQuestions} did not match questions.length=${detail.questions.length}.`
    );
  }

  if (detail.summary.answeredQuestions !== answeredQuestions) {
    throw new Error(
      `Submission detail summary answeredQuestions=${detail.summary.answeredQuestions} did not match derived answered count ${answeredQuestions}.`
    );
  }

  if (detail.summary.missingQuestions !== missingQuestions) {
    throw new Error(
      `Submission detail summary missingQuestions=${detail.summary.missingQuestions} did not match derived missing count ${missingQuestions}.`
    );
  }

  if (detail.summary.answeredQuestions + detail.summary.missingQuestions !== detail.summary.totalQuestions) {
    throw new Error('Submission detail summary counts did not add up to totalQuestions.');
  }

  queueQuestions.forEach((queueQuestion, index) => {
    const detailQuestion = detail.questions[index];
    if (!detailQuestion) {
      throw new Error(`Submission detail omitted queue question ${queueQuestion.id}.`);
    }

    if (detailQuestion.id !== queueQuestion.id) {
      throw new Error(
        `Submission detail question order drifted at index ${index}: expected ${queueQuestion.id} but received ${detailQuestion.id}.`
      );
    }

    if (
      detailQuestion.external_id !== queueQuestion.external_id ||
      detailQuestion.question_type !== queueQuestion.question_type ||
      detailQuestion.question_text !== queueQuestion.question_text ||
      detailQuestion.created_at !== queueQuestion.created_at
    ) {
      throw new Error(`Submission detail question ${queueQuestion.id} drifted from the queue questions contract.`);
    }
  });
}

async function discoverProofTarget(options: VerifierOptions, fetchImpl: FetchLike): Promise<ProofTarget> {
  const queuesUrl = `${options.baseUrl}/api/queues`;
  const queues = await runPhase('queue-discovery', { url: queuesUrl }, async () => {
    return parseQueueList(
      await readJsonResponse(
        fetchImpl,
        queuesUrl,
        options.timeoutMs,
        (value) => value,
        'Failed to load queue list.'
      ),
      `${queuesUrl} response`
    );
  });

  const proofQueue = queues.find((queue) => queue.submission_count > 0 && queue.question_count > 0);
  if (!proofQueue) {
    throw new VerifierPhaseError(
      'queue-discovery',
      'No queue with both submissions and questions was found. Load local fixture data before running verify:m004-s01.',
      { url: queuesUrl }
    );
  }

  const submissionsUrl = `${options.baseUrl}/api/queues/${proofQueue.id}/submissions`;
  const submissions = await runPhase(
    'submission-discovery',
    {
      url: submissionsUrl,
      queueId: proofQueue.id,
      queueLabel: proofQueue.queue_id,
    },
    async () => {
      return parseQueueSubmissionList(
        await readJsonResponse(
          fetchImpl,
          submissionsUrl,
          options.timeoutMs,
          (value) => value,
          'Failed to load queue submissions.'
        ),
        `${submissionsUrl} response`
      );
    }
  );

  const proofSubmission = submissions.submissions[0];
  if (!proofSubmission) {
    throw new VerifierPhaseError(
      'submission-discovery',
      'Queue reported submissions but the first submissions page was empty.',
      {
        url: submissionsUrl,
        queueId: proofQueue.id,
        queueLabel: proofQueue.queue_id,
      }
    );
  }

  return buildProofTarget(options.baseUrl, proofQueue.id, proofQueue.queue_id, proofSubmission);
}

function log(message: string) {
  console.log(`[verify:m004-s01] ${message}`);
}

export function parseVerifierOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): VerifierOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'startup-timeout-ms': { type: 'string' },
      'probe-timeout-ms': { type: 'string' },
      'poll-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    baseUrl: normalizeBaseUrl(parsed.values['base-url'] ?? env.BASE_URL),
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.M004_S01_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    startupTimeoutMs: integerArg(
      parsed.values['startup-timeout-ms'] ?? env.M004_S01_VERIFY_STARTUP_TIMEOUT_MS,
      DEFAULT_STARTUP_TIMEOUT_MS,
      '--startup-timeout-ms'
    ),
    probeTimeoutMs: integerArg(
      parsed.values['probe-timeout-ms'] ?? env.M004_S01_VERIFY_PROBE_TIMEOUT_MS,
      DEFAULT_PROBE_TIMEOUT_MS,
      '--probe-timeout-ms'
    ),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.M004_S01_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch
): Promise<LiveVerificationSummary> {
  const localApp = await runPhase('local-app', { url: `${options.baseUrl}/api/queues` }, async () =>
    ensureLocalAppReady({
      baseUrl: options.baseUrl,
      fetchImpl,
      startupTimeoutMs: options.startupTimeoutMs,
      probeTimeoutMs: options.probeTimeoutMs,
      pollMs: options.pollMs,
    })
  );

  try {
    const proofTarget = await discoverProofTarget(options, fetchImpl);

    const detail = await runPhase(
      'detail-fetch',
      {
        queueId: proofTarget.queueId,
        queueLabel: proofTarget.queueLabel,
        submissionId: proofTarget.submissionId,
        url: proofTarget.detailUrl,
        detailUrl: proofTarget.detailUrl,
      },
      async () => {
        try {
          return await fetchJson(proofTarget.detailUrl, {
            fallbackMessage: 'Failed to load submission detail.',
            init: { signal: buildTimeoutSignal(options.timeoutMs) },
            parse: (value) => parseSubmissionDetailResponse(value, `${proofTarget.detailUrl} response`),
          });
        } catch (error) {
          throw new Error(`${safeMessage(error)} URL under test: ${proofTarget.detailUrl}`);
        }
      }
    );

    const questionsPayload = await runPhase(
      'question-coverage',
      {
        queueId: proofTarget.queueId,
        queueLabel: proofTarget.queueLabel,
        submissionId: proofTarget.submissionId,
        url: proofTarget.questionsUrl,
        detailUrl: proofTarget.detailUrl,
        questionsUrl: proofTarget.questionsUrl,
      },
      async () => {
        return readJsonResponse(
          fetchImpl,
          proofTarget.questionsUrl,
          options.timeoutMs,
          (value) => value,
          'Failed to load queue questions.'
        );
      }
    );

    await runPhase(
      'question-coverage',
      {
        queueId: proofTarget.queueId,
        queueLabel: proofTarget.queueLabel,
        submissionId: proofTarget.submissionId,
        detailUrl: proofTarget.detailUrl,
        questionsUrl: proofTarget.questionsUrl,
      },
      () => assertSubmissionDetailCoverage(detail, questionsPayload)
    );

    const summary: LiveVerificationSummary = {
      ...proofTarget,
      totalQuestions: detail.summary.totalQuestions,
      answeredQuestions: detail.summary.answeredQuestions,
      missingQuestions: detail.summary.missingQuestions,
    };

    log(`Validated submission detail target: ${formatProofTarget(proofTarget)}.`);
    log(`Summary consistency passed: ${formatVerificationSummary(summary)}.`);

    if (localApp.autoStarted) {
      localApp.keepAlive();
      log(`Local Next dev server remains available at ${options.baseUrl} for downstream UI follow-up.`);
    }

    return summary;
  } catch (error) {
    localApp.stop();
    throw error;
  }
}

const isDirectRun = /(^|\/)verify-m004-s01\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatVerificationSummary(summary)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[verify:m004-s01] Unknown failure.');
    process.exit(1);
  }
}
