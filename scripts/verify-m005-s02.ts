import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { loadFixture } from './verify-s02-live';
import { selectProofSubmission } from './verify-m005-s01';
import { ensureLocalAppReady } from './verify-m004-s01';
import {
  DEFAULT_PROMPT_FIELDS,
  parseQueueAssignmentList,
  parseQueueQuestionList,
} from '../src/lib/assignments/queue-assignment-state';

const execFileAsync = promisify(execFile);
type FetchLike = typeof fetch;

type PhaseName =
  | 'local-app'
  | 'fixture'
  | 'schema-readiness'
  | 'attachment-target'
  | 'judge-lifecycle'
  | 'assignment-persistence'
  | 'question-hydration';

type PhaseRefs = {
  queueId?: string;
  queueLabel?: string;
  questionId?: string;
  questionExternalId?: string;
  submissionExternalId?: string;
  judgeId?: string;
  assignmentId?: string;
  detailUrl?: string;
  detailApiUrl?: string;
  endpoint?: string;
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

function formatPhaseRefs(refs: PhaseRefs) {
  const entries = Object.entries(refs).filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!entries.length) {
    return '';
  }

  return ` ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

function formatPhaseMessage(phase: PhaseName, message: string, refs: PhaseRefs) {
  return `[verify:m005-s02] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

const DEFAULT_FIXTURE_PATH = 'scripts/verify-m005-s01.fixture.json';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_POLL_MS = 500;
const REQUIRED_TABLES = ['queues', 'question_templates', 'submissions', 'judge_assignments'] as const;
const FORWARDING_STATES = [false, true, false] as const;

type QueueRow = {
  id: string;
  queue_id: string;
  created_at: string;
};

type QuestionRow = {
  id: string;
  queue_id: string;
  external_id: string;
  question_text: string;
  question_type: string | null;
  created_at: string;
};

type SubmissionRow = {
  id: string;
  queue_id: string;
  external_id: string;
  created_at: string;
};

export type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
  startupTimeoutMs: number;
  probeTimeoutMs: number;
  pollMs: number;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  questionId: string;
  questionExternalId: string;
  questionText: string;
  submissionId: string;
  submissionExternalId: string;
  judgeId: string;
  judgeName: string;
  assignmentId: string;
  assignPageUrl: string;
  assignmentsApiUrl: string;
  detailUrl: string;
  detailApiUrl: string;
  forwardingStates: typeof FORWARDING_STATES;
  autoStartedLocalApp: boolean;
};

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

export function parseVerifierOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): VerifierOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      fixture: { type: 'string' },
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
    fixturePath: parsed.values.fixture ?? env.M005_S02_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.M005_S02_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    startupTimeoutMs: integerArg(
      parsed.values['startup-timeout-ms'] ?? env.M005_S02_VERIFY_STARTUP_TIMEOUT_MS,
      DEFAULT_STARTUP_TIMEOUT_MS,
      '--startup-timeout-ms'
    ),
    probeTimeoutMs: integerArg(
      parsed.values['probe-timeout-ms'] ?? env.M005_S02_VERIFY_PROBE_TIMEOUT_MS,
      DEFAULT_PROBE_TIMEOUT_MS,
      '--probe-timeout-ms'
    ),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.M005_S02_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
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
    throw new VerifierPhaseError(
      phase,
      `${label} returned a non-JSON response (${response.status}).`,
      refs,
      error
    );
  }

  if (!response.ok) {
    const detail = isObject(payload)
      ? [payload.error, payload.detail]
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new Error(`${fieldName} must be a non-empty string.`);
}

function asBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
  }

  throw new Error(`${fieldName} must be a boolean.`);
}

async function maybeReadLocalSupabaseEnv(baseUrl: string) {
  if (!isLocalBaseUrl(baseUrl)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('bunx', ['supabase', 'status', '-o', 'env']);
    const envMap = new Map<string, string>();

    for (const line of stdout.split(/\r?\n/)) {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex);
      const value = stripOptionalQuotes(line.slice(separatorIndex + 1));
      envMap.set(key, value);
    }

    const url = envMap.get('API_URL');
    const secret = envMap.get('SECRET_KEY') ?? envMap.get('SERVICE_ROLE_KEY');

    if (!url || !secret) {
      return null;
    }

    return { url, secret };
  } catch {
    return null;
  }
}

function stripOptionalQuotes(value: string) {
  return value.replace(/^"|"$/g, '');
}

function isLocalBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function createSupabaseServiceClient(baseUrl: string) {
  const localEnv = await maybeReadLocalSupabaseEnv(baseUrl);
  const url = localEnv?.url ?? requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const secret =
    localEnv?.secret ?? process.env.SUPABASE_SECRET_KEY ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, secret);
}

async function checkTableReadable(
  supabase: SupabaseClient,
  table: (typeof REQUIRED_TABLES)[number],
  phase: PhaseName,
  refs: PhaseRefs
) {
  const { error } = await supabase.from(table).select('id').limit(1);
  if (error) {
    throw new VerifierPhaseError(phase, `Supabase table ${table} is not readable: ${error.message}`, refs);
  }
}

async function findAttachmentTarget(
  supabase: SupabaseClient,
  queueLabel: string,
  questionExternalId: string,
  submissionExternalId: string
) {
  const queueRefs: PhaseRefs = { queueLabel };
  const { data: queueRow, error: queueError } = await supabase
    .from('queues')
    .select('id, queue_id, created_at')
    .eq('queue_id', queueLabel)
    .maybeSingle();

  if (queueError || !queueRow) {
    throw new Error(queueError?.message ?? `Queue ${queueLabel} was not persisted.`);
  }

  const questionRefs: PhaseRefs = { ...queueRefs, queueId: queueRow.id, questionExternalId };
  const { data: questionRow, error: questionError } = await supabase
    .from('question_templates')
    .select('id, queue_id, external_id, question_text, question_type, created_at')
    .eq('queue_id', queueRow.id)
    .eq('external_id', questionExternalId)
    .maybeSingle();

  if (questionError || !questionRow) {
    throw new Error(
      questionError?.message ?? `Question ${questionExternalId} was not persisted for queue ${queueLabel}.`
    );
  }

  const submissionRefs: PhaseRefs = { ...questionRefs, submissionExternalId };
  const { data: submissionRow, error: submissionError } = await supabase
    .from('submissions')
    .select('id, queue_id, external_id, created_at')
    .eq('queue_id', queueRow.id)
    .eq('external_id', submissionExternalId)
    .maybeSingle();

  if (submissionError || !submissionRow) {
    throw new Error(
      submissionError?.message ??
        `Submission ${submissionExternalId} was not persisted for queue ${queueLabel}.`
    );
  }

  return {
    queue: queueRow as QueueRow,
    question: questionRow as QuestionRow,
    submission: submissionRow as SubmissionRow,
  };
}

function sanitizeQueueLabel(queueLabel: string) {
  return queueLabel.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

async function createVerifierJudge(
  baseUrl: string,
  queueLabel: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const judgeName = `verify:m005-s02 ${sanitizeQueueLabel(queueLabel)}`;
  const payload = {
    name: judgeName,
    system_prompt: `Live verifier judge for ${queueLabel}.`,
    model: 'verifier/m005-s02',
    active: true,
  };

  const response = await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Create verifier judge',
    'judge-lifecycle',
    { queueLabel },
    timeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  return {
    id: asNonEmptyString(response.id, 'Judge id'),
    name: asNonEmptyString(response.name, 'Judge name'),
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
  const url = `${baseUrl}/api/queues/${queueId}/assignments`;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_template_id: questionId, judge_id: judgeId }),
      signal: buildTimeoutSignal(timeoutMs),
    });
  } catch (error) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Delete assignment request failed: ${safeMessage(error)}`,
      { queueId, questionId, judgeId },
      error
    );
  }

  if (response.status === 204) {
    return;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Delete assignment returned a non-JSON response (${response.status}).`,
        { queueId, questionId, judgeId }
      );
    }
  }

  if (!response.ok) {
    const detail = isObject(payload) && typeof payload.error === 'string' ? payload.error : response.statusText;
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Delete assignment failed (${response.status}): ${detail || 'request failed'}`,
      { queueId, questionId, judgeId }
    );
  }
}

export function assertAssignmentResponse(payload: unknown) {
  if (!isObject(payload)) {
    throw new Error('Assignment response was not an object.');
  }

  const forwardingValue = payload.attachment_forwarding;

  return {
    id: asNonEmptyString(payload.id, 'Assignment id'),
    queue_id: asNonEmptyString(payload.queue_id, 'Assignment queue_id'),
    question_template_id: asNonEmptyString(
      payload.question_template_id,
      'Assignment question_template_id'
    ),
    judge_id: asNonEmptyString(payload.judge_id, 'Assignment judge_id'),
    attachment_forwarding:
      forwardingValue == null
        ? false
        : asBoolean(forwardingValue, 'Assignment attachment_forwarding'),
  };
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
  const url = `${baseUrl}/api/queues/${queueId}/assignments`;
  const response = await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    url,
    'Create assignment',
    'assignment-persistence',
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

  return assertAssignmentResponse(response);
}

async function fetchAssignments(
  baseUrl: string,
  queueId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/assignments`,
    'Queue assignments',
    'assignment-persistence',
    { queueId, endpoint: `/api/queues/${queueId}/assignments` },
    timeoutMs
  );

  try {
    return parseQueueAssignmentList(payload, {
      context: `/api/queues/${queueId}/assignments response`,
      requireQuestion: true,
    });
  } catch (error) {
    throw new VerifierPhaseError('assignment-persistence', safeMessage(error), { queueId }, error);
  }
}

async function fetchQuestions(
  baseUrl: string,
  queueId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/questions`,
    'Queue questions',
    'question-hydration',
    { queueId, endpoint: `/api/queues/${queueId}/questions` },
    timeoutMs
  );

  try {
    return parseQueueQuestionList(payload, `/api/queues/${queueId}/questions response`);
  } catch (error) {
    throw new VerifierPhaseError('question-hydration', safeMessage(error), { queueId }, error);
  }
}

async function verifyAssignmentSurfaces(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  expectedForwarding: boolean,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const [assignments, questions] = await Promise.all([
    fetchAssignments(baseUrl, queueId, timeoutMs, fetchImpl),
    fetchQuestions(baseUrl, queueId, timeoutMs, fetchImpl),
  ]);

  const assignment = assignments.find(
    (row) => row.question_template_id === questionId && row.judge_id === judgeId
  );

  if (!assignment) {
    throw new Error('Assignment was missing from the queue assignments surface.');
  }

  if (assignment.attachment_forwarding !== expectedForwarding) {
    throw new Error(
      `Assignment forwarding state was ${assignment.attachment_forwarding} instead of ${expectedForwarding}.`
    );
  }

  const question = questions.find((row) => row.id === questionId);
  const questionAssignment = question?.assignments.find((row) => row.judge_id === judgeId);

  if (!question || !questionAssignment) {
    throw new Error('Assignment was missing from the hydrated question surface.');
  }

  if (questionAssignment.attachment_forwarding !== expectedForwarding) {
    throw new Error(
      `Hydrated question assignment forwarding was ${questionAssignment.attachment_forwarding} instead of ${expectedForwarding}.`
    );
  }

  return assignment;
}

async function performForwardingCycle(
  options: VerifierOptions,
  fetchImpl: FetchLike,
  queueId: string,
  questionId: string,
  judgeId: string
) {
  let assignmentId: string | null = null;

  for (const state of FORWARDING_STATES) {
    const assignment = await postAssignment(
      options.baseUrl,
      queueId,
      questionId,
      judgeId,
      state,
      options.timeoutMs,
      fetchImpl
    );

    if (!assignmentId) {
      assignmentId = assignment.id;
    } else if (assignmentId !== assignment.id) {
      throw new Error('Assignment id changed across the forwarding cycle.');
    }

    await verifyAssignmentSurfaces(
      options.baseUrl,
      queueId,
      questionId,
      judgeId,
      state,
      options.timeoutMs,
      fetchImpl
    );
  }

  return { assignmentId: assignmentId ?? '', forwardingStates: FORWARDING_STATES };
}

export function formatProofSummary(summary: LiveVerificationSummary) {
  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `question=${summary.questionId}`,
    `questionExternalId=${summary.questionExternalId}`,
    `submission=${summary.submissionId}`,
    `submissionExternalId=${summary.submissionExternalId}`,
    `judge=${summary.judgeId}`,
    `assignment=${summary.assignmentId}`,
    `forwarding=${summary.forwardingStates.join('/')}`,
    `assignPage=${summary.assignPageUrl}`,
    `assignmentsApi=${summary.assignmentsApiUrl}`,
    `detailUrl=${summary.detailUrl}`,
    `detailApiUrl=${summary.detailApiUrl}`,
  ].join(' ');
}

function log(message: string) {
  console.log(`[verify:m005-s02] ${message}`);
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch
): Promise<LiveVerificationSummary> {
  let keepLocalAppAlive = false;
  const localAppGuard = await runPhase('local-app', { endpoint: '/api/queues' }, () =>
    ensureLocalAppReady({
      baseUrl: options.baseUrl,
      startupTimeoutMs: options.startupTimeoutMs,
      probeTimeoutMs: options.probeTimeoutMs,
      pollMs: options.pollMs,
    })
  );

  try {
    const fixtureItems = await runPhase('fixture', { endpoint: options.fixturePath }, () =>
      loadFixture(options.fixturePath)
    );

    const proofTarget = selectProofSubmission(fixtureItems, options.baseUrl);
    const proofSubmission = fixtureItems.find((item) => item.id === proofTarget.submissionExternalId);

    if (!proofSubmission) {
      throw new Error('Proof fixture submission could not be located.');
    }

    const proofQuestion = proofSubmission.questions?.[0]?.data;

    if (!proofQuestion) {
      throw new Error('Proof fixture must include a question.');
    }

    const supabase = await runPhase('schema-readiness', { endpoint: '/api/queues' }, () =>
      createSupabaseServiceClient(options.baseUrl)
    );

    for (const table of REQUIRED_TABLES) {
      await runPhase('schema-readiness', { endpoint: table }, () =>
        checkTableReadable(supabase, table, 'schema-readiness', { endpoint: table })
      );
    }

    const target = await runPhase(
      'attachment-target',
      { queueLabel: proofTarget.queueLabel, questionExternalId: proofQuestion.id },
      async () =>
        findAttachmentTarget(
          supabase,
          proofTarget.queueLabel,
          proofQuestion.id,
          proofTarget.submissionExternalId
        )
    );

    const judge = await runPhase(
      'judge-lifecycle',
      {
        queueLabel: target.queue.queue_id,
        queueId: target.queue.id,
      },
      () =>
        createVerifierJudge(
          options.baseUrl,
          target.queue.queue_id,
          options.timeoutMs,
          fetchImpl
        )
    );

    await runPhase(
      'assignment-persistence',
      { queueId: target.queue.id, questionId: target.question.id, judgeId: judge.id },
      () =>
        deleteAssignment(
          options.baseUrl,
          target.queue.id,
          target.question.id,
          judge.id,
          options.timeoutMs,
          fetchImpl
        )
    );

    const cycle = await runPhase(
      'assignment-persistence',
      { queueId: target.queue.id, questionId: target.question.id, judgeId: judge.id },
      () => performForwardingCycle(options, fetchImpl, target.queue.id, target.question.id, judge.id)
    );

    const summary: LiveVerificationSummary = {
      queueId: target.queue.id,
      queueLabel: target.queue.queue_id,
      questionId: target.question.id,
      questionExternalId: target.question.external_id,
      questionText: target.question.question_text,
      submissionId: target.submission.id,
      submissionExternalId: target.submission.external_id,
      judgeId: judge.id,
      judgeName: judge.name,
      assignmentId: cycle.assignmentId,
      assignPageUrl: `${options.baseUrl}/queues/${target.queue.queue_id}/assign`,
      assignmentsApiUrl: `${options.baseUrl}/api/queues/${target.queue.id}/assignments`,
      detailUrl: `${options.baseUrl}/queues/${target.queue.queue_id}/submissions/${target.submission.external_id}`,
      detailApiUrl: `${options.baseUrl}/api/queues/${target.queue.id}/submissions/${target.submission.id}`,
      forwardingStates: cycle.forwardingStates,
      autoStartedLocalApp: localAppGuard.autoStarted,
    };

    keepLocalAppAlive = true;
    localAppGuard.keepAlive();

    return summary;
  } finally {
    if (!keepLocalAppAlive) {
      localAppGuard.stop();
    }
  }
}

const isDirectRun = /(^|\/)verify-m005-s02\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatProofSummary(summary)}`);
    log(
      `Browser targets: assign=${summary.assignPageUrl} detail=${summary.detailUrl} assignmentsApi=${summary.assignmentsApiUrl}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : `[verify:m005-s02] ${safeMessage(error)}`);
    process.exit(1);
  }
}
