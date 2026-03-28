import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { parseQueueAssignmentList } from '../src/lib/assignments/queue-assignment-state';
import { parseJudgeRecord, type JudgeLifecycleAction } from '../src/lib/judges/judge-lifecycle';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import type { ResultsEvaluation, ResultsResponse, UploadResult } from '../src/types/api';
import type { EvalStatusEnum, Judge, RunStatusEnum, VerdictEnum } from '../src/types/db';
import {
  assertPersistedAudit,
  pollRunUntilTerminal,
  type EvaluationAuditRow,
  type PersistedRunAudit,
} from './verify-s01-live';
import { assertUploadResultPayload, loadFixture } from './verify-s02-live';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;

type PhaseName =
  | 'schema-readiness'
  | 'upload'
  | 'judge-setup'
  | 'assignment-setup'
  | 'run-start'
  | 'run-poll'
  | 'results-assertions'
  | 'page-confirmation';

type PhaseRefs = {
  queueId?: string;
  queueLabel?: string;
  runId?: string;
  validJudgeId?: string;
  invalidJudgeId?: string;
  questionId?: string;
  endpoint?: string;
  page?: string;
  filter?: string;
};

type QueueRow = {
  id: string;
  queue_id: string;
  created_at: string;
};

type PersistedQuestion = {
  id: string;
  queue_id: string;
  external_id: string;
  question_text: string;
  question_type: string | null;
  created_at: string;
};

type RunStartResponse = {
  runId: string;
  total: number;
};

type FixtureTarget = {
  queueLabel: string;
  questionExternalIds: [string, string];
};

type FixtureSummary = UploadResult & {
  queueIds: string[];
};

type ResultsProofSummary = {
  currentTotal: number;
  currentCompleted: number;
  currentErrored: number;
  verdictFilter: VerdictEnum;
};

export type VerifierOptions = {
  baseUrl: string;
  fixturePath: string;
  timeoutMs: number;
  pollMs: number;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  runId: string;
  runStatus: RunStatusEnum;
  previewTotal: number;
  startedTotal: number;
  verifierJudgeIds: {
    valid: string;
    invalid: string;
  };
  verifierJudgeNames: {
    valid: string;
    invalid: string;
  };
  questionIds: [string, string];
  resultsProof: ResultsProofSummary;
  pageUrl: string;
};

const DEFAULT_FIXTURE_PATH = 'scripts/verify-s03-live.fixture.json';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const REQUIRED_TABLES = [
  'queues',
  'question_templates',
  'submissions',
  'submission_answers',
  'judges',
  'judge_assignments',
  'evaluation_runs',
  'evaluations',
] as const;
const VALID_MODEL = process.env.S03_VERIFY_MODEL ?? 'openai/gpt-4o-mini';
const INVALID_MODEL = 'openai/not-a-real-model-s03-live';
const VALID_JUDGE_PREFIX = 'S03 Live Results Valid';
const INVALID_JUDGE_PREFIX = 'S03 Live Results Invalid';
const VERIFIER_PROMPT_FIELDS = ['questionText', 'answer', 'questionType'] as const;
const execFileAsync = promisify(execFile);

export class ResultsVerifierPhaseError extends Error {
  readonly phase: PhaseName;
  readonly refs: PhaseRefs;

  constructor(phase: PhaseName, message: string, refs: PhaseRefs = {}, cause?: unknown) {
    super(formatPhaseMessage(phase, message, refs), cause ? { cause } : undefined);
    this.name = 'ResultsVerifierPhaseError';
    this.phase = phase;
    this.refs = refs;
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
  return `[verify:s03-live] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
}

export async function runPhase<T>(phase: PhaseName, refs: PhaseRefs, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ResultsVerifierPhaseError) {
      throw error;
    }

    throw new ResultsVerifierPhaseError(phase, safeMessage(error), refs, error);
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function asNullableString(value: unknown, fieldName: string) {
  if (value == null) {
    return null;
  }

  return asNonEmptyString(value, fieldName);
}

function asNonNegativeInteger(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return value;
}

function isRunStatus(value: unknown): value is RunStatusEnum {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'error' || value === 'cancelled';
}

function isEvalStatus(value: unknown): value is EvalStatusEnum {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'error';
}

function isVerdict(value: unknown): value is VerdictEnum {
  return value === 'pass' || value === 'fail' || value === 'inconclusive';
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
  const secret = localEnv?.secret ?? process.env.SUPABASE_SECRET_KEY ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, secret);
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
    throw new ResultsVerifierPhaseError(phase, `${label} request failed: ${safeMessage(error)}`, refs, error);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ResultsVerifierPhaseError(phase, `${label} returned a non-JSON response (${response.status}).`, refs, error);
  }

  if (!response.ok) {
    const detail = isObject(payload)
      ? [payload.error, payload.detail]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' ')
      : '';
    throw new ResultsVerifierPhaseError(
      phase,
      `${label} failed (${response.status}): ${detail || response.statusText || 'request failed'}`,
      refs
    );
  }

  return payload as T;
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

function parseRunStartPayload(payload: unknown): RunStartResponse {
  if (!isObject(payload)) {
    throw new Error('Run start response was not an object.');
  }

  return {
    runId: asNonEmptyString(payload.runId, 'Run start response runId'),
    total: asNonNegativeInteger(payload.total, 'Run start response total'),
  };
}

function summarizeFixture(items: Awaited<ReturnType<typeof loadFixture>>): FixtureSummary {
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

function getFixtureTarget(items: Awaited<ReturnType<typeof loadFixture>>): FixtureTarget {
  const firstSubmission = items[0];
  if (!firstSubmission) {
    throw new Error('Fixture data is empty.');
  }

  const queueLabel = firstSubmission.queueId;
  const questionExternalIds = [
    ...new Set(items.filter((item) => item.queueId === queueLabel).flatMap((item) => item.questions.map((question) => question.data.id))),
  ];

  if (questionExternalIds.length < 2) {
    throw new Error(`Fixture queue ${queueLabel} must include at least two questions.`);
  }

  return {
    queueLabel,
    questionExternalIds: [questionExternalIds[0], questionExternalIds[1]],
  };
}

function sanitizeLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function createVerificationTag() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function buildValidJudgeName(queueLabel: string, tag: string) {
  return `${VALID_JUDGE_PREFIX} [${sanitizeLabel(queueLabel)}] [${tag}]`;
}

function buildInvalidJudgeName(queueLabel: string, tag: string) {
  return `${INVALID_JUDGE_PREFIX} [${sanitizeLabel(queueLabel)}] [${tag}]`;
}

function buildValidJudgePrompt(queueLabel: string, tag: string) {
  return [
    `You are the S03 live results verifier judge for ${queueLabel}.`,
    'Read the answer payload and obey the verdictHint field exactly.',
    'If verdictHint is pass, return verdict=pass.',
    'If verdictHint is fail, return verdict=fail.',
    'If verdictHint is inconclusive, return verdict=inconclusive.',
    'Always include a short reasoning sentence that mentions the evidence field.',
    `verification_tag=${tag}`,
  ].join('\n');
}

function log(message: string) {
  console.log(`[verify:s03-live] ${message}`);
}

async function checkTableReadable(
  supabase: SupabaseClient,
  table: (typeof REQUIRED_TABLES)[number],
  phase: PhaseName,
  refs: PhaseRefs
) {
  const { error } = await supabase.from(table).select('id').limit(1);
  if (error) {
    throw new ResultsVerifierPhaseError(phase, `Supabase table ${table} is not readable: ${error.message}`, refs);
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
    baseUrl: baseUrlFromInput(parsed.values['base-url'] ?? env.BASE_URL),
    fixturePath: parsed.values.fixture ?? env.S03_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.S03_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.S03_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

async function verifySchemaReadiness(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const supabase = await createSupabaseServiceClient(baseUrl);

  await runPhase('schema-readiness', { endpoint: '/api/queues' }, async () => {
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

  log('Schema readiness passed for the app endpoints and results-related Supabase tables.');
  return supabase;
}

async function uploadFixture(
  options: VerifierOptions,
  fixtureItems: Awaited<ReturnType<typeof loadFixture>>,
  fetchImpl: FetchLike
) {
  const fixtureSummary = summarizeFixture(fixtureItems);
  const form = new FormData();
  form.append(
    'file',
    new Blob([JSON.stringify(fixtureItems)], { type: 'application/json' }),
    path.basename(options.fixturePath)
  );

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
    throw new Error(
      `Upload response ${JSON.stringify(result)} did not match expected counts ${JSON.stringify(expected)}.`
    );
  }

  log(
    `Upload passed using ${path.basename(options.fixturePath)}: queues=${result.queues}, submissions=${result.submissions}, questions=${result.questions}, answers=${result.answers}.`
  );
}

async function findPersistedQueueAndQuestions(
  supabase: SupabaseClient,
  target: FixtureTarget
) {
  const { data: queueRow, error: queueError } = await supabase
    .from('queues')
    .select('id, queue_id, created_at')
    .eq('queue_id', target.queueLabel)
    .maybeSingle();

  if (queueError || !queueRow) {
    throw new Error(queueError?.message ?? `Queue ${target.queueLabel} was not persisted.`);
  }

  const { data: questionRows, error: questionError } = await supabase
    .from('question_templates')
    .select('id, queue_id, external_id, question_text, question_type, created_at')
    .eq('queue_id', queueRow.id)
    .in('external_id', [...target.questionExternalIds])
    .order('created_at', { ascending: true });

  if (questionError) {
    throw new Error(questionError.message);
  }

  const questionsByExternalId = new Map(
    (questionRows ?? []).map((row) => [row.external_id, row as PersistedQuestion])
  );
  const firstQuestion = questionsByExternalId.get(target.questionExternalIds[0]);
  const secondQuestion = questionsByExternalId.get(target.questionExternalIds[1]);

  if (!firstQuestion || !secondQuestion) {
    throw new Error(
      `Persisted questions did not include both tracked external ids ${target.questionExternalIds.join(', ')}.`
    );
  }

  const { data: answers, error: answersError } = await supabase
    .from('submission_answers')
    .select('id, question_template_id')
    .in('question_template_id', [firstQuestion.id, secondQuestion.id]);

  if (answersError) {
    throw new Error(answersError.message);
  }

  const answerCountByQuestionId = new Map<string, number>();
  for (const row of answers ?? []) {
    const next = (answerCountByQuestionId.get(row.question_template_id) ?? 0) + 1;
    answerCountByQuestionId.set(row.question_template_id, next);
  }

  if ((answerCountByQuestionId.get(firstQuestion.id) ?? 0) === 0 || (answerCountByQuestionId.get(secondQuestion.id) ?? 0) === 0) {
    throw new Error('Tracked verifier questions must both have persisted answers after upload.');
  }

  return {
    queue: queueRow as QueueRow,
    questions: [firstQuestion, secondQuestion] as [PersistedQuestion, PersistedQuestion],
    answerCountByQuestionId,
  };
}

async function fetchJudgesApi(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Judge list',
    'judge-setup',
    { endpoint: '/api/judges' },
    timeoutMs
  );

  if (!Array.isArray(payload)) {
    throw new Error('Judge list response was not an array.');
  }

  return payload.map((row, index) => parseJudgeRecord(row, `/api/judges response[${index}]`));
}

async function createJudgeApi(
  baseUrl: string,
  body: { name: string; system_prompt: string; model: string; active: boolean },
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Create judge',
    'judge-setup',
    { endpoint: '/api/judges' },
    timeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  return parseJudgeRecord(payload, 'POST /api/judges response');
}

async function patchJudgeApi(
  baseUrl: string,
  judgeId: string,
  body: { active?: boolean; model?: string; system_prompt?: string },
  timeoutMs: number,
  fetchImpl: FetchLike,
  action: JudgeLifecycleAction = 'edit'
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges/${judgeId}`,
    `${action} judge`,
    'judge-setup',
    { endpoint: `/api/judges/${judgeId}`, validJudgeId: judgeId },
    timeoutMs,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  return parseJudgeRecord(payload, `PATCH /api/judges/${judgeId} response`);
}

async function deactivatePriorVerifierJudges(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const judges = await fetchJudgesApi(baseUrl, timeoutMs, fetchImpl);
  const verifierJudges = judges.filter(
    (judge) => judge.name.startsWith(VALID_JUDGE_PREFIX) || judge.name.startsWith(INVALID_JUDGE_PREFIX)
  );

  for (const judge of verifierJudges) {
    if (!judge.active) {
      continue;
    }

    await patchJudgeApi(baseUrl, judge.id, { active: false }, timeoutMs, fetchImpl, 'deactivate');
  }

  if (verifierJudges.length) {
    log(`Deactivated ${verifierJudges.filter((judge) => judge.active).length} prior verifier judge(s) before creating the current proof pair.`);
  }
}

async function assertNoForeignActiveAssignments(
  baseUrl: string,
  queueId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/assignments`,
    'Queue assignments',
    'assignment-setup',
    { endpoint: `/api/queues/${queueId}/assignments`, queueId },
    timeoutMs
  );

  const assignments = parseQueueAssignmentList(payload, {
    context: `/api/queues/${queueId}/assignments response`,
    requireQuestion: true,
  });

  const foreignActiveAssignment = assignments.find(
    (assignment) =>
      assignment.judge_status === 'active' &&
      !assignment.judge.name.startsWith(VALID_JUDGE_PREFIX) &&
      !assignment.judge.name.startsWith(INVALID_JUDGE_PREFIX)
  );

  if (foreignActiveAssignment) {
    throw new Error(
      `Verifier queue already has an active non-verifier assignment for judge ${foreignActiveAssignment.judge_id}.`
    );
  }
}

async function createAssignmentApi(
  baseUrl: string,
  queueId: string,
  questionId: string,
  judgeId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const payload = await readJsonResponse<Record<string, unknown>>(
    fetchImpl,
    `${baseUrl}/api/queues/${queueId}/assignments`,
    'Create assignment',
    'assignment-setup',
    { endpoint: `/api/queues/${queueId}/assignments`, queueId, questionId, validJudgeId: judgeId },
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

  return {
    id: asNonEmptyString(payload.id, 'Assignment id'),
    judge_id: asNonEmptyString(payload.judge_id, 'Assignment judge_id'),
    question_template_id: asNonEmptyString(payload.question_template_id, 'Assignment question_template_id'),
  };
}

async function ensureVerifierJudgesAndAssignments(
  baseUrl: string,
  queue: QueueRow,
  questions: [PersistedQuestion, PersistedQuestion],
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const verificationTag = createVerificationTag();
  await deactivatePriorVerifierJudges(baseUrl, timeoutMs, fetchImpl);
  await assertNoForeignActiveAssignments(baseUrl, queue.id, timeoutMs, fetchImpl);

  const validJudge = await createJudgeApi(
    baseUrl,
    {
      name: buildValidJudgeName(queue.queue_id, verificationTag),
      system_prompt: buildValidJudgePrompt(queue.queue_id, verificationTag),
      model: VALID_MODEL,
      active: true,
    },
    timeoutMs,
    fetchImpl
  );

  const invalidJudge = await createJudgeApi(
    baseUrl,
    {
      name: buildInvalidJudgeName(queue.queue_id, verificationTag),
      system_prompt: buildValidJudgePrompt(queue.queue_id, `${verificationTag}-invalid`),
      model: INVALID_MODEL,
      active: true,
    },
    timeoutMs,
    fetchImpl
  );

  const [questionOne, questionTwo] = questions;
  await createAssignmentApi(baseUrl, queue.id, questionOne.id, validJudge.id, timeoutMs, fetchImpl);
  await createAssignmentApi(baseUrl, queue.id, questionTwo.id, validJudge.id, timeoutMs, fetchImpl);
  await createAssignmentApi(baseUrl, queue.id, questionOne.id, invalidJudge.id, timeoutMs, fetchImpl);

  log(
    `Created verifier judges valid=${validJudge.id} invalid=${invalidJudge.id} and attached them to ${queue.id} for tracked question coverage.`
  );

  return { validJudge, invalidJudge };
}

async function loadPersistedAudit(supabase: SupabaseClient, runId: string) {
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
      id: asNonEmptyString(run.id, 'Persisted run id'),
      status: isRunStatus(run.status)
        ? run.status
        : (() => {
            throw new Error(`Persisted run ${runId} has invalid status ${String(run.status)}.`);
          })(),
      total: asNonNegativeInteger(run.total, 'Persisted run total'),
      completed: asNonNegativeInteger(run.completed, 'Persisted run completed'),
      errored: asNonNegativeInteger(run.errored, 'Persisted run errored'),
    } satisfies PersistedRunAudit,
    evaluations: (evaluations ?? []).map((row) => ({
      id: asNonEmptyString(row.id, 'Evaluation id'),
      status: isEvalStatus(row.status)
        ? row.status
        : (() => {
            throw new Error(`Persisted evaluation ${String(row.id)} has invalid status ${String(row.status)}.`);
          })(),
      verdict:
        row.verdict == null
          ? null
          : isVerdict(row.verdict)
            ? row.verdict
            : (() => {
                throw new Error(`Persisted evaluation ${String(row.id)} has invalid verdict ${String(row.verdict)}.`);
              })(),
      reasoning: asNullableString(row.reasoning, `Evaluation ${String(row.id)} reasoning`),
      prompt_snapshot: asNullableString(row.prompt_snapshot, `Evaluation ${String(row.id)} prompt_snapshot`),
      model_used: asNullableString(row.model_used, `Evaluation ${String(row.id)} model_used`),
      tokens_used:
        row.tokens_used == null
          ? null
          : asNonNegativeInteger(row.tokens_used, `Evaluation ${String(row.id)} tokens_used`),
      latency_ms:
        row.latency_ms == null
          ? null
          : asNonNegativeInteger(row.latency_ms, `Evaluation ${String(row.id)} latency_ms`),
      retry_count: asNonNegativeInteger(row.retry_count, `Evaluation ${String(row.id)} retry_count`),
      error_message: asNullableString(row.error_message, `Evaluation ${String(row.id)} error_message`),
    })) satisfies EvaluationAuditRow[],
  };
}

function buildQueryString(input: {
  judgeIds?: string[];
  questionIds?: string[];
  verdicts?: VerdictEnum[];
}) {
  const params = new URLSearchParams({ page: '1' });

  for (const judgeId of input.judgeIds ?? []) {
    params.append('judgeId', judgeId);
  }

  for (const questionId of input.questionIds ?? []) {
    params.append('questionId', questionId);
  }

  for (const verdict of input.verdicts ?? []) {
    params.append('verdict', verdict);
  }

  return params;
}

function summarizeFilter(params: URLSearchParams) {
  const raw = params.toString();
  return raw.length > 0 ? raw : 'page=1';
}

async function fetchResultsApi(
  baseUrl: string,
  queueId: string,
  params: URLSearchParams,
  timeoutMs: number,
  fetchImpl: FetchLike,
  refs: PhaseRefs
) {
  const url = `${baseUrl}/api/queues/${queueId}/results?${params.toString()}`;
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    url,
    'Results API',
    'results-assertions',
    { ...refs, endpoint: `/api/queues/${queueId}/results`, filter: summarizeFilter(params) },
    timeoutMs
  );

  try {
    return parseResultsResponse(payload, `${url} response`);
  } catch (error) {
    throw new ResultsVerifierPhaseError(
      'results-assertions',
      safeMessage(error),
      { ...refs, endpoint: `/api/queues/${queueId}/results`, filter: summarizeFilter(params) },
      error
    );
  }
}

function sortJudgePassRates(
  rows: Array<Pick<ResultsEvaluation, 'status' | 'verdict'> & { judge: Pick<Judge, 'id' | 'name'> }>
) {
  const completedRows = rows.filter((row) => row.status === 'completed');
  const judges = new Map<string, { judgeId: string; name: string; total: number; passCount: number }>();

  for (const row of completedRows) {
    const existing = judges.get(row.judge.id) ?? {
      judgeId: row.judge.id,
      name: row.judge.name,
      total: 0,
      passCount: 0,
    };

    existing.total += 1;
    if (row.verdict === 'pass') {
      existing.passCount += 1;
    }

    judges.set(row.judge.id, existing);
  }

  return [...judges.values()]
    .map((entry) => ({
      judgeId: entry.judgeId,
      name: entry.name,
      passRate: entry.total > 0 ? Math.round((entry.passCount / entry.total) * 100) : 0,
      total: entry.total,
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.judgeId.localeCompare(right.judgeId));
}

export function assertFilteredResultsResponse(input: {
  label: string;
  response: ResultsResponse;
  expectedRows: ResultsEvaluation[];
  expectedJudgeIds?: string[];
  expectedQuestionIds?: string[];
  expectedVerdicts?: VerdictEnum[];
}) {
  const expectedIds = [...new Set(input.expectedRows.map((row) => row.id))].sort();
  const actualIds = [...new Set(input.response.evaluations.map((row) => row.id))].sort();

  if (input.response.total !== input.expectedRows.length) {
    throw new Error(
      `${input.label} total ${input.response.total} did not match the expected row count ${input.expectedRows.length}.`
    );
  }

  if (input.response.evaluations.length !== input.expectedRows.length) {
    throw new Error(
      `${input.label} returned ${input.response.evaluations.length} rows on page 1, expected ${input.expectedRows.length}.`
    );
  }

  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`${input.label} returned an unexpected evaluation id set.`);
  }

  if (input.expectedJudgeIds?.length) {
    const allowedJudgeIds = new Set(input.expectedJudgeIds);
    const invalidRow = input.response.evaluations.find((row) => !allowedJudgeIds.has(row.judge.id));
    if (invalidRow) {
      throw new Error(`${input.label} included evaluation ${invalidRow.id} from judge ${invalidRow.judge.id}.`);
    }
  }

  if (input.expectedQuestionIds?.length) {
    const allowedQuestionIds = new Set(input.expectedQuestionIds);
    const invalidRow = input.response.evaluations.find((row) => !allowedQuestionIds.has(row.question.id));
    if (invalidRow) {
      throw new Error(`${input.label} included evaluation ${invalidRow.id} for question ${invalidRow.question.id}.`);
    }
  }

  if (input.expectedVerdicts?.length) {
    const allowedVerdicts = new Set(input.expectedVerdicts);
    const invalidRow = input.response.evaluations.find(
      (row) => row.verdict == null || !allowedVerdicts.has(row.verdict)
    );
    if (invalidRow) {
      throw new Error(`${input.label} included evaluation ${invalidRow.id} outside the requested verdict filter.`);
    }
  }

  const completedRows = input.expectedRows.filter((row) => row.status === 'completed');
  const expectedPassCount = completedRows.filter((row) => row.verdict === 'pass').length;
  const expectedPassRate = completedRows.length > 0 ? Math.round((expectedPassCount / completedRows.length) * 100) : 0;
  if (input.response.passRate !== expectedPassRate) {
    throw new Error(`${input.label} passRate ${input.response.passRate} did not match ${expectedPassRate}.`);
  }

  const expectedJudgePassRates = sortJudgePassRates(input.expectedRows);
  if (JSON.stringify(input.response.judgePassRates) !== JSON.stringify(expectedJudgePassRates)) {
    throw new Error(`${input.label} judgePassRates drifted from the filtered completed rows.`);
  }
}

function pickVerdictFilter(rows: ResultsEvaluation[]) {
  const verdict = rows.find((row) => row.status === 'completed' && row.verdict)?.verdict;
  if (!verdict) {
    throw new Error('The current verifier rows did not contain any completed verdicts to test the verdict filter.');
  }

  return verdict;
}

async function verifyResultsApiProof(input: {
  baseUrl: string;
  queueId: string;
  validJudgeId: string;
  invalidJudgeId: string;
  questionIds: [string, string];
  expectedCurrentTotal: number;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const baseParams = buildQueryString({ judgeIds: [input.validJudgeId, input.invalidJudgeId] });
  const baseResponse = await fetchResultsApi(
    input.baseUrl,
    input.queueId,
    baseParams,
    input.timeoutMs,
    input.fetchImpl,
    {
      queueId: input.queueId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
    }
  );

  if (baseResponse.total !== input.expectedCurrentTotal) {
    throw new Error(
      `Current verifier judge filters returned ${baseResponse.total} rows instead of ${input.expectedCurrentTotal}.`
    );
  }

  const currentCompleted = baseResponse.evaluations.filter((row) => row.status === 'completed');
  const currentErrored = baseResponse.evaluations.filter((row) => row.status === 'error');
  if (currentCompleted.length === 0 || currentErrored.length === 0) {
    throw new Error(
      `Expected mixed completed/error verifier rows, received completed=${currentCompleted.length} errored=${currentErrored.length}.`
    );
  }

  const questionOneResponse = await fetchResultsApi(
    input.baseUrl,
    input.queueId,
    buildQueryString({ judgeIds: [input.validJudgeId, input.invalidJudgeId], questionIds: [input.questionIds[0]] }),
    input.timeoutMs,
    input.fetchImpl,
    {
      queueId: input.queueId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
      questionId: input.questionIds[0],
    }
  );
  assertFilteredResultsResponse({
    label: 'question filter (question 1)',
    response: questionOneResponse,
    expectedRows: baseResponse.evaluations.filter((row) => row.question.id === input.questionIds[0]),
    expectedJudgeIds: [input.validJudgeId, input.invalidJudgeId],
    expectedQuestionIds: [input.questionIds[0]],
  });

  const questionTwoResponse = await fetchResultsApi(
    input.baseUrl,
    input.queueId,
    buildQueryString({ judgeIds: [input.validJudgeId, input.invalidJudgeId], questionIds: [input.questionIds[1]] }),
    input.timeoutMs,
    input.fetchImpl,
    {
      queueId: input.queueId,
      validJudgeId: input.validJudgeId,
      invalidJudgeId: input.invalidJudgeId,
      questionId: input.questionIds[1],
    }
  );
  assertFilteredResultsResponse({
    label: 'question filter (question 2)',
    response: questionTwoResponse,
    expectedRows: baseResponse.evaluations.filter((row) => row.question.id === input.questionIds[1]),
    expectedJudgeIds: [input.validJudgeId, input.invalidJudgeId],
    expectedQuestionIds: [input.questionIds[1]],
  });

  const validJudgeResponse = await fetchResultsApi(
    input.baseUrl,
    input.queueId,
    buildQueryString({ judgeIds: [input.validJudgeId] }),
    input.timeoutMs,
    input.fetchImpl,
    { queueId: input.queueId, validJudgeId: input.validJudgeId, filter: `judgeId=${input.validJudgeId}` }
  );
  assertFilteredResultsResponse({
    label: 'judge filter (valid)',
    response: validJudgeResponse,
    expectedRows: baseResponse.evaluations.filter((row) => row.judge.id === input.validJudgeId),
    expectedJudgeIds: [input.validJudgeId],
  });

  const invalidJudgeResponse = await fetchResultsApi(
    input.baseUrl,
    input.queueId,
    buildQueryString({ judgeIds: [input.invalidJudgeId] }),
    input.timeoutMs,
    input.fetchImpl,
    { queueId: input.queueId, invalidJudgeId: input.invalidJudgeId, filter: `judgeId=${input.invalidJudgeId}` }
  );
  assertFilteredResultsResponse({
    label: 'judge filter (invalid)',
    response: invalidJudgeResponse,
    expectedRows: baseResponse.evaluations.filter((row) => row.judge.id === input.invalidJudgeId),
    expectedJudgeIds: [input.invalidJudgeId],
  });

  const verdictFilter = pickVerdictFilter(validJudgeResponse.evaluations);
  const verdictResponse = await fetchResultsApi(
    input.baseUrl,
    input.queueId,
    buildQueryString({ judgeIds: [input.validJudgeId], verdicts: [verdictFilter] }),
    input.timeoutMs,
    input.fetchImpl,
    {
      queueId: input.queueId,
      validJudgeId: input.validJudgeId,
      filter: `judgeId=${input.validJudgeId}&verdict=${verdictFilter}`,
    }
  );
  assertFilteredResultsResponse({
    label: 'verdict filter',
    response: verdictResponse,
    expectedRows: validJudgeResponse.evaluations.filter((row) => row.verdict === verdictFilter),
    expectedJudgeIds: [input.validJudgeId],
    expectedVerdicts: [verdictFilter],
  });

  log(
    `Results API proof passed for queue=${input.queueId}: currentTotal=${baseResponse.total}, completed=${currentCompleted.length}, errored=${currentErrored.length}, verdictFilter=${verdictFilter}.`
  );

  return {
    currentTotal: baseResponse.total,
    currentCompleted: currentCompleted.length,
    currentErrored: currentErrored.length,
    verdictFilter,
  } satisfies ResultsProofSummary;
}

async function verifyResultsPageReachability(
  baseUrl: string,
  queueId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const pageUrl = `${baseUrl}/queues/${queueId}/results`;
  const body = await readPageBody(fetchImpl, pageUrl, timeoutMs);

  if (!body.includes('Results')) {
    throw new Error('Results page HTML did not include the Results heading.');
  }

  log(`Results page route is reachable at ${pageUrl}.`);
  return pageUrl;
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
  await runPhase('upload', { endpoint: '/api/upload', queueLabel: target.queueLabel }, async () => {
    await uploadFixture(options, fixtureItems, fetchImpl);
  });

  const persistedTarget = await runPhase('upload', { queueLabel: target.queueLabel }, async () =>
    findPersistedQueueAndQuestions(supabase, target)
  );

  const verifierPair = await runPhase(
    'judge-setup',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
    },
    async () =>
      ensureVerifierJudgesAndAssignments(
        options.baseUrl,
        persistedTarget.queue,
        persistedTarget.questions,
        options.timeoutMs,
        fetchImpl
      )
  );

  const expectedCurrentTotal =
    (persistedTarget.answerCountByQuestionId.get(persistedTarget.questions[0].id) ?? 0) * 2 +
    (persistedTarget.answerCountByQuestionId.get(persistedTarget.questions[1].id) ?? 0);

  const previewPayload = await runPhase(
    'run-start',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      validJudgeId: verifierPair.validJudge.id,
      invalidJudgeId: verifierPair.invalidJudge.id,
    },
    async () =>
      readJsonResponse<unknown>(
        fetchImpl,
        `${options.baseUrl}/api/queues/${persistedTarget.queue.id}/run-preview`,
        'Run preview',
        'run-start',
        {
          endpoint: `/api/queues/${persistedTarget.queue.id}/run-preview`,
          queueId: persistedTarget.queue.id,
          queueLabel: persistedTarget.queue.queue_id,
          validJudgeId: verifierPair.validJudge.id,
          invalidJudgeId: verifierPair.invalidJudge.id,
        },
        options.timeoutMs
      )
  );

  if (!isObject(previewPayload) || typeof previewPayload.total !== 'number') {
    throw new ResultsVerifierPhaseError(
      'run-start',
      'Run preview response was malformed.',
      {
        endpoint: `/api/queues/${persistedTarget.queue.id}/run-preview`,
        queueId: persistedTarget.queue.id,
        queueLabel: persistedTarget.queue.queue_id,
      }
    );
  }

  const startedPayload = await runPhase(
    'run-start',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      validJudgeId: verifierPair.validJudge.id,
      invalidJudgeId: verifierPair.invalidJudge.id,
    },
    async () =>
      readJsonResponse<unknown>(
        fetchImpl,
        `${options.baseUrl}/api/queues/${persistedTarget.queue.id}/runs`,
        'Run start',
        'run-start',
        {
          endpoint: `/api/queues/${persistedTarget.queue.id}/runs`,
          queueId: persistedTarget.queue.id,
          queueLabel: persistedTarget.queue.queue_id,
          validJudgeId: verifierPair.validJudge.id,
          invalidJudgeId: verifierPair.invalidJudge.id,
        },
        options.timeoutMs,
        { method: 'POST' }
      )
  );
  const started = parseRunStartPayload(startedPayload);
  log(`Run started for queue=${persistedTarget.queue.id}: run=${started.runId} total=${started.total} previewTotal=${previewPayload.total}.`);

  const terminal = await runPhase(
    'run-poll',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      validJudgeId: verifierPair.validJudge.id,
      invalidJudgeId: verifierPair.invalidJudge.id,
    },
    async () =>
      pollRunUntilTerminal({
        baseUrl: options.baseUrl,
        queueId: persistedTarget.queue.id,
        runId: started.runId,
        timeoutMs: options.timeoutMs,
        pollMs: options.pollMs,
        fetchImpl,
      })
  );
  log(`Run reached ${terminal.progress.status} after ${terminal.attempts} poll(s).`);

  const persistedAudit = await runPhase(
    'run-poll',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      validJudgeId: verifierPair.validJudge.id,
      invalidJudgeId: verifierPair.invalidJudge.id,
    },
    async () => loadPersistedAudit(supabase, started.runId)
  );
  assertPersistedAudit({
    run: persistedAudit.run,
    evaluations: persistedAudit.evaluations,
    expectedTotal: started.total,
  });

  const resultsProof = await runPhase(
    'results-assertions',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      validJudgeId: verifierPair.validJudge.id,
      invalidJudgeId: verifierPair.invalidJudge.id,
    },
    async () =>
      verifyResultsApiProof({
        baseUrl: options.baseUrl,
        queueId: persistedTarget.queue.id,
        validJudgeId: verifierPair.validJudge.id,
        invalidJudgeId: verifierPair.invalidJudge.id,
        questionIds: [persistedTarget.questions[0].id, persistedTarget.questions[1].id],
        expectedCurrentTotal,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      })
  );

  const pageUrl = await runPhase(
    'page-confirmation',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      page: `/queues/${persistedTarget.queue.id}/results`,
    },
    async () => verifyResultsPageReachability(options.baseUrl, persistedTarget.queue.id, options.timeoutMs, fetchImpl)
  );

  return {
    queueId: persistedTarget.queue.id,
    queueLabel: persistedTarget.queue.queue_id,
    runId: started.runId,
    runStatus: terminal.progress.status,
    previewTotal: asNonNegativeInteger(previewPayload.total, 'Run preview total'),
    startedTotal: started.total,
    verifierJudgeIds: {
      valid: verifierPair.validJudge.id,
      invalid: verifierPair.invalidJudge.id,
    },
    verifierJudgeNames: {
      valid: verifierPair.validJudge.name,
      invalid: verifierPair.invalidJudge.name,
    },
    questionIds: [persistedTarget.questions[0].id, persistedTarget.questions[1].id],
    resultsProof,
    pageUrl,
  };
}

const isDirectRun = /(^|\/)verify-s03-live\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(
      `OK queue=${summary.queueId} run=${summary.runId} validJudge=${summary.verifierJudgeIds.valid} invalidJudge=${summary.verifierJudgeIds.invalid} results=${summary.resultsProof.currentTotal}/${summary.resultsProof.currentCompleted}/${summary.resultsProof.currentErrored} verdictFilter=${summary.resultsProof.verdictFilter}.`
    );
    log(`Results page route: ${summary.pageUrl}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : `[verify:s03-live] ${safeMessage(error)}`);
    process.exit(1);
  }
}
