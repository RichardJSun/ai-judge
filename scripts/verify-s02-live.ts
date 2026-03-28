import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { parseQueueAssignmentList, parseQueueQuestionList, type QueueAssignmentRecord } from '../src/lib/assignments/queue-assignment-state';
import { parseJudgeList, parseJudgeRecord, type JudgeLifecycleAction } from '../src/lib/judges/judge-lifecycle';
import { SubmissionFileSchema, type ValidatedSubmission } from '../src/lib/validators/upload';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;

type PhaseName =
  | 'schema-readiness'
  | 'upload'
  | 'judge-lifecycle'
  | 'assignment-persistence'
  | 'inactive-run-filtering'
  | 'browser-confirmation';

type PhaseRefs = {
  queueId?: string;
  queueLabel?: string;
  judgeId?: string;
  assignmentId?: string;
  questionId?: string;
  page?: string;
  endpoint?: string;
};

type QueueRow = {
  id: string;
  queue_id: string;
  created_at: string;
  submission_count: number | undefined;
  question_count: number | undefined;
};

type PersistedQuestion = {
  id: string;
  queue_id: string;
  external_id: string;
  question_text: string;
  question_type: string | null;
  created_at: string;
};

type RawJudge = {
  id: string;
  name: string;
  system_prompt: string;
  model: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type UploadResult = {
  queues: number;
  submissions: number;
  questions: number;
  answers: number;
};

type RunPreview = {
  total: number;
  inactiveAssignmentCount: number;
  breakdown: Array<{
    questionText: string;
    judgeCount: number;
    excludedInactiveJudgeCount?: number;
  }>;
};

type PersistedAssignmentRow = {
  id: string;
  queue_id: string;
  question_template_id: string;
  judge_id: string;
  prompt_fields: string[];
  attachment_forwarding: boolean;
  created_at: string | null;
};

type FixtureSummary = UploadResult & {
  queueIds: string[];
};

type FixtureTarget = {
  queueLabel: string;
  questionExternalId: string;
};

type PreviewDeltaProof = {
  baseline: Pick<RunPreview, 'total' | 'inactiveAssignmentCount'>;
  active: Pick<RunPreview, 'total' | 'inactiveAssignmentCount'>;
  inactive: Pick<RunPreview, 'total' | 'inactiveAssignmentCount'>;
  reactivated: Pick<RunPreview, 'total' | 'inactiveAssignmentCount'>;
  answerCount: number;
  activeAssignmentId: string;
  inactiveAssignmentId: string;
  reactivatedAssignmentId: string;
};

export type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  questionId: string;
  questionExternalId: string;
  questionText: string;
  answerCount: number;
  judgeId: string;
  judgeName: string;
  judgeAction: 'created' | 'reused';
  editAction: JudgeLifecycleAction;
  assignmentId: string;
  previewTotals: {
    baseline: number;
    active: number;
    inactive: number;
    reactivated: number;
  };
  pageUrls: {
    queues: string;
    judges: string;
    assign: string;
  };
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

const DEFAULT_FIXTURE_PATH = 'scripts/verify-s02-live.fixture.json';
const DEFAULT_TIMEOUT_MS = 15_000;
const REQUIRED_TABLES = [
  'queues',
  'question_templates',
  'submissions',
  'submission_answers',
  'judges',
  'judge_assignments',
] as const;
const VERIFIER_MODEL = 'verifier/s02-live';
const VERIFIER_PROMPT_FIELDS = ['questionText', 'answer', 'questionType'] as const;
const execFileAsync = promisify(execFile);

function isLocalBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function stripOptionalQuotes(value: string) {
  return value.replace(/^"|"$/g, '');
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

function baseUrlFromInput(rawUrl: string | undefined) {
  if (!rawUrl?.trim()) {
    throw new Error('--base-url is required.');
  }

  return rawUrl.replace(/\/$/, '');
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

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonNegativeInteger(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return value;
}

function asNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function asBoolean(value: unknown, fieldName: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
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
  const orderedEntries = Object.entries(refs).filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!orderedEntries.length) {
    return '';
  }

  return ` ${orderedEntries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

function formatPhaseMessage(phase: PhaseName, message: string, refs: PhaseRefs) {
  return `[verify:s02-live] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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
    const errorPayload = isObject(payload) ? payload : null;
    const detail = [errorPayload?.error, errorPayload?.detail]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');

    throw new VerifierPhaseError(
      phase,
      `${label} failed (${response.status}): ${detail || response.statusText || 'request failed'}`,
      refs
    );
  }

  return payload as T;
}

async function readPageHeading(
  fetchImpl: FetchLike,
  url: string,
  expectedText: string,
  phase: PhaseName,
  refs: PhaseRefs,
  timeoutMs: number
) {
  let response: Response;

  try {
    response = await fetchImpl(url, { signal: buildTimeoutSignal(timeoutMs) });
  } catch (error) {
    throw new VerifierPhaseError(phase, `Page request failed: ${safeMessage(error)}`, refs, error);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new VerifierPhaseError(phase, `Page returned ${response.status}.`, refs);
  }

  if (!body.includes(expectedText)) {
    throw new VerifierPhaseError(phase, `Page HTML did not include expected text ${JSON.stringify(expectedText)}.`, refs);
  }
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

export function parseVerifierOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): VerifierOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      fixture: { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    baseUrl: baseUrlFromInput(parsed.values['base-url'] ?? env.BASE_URL),
    fixturePath: parsed.values.fixture ?? env.S02_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.S02_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
  };
}

export async function loadFixture(
  fixturePath: string,
  readFileImpl: ReadFileLike = readFile
): Promise<ValidatedSubmission[]> {
  let rawText: string;

  try {
    rawText = await readFileImpl(fixturePath, 'utf8');
  } catch (error) {
    if (isObject(error) && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Fixture file not found: ${fixturePath}.`);
    }

    throw new Error(`Failed to read fixture file ${fixturePath}: ${safeMessage(error)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Fixture file ${fixturePath} did not contain valid JSON: ${safeMessage(error)}`);
  }

  const parsed = SubmissionFileSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Fixture file ${fixturePath} did not match the submission schema.`);
  }

  if (parsed.data.length === 0) {
    throw new Error(`Fixture file ${fixturePath} was empty.`);
  }

  return parsed.data;
}

function summarizeFixture(items: ValidatedSubmission[]): FixtureSummary {
  const queueIds = [...new Set(items.map((item) => item.queueId))];
  const questionPairs = new Set<string>();
  let answerCount = 0;

  for (const item of items) {
    for (const question of item.questions) {
      questionPairs.add(`${item.queueId}::${question.data.id}`);
    }

    answerCount += Object.keys(item.answers).length;
  }

  return {
    queueIds,
    queues: queueIds.length,
    submissions: items.length,
    questions: questionPairs.size,
    answers: answerCount,
  };
}

function getFixtureTarget(items: ValidatedSubmission[]): FixtureTarget {
  const firstSubmission = items[0];
  if (!firstSubmission) {
    throw new Error('Fixture data is empty.');
  }

  const firstQuestion = firstSubmission.questions[0]?.data.id;
  if (!firstQuestion) {
    throw new Error(`Fixture queue ${firstSubmission.queueId} did not include any questions.`);
  }

  return {
    queueLabel: firstSubmission.queueId,
    questionExternalId: firstQuestion,
  };
}

async function createSupabaseServiceClient(baseUrl: string) {
  const localEnv = await maybeReadLocalSupabaseEnv(baseUrl);
  const url = localEnv?.url ?? requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const secret =
    localEnv?.secret ?? process.env.SUPABASE_SECRET_KEY ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, secret);
}

export function assertUploadResultPayload(payload: unknown): UploadResult {
  if (!isObject(payload)) {
    throw new Error('Upload response was not an object.');
  }

  return {
    queues: asNonNegativeInteger(payload.queues, 'Upload response queues'),
    submissions: asNonNegativeInteger(payload.submissions, 'Upload response submissions'),
    questions: asNonNegativeInteger(payload.questions, 'Upload response questions'),
    answers: asNonNegativeInteger(payload.answers, 'Upload response answers'),
  };
}

export function assertRunPreviewPayload(payload: unknown): RunPreview {
  if (!isObject(payload)) {
    throw new Error('Run preview response was not an object.');
  }

  if (!Array.isArray(payload.breakdown)) {
    throw new Error('Run preview response is missing a breakdown array.');
  }

  return {
    total: asNonNegativeInteger(payload.total, 'Run preview total'),
    inactiveAssignmentCount: asNonNegativeInteger(
      payload.inactiveAssignmentCount ?? 0,
      'Run preview inactiveAssignmentCount'
    ),
    breakdown: payload.breakdown.map((entry, index) => {
      if (!isObject(entry)) {
        throw new Error(`Run preview breakdown[${index}] was not an object.`);
      }

      return {
        questionText: asNonEmptyString(entry.questionText, `Run preview breakdown[${index}].questionText`),
        judgeCount: asNonNegativeInteger(entry.judgeCount, `Run preview breakdown[${index}].judgeCount`),
        ...(entry.excludedInactiveJudgeCount == null
          ? {}
          : {
              excludedInactiveJudgeCount: asNonNegativeInteger(
                entry.excludedInactiveJudgeCount,
                `Run preview breakdown[${index}].excludedInactiveJudgeCount`
              ),
            }),
      };
    }),
  };
}

export function assertPersistedAssignmentRow(payload: unknown): PersistedAssignmentRow {
  if (!isObject(payload)) {
    throw new Error('Persisted assignment row was not an object.');
  }

  const promptFields = payload.prompt_fields;
  if (!Array.isArray(promptFields) || !promptFields.every((field) => typeof field === 'string' && field.length > 0)) {
    throw new Error('Persisted assignment row prompt_fields must be an array of strings.');
  }

  return {
    id: asNonEmptyString(payload.id, 'Persisted assignment row id'),
    queue_id: asNonEmptyString(payload.queue_id, 'Persisted assignment row queue_id'),
    question_template_id: asNonEmptyString(
      payload.question_template_id,
      'Persisted assignment row question_template_id'
    ),
    judge_id: asNonEmptyString(payload.judge_id, 'Persisted assignment row judge_id'),
    prompt_fields: [...promptFields],
    attachment_forwarding: asBoolean(
      payload.attachment_forwarding ?? false,
      'Persisted assignment row attachment_forwarding'
    ),
    created_at: payload.created_at == null ? null : asNonEmptyString(payload.created_at, 'Persisted assignment row created_at'),
  };
}

export function assertInactiveJudgeProof(proof: PreviewDeltaProof) {
  const expectedActiveTotal = proof.baseline.total + proof.answerCount;

  if (proof.active.total !== expectedActiveTotal) {
    throw new Error(
      `Active preview total ${proof.active.total} did not increase by ${proof.answerCount} from the baseline ${proof.baseline.total}.`
    );
  }

  if (proof.inactive.total !== proof.baseline.total) {
    throw new Error(
      `Inactive preview total ${proof.inactive.total} should have returned to the baseline ${proof.baseline.total}.`
    );
  }

  if (proof.inactive.inactiveAssignmentCount !== proof.baseline.inactiveAssignmentCount + 1) {
    throw new Error(
      `Inactive preview count ${proof.inactive.inactiveAssignmentCount} did not increase by one from the baseline ${proof.baseline.inactiveAssignmentCount}.`
    );
  }

  if (proof.reactivated.total !== proof.active.total) {
    throw new Error(
      `Reactivated preview total ${proof.reactivated.total} did not return to the active total ${proof.active.total}.`
    );
  }

  if (proof.reactivated.inactiveAssignmentCount !== proof.baseline.inactiveAssignmentCount) {
    throw new Error(
      `Reactivated preview count ${proof.reactivated.inactiveAssignmentCount} did not return to the baseline ${proof.baseline.inactiveAssignmentCount}.`
    );
  }

  if (proof.activeAssignmentId !== proof.inactiveAssignmentId || proof.activeAssignmentId !== proof.reactivatedAssignmentId) {
    throw new Error('Assignment id changed across deactivate/reactivate instead of reusing the same persisted row.');
  }
}

function sanitizeQueueLabel(queueLabel: string) {
  return queueLabel.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function buildVerifierJudgeName(queueLabel: string) {
  return `S02 Live Verifier [${sanitizeQueueLabel(queueLabel)}]`;
}

function buildEditedPrompt(queueLabel: string, questionText: string, verificationTag: string) {
  return [
    `You are the live verifier judge for ${queueLabel}.`,
    `Evaluate the prompt for question: ${questionText}`,
    'Return a truthful pass/fail/inconclusive verdict with a short reason.',
    `verification_tag=${verificationTag}`,
  ].join('\n');
}

function log(message: string) {
  console.log(`[verify:s02-live] ${message}`);
}

async function fetchQueuesApi(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues`,
    'Queue list',
    'schema-readiness',
    { endpoint: '/api/queues' },
    timeoutMs
  );

  if (!Array.isArray(payload)) {
    throw new Error('Queue list response was not an array.');
  }

  return payload
    .filter(isObject)
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : null,
      queue_id: typeof row.queue_id === 'string' ? row.queue_id : null,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      submission_count: typeof row.submission_count === 'number' ? row.submission_count : undefined,
      question_count: typeof row.question_count === 'number' ? row.question_count : undefined,
    }))
    .filter((row): row is QueueRow => Boolean(row.id && row.queue_id && row.created_at));
}

async function fetchJudgesApi(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Judge list',
    'judge-lifecycle',
    { endpoint: '/api/judges' },
    timeoutMs
  );

  return parseJudgeList(payload, '/api/judges response');
}

async function fetchJudgeApi(baseUrl: string, judgeId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges/${judgeId}`,
    'Judge detail',
    'judge-lifecycle',
    { endpoint: `/api/judges/${judgeId}`, judgeId },
    timeoutMs
  );

  return parseJudgeRecord(payload, `/api/judges/${judgeId} response`);
}

async function createJudgeApi(
  baseUrl: string,
  payload: { name: string; system_prompt: string; model: string; active: boolean },
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const response = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Create judge',
    'judge-lifecycle',
    { endpoint: '/api/judges' },
    timeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  return parseJudgeRecord(response, 'POST /api/judges response');
}

async function patchJudgeApi(
  baseUrl: string,
  judgeId: string,
  payload: { name?: string; system_prompt?: string; model?: string; active?: boolean },
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const response = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges/${judgeId}`,
    'Update judge',
    'judge-lifecycle',
    { endpoint: `/api/judges/${judgeId}`, judgeId },
    timeoutMs,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  return parseJudgeRecord(response, `PATCH /api/judges/${judgeId} response`);
}

async function fetchAssignmentsApi(baseUrl: string, queueId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/assignments`,
    'Queue assignments',
    'assignment-persistence',
    { endpoint: `/api/queues/${queueId}/assignments`, queueId },
    timeoutMs
  );

  return parseQueueAssignmentList(payload, {
    context: `/api/queues/${queueId}/assignments response`,
    requireQuestion: true,
  });
}

async function fetchQuestionsApi(baseUrl: string, queueId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/questions`,
    'Queue questions',
    'assignment-persistence',
    { endpoint: `/api/queues/${queueId}/questions`, queueId },
    timeoutMs
  );

  return parseQueueQuestionList(payload, `/api/queues/${queueId}/questions response`);
}

async function fetchRunPreviewApi(baseUrl: string, queueId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/run-preview`,
    'Run preview',
    'inactive-run-filtering',
    { endpoint: `/api/queues/${queueId}/run-preview`, queueId },
    timeoutMs
  );

  return assertRunPreviewPayload(payload);
}

async function createAssignmentApi(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/assignments`,
    'Create assignment',
    'assignment-persistence',
    { endpoint: `/api/queues/${queueId}/assignments`, queueId, questionId, judgeId },
    timeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        judge_id: judgeId,
        question_template_id: questionId,
        prompt_fields: [...VERIFIER_PROMPT_FIELDS],
      }),
    }
  );

  return assertPersistedAssignmentRow(payload);
}

async function deleteAssignmentApi(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  let response: Response;

  try {
    response = await fetchImpl(`${baseUrl}/api/queues/${queueId}/assignments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judge_id: judgeId, question_template_id: questionId }),
      signal: buildTimeoutSignal(timeoutMs),
    });
  } catch (error) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Delete assignment request failed: ${safeMessage(error)}`,
      { endpoint: `/api/queues/${queueId}/assignments`, queueId, questionId, judgeId },
      error
    );
  }

  if (response.status === 204) {
    return;
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Delete assignment returned a non-JSON response (${response.status}).`,
        { endpoint: `/api/queues/${queueId}/assignments`, queueId, questionId, judgeId }
      );
    }
  }

  if (!response.ok) {
    const detail = isObject(payload) && typeof payload.error === 'string' ? payload.error : response.statusText;
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Delete assignment failed (${response.status}): ${detail || 'request failed'}`,
      { endpoint: `/api/queues/${queueId}/assignments`, queueId, questionId, judgeId }
    );
  }
}

async function findPersistedQueue(
  supabase: SupabaseClient,
  queueLabel: string,
  questionExternalId: string,
  phase: PhaseName,
  refs: PhaseRefs
) {
  const { data: queueRow, error: queueError } = await supabase
    .from('queues')
    .select('id, queue_id, created_at')
    .eq('queue_id', queueLabel)
    .maybeSingle();

  if (queueError || !queueRow) {
    throw new VerifierPhaseError(phase, queueError?.message ?? `Queue ${queueLabel} was not persisted.`, refs);
  }

  const { data: questionRow, error: questionError } = await supabase
    .from('question_templates')
    .select('id, queue_id, external_id, question_text, question_type, created_at')
    .eq('queue_id', queueRow.id)
    .eq('external_id', questionExternalId)
    .maybeSingle();

  if (questionError || !questionRow) {
    throw new VerifierPhaseError(
      phase,
      questionError?.message ?? `Question ${questionExternalId} was not persisted for queue ${queueLabel}.`,
      { ...refs, queueId: queueRow.id }
    );
  }

  const { data: answers, error: answersError } = await supabase
    .from('submission_answers')
    .select('id')
    .eq('question_template_id', questionRow.id);

  if (answersError) {
    throw new VerifierPhaseError(phase, answersError.message, { ...refs, queueId: queueRow.id, questionId: questionRow.id });
  }

  return {
    queue: queueRow as QueueRow,
    question: questionRow as PersistedQuestion,
    answerCount: answers?.length ?? 0,
  };
}

async function findVerifierJudgeByName(supabase: SupabaseClient, judgeName: string, refs: PhaseRefs) {
  const { data, error } = await supabase
    .from('judges')
    .select('*')
    .eq('name', judgeName)
    .order('created_at', { ascending: false });

  if (error) {
    throw new VerifierPhaseError('judge-lifecycle', `Failed to query verifier judge: ${error.message}`, refs);
  }

  if ((data ?? []).length > 1) {
    throw new VerifierPhaseError('judge-lifecycle', `Multiple verifier judges named ${judgeName} were found.`, refs);
  }

  if (!data?.[0]) {
    return null;
  }

  return parseJudgeRecord(data[0], `judges row ${judgeName}`);
}

async function loadPersistedJudgeRow(supabase: SupabaseClient, judgeId: string, refs: PhaseRefs) {
  const { data, error } = await supabase
    .from('judges')
    .select('*')
    .eq('id', judgeId)
    .maybeSingle();

  if (error || !data) {
    throw new VerifierPhaseError('judge-lifecycle', error?.message ?? `Judge ${judgeId} was not persisted.`, refs);
  }

  return parseJudgeRecord(data, `judges row ${judgeId}`);
}

async function loadPersistedAssignmentRow(
  supabase: SupabaseClient,
  queueId: string,
  questionId: string,
  judgeId: string,
  refs: PhaseRefs
) {
  const { data, error } = await supabase
    .from('judge_assignments')
    .select('id, queue_id, question_template_id, judge_id, prompt_fields, attachment_forwarding, created_at')
    .eq('queue_id', queueId)
    .eq('question_template_id', questionId)
    .eq('judge_id', judgeId)
    .maybeSingle();

  if (error || !data) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      error?.message ?? 'Persisted assignment row was missing.',
      refs
    );
  }

  return assertPersistedAssignmentRow(data);
}

function findAssignment(assignments: QueueAssignmentRecord[], questionId: string, judgeId: string) {
  return assignments.find(
    (assignment) => assignment.question_template_id === questionId && assignment.judge_id === judgeId
  );
}

async function verifySchemaReadiness(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const supabase = await createSupabaseServiceClient(baseUrl);

  await runPhase('schema-readiness', { endpoint: '/api/queues' }, async () => {
    await fetchQueuesApi(baseUrl, timeoutMs, fetchImpl);
  });

  await runPhase('schema-readiness', { endpoint: '/api/judges' }, async () => {
    await readJsonResponse<unknown>(
      fetchImpl,
      `${baseUrl}/api/judges`,
      'Judge list',
      'schema-readiness',
      { endpoint: '/api/judges' },
      timeoutMs
    );
  });

  for (const table of REQUIRED_TABLES) {
    await runPhase('schema-readiness', { endpoint: table }, async () => {
      await checkTableReadable(supabase, table, 'schema-readiness', { endpoint: table });
    });
  }

  log('Schema readiness passed for app endpoints and required Supabase tables.');
  return supabase;
}

async function uploadFixture(
  options: VerifierOptions,
  fixtureItems: ValidatedSubmission[],
  fetchImpl: FetchLike
) {
  const fixtureSummary = summarizeFixture(fixtureItems);
  const fixturePath = path.basename(options.fixturePath);
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(fixtureItems)], { type: 'application/json' }), fixturePath);

  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${options.baseUrl}/api/upload`,
    'Upload',
    'upload',
    { endpoint: '/api/upload' },
    options.timeoutMs,
    { method: 'POST', body: form }
  );

  const result = assertUploadResultPayload(payload);
  const expected = {
    queues: fixtureSummary.queues,
    submissions: fixtureSummary.submissions,
    questions: fixtureSummary.questions,
    answers: fixtureSummary.answers,
  };

  if (
    result.queues !== expected.queues ||
    result.submissions !== expected.submissions ||
    result.questions !== expected.questions ||
    result.answers !== expected.answers
  ) {
    throw new VerifierPhaseError(
      'upload',
      `Upload response ${JSON.stringify(result)} did not match expected counts ${JSON.stringify(expected)}.`,
      { endpoint: '/api/upload' }
    );
  }

  log(
    `Upload passed using ${fixturePath}: queues=${result.queues}, submissions=${result.submissions}, questions=${result.questions}, answers=${result.answers}.`
  );

  return result;
}

async function ensureVerifierJudge(
  supabase: SupabaseClient,
  baseUrl: string,
  queueLabel: string,
  questionText: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const judgeName = buildVerifierJudgeName(queueLabel);
  const refs: PhaseRefs = { queueLabel };
  const existingJudge = await findVerifierJudgeByName(supabase, judgeName, refs);

  const judgeAction: 'created' | 'reused' = existingJudge ? 'reused' : 'created';
  const createdJudge = existingJudge ?? (await createJudgeApi(
    baseUrl,
    {
      name: judgeName,
      system_prompt: 'Seed prompt for S02 verifier create flow.',
      model: 'verifier/seed',
      active: true,
    },
    timeoutMs,
    fetchImpl
  ));

  const verificationTag = new Date().toISOString();
  const nextPrompt = buildEditedPrompt(queueLabel, questionText, verificationTag);
  const updatedJudge = await patchJudgeApi(
    baseUrl,
    createdJudge.id,
    {
      system_prompt: nextPrompt,
      model: VERIFIER_MODEL,
      active: true,
    },
    timeoutMs,
    fetchImpl
  );

  const judgeDetail = await fetchJudgeApi(baseUrl, updatedJudge.id, timeoutMs, fetchImpl);
  const judgeList = await fetchJudgesApi(baseUrl, timeoutMs, fetchImpl);
  const listJudge = judgeList.find((judge) => judge.id === updatedJudge.id);
  const persistedJudge = await loadPersistedJudgeRow(supabase, updatedJudge.id, {
    queueLabel,
    judgeId: updatedJudge.id,
  });

  if (!listJudge) {
    throw new VerifierPhaseError('judge-lifecycle', 'Judge list did not include the verifier judge.', {
      queueLabel,
      judgeId: updatedJudge.id,
    });
  }

  for (const judge of [updatedJudge, judgeDetail, listJudge, persistedJudge] satisfies RawJudge[]) {
    if (!judge.active) {
      throw new VerifierPhaseError('judge-lifecycle', 'Verifier judge should be active after the edit step.', {
        queueLabel,
        judgeId: updatedJudge.id,
      });
    }

    if (judge.model !== VERIFIER_MODEL) {
      throw new VerifierPhaseError('judge-lifecycle', `Verifier judge model drifted to ${judge.model}.`, {
        queueLabel,
        judgeId: updatedJudge.id,
      });
    }

    if (judge.system_prompt !== nextPrompt) {
      throw new VerifierPhaseError('judge-lifecycle', 'Verifier judge prompt did not persist the edit payload.', {
        queueLabel,
        judgeId: updatedJudge.id,
      });
    }
  }

  log(`Judge lifecycle passed for ${judgeName}: action=${judgeAction}, id=${updatedJudge.id}.`);

  return {
    judge: updatedJudge,
    judgeAction,
    editAction: 'edit' as JudgeLifecycleAction,
  };
}

async function verifyAssignmentSurfaces(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  expectedStatus: 'active' | 'inactive',
  expectedAssignmentId: string,
  refs: PhaseRefs
) {
  const assignments = await fetchAssignmentsApi(baseUrl, queueId, timeoutMs, fetchImpl);
  const assignment = findAssignment(assignments, questionId, judgeId);
  if (!assignment) {
    throw new VerifierPhaseError('assignment-persistence', 'Assignment list did not include the verifier row.', refs);
  }

  if (assignment.id !== expectedAssignmentId) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Assignment id drifted from ${expectedAssignmentId} to ${assignment.id}.`,
      { ...refs, assignmentId: assignment.id ?? undefined }
    );
  }

  if (assignment.judge_status !== expectedStatus) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Assignment status was ${assignment.judge_status} instead of ${expectedStatus}.`,
      { ...refs, assignmentId: assignment.id ?? undefined }
    );
  }

  const questionRows = await fetchQuestionsApi(baseUrl, queueId, timeoutMs, fetchImpl);
  const question = questionRows.find((row) => row.id === questionId);
  const questionAssignment = question?.assignments.find((row) => row.judge_id === judgeId);

  if (!question || !questionAssignment) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      'Queue question hydration did not include the verifier assignment.',
      refs
    );
  }

  if (questionAssignment.id !== expectedAssignmentId) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Queue question assignment id drifted from ${expectedAssignmentId} to ${questionAssignment.id}.`,
      { ...refs, assignmentId: questionAssignment.id ?? undefined }
    );
  }

  if (questionAssignment.judge_status !== expectedStatus) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      `Queue question assignment status was ${questionAssignment.judge_status} instead of ${expectedStatus}.`,
      refs
    );
  }

  return assignment;
}

async function verifyLiveAssignmentPath(
  supabase: SupabaseClient,
  baseUrl: string,
  queue: QueueRow,
  question: PersistedQuestion,
  answerCount: number,
  judgeId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const refs: PhaseRefs = {
    queueId: queue.id,
    queueLabel: queue.queue_id,
    judgeId,
    questionId: question.id,
  };

  await deleteAssignmentApi(baseUrl, queue.id, question.id, judgeId, timeoutMs, fetchImpl);

  const baselinePreview = await fetchRunPreviewApi(baseUrl, queue.id, timeoutMs, fetchImpl);
  const createdAssignment = await createAssignmentApi(baseUrl, queue.id, question.id, judgeId, timeoutMs, fetchImpl);
  const persistedAssignment = await loadPersistedAssignmentRow(supabase, queue.id, question.id, judgeId, {
    ...refs,
    assignmentId: createdAssignment.id,
  });

  if (persistedAssignment.id !== createdAssignment.id) {
    throw new VerifierPhaseError('assignment-persistence', 'API and persisted assignment ids did not match.', {
      ...refs,
      assignmentId: createdAssignment.id,
    });
  }

  if (persistedAssignment.prompt_fields.join(',') !== [...VERIFIER_PROMPT_FIELDS].join(',')) {
    throw new VerifierPhaseError('assignment-persistence', 'Persisted assignment prompt_fields drifted from the verifier payload.', {
      ...refs,
      assignmentId: createdAssignment.id,
    });
  }

  await verifyAssignmentSurfaces(
    baseUrl,
    queue.id,
    question.id,
    judgeId,
    timeoutMs,
    fetchImpl,
    'active',
    createdAssignment.id,
    { ...refs, assignmentId: createdAssignment.id }
  );

  const activePreview = await fetchRunPreviewApi(baseUrl, queue.id, timeoutMs, fetchImpl);

  log(
    `Assignment persistence passed for queue=${queue.id} question=${question.id} judge=${judgeId}: assignment=${createdAssignment.id}.`
  );

  return {
    createdAssignment,
    baselinePreview,
    activePreview,
  };
}

async function verifyInactiveFilteringPath(
  supabase: SupabaseClient,
  baseUrl: string,
  queue: QueueRow,
  question: PersistedQuestion,
  answerCount: number,
  judgeId: string,
  assignmentId: string,
  baselinePreview: RunPreview,
  activePreview: RunPreview,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const refs: PhaseRefs = {
    queueId: queue.id,
    queueLabel: queue.queue_id,
    judgeId,
    questionId: question.id,
    assignmentId,
  };

  const deactivatedJudge = await patchJudgeApi(
    baseUrl,
    judgeId,
    { active: false },
    timeoutMs,
    fetchImpl
  );

  if (deactivatedJudge.active) {
    throw new VerifierPhaseError('inactive-run-filtering', 'Judge remained active after deactivation.', refs);
  }

  const persistedInactiveJudge = await loadPersistedJudgeRow(supabase, judgeId, refs);
  if (persistedInactiveJudge.active) {
    throw new VerifierPhaseError('inactive-run-filtering', 'Persisted judge row remained active after deactivation.', refs);
  }

  const inactiveAssignment = await verifyAssignmentSurfaces(
    baseUrl,
    queue.id,
    question.id,
    judgeId,
    timeoutMs,
    fetchImpl,
    'inactive',
    assignmentId,
    refs
  );
  const inactivePreview = await fetchRunPreviewApi(baseUrl, queue.id, timeoutMs, fetchImpl);

  const reactivatedJudge = await patchJudgeApi(
    baseUrl,
    judgeId,
    { active: true },
    timeoutMs,
    fetchImpl
  );

  if (!reactivatedJudge.active) {
    throw new VerifierPhaseError('inactive-run-filtering', 'Judge did not reactivate.', refs);
  }

  const persistedReactivatedJudge = await loadPersistedJudgeRow(supabase, judgeId, refs);
  if (!persistedReactivatedJudge.active) {
    throw new VerifierPhaseError('inactive-run-filtering', 'Persisted judge row did not reactivate.', refs);
  }

  const reactivatedAssignment = await verifyAssignmentSurfaces(
    baseUrl,
    queue.id,
    question.id,
    judgeId,
    timeoutMs,
    fetchImpl,
    'active',
    assignmentId,
    refs
  );
  const reactivatedPreview = await fetchRunPreviewApi(baseUrl, queue.id, timeoutMs, fetchImpl);

  assertInactiveJudgeProof({
    baseline: {
      total: baselinePreview.total,
      inactiveAssignmentCount: baselinePreview.inactiveAssignmentCount,
    },
    active: {
      total: activePreview.total,
      inactiveAssignmentCount: activePreview.inactiveAssignmentCount,
    },
    inactive: {
      total: inactivePreview.total,
      inactiveAssignmentCount: inactivePreview.inactiveAssignmentCount,
    },
    reactivated: {
      total: reactivatedPreview.total,
      inactiveAssignmentCount: reactivatedPreview.inactiveAssignmentCount,
    },
    answerCount,
    activeAssignmentId: assignmentId,
    inactiveAssignmentId: inactiveAssignment.id ?? assignmentId,
    reactivatedAssignmentId: reactivatedAssignment.id ?? assignmentId,
  });

  log(`Inactive filtering passed for assignment=${assignmentId}: preview ${activePreview.total} → ${inactivePreview.total} → ${reactivatedPreview.total}.`);

  return {
    inactivePreview,
    reactivatedPreview,
  };
}

async function verifyBrowserTargets(baseUrl: string, queueId: string, timeoutMs: number, fetchImpl: FetchLike) {
  const pageUrls = {
    queues: `${baseUrl}/queues`,
    judges: `${baseUrl}/judges`,
    assign: `${baseUrl}/queues/${queueId}/assign`,
  };

  await readPageHeading(fetchImpl, pageUrls.queues, 'Queues', 'browser-confirmation', { page: '/queues' }, timeoutMs);
  await readPageHeading(fetchImpl, pageUrls.judges, 'Judges', 'browser-confirmation', { page: '/judges' }, timeoutMs);
  await readPageHeading(
    fetchImpl,
    pageUrls.assign,
    'Assign Judges',
    'browser-confirmation',
    { page: `/queues/${queueId}/assign`, queueId },
    timeoutMs
  );

  log(`Browser targets are reachable: ${pageUrls.queues}, ${pageUrls.judges}, ${pageUrls.assign}.`);
  return pageUrls;
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch,
  readFileImpl: ReadFileLike = readFile
): Promise<LiveVerificationSummary> {
  const fixtureItems = await runPhase('upload', { endpoint: options.fixturePath }, async () =>
    loadFixture(options.fixturePath, readFileImpl)
  );
  const target = getFixtureTarget(fixtureItems);

  const supabase = await verifySchemaReadiness(options.baseUrl, options.timeoutMs, fetchImpl);
  await uploadFixture(options, fixtureItems, fetchImpl);

  const persistedTarget = await runPhase('upload', { queueLabel: target.queueLabel }, async () =>
    findPersistedQueue(supabase, target.queueLabel, target.questionExternalId, 'upload', {
      queueLabel: target.queueLabel,
    })
  );

  if (persistedTarget.answerCount <= 0) {
    throw new VerifierPhaseError(
      'upload',
      `Question ${persistedTarget.question.external_id} had no persisted answers after upload.`,
      {
        queueId: persistedTarget.queue.id,
        queueLabel: persistedTarget.queue.queue_id,
        questionId: persistedTarget.question.id,
      }
    );
  }

  const judgeResult = await runPhase(
    'judge-lifecycle',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
    },
    async () =>
      ensureVerifierJudge(
        supabase,
        options.baseUrl,
        persistedTarget.queue.queue_id,
        persistedTarget.question.question_text,
        options.timeoutMs,
        fetchImpl
      )
  );

  const assignmentResult = await runPhase(
    'assignment-persistence',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      judgeId: judgeResult.judge.id,
      questionId: persistedTarget.question.id,
    },
    async () =>
      verifyLiveAssignmentPath(
        supabase,
        options.baseUrl,
        persistedTarget.queue,
        persistedTarget.question,
        persistedTarget.answerCount,
        judgeResult.judge.id,
        options.timeoutMs,
        fetchImpl
      )
  );

  const inactiveFilteringResult = await runPhase(
    'inactive-run-filtering',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      judgeId: judgeResult.judge.id,
      questionId: persistedTarget.question.id,
      assignmentId: assignmentResult.createdAssignment.id,
    },
    async () =>
      verifyInactiveFilteringPath(
        supabase,
        options.baseUrl,
        persistedTarget.queue,
        persistedTarget.question,
        persistedTarget.answerCount,
        judgeResult.judge.id,
        assignmentResult.createdAssignment.id,
        assignmentResult.baselinePreview,
        assignmentResult.activePreview,
        options.timeoutMs,
        fetchImpl
      )
  );

  const pageUrls = await runPhase(
    'browser-confirmation',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      judgeId: judgeResult.judge.id,
      questionId: persistedTarget.question.id,
      assignmentId: assignmentResult.createdAssignment.id,
    },
    async () => verifyBrowserTargets(options.baseUrl, persistedTarget.queue.id, options.timeoutMs, fetchImpl)
  );

  return {
    queueId: persistedTarget.queue.id,
    queueLabel: persistedTarget.queue.queue_id,
    questionId: persistedTarget.question.id,
    questionExternalId: persistedTarget.question.external_id,
    questionText: persistedTarget.question.question_text,
    answerCount: persistedTarget.answerCount,
    judgeId: judgeResult.judge.id,
    judgeName: judgeResult.judge.name,
    judgeAction: judgeResult.judgeAction,
    editAction: judgeResult.editAction,
    assignmentId: assignmentResult.createdAssignment.id,
    previewTotals: {
      baseline: assignmentResult.baselinePreview.total,
      active: assignmentResult.activePreview.total,
      inactive: inactiveFilteringResult.inactivePreview.total,
      reactivated: inactiveFilteringResult.reactivatedPreview.total,
    },
    pageUrls,
  };
}

const isDirectRun = /(^|\/)verify-s02-live\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(
      `OK queue=${summary.queueId} queueLabel=${summary.queueLabel} question=${summary.questionId} judge=${summary.judgeId} assignment=${summary.assignmentId} previews=${summary.previewTotals.baseline}/${summary.previewTotals.active}/${summary.previewTotals.inactive}/${summary.previewTotals.reactivated}.`
    );
    log(
      `Browser proof targets: queues=${summary.pageUrls.queues} judges=${summary.pageUrls.judges} assign=${summary.pageUrls.assign}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : `[verify:s02-live] ${safeMessage(error)}`);
    process.exit(1);
  }
}
