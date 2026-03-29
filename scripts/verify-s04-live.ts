import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import {
  parseQueueAssignmentList,
  parseQueueQuestionList,
  type QueueAssignmentRecord,
} from '../src/lib/assignments/queue-assignment-state';
import { parseJudgeList, parseJudgeRecord } from '../src/lib/judges/judge-lifecycle';
import { parseResultsResponse } from '../src/lib/results/fetch-json';
import { parseSubmissionDetailResponse } from '../src/lib/submissions/fetch-json';
import type {
  ResultsEvaluation,
  SubmissionDetailAttachment,
  SubmissionDetailResponse,
  UploadResult,
} from '../src/types/api';
import type {
  EvalStatusEnum,
  Judge,
  QuestionTemplate,
  RunStatusEnum,
  VerdictEnum,
} from '../src/types/db';
import {
  assertPersistedAudit,
  pollRunUntilTerminal,
  type EvaluationAuditRow,
  type PersistedRunAudit,
} from './verify-s01-live';
import { parsePlanMarker } from '../src/lib/ai/plan-marker';
import {
  assertPersistedAssignmentRow,
  assertRunPreviewPayload,
  assertUploadResultPayload,
  loadFixture,
} from './verify-s02-live';
import { assertFilteredResultsResponse } from './verify-s03-live';
import { assertPersistedAttachmentRow, assertDetailAttachmentTruth } from './verify-m005-s01';

type FetchLike = typeof fetch;
type ReadFileLike = typeof readFile;

type PhaseName =
  | 'schema-readiness'
  | 'upload'
  | 'judge-crud'
  | 'assignment-persistence'
  | 'run-start'
  | 'run-poll'
  | 'results-assertions'
  | 'page-confirmation'
  | 'submission-detail'
  | 'submission-page'
  | 'scenario-proof';

type PhaseRefs = {
  queueId?: string;
  queueLabel?: string;
  judgeId?: string;
  validJudgeId?: string;
  invalidJudgeId?: string;
  questionId?: string;
  assignmentId?: string;
  runId?: string;
  submissionId?: string;
  submissionExternalId?: string;
  endpoint?: string;
  page?: string;
  detailUrl?: string;
  filter?: string;
  attachmentId?: string;
  storagePath?: string;
};

type QueueRow = {
  id: string;
  queue_id: string;
  created_at: string;
};

type ScenarioName = 'text-only' | 'multimodal' | 'blocked';

type ScenarioProofEntry = {
  scenario: ScenarioName;
  evaluationId: string;
  status: EvalStatusEnum;
  verdict: VerdictEnum | null;
  modelUsed: string;
  promptSnapshot: string;
  errorMessage: string | null;
};

type AttachmentDetail = {
  id: string;
  externalAttachmentId: string;
  fileName: string;
  mediaType: string;
  storageStatus: SubmissionDetailAttachment['storage_status'];
};

type AttachmentProofSummary = {
  submissionId: string;
  submissionExternalId: string;
  detailUrl: string;
  detailApiUrl: string;
  attachments: AttachmentDetail[];
};

type AssignmentForwardingEntry = {
  questionId: string;
  assignmentId: string;
  attachmentForwarding: boolean;
};

const SCENARIO_NAMES: ScenarioName[] = ['text-only', 'multimodal', 'blocked'];

type FixtureSummary = UploadResult & {
  queueIds: string[];
};

type FixtureTarget = {
  queueLabel: string;
  questionExternalIds: [string, string];
};

type RunStartResponse = {
  runId: string;
  total: number;
};

type SetupAssignmentTarget = {
  question: PersistedQuestion;
  answerCount: number;
  assignmentId: string;
  attachmentForwarding: boolean;
};

type AssignmentProofSummary = {
  baseline: number;
  active: number;
  inactive: number;
  reactivated: number;
  inactiveAssignments: number;
};

type RunProofSummary = {
  runId: string;
  status: RunStatusEnum;
  previewTotal: number;
  startedTotal: number;
  completedRows: number;
  erroredRows: number;
  retriedRows: number;
};

type ResultsProofSummary = {
  currentTotal: number;
  currentCompleted: number;
  currentErrored: number;
  verdictFilter: VerdictEnum;
  evaluations: ResultsEvaluation[];
};

export type SetupQuestionSummary = {
  id: string;
  externalId: string;
  questionText: string;
  answerCount: number;
  validAssignmentId: string;
  invalidAssignmentId: string | null;
};

export type InspectionUrls = {
  queues: string;
  queueDetail: string;
  judges: string;
  validJudgeDetail: string;
  invalidJudgeDetail: string;
  assign: string;
  run: string;
  results: string;
};

export type ApiUrls = {
  runPreview: string;
  runStart: string;
  runProgress: string;
  results: string;
  submissionDetail: string;
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
  verifierJudgeIds: {
    valid: string;
    invalid: string;
  };
  verifierJudgeNames: {
    valid: string;
    invalid: string;
  };
  questionRefs: [SetupQuestionSummary, SetupQuestionSummary];
  assignmentProof: AssignmentProofSummary;
  run: RunProofSummary;
  resultsProof: ResultsProofSummary;
  attachmentProof: AttachmentProofSummary;
  assignmentForwarding: AssignmentForwardingEntry[];
  scenarioProof: ScenarioProofEntry[];
  inspectionUrls: InspectionUrls;
  apiUrls: ApiUrls;
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

const DEFAULT_FIXTURE_PATH = 'scripts/verify-s04-live.fixture.json';
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
const VALID_MODEL = process.env.S04_VERIFY_MODEL ?? process.env.S03_VERIFY_MODEL ?? 'gateway/multimodal-model';
const INVALID_MODEL = 'openai/not-a-real-model-s04-live';
const VALID_JUDGE_PREFIX = 'S04 Live Results Valid';
const INVALID_JUDGE_PREFIX = 'S04 Live Results Invalid';
const ATTACHMENT_FORWARDING_INDEX = 1;
const VERIFIER_PROMPT_FIELDS = ['questionText', 'answer', 'questionType'] as const;

function shouldForwardAttachmentsForQuestion(index: number) {
  return index === ATTACHMENT_FORWARDING_INDEX;
}

const execFileAsync = promisify(execFile);

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
  return `[verify:s04-live] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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
    throw new VerifierPhaseError(phase, `${label} returned a non-JSON response (${response.status}).`, refs, error);
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
  const orderedQuestionIds: string[] = [];
  const seenQuestionIds = new Set<string>();

  for (const item of items) {
    if (item.queueId !== queueLabel) {
      continue;
    }

    for (const question of item.questions) {
      if (seenQuestionIds.has(question.data.id)) {
        continue;
      }

      seenQuestionIds.add(question.data.id);
      orderedQuestionIds.push(question.data.id);
    }
  }

  if (orderedQuestionIds.length < 2) {
    throw new Error(`Fixture queue ${queueLabel} must include at least two tracked questions.`);
  }

  return {
    queueLabel,
    questionExternalIds: [orderedQuestionIds[0], orderedQuestionIds[1]],
  };
}

function sanitizeLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function createVerificationTag() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

function buildValidJudgeName(queueLabel: string, tag: string) {
  return `${VALID_JUDGE_PREFIX} [${sanitizeLabel(queueLabel)}] [${tag}]`;
}

function buildInvalidJudgeName(queueLabel: string, tag: string) {
  return `${INVALID_JUDGE_PREFIX} [${sanitizeLabel(queueLabel)}] [${tag}]`;
}

function buildValidJudgePrompt(queueLabel: string, tag: string) {
  return [
    `You are the S04 live verifier judge for ${queueLabel}.`,
    'Read the answer payload and obey the verdictHint field exactly.',
    'If verdictHint is pass, return verdict=pass.',
    'If verdictHint is fail, return verdict=fail.',
    'If verdictHint is inconclusive, return verdict=inconclusive.',
    'Always include a short reasoning sentence that mentions the evidence field.',
    `verification_tag=${tag}`,
  ].join('\n');
}

function log(message: string) {
  console.log(`[verify:s04-live] ${message}`);
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
    fixturePath: parsed.values.fixture ?? env.S04_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.S04_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.S04_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

export function assertRunStartPayload(payload: unknown): RunStartResponse {
  if (!isObject(payload)) {
    throw new Error('Run start response was not an object.');
  }

  return {
    runId: asNonEmptyString(payload.runId, 'Run start response runId'),
    total: asNonNegativeInteger(payload.total, 'Run start response total'),
  };
}

export function buildInspectionUrls(
  baseUrl: string,
  queueId: string,
  validJudgeId: string,
  invalidJudgeId: string,
  submissionId: string
): InspectionUrls {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  return {
    queues: `${normalizedBaseUrl}/queues`,
    queueDetail: `${normalizedBaseUrl}/queues/${queueId}`,
    judges: `${normalizedBaseUrl}/judges`,
    validJudgeDetail: `${normalizedBaseUrl}/judges/${validJudgeId}`,
    invalidJudgeDetail: `${normalizedBaseUrl}/judges/${invalidJudgeId}`,
    assign: `${normalizedBaseUrl}/queues/${queueId}/assign`,
    run: `${normalizedBaseUrl}/queues/${queueId}/run`,
    results: `${normalizedBaseUrl}/queues/${queueId}/results`,
    submissionDetail: `${normalizedBaseUrl}/queues/${queueId}/submissions/${submissionId}?source=results`,
  };
}

export function buildApiUrls(
  baseUrl: string,
  queueId: string,
  runId: string,
  resultsQueryString: string,
  submissionId: string
): ApiUrls {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  return {
    runPreview: `${normalizedBaseUrl}/api/queues/${queueId}/run-preview`,
    runStart: `${normalizedBaseUrl}/api/queues/${queueId}/runs`,
    runProgress: `${normalizedBaseUrl}/api/queues/${queueId}/runs/${runId}`,
    results: `${normalizedBaseUrl}/api/queues/${queueId}/results?${resultsQueryString}`,
    submissionDetail: `${normalizedBaseUrl}/api/queues/${queueId}/submissions/${submissionId}`,
  };
}

export function assertInspectionUrls(urls: Partial<InspectionUrls>): InspectionUrls {
  const requiredKeys: Array<keyof InspectionUrls> = [
    'queues',
    'queueDetail',
    'judges',
    'validJudgeDetail',
    'invalidJudgeDetail',
    'assign',
    'run',
    'results',
    'submissionDetail',
  ];

  for (const key of requiredKeys) {
    const value = urls[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Verification summary is missing inspection URL ${key}.`);
    }
  }

  return urls as InspectionUrls;
}

export function formatSetupSummary(summary: LiveVerificationSummary) {
  const questionRefs = summary.questionRefs
    .map(
      (question) =>
        `${question.id}:${question.validAssignmentId}:${question.invalidAssignmentId ?? 'none'}:${question.answerCount}`
    )
    .join(',');

  const attachmentRefs = summary.attachmentProof.attachments
    .map((attachment) => `${attachment.id}:${attachment.fileName}:${attachment.storageStatus}`)
    .join(',');

  const forwardingRefs = summary.assignmentForwarding
    .map((entry) =>
      `${entry.questionId}:${entry.assignmentId}:${entry.attachmentForwarding ? 'forward' : 'no-forward'}`
    )
    .join(',');

  const scenarioRefs = summary.scenarioProof
    .map((entry) => {
      const base = `${entry.scenario}:${entry.evaluationId}:${entry.status}:${entry.modelUsed}`;
      return entry.errorMessage ? `${base}:${entry.errorMessage}` : base;
    })
    .join(',');

  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `validJudge=${summary.verifierJudgeIds.valid}`,
    `invalidJudge=${summary.verifierJudgeIds.invalid}`,
    `questions=${questionRefs}`,
    `previews=${summary.assignmentProof.baseline}/${summary.assignmentProof.active}/${summary.assignmentProof.inactive}/${summary.assignmentProof.reactivated}`,
    `inactiveAssignments=${summary.assignmentProof.inactiveAssignments}`,
    `run=${summary.run.runId}:${summary.run.status}:${summary.run.previewTotal}/${summary.run.startedTotal}:${summary.run.completedRows}/${summary.run.erroredRows}/${summary.run.retriedRows}`,
    `verdictFilter=${summary.resultsProof.verdictFilter}`,
    `results=${summary.resultsProof.currentTotal}/${summary.resultsProof.currentCompleted}/${summary.resultsProof.currentErrored}`,
    `submission=${summary.attachmentProof.submissionId}:${summary.attachmentProof.submissionExternalId}`,
    `detailUrl=${summary.attachmentProof.detailUrl}`,
    `detailApiUrl=${summary.attachmentProof.detailApiUrl}`,
    `attachments=${attachmentRefs || 'none'}`,
    `forwarding=${forwardingRefs}`,
    `scenarios=${scenarioRefs}`,
  ].join(' ');
}

export function formatInspectionTargets(summary: LiveVerificationSummary) {
  const inspectionUrls = assertInspectionUrls(summary.inspectionUrls);

  return [
    `queues=${inspectionUrls.queues}`,
    `queueDetail=${inspectionUrls.queueDetail}`,
    `judges=${inspectionUrls.judges}`,
    `validJudgeDetail=${inspectionUrls.validJudgeDetail}`,
    `invalidJudgeDetail=${inspectionUrls.invalidJudgeDetail}`,
    `assign=${inspectionUrls.assign}`,
    `run=${inspectionUrls.run}`,
    `results=${inspectionUrls.results}`,
    `submissionDetail=${inspectionUrls.submissionDetail}`,
  ].join(' ');
}

export function formatApiTargets(summary: LiveVerificationSummary) {
  return [
    `runPreview=${summary.apiUrls.runPreview}`,
    `runStart=${summary.apiUrls.runStart}`,
    `runProgress=${summary.apiUrls.runProgress}`,
    `results=${summary.apiUrls.results}`,
    `submissionDetail=${summary.apiUrls.submissionDetail}`,
  ].join(' ');
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
    const payload = await readJsonResponse<unknown>(
      fetchImpl,
      `${baseUrl}/api/judges`,
      'Judge list',
      'schema-readiness',
      { endpoint: '/api/judges' },
      timeoutMs
    );

    parseJudgeList(payload, '/api/judges response');
  });

  for (const table of REQUIRED_TABLES) {
    await runPhase('schema-readiness', { endpoint: table }, async () => {
      await checkTableReadable(supabase, table, 'schema-readiness', { endpoint: table });
    });
  }

  log('Schema readiness passed for setup, run, and results tables.');
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

async function findPersistedQueueAndQuestions(supabase: SupabaseClient, target: FixtureTarget) {
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
    .in('external_id', [...target.questionExternalIds]);

  if (questionError) {
    throw new Error(questionError.message);
  }

  const questionByExternalId = new Map(
    (questionRows ?? []).map((row) => [row.external_id, row as PersistedQuestion])
  );
  const firstQuestion = questionByExternalId.get(target.questionExternalIds[0]);
  const secondQuestion = questionByExternalId.get(target.questionExternalIds[1]);

  if (!firstQuestion || !secondQuestion) {
    throw new Error(
      `Persisted questions did not include both tracked external ids ${target.questionExternalIds.join(', ')}.`
    );
  }

  const { data: answerRows, error: answerError } = await supabase
    .from('submission_answers')
    .select('question_template_id')
    .in('question_template_id', [firstQuestion.id, secondQuestion.id]);

  if (answerError) {
    throw new Error(answerError.message);
  }

  const answerCountByQuestionId = new Map<string, number>();
  for (const row of answerRows ?? []) {
    const questionId = asNonEmptyString(row.question_template_id, 'submission_answers.question_template_id');
    answerCountByQuestionId.set(questionId, (answerCountByQuestionId.get(questionId) ?? 0) + 1);
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

async function findSubmissionWithAttachments(
  supabase: SupabaseClient,
  queueId: string,
  queueLabel: string,
  refs: PhaseRefs
) {
  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('id, external_id')
    .eq('queue_id', queueId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new VerifierPhaseError('submission-detail', error.message, { ...refs, queueId, queueLabel });
  }

  for (const submission of (submissions ?? []) as Array<{ id: string; external_id: string }>) {
    const attachments = await loadSubmissionAttachments(supabase, submission.id, {
      ...refs,
      submissionId: submission.id,
      submissionExternalId: submission.external_id,
    });

    if (attachments.length > 0) {
      return {
        submissionId: submission.id,
        submissionExternalId: submission.external_id,
        attachments,
      };
    }
  }

  throw new VerifierPhaseError('submission-detail', 'No submission with attachments was found.', {
    ...refs,
    queueId,
    queueLabel,
  });
}

async function fetchJudgesApi(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges`,
    'Judge list',
    'judge-crud',
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
    'judge-crud',
    { endpoint: `/api/judges/${judgeId}`, judgeId },
    timeoutMs
  );

  return parseJudgeRecord(payload, `/api/judges/${judgeId} response`);
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
    'judge-crud',
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
  phase: PhaseName = 'judge-crud'
) {
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    `${baseUrl}/api/judges/${judgeId}`,
    'Update judge',
    phase,
    { endpoint: `/api/judges/${judgeId}`, judgeId },
    timeoutMs,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  return parseJudgeRecord(payload, `PATCH /api/judges/${judgeId} response`);
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
    'assignment-persistence',
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
  attachmentForwarding: boolean,
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
        attachment_forwarding: attachmentForwarding,
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

  const text = await response.text();
  let payload: unknown = null;

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

async function loadPersistedJudgeRow(supabase: SupabaseClient, judgeId: string, refs: PhaseRefs) {
  const { data, error } = await supabase.from('judges').select('*').eq('id', judgeId).maybeSingle();

  if (error || !data) {
    throw new VerifierPhaseError('judge-crud', error?.message ?? `Judge ${judgeId} was not persisted.`, refs);
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

async function loadSubmissionAttachments(
  supabase: SupabaseClient,
  submissionId: string,
  refs: PhaseRefs
) {
  const { data, error } = await supabase
    .from('submission_attachments')
    .select('*')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new VerifierPhaseError('submission-detail', error.message, { ...refs, submissionId });
  }

  return (data ?? []).map((row) => assertPersistedAttachmentRow(row));
}

async function assertJudgeAcrossSurfaces(input: {
  baseUrl: string;
  supabase: SupabaseClient;
  judgeId: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  expected: Pick<Judge, 'name' | 'system_prompt' | 'model' | 'active'>;
  refs: PhaseRefs;
  phase?: PhaseName;
}) {
  const phase = input.phase ?? 'judge-crud';
  const detailJudge = await fetchJudgeApi(input.baseUrl, input.judgeId, input.timeoutMs, input.fetchImpl);
  const listedJudge = (await fetchJudgesApi(input.baseUrl, input.timeoutMs, input.fetchImpl)).find(
    (judge) => judge.id === input.judgeId
  );
  const persistedJudge = await loadPersistedJudgeRow(input.supabase, input.judgeId, input.refs);

  if (!listedJudge) {
    throw new VerifierPhaseError(phase, 'Judge list did not include the verifier judge.', input.refs);
  }

  for (const judge of [detailJudge, listedJudge, persistedJudge]) {
    if (judge.name !== input.expected.name) {
      throw new VerifierPhaseError(phase, `Verifier judge name drifted to ${judge.name}.`, input.refs);
    }

    if (judge.system_prompt !== input.expected.system_prompt) {
      throw new VerifierPhaseError(phase, 'Verifier judge prompt did not persist the expected value.', input.refs);
    }

    if (judge.model !== input.expected.model) {
      throw new VerifierPhaseError(phase, `Verifier judge model drifted to ${judge.model}.`, input.refs);
    }

    if (judge.active !== input.expected.active) {
      throw new VerifierPhaseError(
        phase,
        `Verifier judge active state drifted to ${judge.active ? 'active' : 'inactive'}.`,
        input.refs
      );
    }
  }
}

async function deactivatePriorVerifierJudges(baseUrl: string, timeoutMs: number, fetchImpl: FetchLike) {
  const judges = await fetchJudgesApi(baseUrl, timeoutMs, fetchImpl);
  const verifierJudges = judges.filter(
    (judge) => judge.name.startsWith(VALID_JUDGE_PREFIX) || judge.name.startsWith(INVALID_JUDGE_PREFIX)
  );

  let deactivatedCount = 0;
  for (const judge of verifierJudges) {
    if (!judge.active) {
      continue;
    }

    await patchJudgeApi(baseUrl, judge.id, { active: false }, timeoutMs, fetchImpl, 'judge-crud');
    deactivatedCount += 1;
  }

  if (deactivatedCount > 0) {
    log(`Deactivated ${deactivatedCount} prior S04 verifier judge(s) before the current proof run.`);
  }
}

async function assertNoForeignActiveAssignments(
  baseUrl: string,
  queueId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const assignments = await fetchAssignmentsApi(baseUrl, queueId, timeoutMs, fetchImpl);

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

async function clearPriorVerifierAssignments(
  baseUrl: string,
  queueId: string,
  timeoutMs: number,
  fetchImpl: FetchLike
) {
  const assignments = await fetchAssignmentsApi(baseUrl, queueId, timeoutMs, fetchImpl);
  const verifierAssignments = assignments.filter(
    (assignment) =>
      assignment.judge.name.startsWith(VALID_JUDGE_PREFIX) || assignment.judge.name.startsWith(INVALID_JUDGE_PREFIX)
  );

  for (const assignment of verifierAssignments) {
    await deleteAssignmentApi(
      baseUrl,
      queueId,
      assignment.question_template_id,
      assignment.judge_id,
      timeoutMs,
      fetchImpl
    );
  }

  if (verifierAssignments.length > 0) {
    log(`Cleared ${verifierAssignments.length} prior S04 verifier assignment row(s) before baseline preview.`);
  }
}

async function createVerifierJudges(input: {
  supabase: SupabaseClient;
  baseUrl: string;
  queue: QueueRow;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const tag = createVerificationTag();
  await deactivatePriorVerifierJudges(input.baseUrl, input.timeoutMs, input.fetchImpl);
  await clearPriorVerifierAssignments(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);
  await assertNoForeignActiveAssignments(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);

  const validExpected = {
    name: buildValidJudgeName(input.queue.queue_id, tag),
    system_prompt: buildValidJudgePrompt(input.queue.queue_id, tag),
    model: VALID_MODEL,
    active: true,
  } satisfies Pick<Judge, 'name' | 'system_prompt' | 'model' | 'active'>;

  const invalidExpected = {
    name: buildInvalidJudgeName(input.queue.queue_id, tag),
    system_prompt: buildValidJudgePrompt(input.queue.queue_id, `${tag}-invalid`),
    model: INVALID_MODEL,
    active: true,
  } satisfies Pick<Judge, 'name' | 'system_prompt' | 'model' | 'active'>;

  const validJudge = await createJudgeApi(input.baseUrl, validExpected, input.timeoutMs, input.fetchImpl);
  const invalidJudge = await createJudgeApi(input.baseUrl, invalidExpected, input.timeoutMs, input.fetchImpl);

  await assertJudgeAcrossSurfaces({
    baseUrl: input.baseUrl,
    supabase: input.supabase,
    judgeId: validJudge.id,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    expected: validExpected,
    refs: { queueId: input.queue.id, queueLabel: input.queue.queue_id, validJudgeId: validJudge.id },
  });
  await assertJudgeAcrossSurfaces({
    baseUrl: input.baseUrl,
    supabase: input.supabase,
    judgeId: invalidJudge.id,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    expected: invalidExpected,
    refs: { queueId: input.queue.id, queueLabel: input.queue.queue_id, invalidJudgeId: invalidJudge.id },
  });

  log(`Judge CRUD passed for valid=${validJudge.id} invalid=${invalidJudge.id}.`);

  return { validJudge, invalidJudge };
}

function findAssignment(assignments: QueueAssignmentRecord[], questionId: string, judgeId: string) {
  return assignments.find(
    (assignment) => assignment.question_template_id === questionId && assignment.judge_id === judgeId
  );
}

async function verifyAssignmentSurfaces(input: {
  baseUrl: string;
  queueId: string;
  judgeId: string;
  expectedStatus: 'active' | 'inactive';
  expectedAssignments: SetupAssignmentTarget[];
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const refs: PhaseRefs = { queueId: input.queueId, judgeId: input.judgeId };
  const assignments = await fetchAssignmentsApi(input.baseUrl, input.queueId, input.timeoutMs, input.fetchImpl);

  for (const expected of input.expectedAssignments) {
    const assignment = findAssignment(assignments, expected.question.id, input.judgeId);
    if (!assignment) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        'Assignment list did not include the verifier row.',
        { ...refs, questionId: expected.question.id }
      );
    }

    if (assignment.id !== expected.assignmentId) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Assignment id drifted from ${expected.assignmentId} to ${assignment.id}.`,
        { ...refs, questionId: expected.question.id, assignmentId: assignment.id ?? undefined }
      );
    }

    if (assignment.judge_status !== input.expectedStatus) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Assignment status was ${assignment.judge_status} instead of ${input.expectedStatus}.`,
        { ...refs, questionId: expected.question.id, assignmentId: assignment.id ?? undefined }
      );
    }

    if (assignment.prompt_fields.join(',') !== [...VERIFIER_PROMPT_FIELDS].join(',')) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        'Assignment prompt_fields drifted from the verifier payload.',
        { ...refs, questionId: expected.question.id, assignmentId: assignment.id ?? undefined }
      );
    }

    if (assignment.attachment_forwarding !== expected.attachmentForwarding) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Assignment forwarding state was ${assignment.attachment_forwarding} instead of ${expected.attachmentForwarding}.`,
        { ...refs, questionId: expected.question.id, assignmentId: assignment.id ?? undefined }
      );
    }
  }

  const questions = await fetchQuestionsApi(input.baseUrl, input.queueId, input.timeoutMs, input.fetchImpl);
  for (const expected of input.expectedAssignments) {
    const question = questions.find((row) => row.id === expected.question.id);
    const questionAssignment = question?.assignments.find((row) => row.judge_id === input.judgeId);

    if (!question || !questionAssignment) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        'Queue question hydration did not include the verifier assignment.',
        { ...refs, questionId: expected.question.id }
      );
    }

    if (questionAssignment.id !== expected.assignmentId) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Queue question assignment id drifted from ${expected.assignmentId} to ${questionAssignment.id}.`,
        { ...refs, questionId: expected.question.id, assignmentId: questionAssignment.id ?? undefined }
      );
    }

    if (questionAssignment.judge_status !== input.expectedStatus) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Queue question assignment status was ${questionAssignment.judge_status} instead of ${input.expectedStatus}.`,
        { ...refs, questionId: expected.question.id, assignmentId: questionAssignment.id ?? undefined }
      );
    }

    if (questionAssignment.attachment_forwarding !== expected.attachmentForwarding) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Queue question assignment forwarding was ${questionAssignment.attachment_forwarding} instead of ${expected.attachmentForwarding}.`,
        { ...refs, questionId: expected.question.id, assignmentId: questionAssignment.id ?? undefined }
      );
    }
  }
}

function assertTrackedPreviewRows(input: {
  preview: ReturnType<typeof assertRunPreviewPayload>;
  questions: [PersistedQuestion, PersistedQuestion];
  expectedJudgeCounts: Map<string, number>;
  expectedInactiveCounts: Map<string, number>;
  refs: PhaseRefs;
}) {
  for (const question of input.questions) {
    const breakdown = input.preview.breakdown.find((entry) => entry.questionText === question.question_text);
    if (!breakdown) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Run preview breakdown did not include question ${question.id}.`,
        { ...input.refs, questionId: question.id }
      );
    }

    const expectedJudgeCount = input.expectedJudgeCounts.get(question.id) ?? 0;
    if (breakdown.judgeCount !== expectedJudgeCount) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Run preview judgeCount for question ${question.id} was ${breakdown.judgeCount} instead of ${expectedJudgeCount}.`,
        { ...input.refs, questionId: question.id }
      );
    }

    const expectedInactive = input.expectedInactiveCounts.get(question.id) ?? 0;
    const actualInactive = breakdown.excludedInactiveJudgeCount ?? 0;
    if (actualInactive !== expectedInactive) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        `Run preview excludedInactiveJudgeCount for question ${question.id} was ${actualInactive} instead of ${expectedInactive}.`,
        { ...input.refs, questionId: question.id }
      );
    }
  }
}

function assertSetupPreviewProof(input: {
  baseline: AssignmentProofSummary['baseline'];
  active: AssignmentProofSummary['active'];
  inactive: AssignmentProofSummary['inactive'];
  reactivated: AssignmentProofSummary['reactivated'];
  baselineInactiveAssignments: number;
  inactiveAssignments: number;
  expectedAddedTotal: number;
  assignmentCount: number;
}) {
  if (input.active !== input.baseline + input.expectedAddedTotal) {
    throw new Error(
      `Active preview total ${input.active} did not increase by ${input.expectedAddedTotal} from the baseline ${input.baseline}.`
    );
  }

  if (input.inactive !== input.baseline) {
    throw new Error(
      `Inactive preview total ${input.inactive} should have returned to the baseline ${input.baseline}.`
    );
  }

  if (input.inactiveAssignments !== input.baselineInactiveAssignments + input.assignmentCount) {
    throw new Error(
      `Inactive preview count ${input.inactiveAssignments} did not increase by ${input.assignmentCount} from the baseline ${input.baselineInactiveAssignments}.`
    );
  }

  if (input.reactivated !== input.active) {
    throw new Error(
      `Reactivated preview total ${input.reactivated} did not return to the active total ${input.active}.`
    );
  }
}

async function verifyValidJudgeAssignmentPersistence(input: {
  supabase: SupabaseClient;
  baseUrl: string;
  queue: QueueRow;
  questions: [PersistedQuestion, PersistedQuestion];
  answerCountByQuestionId: Map<string, number>;
  validJudge: Judge;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const refs: PhaseRefs = {
    queueId: input.queue.id,
    queueLabel: input.queue.queue_id,
    validJudgeId: input.validJudge.id,
  };

  const baselinePreview = await fetchRunPreviewApi(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);

  const createdAssignments: SetupAssignmentTarget[] = [];
  for (const [index, question] of input.questions.entries()) {
    const attachmentForwarding = shouldForwardAttachmentsForQuestion(index);
    const createdAssignment = await createAssignmentApi(
      input.baseUrl,
      input.queue.id,
      question.id,
      input.validJudge.id,
      attachmentForwarding,
      input.timeoutMs,
      input.fetchImpl
    );

    const persistedAssignment = await loadPersistedAssignmentRow(
      input.supabase,
      input.queue.id,
      question.id,
      input.validJudge.id,
      {
        ...refs,
        questionId: question.id,
        assignmentId: createdAssignment.id,
      }
    );

    if (persistedAssignment.id !== createdAssignment.id) {
      throw new VerifierPhaseError(
        'assignment-persistence',
        'API and persisted assignment ids did not match.',
        {
          ...refs,
          questionId: question.id,
          assignmentId: createdAssignment.id,
        }
      );
    }

    createdAssignments.push({
      question,
      answerCount: input.answerCountByQuestionId.get(question.id) ?? 0,
      assignmentId: createdAssignment.id,
      attachmentForwarding,
    });
  }

  await verifyAssignmentSurfaces({
    baseUrl: input.baseUrl,
    queueId: input.queue.id,
    judgeId: input.validJudge.id,
    expectedStatus: 'active',
    expectedAssignments: createdAssignments,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  const activePreview = await fetchRunPreviewApi(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);
  assertTrackedPreviewRows({
    preview: activePreview,
    questions: input.questions,
    expectedJudgeCounts: new Map(input.questions.map((question) => [question.id, 1])),
    expectedInactiveCounts: new Map(input.questions.map((question) => [question.id, 0])),
    refs,
  });

  const inactiveJudge = await patchJudgeApi(
    input.baseUrl,
    input.validJudge.id,
    { active: false },
    input.timeoutMs,
    input.fetchImpl,
    'assignment-persistence'
  );

  await assertJudgeAcrossSurfaces({
    baseUrl: input.baseUrl,
    supabase: input.supabase,
    judgeId: input.validJudge.id,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    expected: {
      name: inactiveJudge.name,
      system_prompt: inactiveJudge.system_prompt,
      model: inactiveJudge.model,
      active: false,
    },
    refs,
    phase: 'assignment-persistence',
  });

  await verifyAssignmentSurfaces({
    baseUrl: input.baseUrl,
    queueId: input.queue.id,
    judgeId: input.validJudge.id,
    expectedStatus: 'inactive',
    expectedAssignments: createdAssignments,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  const inactivePreview = await fetchRunPreviewApi(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);
  assertTrackedPreviewRows({
    preview: inactivePreview,
    questions: input.questions,
    expectedJudgeCounts: new Map(input.questions.map((question) => [question.id, 0])),
    expectedInactiveCounts: new Map(input.questions.map((question) => [question.id, 1])),
    refs,
  });

  const reactivatedJudge = await patchJudgeApi(
    input.baseUrl,
    input.validJudge.id,
    { active: true },
    input.timeoutMs,
    input.fetchImpl,
    'assignment-persistence'
  );

  await assertJudgeAcrossSurfaces({
    baseUrl: input.baseUrl,
    supabase: input.supabase,
    judgeId: input.validJudge.id,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    expected: {
      name: reactivatedJudge.name,
      system_prompt: reactivatedJudge.system_prompt,
      model: reactivatedJudge.model,
      active: true,
    },
    refs,
    phase: 'assignment-persistence',
  });

  await verifyAssignmentSurfaces({
    baseUrl: input.baseUrl,
    queueId: input.queue.id,
    judgeId: input.validJudge.id,
    expectedStatus: 'active',
    expectedAssignments: createdAssignments,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  const reactivatedPreview = await fetchRunPreviewApi(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);
  assertTrackedPreviewRows({
    preview: reactivatedPreview,
    questions: input.questions,
    expectedJudgeCounts: new Map(input.questions.map((question) => [question.id, 1])),
    expectedInactiveCounts: new Map(input.questions.map((question) => [question.id, 0])),
    refs,
  });

  const expectedAddedTotal = createdAssignments.reduce((sum, assignment) => sum + assignment.answerCount, 0);
  assertSetupPreviewProof({
    baseline: baselinePreview.total,
    active: activePreview.total,
    inactive: inactivePreview.total,
    reactivated: reactivatedPreview.total,
    baselineInactiveAssignments: baselinePreview.inactiveAssignmentCount,
    inactiveAssignments: inactivePreview.inactiveAssignmentCount,
    expectedAddedTotal,
    assignmentCount: createdAssignments.length,
  });

  log(
    `Assignment persistence passed for valid judge=${input.validJudge.id}: baseline=${baselinePreview.total} active=${activePreview.total} inactive=${inactivePreview.total} reactivated=${reactivatedPreview.total}.`
  );

  return {
    createdAssignments,
    previewTotals: {
      baseline: baselinePreview.total,
      active: activePreview.total,
      inactive: inactivePreview.total,
      reactivated: reactivatedPreview.total,
      inactiveAssignments: inactivePreview.inactiveAssignmentCount,
    } satisfies AssignmentProofSummary,
  };
}

async function addInvalidJudgeAssignment(input: {
  supabase: SupabaseClient;
  baseUrl: string;
  queue: QueueRow;
  questions: [PersistedQuestion, PersistedQuestion];
  answerCountByQuestionId: Map<string, number>;
  validJudge: Judge;
  invalidJudge: Judge;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const questionOne = input.questions[0];
  const createdAssignment = await createAssignmentApi(
    input.baseUrl,
    input.queue.id,
    questionOne.id,
    input.invalidJudge.id,
    true,
    input.timeoutMs,
    input.fetchImpl
  );

  const persistedAssignment = await loadPersistedAssignmentRow(
    input.supabase,
    input.queue.id,
    questionOne.id,
    input.invalidJudge.id,
    {
      queueId: input.queue.id,
      queueLabel: input.queue.queue_id,
      invalidJudgeId: input.invalidJudge.id,
      questionId: questionOne.id,
      assignmentId: createdAssignment.id,
    }
  );

  if (persistedAssignment.id !== createdAssignment.id) {
    throw new VerifierPhaseError(
      'assignment-persistence',
      'Invalid judge assignment id drifted between API and persistence.',
      {
        queueId: input.queue.id,
        queueLabel: input.queue.queue_id,
        invalidJudgeId: input.invalidJudge.id,
        questionId: questionOne.id,
        assignmentId: createdAssignment.id,
      }
    );
  }

  await verifyAssignmentSurfaces({
    baseUrl: input.baseUrl,
    queueId: input.queue.id,
    judgeId: input.invalidJudge.id,
    expectedStatus: 'active',
    expectedAssignments: [
      {
        question: questionOne,
        answerCount: input.answerCountByQuestionId.get(questionOne.id) ?? 0,
        assignmentId: createdAssignment.id,
        attachmentForwarding: true,
      },
    ],
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });

  const preview = await fetchRunPreviewApi(input.baseUrl, input.queue.id, input.timeoutMs, input.fetchImpl);
  assertTrackedPreviewRows({
    preview,
    questions: input.questions,
    expectedJudgeCounts: new Map<string, number>([
      [input.questions[0].id, 2],
      [input.questions[1].id, 1],
    ]),
    expectedInactiveCounts: new Map<string, number>([
      [input.questions[0].id, 0],
      [input.questions[1].id, 0],
    ]),
    refs: {
      queueId: input.queue.id,
      queueLabel: input.queue.queue_id,
      validJudgeId: input.validJudge.id,
      invalidJudgeId: input.invalidJudge.id,
    },
  });

  const expectedTotal =
    (input.answerCountByQuestionId.get(input.questions[0].id) ?? 0) * 2 +
    (input.answerCountByQuestionId.get(input.questions[1].id) ?? 0);

  if (preview.total !== expectedTotal) {
    throw new VerifierPhaseError(
      'run-start',
      `Run preview total ${preview.total} did not match expected total ${expectedTotal}.`,
      {
        queueId: input.queue.id,
        queueLabel: input.queue.queue_id,
        validJudgeId: input.validJudge.id,
        invalidJudgeId: input.invalidJudge.id,
      }
    );
  }

  return {
    assignmentId: createdAssignment.id,
    preview,
  };
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
      status: row.status as EvaluationAuditRow['status'],
      verdict: row.verdict as EvaluationAuditRow['verdict'],
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
    throw new VerifierPhaseError(
      'results-assertions',
      safeMessage(error),
      { ...refs, endpoint: `/api/queues/${queueId}/results`, filter: summarizeFilter(params) },
      error
    );
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
    {
      queueId: input.queueId,
      validJudgeId: input.validJudgeId,
      filter: `judgeId=${input.validJudgeId}`,
    }
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
    {
      queueId: input.queueId,
      invalidJudgeId: input.invalidJudgeId,
      filter: `judgeId=${input.invalidJudgeId}`,
    }
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
    evaluations: baseResponse.evaluations,
  } satisfies ResultsProofSummary;
}

function buildScenarioProofEntries(input: {
  evaluations: ResultsEvaluation[];
  refs: PhaseRefs;
}): ScenarioProofEntry[] {
  return SCENARIO_NAMES.map((scenario) => {
    const matches = input.evaluations.filter((row) => {
      const snapshot = row.prompt_snapshot;
      if (!snapshot) {
        return false;
      }

      try {
        return parsePlanMarker(snapshot).kind === scenario;
      } catch {
        return false;
      }
    });

    if (matches.length === 0) {
      const malformed = input.evaluations.find((row) => {
        const snapshot = row.prompt_snapshot;
        if (!snapshot) {
          return false;
        }

        try {
          parsePlanMarker(snapshot);
          return false;
        } catch {
          return true;
        }
      });

      if (malformed) {
        throw new VerifierPhaseError(
          'results-assertions',
          `Scenario classification is impossible because evaluation ${malformed.id} has a malformed plan marker.`,
          input.refs
        );
      }

      throw new VerifierPhaseError('results-assertions', `Evaluation log did not include a ${scenario} scenario.`, input.refs);
    }

    const evaluation = matches[0];
    if (!evaluation.prompt_snapshot) {
      throw new VerifierPhaseError(
        'results-assertions',
        `Scenario classification is impossible because evaluation ${evaluation.id} is missing prompt_snapshot.`,
        input.refs
      );
    }

    return {
      scenario,
      evaluationId: evaluation.id,
      status: evaluation.status,
      verdict: evaluation.verdict ?? null,
      modelUsed: evaluation.model_used ?? 'unknown',
      promptSnapshot: evaluation.prompt_snapshot,
      errorMessage: evaluation.error_message ?? null,
    };
  });
}

function assertPageContains(body: string, expectedText: string, page: string) {
  if (!body.includes(expectedText)) {
    throw new Error(`Page ${page} did not include expected text ${JSON.stringify(expectedText)}.`);
  }
}

async function confirmReviewerPages(input: {
  inspectionUrls: InspectionUrls;
  timeoutMs: number;
  fetchImpl: FetchLike;
}) {
  const checks: Array<{ url: string; page: string; expectedText: string }> = [
    { url: input.inspectionUrls.queues, page: '/queues', expectedText: 'Queues' },
    { url: input.inspectionUrls.queueDetail, page: input.inspectionUrls.queueDetail, expectedText: 'Submissions' },
    { url: input.inspectionUrls.judges, page: '/judges', expectedText: 'Judges' },
    { url: input.inspectionUrls.validJudgeDetail, page: input.inspectionUrls.validJudgeDetail, expectedText: 'Judges' },
    { url: input.inspectionUrls.invalidJudgeDetail, page: input.inspectionUrls.invalidJudgeDetail, expectedText: 'Judges' },
    { url: input.inspectionUrls.assign, page: input.inspectionUrls.assign, expectedText: 'Assign Judges' },
    { url: input.inspectionUrls.run, page: input.inspectionUrls.run, expectedText: 'Run Evaluations' },
    { url: input.inspectionUrls.results, page: input.inspectionUrls.results, expectedText: 'Results' },
  ];

  for (const check of checks) {
    const body = await readPageBody(input.fetchImpl, check.url, input.timeoutMs);
    assertPageContains(body, check.expectedText, check.page);
  }

  log(`Reviewer page targets are reachable: ${input.inspectionUrls.queueDetail}, ${input.inspectionUrls.run}, ${input.inspectionUrls.results}.`);
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

  const verifierJudges = await runPhase(
    'judge-crud',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
    },
    async () =>
      createVerifierJudges({
        supabase,
        baseUrl: options.baseUrl,
        queue: persistedTarget.queue,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      })
  );

  const assignmentProof = await runPhase(
    'assignment-persistence',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      validJudgeId: verifierJudges.validJudge.id,
    },
    async () =>
      verifyValidJudgeAssignmentPersistence({
        supabase,
        baseUrl: options.baseUrl,
        queue: persistedTarget.queue,
        questions: persistedTarget.questions,
        answerCountByQuestionId: persistedTarget.answerCountByQuestionId,
        validJudge: verifierJudges.validJudge,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      })
  );

  const invalidAssignment = await runPhase(
    'assignment-persistence',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      validJudgeId: verifierJudges.validJudge.id,
      invalidJudgeId: verifierJudges.invalidJudge.id,
    },
    async () =>
      addInvalidJudgeAssignment({
        supabase,
        baseUrl: options.baseUrl,
        queue: persistedTarget.queue,
        questions: persistedTarget.questions,
        answerCountByQuestionId: persistedTarget.answerCountByQuestionId,
        validJudge: verifierJudges.validJudge,
        invalidJudge: verifierJudges.invalidJudge,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      })
  );

  const startedPayload = await runPhase(
    'run-start',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      validJudgeId: verifierJudges.validJudge.id,
      invalidJudgeId: verifierJudges.invalidJudge.id,
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
          validJudgeId: verifierJudges.validJudge.id,
          invalidJudgeId: verifierJudges.invalidJudge.id,
        },
        options.timeoutMs,
        { method: 'POST' }
      )
  );
  const started = assertRunStartPayload(startedPayload);

  if (started.total !== invalidAssignment.preview.total) {
    throw new VerifierPhaseError(
      'run-start',
      `Run start total ${started.total} did not match preview total ${invalidAssignment.preview.total}.`,
      {
        queueId: persistedTarget.queue.id,
        queueLabel: persistedTarget.queue.queue_id,
        runId: started.runId,
        validJudgeId: verifierJudges.validJudge.id,
        invalidJudgeId: verifierJudges.invalidJudge.id,
      }
    );
  }

  log(`Run started for queue=${persistedTarget.queue.id}: run=${started.runId} total=${started.total}.`);

  const terminal = await runPhase(
    'run-poll',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      validJudgeId: verifierJudges.validJudge.id,
      invalidJudgeId: verifierJudges.invalidJudge.id,
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
      validJudgeId: verifierJudges.validJudge.id,
      invalidJudgeId: verifierJudges.invalidJudge.id,
    },
    async () => loadPersistedAudit(supabase, started.runId)
  );
  const auditProof = assertPersistedAudit({
    run: persistedAudit.run,
    evaluations: persistedAudit.evaluations,
    expectedTotal: started.total,
  });
  log(
    `Persisted audit verified: completed=${auditProof.completedRows}, errored=${auditProof.erroredRows}, retried=${auditProof.retriedRows}.`
  );

  const resultsQueryString = buildQueryString({
    judgeIds: [verifierJudges.validJudge.id, verifierJudges.invalidJudge.id],
  }).toString();

  const resultsProof = await runPhase(
    'results-assertions',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      validJudgeId: verifierJudges.validJudge.id,
      invalidJudgeId: verifierJudges.invalidJudge.id,
      filter: resultsQueryString,
    },
    async () =>
      verifyResultsApiProof({
        baseUrl: options.baseUrl,
        queueId: persistedTarget.queue.id,
        validJudgeId: verifierJudges.validJudge.id,
        invalidJudgeId: verifierJudges.invalidJudge.id,
        questionIds: [persistedTarget.questions[0].id, persistedTarget.questions[1].id],
        expectedCurrentTotal: started.total,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      })
  );

  const submissionProof = await runPhase(
    'submission-detail',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
    },
    async () =>
      findSubmissionWithAttachments(
        supabase,
        persistedTarget.queue.id,
        persistedTarget.queue.queue_id,
        {
          queueId: persistedTarget.queue.id,
          queueLabel: persistedTarget.queue.queue_id,
        }
      )
  );

  const submissionDetailUrl = `${options.baseUrl}/queues/${persistedTarget.queue.id}/submissions/${submissionProof.submissionId}?source=results`;
  const submissionDetailApiUrl = `${options.baseUrl}/api/queues/${persistedTarget.queue.id}/submissions/${submissionProof.submissionId}`;

  const submissionDetailPayload = await runPhase(
    'submission-detail',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      submissionId: submissionProof.submissionId,
      detailUrl: submissionDetailApiUrl,
    },
    async () =>
      readJsonResponse<unknown>(
        fetchImpl,
        submissionDetailApiUrl,
        'Submission detail',
        'submission-detail',
        {
          queueId: persistedTarget.queue.id,
          queueLabel: persistedTarget.queue.queue_id,
          submissionId: submissionProof.submissionId,
          endpoint: `/api/queues/${persistedTarget.queue.id}/submissions/${submissionProof.submissionId}`
        },
        options.timeoutMs
      )
  );

  let submissionDetailResponse: SubmissionDetailResponse;
  try {
    submissionDetailResponse = parseSubmissionDetailResponse(
      submissionDetailPayload,
      'submission detail response'
    );
  } catch (error) {
    throw new VerifierPhaseError(
      'submission-detail',
      safeMessage(error),
      {
        queueId: persistedTarget.queue.id,
        queueLabel: persistedTarget.queue.queue_id,
        submissionId: submissionProof.submissionId,
        detailUrl: submissionDetailApiUrl,
      },
      error
    );
  }

  assertDetailAttachmentTruth({
    detail: submissionDetailResponse,
    submissionId: submissionProof.submissionId,
    persistedAttachments: submissionProof.attachments,
  });

  const inspectionUrls = buildInspectionUrls(
    options.baseUrl,
    persistedTarget.queue.id,
    verifierJudges.validJudge.id,
    verifierJudges.invalidJudge.id,
    submissionProof.submissionId
  );
  const apiUrls = buildApiUrls(
    options.baseUrl,
    persistedTarget.queue.id,
    started.runId,
    resultsQueryString,
    submissionProof.submissionId
  );

  await runPhase(
    'page-confirmation',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      page: inspectionUrls.results,
    },
    async () =>
      confirmReviewerPages({
        inspectionUrls,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      })
  );

  const scenarioProof = await runPhase(
    'results-assertions',
    {
      queueId: persistedTarget.queue.id,
      queueLabel: persistedTarget.queue.queue_id,
      runId: started.runId,
      validJudgeId: verifierJudges.validJudge.id,
      invalidJudgeId: verifierJudges.invalidJudge.id,
      filter: resultsQueryString,
    },
    async () =>
      buildScenarioProofEntries({
        evaluations: resultsProof.evaluations,
        refs: {
          queueId: persistedTarget.queue.id,
          queueLabel: persistedTarget.queue.queue_id,
          runId: started.runId,
          validJudgeId: verifierJudges.validJudge.id,
          invalidJudgeId: verifierJudges.invalidJudge.id,
        },
      })
  );

  const assignmentForwarding = [
    ...assignmentProof.createdAssignments.map((assignment) => ({
      questionId: assignment.question.id,
      assignmentId: assignment.assignmentId,
      attachmentForwarding: assignment.attachmentForwarding,
    })),
    {
      questionId: persistedTarget.questions[0].id,
      assignmentId: invalidAssignment.assignmentId,
      attachmentForwarding: true,
    },
  ];

  const attachmentProof: AttachmentProofSummary = {
    submissionId: submissionProof.submissionId,
    submissionExternalId: submissionProof.submissionExternalId,
    detailUrl: submissionDetailUrl,
    detailApiUrl: submissionDetailApiUrl,
    attachments: submissionProof.attachments.map((attachment) => ({
      id: attachment.id,
      externalAttachmentId: attachment.external_attachment_id,
      fileName: attachment.file_name,
      mediaType: attachment.media_type,
      storageStatus: attachment.storage_status,
    })),
  };

  const validQuestionAssignments = new Map(
    assignmentProof.createdAssignments.map((assignment) => [assignment.question.id, assignment.assignmentId])
  );

  const questionRefs = persistedTarget.questions.map((question) => ({
    id: question.id,
    externalId: question.external_id,
    questionText: question.question_text,
    answerCount: persistedTarget.answerCountByQuestionId.get(question.id) ?? 0,
    validAssignmentId: validQuestionAssignments.get(question.id) ?? 'missing',
    invalidAssignmentId: question.id === persistedTarget.questions[0].id ? invalidAssignment.assignmentId : null,
  })) as [SetupQuestionSummary, SetupQuestionSummary];

  return {
    queueId: persistedTarget.queue.id,
    queueLabel: persistedTarget.queue.queue_id,
    verifierJudgeIds: {
      valid: verifierJudges.validJudge.id,
      invalid: verifierJudges.invalidJudge.id,
    },
    verifierJudgeNames: {
      valid: verifierJudges.validJudge.name,
      invalid: verifierJudges.invalidJudge.name,
    },
    questionRefs,
    assignmentProof: assignmentProof.previewTotals,
    run: {
      runId: started.runId,
      status: terminal.progress.status,
      previewTotal: invalidAssignment.preview.total,
      startedTotal: started.total,
      completedRows: auditProof.completedRows,
      erroredRows: auditProof.erroredRows,
      retriedRows: auditProof.retriedRows,
    },
    resultsProof,
    attachmentProof,
    assignmentForwarding,
    scenarioProof,
    inspectionUrls,
    apiUrls,
  };
}

const isDirectRun = /(^|\/)verify-s04-live\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatSetupSummary(summary)}.`);
    log(`Inspect ${formatInspectionTargets(summary)}.`);
    log(`APIs ${formatApiTargets(summary)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : `[verify:s04-live] ${safeMessage(error)}`);
    process.exit(1);
  }
}
