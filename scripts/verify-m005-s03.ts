import { parseArgs } from 'node:util';
import { ensureLocalAppReady } from './verify-m004-s01';
import { loadFixture } from './verify-s02-live';
import { selectProofSubmission } from './verify-m005-s01';
import { DEFAULT_PROMPT_FIELDS } from '../src/lib/assignments/queue-assignment-state';
import type { EvalStatusEnum } from '../src/types/db';
import type { ResultsResponse } from '../src/types/api';

type FetchLike = typeof fetch;

type ScenarioName = 'text-only' | 'multimodal' | 'blocked';

type ScenarioConfig = {
  name: ScenarioName;
  judgeSuffix: string;
  model: string;
  forwarding: boolean;
  expectedPlan: 'text-only' | 'multimodal' | 'blocked';
};

type ScenarioResult = {
  scenario: ScenarioName;
  evaluationId: string;
  judgeId: string;
  judgeName: string;
  status: EvalStatusEnum;
  promptSnapshot: string;
  modelUsed: string;
  errorMessage: string | null;
};

type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  questionId: string;
  questionExternalId: string;
  submissionId: string;
  submissionExternalId: string;
  runId: string;
  evaluationSummaries: ScenarioResult[];
  resultsUrl: string;
};

type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
  pollMs: number;
};

type PhaseName =
  | 'local-app'
  | 'fixture'
  | 'upload'
  | 'queue-discovery'
  | 'submission-fetch'
  | 'question-fetch'
  | 'judge-setup'
  | 'assignment-setup'
  | 'run-start'
  | 'results-poll'
  | 'summary';

type PhaseRefs = {
  queueId?: string;
  queueLabel?: string;
  submissionId?: string;
  submissionExternalId?: string;
  questionId?: string;
  questionExternalId?: string;
  runId?: string;
  judgeId?: string;
  scenario?: ScenarioName;
  endpoint?: string;
};

const DEFAULT_FIXTURE_PATH = 'scripts/verify-m005-s01.fixture.json';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_MS = 1_000;
const SCENARIO_CONFIGS: ScenarioConfig[] = [
  {
    name: 'text-only',
    judgeSuffix: 'text-only',
    model: 'verifier/m005-s03-text',
    forwarding: false,
    expectedPlan: 'text-only',
  },
  {
    name: 'multimodal',
    judgeSuffix: 'multimodal',
    model: 'gateway/multimodal-model',
    forwarding: true,
    expectedPlan: 'multimodal',
  },
  {
    name: 'blocked',
    judgeSuffix: 'blocked-model',
    model: 'openai/gpt-4o-mini',
    forwarding: true,
    expectedPlan: 'blocked',
  },
];

const RESULTS_PAGE_SIZE = 25;

class VerifierPhaseError extends Error {
  readonly phase: PhaseName;
  readonly refs: PhaseRefs;

  constructor(phase: PhaseName, message: string, refs: PhaseRefs = {}, cause?: unknown) {
    super(formatPhaseMessage(phase, message, refs), cause ? { cause } : undefined);
    this.name = 'VerifierPhaseError';
    this.phase = phase;
    this.refs = refs;
  }
}

function formatPhaseRefs(refs: PhaseRefs) {
  const entries = Object.entries(refs).filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!entries.length) {
    return '';
  }

  return ` ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

function formatPhaseMessage(phase: PhaseName, message: string, refs: PhaseRefs) {
  return `[verify:m005-s03] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
}

async function runPhase<T>(phase: PhaseName, refs: PhaseRefs, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VerifierPhaseError) {
      throw error;
    }

    throw new VerifierPhaseError(phase, safeMessage(error), refs, error);
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

function log(message: string) {
  console.log(`[verify:m005-s03] ${message}`);
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
    fixturePath: parsed.values.fixture ?? env.M005_S03_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.M005_S03_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.M005_S03_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

function buildTimeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
  return controller.signal;
}

async function readJsonResponse<T>(
  fetchImpl: FetchLike,
  url: string,
  label: string,
  phase: PhaseName,
  refs: PhaseRefs,
  timeoutMs: number,
  init?: RequestInit
): Promise<T> {
  let response: Response;

  try {
    response = await fetchImpl(url, { ...init, signal: buildTimeoutSignal(timeoutMs) });
  } catch (error) {
    throw new VerifierPhaseError(phase, `${label} request failed: ${safeMessage(error)}`, refs, error);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new VerifierPhaseError(phase, `${label} returned a non-JSON response (${response.status}).`, refs, error);
  }

  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null
      ? [(payload as Record<string, unknown>).error, (payload as Record<string, unknown>).detail]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' ')
      : '';

    throw new VerifierPhaseError(
      phase,
      `${label} failed (${response.status}): ${detail || response.statusText || 'request failed'}`,
      refs
    );
  }

  return payload as T;
}

function formatVerifierSummary(summary: LiveVerificationSummary): string {
  const evaluationCoords = summary.evaluationSummaries
    .map((result) => `${result.scenario}=${result.evaluationId}`)
    .join(',');

  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `run=${summary.runId}`,
    `question=${summary.questionId}`,
    `questionExternalId=${summary.questionExternalId}`,
    `submission=${summary.submissionId}`,
    `submissionExternalId=${summary.submissionExternalId}`,
    `evaluations=${evaluationCoords}`,
    `resultsUrl=${summary.resultsUrl}`,
  ].join(' ');
}

async function uploadFixture(
  options: VerifierOptions,
  fixtureItems: unknown[],
  fetchImpl: FetchLike
): Promise<void> {
  const fixturePath = options.fixturePath.split('/').pop() ?? 'verify-m005-s01.fixture.json';
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(fixtureItems)], { type: 'application/json' }), fixturePath);

  await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    `${options.baseUrl}/api/upload`,
    'Upload',
    'upload',
    { endpoint: '/api/upload' },
    options.timeoutMs,
    { method: 'POST', body: form }
  );
}

async function fetchQueueRow(baseUrl: string, queueLabel: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues`,
    'Queue list',
    'queue-discovery',
    { queueLabel, endpoint: '/api/queues' },
    timeoutMs
  );

  if (!Array.isArray(payload)) {
    throw new Error('Queue list response was not an array.');
  }

  const queue = payload.find((row) => typeof row === 'object' && row !== null && (row as Record<string, unknown>).queue_id === queueLabel);

  if (!queue) {
    throw new Error(`Queue ${queueLabel} was not found after upload.`);
  }

  const record = queue as Record<string, unknown>;
  const id = record.id;

  if (typeof id !== 'string' || !id) {
    throw new Error(`Queue ${queueLabel} returned an invalid id.`);
  }

  return { id, queueLabel };
}

async function fetchSubmissionId(baseUrl: string, queueId: string, submissionExternalId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/submissions`,
    'Queue submissions',
    'submission-fetch',
    { queueId, submissionExternalId, endpoint: `/api/queues/${queueId}/submissions` },
    timeoutMs
  );

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Queue submissions response was not an object.');
  }

  const submissions = (payload as Record<string, unknown>).submissions;
  if (!Array.isArray(submissions)) {
    throw new Error('Queue submissions response missing submissions array.');
  }

  const submission = submissions.find((item) =>
    typeof item === 'object' &&
    item !== null &&
    (item as Record<string, unknown>).external_id === submissionExternalId
  );

  if (!submission) {
    throw new Error(`Submission ${submissionExternalId} was not found for queue ${queueId}.`);
  }

  const record = submission as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== 'string' || !id) {
    throw new Error(`Submission ${submissionExternalId} returned an invalid id.`);
  }

  return id;
}

async function fetchQuestionId(baseUrl: string, queueId: string, questionExternalId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/questions`,
    'Queue questions',
    'question-fetch',
    { queueId, questionExternalId, endpoint: `/api/queues/${queueId}/questions` },
    timeoutMs
  );

  if (!Array.isArray(payload)) {
    throw new Error('Queue questions response was not an array.');
  }

  const question = payload.find((row) =>
    typeof row === 'object' && row !== null && (row as Record<string, unknown>).external_id === questionExternalId
  );

  if (!question) {
    throw new Error(`Question ${questionExternalId} was not found for queue ${queueId}.`);
  }

  const id = (question as Record<string, unknown>).id;
  if (typeof id !== 'string' || !id) {
    throw new Error(`Question ${questionExternalId} returned an invalid id.`);
  }

  return id;
}

async function createJudge(
  baseUrl: string,
  name: string,
  model: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Create judge',
    'judge-setup',
    { endpoint: '/api/judges' },
    timeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        system_prompt: `Live verifier judge for ${name}.`,
        model,
        active: true,
      }),
    }
  );

  if (typeof payload.id !== 'string' || !payload.id) {
    throw new Error('Created judge missing id.');
  }

  return {
    id: payload.id,
    name: payload.name,
  };
}

async function deleteAssignment(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const response = await fetchImpl(`${baseUrl}/api/queues/${queueId}/assignments`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    signal: buildTimeoutSignal(timeoutMs),
    body: JSON.stringify({ judge_id: judgeId, question_template_id: questionId }),
  });

  if (response.status === 204) {
    return;
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new VerifierPhaseError('assignment-setup', `Delete assignment returned a non-JSON response (${response.status}).`, {
        queueId,
        questionId,
        judgeId,
      });
    }
  }

  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
      ? (payload as Record<string, unknown>).error
      : response.statusText;

    throw new VerifierPhaseError(
      'assignment-setup',
      `Delete assignment failed (${response.status}): ${detail || 'request failed'}`,
      { queueId, questionId, judgeId }
    );
  }
}

async function postAssignment(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  forwarding: boolean,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/assignments`,
    'Create assignment',
    'assignment-setup',
    { queueId, questionId, judgeId, endpoint: `/api/queues/${queueId}/assignments` },
    timeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        judge_id: judgeId,
        question_template_id: questionId,
        prompt_fields: DEFAULT_PROMPT_FIELDS,
        attachment_forwarding: forwarding,
      }),
    }
  );

  if (typeof payload.id !== 'string' || !payload.id) {
    throw new Error('Assignment response missing id.');
  }
}

async function startRun(baseUrl: string, queueId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/runs`,
    'Start run',
    'run-start',
    { queueId, endpoint: `/api/queues/${queueId}/runs` },
    timeoutMs,
    { method: 'POST' }
  );

  if (typeof payload.runId !== 'string' || !payload.runId) {
    throw new Error('Run start response missing runId.');
  }

  return payload.runId;
}

async function fetchResults(
  baseUrl: string,
  queueId: string,
  questionId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<ResultsResponse> {
  const url = new URL(`${baseUrl}/api/queues/${queueId}/results`);
  url.searchParams.set('questionId', questionId);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', RESULTS_PAGE_SIZE.toString());

  return readJsonResponse<ResultsResponse>(
    fetchImpl,
    url.toString(),
    'Results',
    'results-poll',
    { queueId, questionId, endpoint: `/api/queues/${queueId}/results` },
    timeoutMs
  );
}

function assertPromptSnapshot(plan: string, promptSnapshot: string) {
  if (!promptSnapshot.includes(`Forwarding requested: ${plan === 'text-only' ? 'no' : 'yes'}`)) {
    throw new Error(`Prompt snapshot did not declare forwarding requested for plan ${plan}.`);
  }

  if (!promptSnapshot.includes(`Plan: ${plan}`)) {
    throw new Error(`Prompt snapshot did not include expected plan ${plan}.`);
  }
}

async function pollForScenarios(
  options: VerifierOptions,
  queueId: string,
  questionId: string,
  submissionExternalId: string,
  scenarioMap: Map<ScenarioName, { judgeId: string; judgeName: string }>,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<ScenarioResult[]> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set<ScenarioName>(scenarioMap.keys());
  const latest: Partial<Record<ScenarioName, ScenarioResult>> = {};

  while (Date.now() < deadline) {
    const results = await fetchResults(baseUrlFromOptions(options), queueId, questionId, timeoutMs, fetchImpl);
    for (const evaluation of results.evaluations) {
      const scenarioEntry = [...scenarioMap.entries()].find(([, info]) => info.judgeId === evaluation.judge.id);
      if (!scenarioEntry) continue;

      const [scenario, info] = scenarioEntry;
      if (evaluation.submission.external_id !== submissionExternalId) continue;
      if (evaluation.question.id !== questionId) continue;

      const promptSnapshot = evaluation.prompt_snapshot;
      if (!promptSnapshot) continue;

      const result: ScenarioResult = {
        scenario,
        evaluationId: evaluation.id,
        judgeId: info.judgeId,
        judgeName: info.judgeName,
        status: evaluation.status,
        promptSnapshot,
        modelUsed: evaluation.model_used ?? '',
        errorMessage: evaluation.error_message,
      };

      latest[scenario] = result;
      pending.delete(scenario);
    }

    if (pending.size === 0) {
      break;
    }

    await wait(options.pollMs);
  }

  if (pending.size > 0) {
    throw new Error('Timed out waiting for all evaluation scenarios.');
  }

  return SCENARIO_CONFIGS.map((config) => {
    const result = latest[config.name];
    if (!result) {
      throw new Error(`Missing evaluation for scenario ${config.name}.`);
    }

    assertPromptSnapshot(config.expectedPlan, result.promptSnapshot);

    if (!result.modelUsed) {
      throw new Error(`Evaluation ${result.evaluationId} did not persist model_used.`);
    }

    if (config.expectedPlan === 'blocked' && !result.errorMessage) {
      throw new Error(`Blocked scenario ${result.evaluationId} did not record an error message.`);
    }

    return result;
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrlFromOptions(options: VerifierOptions) {
  return options.baseUrl;
}

export async function runLiveVerification(options: VerifierOptions, fetchImpl: FetchLike = fetch): Promise<LiveVerificationSummary> {
  const localAppGuard = await runPhase('local-app', { endpoint: '/api/queues' }, () =>
    ensureLocalAppReady({
      baseUrl: options.baseUrl,
      fetchImpl,
      startupTimeoutMs: options.timeoutMs,
      probeTimeoutMs: options.pollMs,
      pollMs: options.pollMs,
    })
  );

  let keepAppAlive = false;

  try {
    const fixtureItems = await runPhase('fixture', { endpoint: options.fixturePath }, () =>
      loadFixture(options.fixturePath)
    );

    const proofTarget = selectProofSubmission(fixtureItems, options.baseUrl);
    const queueLabel = proofTarget.queueLabel;
    const questionExternalId = fixtureItems[0].questions?.[0]?.data.id;
    if (!questionExternalId) {
      throw new Error('Fixture submission missing question external id.');
    }

    await runPhase('upload', { endpoint: '/api/upload' }, () =>
      uploadFixture(options, fixtureItems, fetchImpl)
    );

    const queueRow = await runPhase('queue-discovery', { queueLabel }, () =>
      fetchQueueRow(options.baseUrl, queueLabel, options.timeoutMs, fetchImpl)
    );

    const questionId = await runPhase('question-fetch', { queueId: queueRow.id, questionExternalId }, () =>
      fetchQuestionId(options.baseUrl, queueRow.id, questionExternalId, options.timeoutMs, fetchImpl)
    );

    const submissionId = await runPhase('submission-fetch', { queueId: queueRow.id, submissionExternalId: proofTarget.submissionExternalId }, () =>
      fetchSubmissionId(options.baseUrl, queueRow.id, proofTarget.submissionExternalId, options.timeoutMs, fetchImpl)
    );

    const scenarioMap = new Map<ScenarioName, { judgeId: string; judgeName: string }>();

    for (const config of SCENARIO_CONFIGS) {
      const judgeName = `verify:m005-s03 ${config.judgeSuffix} ${Date.now()}`;
      const judge = await runPhase('judge-setup', { queueLabel, scenario: config.name }, () =>
        createJudge(options.baseUrl, judgeName, config.model, options.timeoutMs, fetchImpl)
      );

      await runPhase('assignment-setup', { queueId: queueRow.id, questionId, judgeId: judge.id, scenario: config.name }, () =>
        deleteAssignment(options.baseUrl, queueRow.id, questionId, judge.id, options.timeoutMs, fetchImpl)
          .then(() => postAssignment(options.baseUrl, queueRow.id, questionId, judge.id, config.forwarding, options.timeoutMs, fetchImpl))
      );

      scenarioMap.set(config.name, { judgeId: judge.id, judgeName: judge.name });
    }

    const runId = await runPhase('run-start', { queueId: queueRow.id }, () =>
      startRun(options.baseUrl, queueRow.id, options.timeoutMs, fetchImpl)
    );

    const evaluationSummaries = await runPhase(
      'results-poll',
      { queueId: queueRow.id, runId },
      () => pollForScenarios(options, queueRow.id, questionId, proofTarget.submissionExternalId, scenarioMap, options.timeoutMs, fetchImpl)
    );

    keepAppAlive = true;
    localAppGuard.keepAlive();

    const summary: LiveVerificationSummary = {
      queueId: queueRow.id,
      queueLabel: queueLabel,
      questionId,
      questionExternalId,
      submissionId,
      submissionExternalId: proofTarget.submissionExternalId,
      runId,
      evaluationSummaries,
      resultsUrl: `${options.baseUrl}/queues/${queueRow.queueLabel ?? queueRow.id}/results`,
    };

    log(`OK ${formatVerifierSummary(summary)}`);
    log(`Ingress proof: queue=${summary.queueId} submission=${summary.submissionId} run=${summary.runId}`);

    return summary;
  } finally {
    if (!keepAppAlive) {
      localAppGuard.stop();
    }
  }
}

export { runPhase, formatVerifierSummary, LiveVerificationSummary, ScenarioResult, VerifierPhaseError };

const isDirectRun = /(^|\/)verify-m005-s03\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    await runLiveVerification(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : `[verify:m005-s03] ${safeMessage(error)}`);
    process.exit(1);
  }
}
