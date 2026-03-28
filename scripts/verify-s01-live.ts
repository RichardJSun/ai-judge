import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';
import type { EvalStatusEnum, RunStatusEnum, VerdictEnum } from '../src/types/db';

type FetchLike = (url: string | URL | globalThis.Request, init?: RequestInit) => Promise<Response>;

type QueueRow = {
  id: string;
  queue_id: string;
  created_at: string;
  submission_count: number;
  question_count: number;
};

type PreviewResponse = {
  total?: number;
  breakdown?: unknown[];
  error?: string;
};

type RunStartResponse = {
  runId?: string;
  total?: number;
  error?: string;
};

type ResultsApiResponse = {
  evaluations?: unknown[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: string;
};

export type RunProgressSnapshot = {
  status: RunStatusEnum;
  total: number;
  completed: number;
  errored: number;
};

export type PersistedRunAudit = {
  id: string;
  status: RunStatusEnum;
  total: number;
  completed: number;
  errored: number;
};

export type EvaluationAuditRow = {
  id: string;
  status: EvalStatusEnum;
  verdict: VerdictEnum | null;
  reasoning: string | null;
  prompt_snapshot: string | null;
  model_used: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  retry_count: number;
  error_message: string | null;
};

export type VerifierOptions = {
  baseUrl: string;
  queueId?: string;
  timeoutMs: number;
  pollMs: number;
};

const RUN_STATUSES: RunStatusEnum[] = ['pending', 'running', 'completed', 'error', 'cancelled'];
const EVAL_STATUSES: EvalStatusEnum[] = ['pending', 'running', 'completed', 'error'];
const VERDICTS: VerdictEnum[] = ['pass', 'fail', 'inconclusive'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRunStatus(value: unknown): value is RunStatusEnum {
  return typeof value === 'string' && RUN_STATUSES.includes(value as RunStatusEnum);
}

function isEvalStatus(value: unknown): value is EvalStatusEnum {
  return typeof value === 'string' && EVAL_STATUSES.includes(value as EvalStatusEnum);
}

function isVerdict(value: unknown): value is VerdictEnum {
  return typeof value === 'string' && VERDICTS.includes(value as VerdictEnum);
}

function asPositiveInteger(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return value;
}

function asString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function asNullableString(value: unknown, fieldName: string) {
  if (value == null) {
    return null;
  }

  return asString(value, fieldName);
}

function baseUrlFromInput(rawUrl: string | undefined) {
  return (rawUrl ?? 'http://localhost:3000').replace(/\/$/, '');
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function readJsonResponse<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit | undefined,
  label: string
): Promise<T> {
  let response: Response;

  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new Error(
      `${label} request failed: ${error instanceof Error ? error.message : 'unknown network error'}`
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label} returned a non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === 'string'
      ? payload.error
      : response.statusText || 'request failed';
    throw new Error(`${label} failed (${response.status}): ${message}`);
  }

  return payload as T;
}

export function parseVerifierOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): VerifierOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      'queue-id': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'poll-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    baseUrl: baseUrlFromInput(parsed.values['base-url'] ?? env.BASE_URL),
    queueId: parsed.values['queue-id'] ?? env.QUEUE_ID,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.RUN_VERIFY_TIMEOUT_MS, 120000, '--timeout-ms'),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.RUN_VERIFY_POLL_MS, 2000, '--poll-ms'),
  };
}

function parsePreviewPayload(payload: unknown, queueId: string) {
  if (!isObject(payload)) {
    throw new Error(`Run preview for queue ${queueId} was not an object.`);
  }

  const total = asPositiveInteger(payload.total, `Run preview total for queue ${queueId}`);
  if (!Array.isArray(payload.breakdown)) {
    throw new Error(`Run preview for queue ${queueId} is missing a breakdown array.`);
  }

  return { total, breakdownCount: payload.breakdown.length };
}

function parseQueueRows(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error('Queue list response was not an array.');
  }

  return payload
    .filter(isObject)
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : null,
      queue_id: typeof row.queue_id === 'string' ? row.queue_id : null,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      submission_count: typeof row.submission_count === 'number' ? row.submission_count : 0,
      question_count: typeof row.question_count === 'number' ? row.question_count : 0,
    }))
    .filter((row): row is QueueRow => Boolean(row.id && row.queue_id && row.created_at));
}

function parseRunStartPayload(payload: unknown) {
  if (!isObject(payload)) {
    throw new Error('Run start response was not an object.');
  }

  return {
    runId: asString(payload.runId, 'Run start response runId'),
    total: asPositiveInteger(payload.total, 'Run start response total'),
  };
}

export function assertRunProgressPayload(payload: unknown): RunProgressSnapshot {
  if (!isObject(payload)) {
    throw new Error('Run progress response was not an object.');
  }

  if (!isRunStatus(payload.status)) {
    throw new Error('Run progress response is missing a valid status.');
  }

  return {
    status: payload.status,
    total: asPositiveInteger(payload.total, 'Run progress total'),
    completed: asPositiveInteger(payload.completed, 'Run progress completed'),
    errored: asPositiveInteger(payload.errored, 'Run progress errored'),
  };
}

export function assertResultsPayload(payload: unknown) {
  if (!isObject(payload)) {
    throw new Error('Results response was not an object.');
  }

  if (!Array.isArray(payload.evaluations)) {
    throw new Error('Results response is missing an evaluations array.');
  }

  return {
    total: asPositiveInteger(payload.total, 'Results response total'),
    page: asPositiveInteger(payload.page, 'Results response page'),
    pageSize: asPositiveInteger(payload.pageSize, 'Results response pageSize'),
    evaluationsCount: payload.evaluations.length,
  };
}

export function summarizeProgress(progress: RunProgressSnapshot | null) {
  if (!progress) {
    return 'no progress received yet';
  }

  return `${progress.status} (completed=${progress.completed}, errored=${progress.errored}, total=${progress.total})`;
}

export async function pollRunUntilTerminal({
  baseUrl,
  queueId,
  runId,
  timeoutMs,
  pollMs,
  fetchImpl = fetch,
  sleepImpl = sleep,
  now = Date.now,
}: {
  baseUrl: string;
  queueId: string;
  runId: string;
  timeoutMs: number;
  pollMs: number;
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<unknown>;
  now?: () => number;
}) {
  const startedAt = now();
  let attempts = 0;
  let lastProgress: RunProgressSnapshot | null = null;

  while (now() - startedAt <= timeoutMs) {
    attempts += 1;
    const payload = await readJsonResponse<unknown>(
      fetchImpl,
      `${baseUrl}/api/queues/${queueId}/runs/${runId}`,
      undefined,
      'Run progress'
    );
    const progress = assertRunProgressPayload(payload);
    lastProgress = progress;

    if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
      return { progress, attempts };
    }

    await sleepImpl(pollMs);
  }

  throw new Error(
    `Timed out waiting for run ${runId} after ${timeoutMs}ms. Last observed state: ${summarizeProgress(lastProgress)}.`
  );
}

function assertPromptAudit(row: EvaluationAuditRow, fieldName: keyof EvaluationAuditRow) {
  const value = row[fieldName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Evaluation ${row.id} is missing ${fieldName}.`);
  }
}

export function assertPersistedAudit({
  run,
  evaluations,
  expectedTotal,
}: {
  run: PersistedRunAudit;
  evaluations: EvaluationAuditRow[];
  expectedTotal: number;
}) {
  if (run.total !== expectedTotal) {
    throw new Error(`Run total ${run.total} did not match the started total ${expectedTotal}.`);
  }

  if (evaluations.length !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} evaluations for run ${run.id}, found ${evaluations.length}.`);
  }

  let completedRows = 0;
  let erroredRows = 0;
  let retriedRows = 0;

  for (const row of evaluations) {
    if (!isEvalStatus(row.status)) {
      throw new Error(`Evaluation ${row.id} has invalid status ${String(row.status)}.`);
    }

    assertPromptAudit(row, 'prompt_snapshot');
    assertPromptAudit(row, 'model_used');

    if (!Number.isInteger(row.retry_count) || row.retry_count < 0) {
      throw new Error(`Evaluation ${row.id} has invalid retry_count ${String(row.retry_count)}.`);
    }

    if (typeof row.latency_ms !== 'number' || !Number.isInteger(row.latency_ms) || row.latency_ms < 0) {
      throw new Error(`Evaluation ${row.id} is missing latency_ms.`);
    }

    if (row.retry_count > 0) {
      retriedRows += 1;
    }

    if (row.status === 'completed') {
      completedRows += 1;

      if (!isVerdict(row.verdict)) {
        throw new Error(`Completed evaluation ${row.id} is missing a valid verdict.`);
      }

      if (typeof row.reasoning !== 'string' || !row.reasoning.trim()) {
        throw new Error(`Completed evaluation ${row.id} is missing reasoning.`);
      }

      if (typeof row.tokens_used !== 'number' || !Number.isInteger(row.tokens_used) || row.tokens_used < 0) {
        throw new Error(`Completed evaluation ${row.id} is missing tokens_used.`);
      }

      continue;
    }

    if (row.status === 'error') {
      erroredRows += 1;

      if (row.verdict !== null) {
        throw new Error(`Errored evaluation ${row.id} should not persist a verdict.`);
      }

      if (row.reasoning !== null) {
        throw new Error(`Errored evaluation ${row.id} should not persist reasoning.`);
      }

      if (typeof row.error_message !== 'string' || !row.error_message.trim()) {
        throw new Error(`Errored evaluation ${row.id} is missing error_message.`);
      }

      continue;
    }

    throw new Error(`Terminal run ${run.id} still has non-terminal evaluation ${row.id} (${row.status}).`);
  }

  if (run.completed !== completedRows) {
    throw new Error(`Run completed count ${run.completed} did not match persisted rows ${completedRows}.`);
  }

  if (run.errored !== erroredRows) {
    throw new Error(`Run errored count ${run.errored} did not match persisted rows ${erroredRows}.`);
  }

  if (run.completed + run.errored !== expectedTotal) {
    throw new Error(
      `Run counters do not add up: completed=${run.completed}, errored=${run.errored}, total=${expectedTotal}.`
    );
  }

  if (run.status !== 'completed' && run.status !== 'error') {
    throw new Error(`Run ${run.id} finished in unexpected terminal status ${run.status}.`);
  }

  if (run.status === 'error' && erroredRows !== expectedTotal) {
    throw new Error(`Run ${run.id} is marked error but only ${erroredRows} of ${expectedTotal} rows errored.`);
  }

  return { completedRows, erroredRows, retriedRows };
}

async function discoverRunnableQueueId(baseUrl: string, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(fetchImpl, `${baseUrl}/api/queues`, undefined, 'Queue list');
  const queues = parseQueueRows(payload);

  if (queues.length === 0) {
    throw new Error('No queues are available for live verification.');
  }

  const failures: string[] = [];

  for (const queue of queues) {
    try {
      const previewPayload = await readJsonResponse<PreviewResponse>(
        fetchImpl,
        `${baseUrl}/api/queues/${queue.id}/run-preview`,
        undefined,
        `Run preview for queue ${queue.id}`
      );
      const preview = parsePreviewPayload(previewPayload, queue.id);
      if (preview.total > 0) {
        return queue.id;
      }
    } catch (error) {
      failures.push(`${queue.id}: ${error instanceof Error ? error.message : 'preview failed'}`);
    }
  }

  throw new Error(
    `No queue with runnable evaluations was found. ${failures.length ? `Preview failures: ${failures.join(' | ')}` : ''}`
  );
}

async function loadPersistedAudit(runId: string) {
  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    process.env.SUPABASE_SECRET_KEY ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  );

  const [{ data: run, error: runError }, { data: evaluations, error: evaluationError }] = await Promise.all([
    supabase
      .from('evaluation_runs')
      .select('id, status, total, completed, errored')
      .eq('id', runId)
      .single(),
    supabase
      .from('evaluations')
      .select(
        'id, status, verdict, reasoning, prompt_snapshot, model_used, tokens_used, latency_ms, retry_count, error_message'
      )
      .eq('run_id', runId)
      .order('created_at', { ascending: true }),
  ]);

  if (runError || !run) {
    throw new Error(runError?.message ?? `Run ${runId} was not persisted in Supabase.`);
  }

  if (evaluationError) {
    throw new Error(evaluationError.message);
  }

  return {
    run: {
      id: asString(run.id, 'Persisted run id'),
      status: isRunStatus(run.status) ? run.status : (() => {
        throw new Error(`Persisted run ${runId} has invalid status ${String(run.status)}.`);
      })(),
      total: asPositiveInteger(run.total, 'Persisted run total'),
      completed: asPositiveInteger(run.completed, 'Persisted run completed'),
      errored: asPositiveInteger(run.errored, 'Persisted run errored'),
    } satisfies PersistedRunAudit,
    evaluations: (evaluations ?? []).map((row) => ({
      id: asString(row.id, 'Evaluation id'),
      status: isEvalStatus(row.status) ? row.status : (() => {
        throw new Error(`Persisted evaluation ${String(row.id)} has invalid status ${String(row.status)}.`);
      })(),
      verdict: row.verdict == null ? null : isVerdict(row.verdict) ? row.verdict : (() => {
        throw new Error(`Persisted evaluation ${String(row.id)} has invalid verdict ${String(row.verdict)}.`);
      })(),
      reasoning: asNullableString(row.reasoning, `Evaluation ${String(row.id)} reasoning`),
      prompt_snapshot: asNullableString(row.prompt_snapshot, `Evaluation ${String(row.id)} prompt_snapshot`),
      model_used: asNullableString(row.model_used, `Evaluation ${String(row.id)} model_used`),
      tokens_used: row.tokens_used == null ? null : asPositiveInteger(row.tokens_used, `Evaluation ${String(row.id)} tokens_used`),
      latency_ms: row.latency_ms == null ? null : asPositiveInteger(row.latency_ms, `Evaluation ${String(row.id)} latency_ms`),
      retry_count: asPositiveInteger(row.retry_count, `Evaluation ${String(row.id)} retry_count`),
      error_message: asNullableString(row.error_message, `Evaluation ${String(row.id)} error_message`),
    })) satisfies EvaluationAuditRow[],
  };
}

function log(message: string) {
  console.log(`[verify:s01-live] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch
) {
  const queueId = options.queueId ?? await discoverRunnableQueueId(options.baseUrl, fetchImpl);

  log(`Using queue ${queueId}.`);

  const previewPayload = await readJsonResponse<PreviewResponse>(
    fetchImpl,
    `${options.baseUrl}/api/queues/${queueId}/run-preview`,
    undefined,
    'Run preview'
  );
  const preview = parsePreviewPayload(previewPayload, queueId);
  if (preview.total === 0) {
    throw new Error(`Queue ${queueId} preview returned 0 evaluations. Choose a queue with assignments and answers.`);
  }
  log(`Preview reports ${preview.total} evaluations across ${preview.breakdownCount} configured question groups.`);

  const startBeganAt = Date.now();
  const startedPayload = await readJsonResponse<RunStartResponse>(
    fetchImpl,
    `${options.baseUrl}/api/queues/${queueId}/runs`,
    { method: 'POST' },
    'Run start'
  );
  const started = parseRunStartPayload(startedPayload);
  const startLatencyMs = Date.now() - startBeganAt;

  if (started.total !== preview.total) {
    throw new Error(`Run start total ${started.total} did not match preview total ${preview.total}.`);
  }

  log(`POST /runs returned run ${started.runId} in ${startLatencyMs}ms.`);

  const initialProgressPayload = await readJsonResponse<unknown>(
    fetchImpl,
    `${options.baseUrl}/api/queues/${queueId}/runs/${started.runId}`,
    undefined,
    'Immediate run progress'
  );
  const initialProgress = assertRunProgressPayload(initialProgressPayload);
  log(`Immediate run handle is readable: ${summarizeProgress(initialProgress)}.`);

  const { progress, attempts } = await pollRunUntilTerminal({
    baseUrl: options.baseUrl,
    queueId,
    runId: started.runId,
    timeoutMs: options.timeoutMs,
    pollMs: options.pollMs,
    fetchImpl,
  });
  log(`Run reached terminal state after ${attempts} poll(s): ${summarizeProgress(progress)}.`);

  const resultsPayload = await readJsonResponse<ResultsApiResponse>(
    fetchImpl,
    `${options.baseUrl}/api/queues/${queueId}/results?page=1`,
    undefined,
    'Results API'
  );
  const results = assertResultsPayload(resultsPayload);
  log(`Results API is healthy: total=${results.total}, page=${results.page}, pageSize=${results.pageSize}.`);

  const persisted = await loadPersistedAudit(started.runId);
  const auditSummary = assertPersistedAudit({
    run: persisted.run,
    evaluations: persisted.evaluations,
    expectedTotal: started.total,
  });
  log(
    `Persisted audit verified: completed=${auditSummary.completedRows}, errored=${auditSummary.erroredRows}, retried=${auditSummary.retriedRows}.`
  );

  return {
    queueId,
    runId: started.runId,
    previewTotal: preview.total,
    startLatencyMs,
    finalStatus: progress.status,
    completedRows: auditSummary.completedRows,
    erroredRows: auditSummary.erroredRows,
    retriedRows: auditSummary.retriedRows,
  };
}

const isDirectRun = /(^|\/)verify-s01-live\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(
      `OK queue=${summary.queueId} run=${summary.runId} status=${summary.finalStatus} total=${summary.previewTotal}.`
    );
  } catch (error) {
    console.error(`[verify:s01-live] ${error instanceof Error ? error.message : 'Unknown failure.'}`);
    process.exit(1);
  }
}
