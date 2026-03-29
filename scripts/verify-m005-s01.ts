import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { createSubmissionAttachmentStoragePath, SUBMISSION_ATTACHMENT_STORAGE_BUCKET } from '../src/lib/submissions/attachment-storage';
import { parseSubmissionDetailResponse } from '../src/lib/submissions/fetch-json';
import type { SubmissionDetailAttachment, SubmissionDetailResponse, UploadResult } from '../src/types/api';
import type { SubmissionAttachment } from '../src/types/db';
import type { ValidatedSubmission } from '../src/lib/validators/upload';
import { ensureLocalAppReady } from './verify-m004-s01';
import { loadFixture } from './verify-s02-live';

type FetchLike = typeof fetch;

type PhaseName =
  | 'local-app'
  | 'schema-readiness'
  | 'upload'
  | 'attachment-row'
  | 'storage-object'
  | 'detail-truth';

type PhaseRefs = {
  queueId?: string;
  queueLabel?: string;
  submissionId?: string;
  submissionExternalId?: string;
  attachmentId?: string;
  externalAttachmentId?: string;
  storagePath?: string;
  endpoint?: string;
  detailUrl?: string;
};

type QueueRow = {
  id: string;
  queue_id: string;
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

export type ProofSubmissionTarget = {
  queueLabel: string;
  submissionExternalId: string;
  detailUrl: string;
  detailApiUrl: string;
  attachments: Array<{
    externalAttachmentId: string;
    fileName: string;
    mediaType: string;
    byteSize: number;
  }>;
};

export type LiveVerificationSummary = {
  queueId: string;
  queueLabel: string;
  submissionId: string;
  submissionExternalId: string;
  detailUrl: string;
  detailApiUrl: string;
  uploadCounts: UploadResult & { attachments: number };
  persistedAttachments: Array<{
    id: string;
    externalAttachmentId: string;
    storageBucket: string;
    storagePath: string;
    storageStatus: SubmissionAttachment['storage_status'];
    fileName: string;
    mediaType: string;
    byteSize: number;
  }>;
  autoStartedLocalApp: boolean;
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

const DEFAULT_FIXTURE_PATH = 'scripts/verify-m005-s01.fixture.json';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_POLL_MS = 500;
const REQUIRED_TABLES = ['queues', 'submissions', 'submission_attachments'] as const;
const execFileAsync = promisify(execFile);

function log(message: string) {
  console.log(`[verify:m005-s01] ${message}`);
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
  return `[verify:m005-s01] phase=${phase}${formatPhaseRefs(refs)} ${message}`;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function asPositiveInteger(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function asNonNegativeInteger(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return value;
}

function asNullableString(value: unknown, fieldName: string) {
  if (value == null) {
    return null;
  }

  return asNonEmptyString(value, fieldName);
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
    fixturePath: parsed.values.fixture ?? env.M005_S01_VERIFY_FIXTURE ?? DEFAULT_FIXTURE_PATH,
    timeoutMs: integerArg(parsed.values['timeout-ms'] ?? env.M005_S01_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    startupTimeoutMs: integerArg(
      parsed.values['startup-timeout-ms'] ?? env.M005_S01_VERIFY_STARTUP_TIMEOUT_MS,
      DEFAULT_STARTUP_TIMEOUT_MS,
      '--startup-timeout-ms'
    ),
    probeTimeoutMs: integerArg(
      parsed.values['probe-timeout-ms'] ?? env.M005_S01_VERIFY_PROBE_TIMEOUT_MS,
      DEFAULT_PROBE_TIMEOUT_MS,
      '--probe-timeout-ms'
    ),
    pollMs: integerArg(parsed.values['poll-ms'] ?? env.M005_S01_VERIFY_POLL_MS, DEFAULT_POLL_MS, '--poll-ms'),
  };
}

function summarizeFixture(items: ValidatedSubmission[]) {
  const queueIds = [...new Set(items.map((item) => item.queueId))];
  const questionPairs = new Set<string>();
  let answerCount = 0;
  let attachmentCount = 0;

  for (const item of items) {
    for (const question of item.questions) {
      questionPairs.add(`${item.queueId}::${question.data.id}`);
    }

    answerCount += Object.keys(item.answers).length;
    attachmentCount += item.attachments?.length ?? 0;
  }

  return {
    queueIds,
    queues: queueIds.length,
    submissions: items.length,
    questions: questionPairs.size,
    answers: answerCount,
    attachments: attachmentCount,
  };
}

export function selectProofSubmission(items: ValidatedSubmission[], baseUrl: string): ProofSubmissionTarget {
  const proofSubmission = items.find((item) => (item.attachments?.length ?? 0) > 0);
  if (!proofSubmission) {
    throw new Error('Fixture data must include at least one submission attachment for proof.');
  }

  const attachments = (proofSubmission.attachments ?? []).map((attachment) => ({
    externalAttachmentId: attachment.id,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
  }));

  if (attachments.length === 0) {
    throw new Error(`Proof submission ${proofSubmission.id} did not retain any attachments.`);
  }

  return {
    queueLabel: proofSubmission.queueId,
    submissionExternalId: proofSubmission.id,
    detailUrl: '',
    detailApiUrl: '',
    attachments,
  };
}

export function assertAttachmentUploadResultPayload(payload: unknown): UploadResult & { attachments: number } {
  if (!isObject(payload)) {
    throw new Error('Upload response was not an object.');
  }

  return {
    queues: asNonNegativeInteger(payload.queues, 'Upload response queues'),
    submissions: asNonNegativeInteger(payload.submissions, 'Upload response submissions'),
    questions: asNonNegativeInteger(payload.questions, 'Upload response questions'),
    answers: asNonNegativeInteger(payload.answers, 'Upload response answers'),
    attachments: asNonNegativeInteger(payload.attachments, 'Upload response attachments'),
  };
}

export function assertPersistedAttachmentRow(payload: unknown): SubmissionAttachment {
  if (!isObject(payload)) {
    throw new Error('Persisted attachment row was not an object.');
  }

  return {
    id: asNonEmptyString(payload.id, 'Persisted attachment row id'),
    submission_id: asNonEmptyString(payload.submission_id, 'Persisted attachment row submission_id'),
    external_attachment_id: asNonEmptyString(
      payload.external_attachment_id,
      'Persisted attachment row external_attachment_id'
    ),
    source_kind: asNonEmptyString(payload.source_kind, 'Persisted attachment row source_kind'),
    file_name: asNonEmptyString(payload.file_name, 'Persisted attachment row file_name'),
    media_type: asNonEmptyString(payload.media_type, 'Persisted attachment row media_type'),
    byte_size: asPositiveInteger(payload.byte_size, 'Persisted attachment row byte_size'),
    storage_bucket: asNonEmptyString(payload.storage_bucket, 'Persisted attachment row storage_bucket'),
    storage_path: asNonEmptyString(payload.storage_path, 'Persisted attachment row storage_path'),
    storage_status: asNonEmptyString(payload.storage_status, 'Persisted attachment row storage_status') as SubmissionAttachment['storage_status'],
    storage_error: asNullableString(payload.storage_error, 'Persisted attachment row storage_error'),
    created_at: asNonEmptyString(payload.created_at, 'Persisted attachment row created_at'),
    updated_at: asNonEmptyString(payload.updated_at, 'Persisted attachment row updated_at'),
  };
}

export function assertDetailAttachmentTruth(input: {
  detail: SubmissionDetailResponse;
  submissionId: string;
  persistedAttachments: SubmissionAttachment[];
}) {
  if (input.detail.submission.id !== input.submissionId) {
    throw new Error(
      `Submission detail returned submission ${input.detail.submission.id} instead of ${input.submissionId}.`
    );
  }

  if (input.detail.attachments.length !== input.persistedAttachments.length) {
    throw new Error(
      `Submission detail returned ${input.detail.attachments.length} attachments but ${input.persistedAttachments.length} persisted attachment rows exist.`
    );
  }

  const persistedById = new Map(input.persistedAttachments.map((row) => [row.id, row]));

  for (const attachment of input.detail.attachments) {
    const persisted = persistedById.get(attachment.id);
    if (!persisted) {
      throw new Error(`Submission detail returned unknown attachment ${attachment.id}.`);
    }

    assertReviewerAttachmentMatches(attachment, persisted);
  }
}

function assertReviewerAttachmentMatches(detailAttachment: SubmissionDetailAttachment, persisted: SubmissionAttachment) {
  const expected = {
    external_attachment_id: persisted.external_attachment_id,
    source_kind: persisted.source_kind,
    file_name: persisted.file_name,
    media_type: persisted.media_type,
    byte_size: persisted.byte_size,
    storage_status: persisted.storage_status,
    storage_error: persisted.storage_error,
  };

  const received = {
    external_attachment_id: detailAttachment.external_attachment_id,
    source_kind: detailAttachment.source_kind,
    file_name: detailAttachment.file_name,
    media_type: detailAttachment.media_type,
    byte_size: detailAttachment.byte_size,
    storage_status: detailAttachment.storage_status,
    storage_error: detailAttachment.storage_error,
  };

  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(
      `Submission detail attachment ${detailAttachment.id} drifted from persisted truth. expected=${JSON.stringify(expected)} received=${JSON.stringify(received)}`
    );
  }
}

export function formatProofSummary(summary: LiveVerificationSummary) {
  const attachmentRefs = summary.persistedAttachments
    .map((attachment) => `${attachment.id}:${attachment.externalAttachmentId}:${attachment.storagePath}`)
    .join(',');

  return [
    `queue=${summary.queueId}`,
    `queueLabel=${summary.queueLabel}`,
    `submission=${summary.submissionId}`,
    `submissionExternalId=${summary.submissionExternalId}`,
    `detailUrl=${summary.detailUrl}`,
    `detailApiUrl=${summary.detailApiUrl}`,
    `attachments=${attachmentRefs}`,
    `uploadCounts=${summary.uploadCounts.queues}/${summary.uploadCounts.submissions}/${summary.uploadCounts.questions}/${summary.uploadCounts.answers}/${summary.uploadCounts.attachments}`,
    `autoStarted=${summary.autoStartedLocalApp ? 'yes' : 'no'}`,
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

async function findPersistedProofSubmission(supabase: SupabaseClient, target: ProofSubmissionTarget) {
  const { data: queueRow, error: queueError } = await supabase
    .from('queues')
    .select('id, queue_id, created_at')
    .eq('queue_id', target.queueLabel)
    .maybeSingle();

  if (queueError || !queueRow) {
    throw new Error(queueError?.message ?? `Queue ${target.queueLabel} was not persisted.`);
  }

  const { data: submissionRow, error: submissionError } = await supabase
    .from('submissions')
    .select('id, queue_id, external_id, created_at')
    .eq('queue_id', queueRow.id)
    .eq('external_id', target.submissionExternalId)
    .maybeSingle();

  if (submissionError || !submissionRow) {
    throw new Error(
      submissionError?.message ??
        `Submission ${target.submissionExternalId} was not persisted for queue ${target.queueLabel}.`
    );
  }

  return {
    queue: queueRow as QueueRow,
    submission: submissionRow as SubmissionRow,
  };
}

async function loadPersistedAttachments(supabase: SupabaseClient, submissionId: string, refs: PhaseRefs) {
  const { data, error } = await supabase
    .from('submission_attachments')
    .select(
      'id, submission_id, external_attachment_id, source_kind, file_name, media_type, byte_size, storage_bucket, storage_path, storage_status, storage_error, created_at, updated_at'
    )
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new VerifierPhaseError('attachment-row', error.message, refs);
  }

  return (data ?? []).map((row) => assertPersistedAttachmentRow(row));
}

async function verifyStoredObject(supabase: SupabaseClient, attachment: SubmissionAttachment, refs: PhaseRefs) {
  const expectedPath = createSubmissionAttachmentStoragePath({
    submissionId: attachment.submission_id,
    attachmentId: attachment.external_attachment_id,
  });

  if (attachment.storage_bucket !== SUBMISSION_ATTACHMENT_STORAGE_BUCKET) {
    throw new VerifierPhaseError(
      'storage-object',
      `Attachment ${attachment.id} was stored in bucket ${attachment.storage_bucket} instead of ${SUBMISSION_ATTACHMENT_STORAGE_BUCKET}.`,
      refs
    );
  }

  if (attachment.storage_path !== expectedPath) {
    throw new VerifierPhaseError(
      'storage-object',
      `Attachment ${attachment.id} storage path ${attachment.storage_path} did not match expected ${expectedPath}.`,
      refs
    );
  }

  if (attachment.storage_status !== 'stored') {
    throw new VerifierPhaseError(
      'storage-object',
      `Attachment ${attachment.id} storage_status was ${attachment.storage_status} instead of stored.`,
      refs
    );
  }

  if (attachment.storage_error !== null) {
    throw new VerifierPhaseError(
      'storage-object',
      `Attachment ${attachment.id} reported storage_error ${attachment.storage_error} despite stored status.`,
      refs
    );
  }

  const { data, error } = await supabase.storage
    .from(attachment.storage_bucket)
    .download(attachment.storage_path);

  if (error || !data) {
    throw new VerifierPhaseError(
      'storage-object',
      error?.message ?? `Attachment object ${attachment.storage_path} was not reachable in storage.`,
      refs
    );
  }

  const byteLength = (await data.arrayBuffer()).byteLength;
  if (byteLength !== attachment.byte_size) {
    throw new VerifierPhaseError(
      'storage-object',
      `Attachment object ${attachment.storage_path} byte length ${byteLength} did not match persisted size ${attachment.byte_size}.`,
      refs
    );
  }
}

async function verifySubmissionDetailTruth(
  options: VerifierOptions,
  queueId: string,
  submissionId: string,
  persistedAttachments: SubmissionAttachment[],
  refs: PhaseRefs,
  fetchImpl: FetchLike
) {
  const detailApiUrl = `${options.baseUrl}/api/queues/${queueId}/submissions/${submissionId}`;
  const payload = await readJsonResponse<unknown>(
    fetchImpl,
    detailApiUrl,
    'Submission detail',
    'detail-truth',
    { ...refs, detailUrl: detailApiUrl, endpoint: `/api/queues/${queueId}/submissions/${submissionId}` },
    options.timeoutMs
  );

  let detail: SubmissionDetailResponse;
  try {
    detail = parseSubmissionDetailResponse(payload, 'attachment proof submission detail response');
  } catch (error) {
    throw new VerifierPhaseError('detail-truth', safeMessage(error), { ...refs, detailUrl: detailApiUrl }, error);
  }

  try {
    assertDetailAttachmentTruth({
      detail,
      submissionId,
      persistedAttachments,
    });
  } catch (error) {
    throw new VerifierPhaseError('detail-truth', safeMessage(error), { ...refs, detailUrl: detailApiUrl }, error);
  }

  return detailApiUrl;
}

export async function runLiveVerification(
  options: VerifierOptions,
  fetchImpl: FetchLike = fetch
): Promise<LiveVerificationSummary> {
  const localAppGuard = await runPhase('local-app', { endpoint: '/api/queues' }, async () =>
    ensureLocalAppReady({
      baseUrl: options.baseUrl,
      fetchImpl,
      startupTimeoutMs: options.startupTimeoutMs,
      probeTimeoutMs: options.probeTimeoutMs,
      pollMs: options.pollMs,
    })
  );

  let keepLocalAppAlive = false;

  try {
    const fixtureItems = await runPhase('upload', { endpoint: options.fixturePath }, async () =>
      loadFixture(options.fixturePath)
    );
    const fixtureSummary = summarizeFixture(fixtureItems);
    const proofTarget = selectProofSubmission(fixtureItems, options.baseUrl);

    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(fixtureItems)], { type: 'application/json' }),
      options.fixturePath.split('/').pop() ?? 'verify-m005-s01.fixture.json'
    );

    const supabase = await runPhase('schema-readiness', { endpoint: '/api/queues' }, async () =>
      createSupabaseServiceClient(options.baseUrl)
    );

    await runPhase('schema-readiness', { endpoint: '/api/queues' }, async () => {
      await readJsonResponse<unknown>(
        fetchImpl,
        `${options.baseUrl}/api/queues`,
        'Queue list',
        'schema-readiness',
        { endpoint: '/api/queues' },
        options.timeoutMs
      );
    });

    for (const table of REQUIRED_TABLES) {
      await runPhase('schema-readiness', { endpoint: table }, async () => {
        await checkTableReadable(supabase, table, 'schema-readiness', { endpoint: table });
      });
    }

    const uploadPayload = await readJsonResponse<unknown>(
      fetchImpl,
      `${options.baseUrl}/api/upload`,
      'Upload',
      'upload',
      { endpoint: '/api/upload' },
      options.timeoutMs,
      { method: 'POST', body: form }
    );
    const uploadCounts = assertAttachmentUploadResultPayload(uploadPayload);

    const expectedCounts = {
      queues: fixtureSummary.queues,
      submissions: fixtureSummary.submissions,
      questions: fixtureSummary.questions,
      answers: fixtureSummary.answers,
      attachments: fixtureSummary.attachments,
    };

    if (JSON.stringify(uploadCounts) !== JSON.stringify(expectedCounts)) {
      throw new VerifierPhaseError(
        'upload',
        `Upload response ${JSON.stringify(uploadCounts)} did not match expected counts ${JSON.stringify(expectedCounts)}.`,
        { endpoint: '/api/upload' }
      );
    }

    const persisted = await runPhase(
      'attachment-row',
      { queueLabel: proofTarget.queueLabel, submissionExternalId: proofTarget.submissionExternalId },
      async () => findPersistedProofSubmission(supabase, proofTarget)
    );

    proofTarget.detailUrl = `${options.baseUrl}/queues/${persisted.queue.id}/submissions/${persisted.submission.id}`;
    proofTarget.detailApiUrl = `${options.baseUrl}/api/queues/${persisted.queue.id}/submissions/${persisted.submission.id}`;

    const attachmentRows = await runPhase(
      'attachment-row',
      {
        queueId: persisted.queue.id,
        queueLabel: persisted.queue.queue_id,
        submissionId: persisted.submission.id,
        submissionExternalId: persisted.submission.external_id,
      },
      async () => loadPersistedAttachments(supabase, persisted.submission.id, {
        queueId: persisted.queue.id,
        queueLabel: persisted.queue.queue_id,
        submissionId: persisted.submission.id,
        submissionExternalId: persisted.submission.external_id,
      })
    );

    if (attachmentRows.length !== proofTarget.attachments.length) {
      throw new VerifierPhaseError(
        'attachment-row',
        `Submission ${persisted.submission.id} persisted ${attachmentRows.length} attachment rows but fixture expected ${proofTarget.attachments.length}.`,
        {
          queueId: persisted.queue.id,
          queueLabel: persisted.queue.queue_id,
          submissionId: persisted.submission.id,
          submissionExternalId: persisted.submission.external_id,
        }
      );
    }

    const expectedAttachmentByExternalId = new Map(
      proofTarget.attachments.map((attachment) => [attachment.externalAttachmentId, attachment])
    );

    for (const row of attachmentRows) {
      const expectedAttachment = expectedAttachmentByExternalId.get(row.external_attachment_id);
      if (!expectedAttachment) {
        throw new VerifierPhaseError(
          'attachment-row',
          `Persisted unexpected attachment external id ${row.external_attachment_id}.`,
          {
            queueId: persisted.queue.id,
            queueLabel: persisted.queue.queue_id,
            submissionId: persisted.submission.id,
            submissionExternalId: persisted.submission.external_id,
            attachmentId: row.id,
            externalAttachmentId: row.external_attachment_id,
          }
        );
      }

      if (
        row.file_name !== expectedAttachment.fileName ||
        row.media_type !== expectedAttachment.mediaType ||
        row.byte_size !== expectedAttachment.byteSize
      ) {
        throw new VerifierPhaseError(
          'attachment-row',
          `Persisted attachment ${row.id} drifted from the fixture metadata.`,
          {
            queueId: persisted.queue.id,
            queueLabel: persisted.queue.queue_id,
            submissionId: persisted.submission.id,
            submissionExternalId: persisted.submission.external_id,
            attachmentId: row.id,
            externalAttachmentId: row.external_attachment_id,
          }
        );
      }
    }

    for (const row of attachmentRows) {
      await runPhase(
        'storage-object',
        {
          queueId: persisted.queue.id,
          queueLabel: persisted.queue.queue_id,
          submissionId: persisted.submission.id,
          submissionExternalId: persisted.submission.external_id,
          attachmentId: row.id,
          externalAttachmentId: row.external_attachment_id,
          storagePath: row.storage_path,
        },
        async () => verifyStoredObject(supabase, row, {
          queueId: persisted.queue.id,
          queueLabel: persisted.queue.queue_id,
          submissionId: persisted.submission.id,
          submissionExternalId: persisted.submission.external_id,
          attachmentId: row.id,
          externalAttachmentId: row.external_attachment_id,
          storagePath: row.storage_path,
        })
      );
    }

    const detailApiUrl = await runPhase(
      'detail-truth',
      {
        queueId: persisted.queue.id,
        queueLabel: persisted.queue.queue_id,
        submissionId: persisted.submission.id,
        submissionExternalId: persisted.submission.external_id,
        detailUrl: proofTarget.detailApiUrl,
      },
      async () => verifySubmissionDetailTruth(
        options,
        persisted.queue.id,
        persisted.submission.id,
        attachmentRows,
        {
          queueId: persisted.queue.id,
          queueLabel: persisted.queue.queue_id,
          submissionId: persisted.submission.id,
          submissionExternalId: persisted.submission.external_id,
          detailUrl: proofTarget.detailApiUrl,
        },
        fetchImpl
      )
    );

    keepLocalAppAlive = true;
    localAppGuard.keepAlive();

    return {
      queueId: persisted.queue.id,
      queueLabel: persisted.queue.queue_id,
      submissionId: persisted.submission.id,
      submissionExternalId: persisted.submission.external_id,
      detailUrl: proofTarget.detailUrl,
      detailApiUrl,
      uploadCounts,
      persistedAttachments: attachmentRows.map((row) => ({
        id: row.id,
        externalAttachmentId: row.external_attachment_id,
        storageBucket: row.storage_bucket,
        storagePath: row.storage_path,
        storageStatus: row.storage_status,
        fileName: row.file_name,
        mediaType: row.media_type,
        byteSize: row.byte_size,
      })),
      autoStartedLocalApp: localAppGuard.autoStarted,
    };
  } finally {
    if (!keepLocalAppAlive) {
      localAppGuard.stop();
    }
  }
}

const isDirectRun = /(^|\/)verify-m005-s01\.ts$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  try {
    const options = parseVerifierOptions(process.argv.slice(2));
    const summary = await runLiveVerification(options);
    log(`OK ${formatProofSummary(summary)}`);
    log(`Reuse detailUrl=${summary.detailUrl} detailApiUrl=${summary.detailApiUrl}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : `[verify:m005-s01] ${safeMessage(error)}`);
    process.exit(1);
  }
}
