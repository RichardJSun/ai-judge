import { describe, expect, it } from 'bun:test';
import type { SubmissionDetailResponse } from '../src/types/api';
import type { ValidatedSubmission } from '../src/lib/validators/upload';
import { loadFixture } from './verify-s02-live';
import {
  assertAttachmentUploadResultPayload,
  assertDetailAttachmentTruth,
  assertPersistedAttachmentRow,
  formatProofSummary,
  parseVerifierOptions,
  runPhase,
  selectProofSubmission,
  type LiveVerificationSummary,
  VerifierPhaseError,
} from './verify-m005-s01';

function createValidatedSubmission(overrides: Partial<ValidatedSubmission> = {}): ValidatedSubmission {
  return {
    id: 'sub-proof-1',
    queueId: 'queue-proof',
    labelingTaskId: 'task-proof',
    createdAt: 1711843200000,
    questions: [
      {
        rev: 1,
        data: {
          id: 'question-proof-1',
          questionType: 'short_text',
          questionText: 'What was attached?',
        },
      },
    ],
    answers: {
      'question-proof-1': {
        value: 'A deterministic proof attachment.',
      },
    },
    attachments: [
      {
        id: 'attachment-proof-1',
        fileName: 'proof.txt',
        mediaType: 'text/plain',
        byteSize: 5,
        source: {
          kind: 'inline_base64',
          base64: 'aGVsbG8=',
        },
      },
    ],
    ...overrides,
  };
}

function createDetailResponse(): SubmissionDetailResponse {
  return {
    queue: {
      id: 'queue-uuid-1',
      queue_id: 'queue-proof',
      created_at: '2026-03-29T00:00:00.000Z',
    },
    submission: {
      id: 'submission-uuid-1',
      queue_id: 'queue-uuid-1',
      external_id: 'sub-proof-1',
      labeling_task_id: 'task-proof',
      submitted_at: null,
      created_at: '2026-03-29T00:00:01.000Z',
    },
    summary: {
      totalQuestions: 1,
      answeredQuestions: 1,
      missingQuestions: 0,
    },
    questions: [
      {
        id: 'question-uuid-1',
        external_id: 'question-proof-1',
        question_type: 'short_text',
        question_text: 'What was attached?',
        created_at: '2026-03-29T00:00:00.500Z',
        answerState: 'answered',
        answer: 'A deterministic proof attachment.',
        rawAnswer: { value: 'A deterministic proof attachment.' },
      },
    ],
    attachments: [
      {
        id: 'attachment-row-1',
        external_attachment_id: 'attachment-proof-1',
        source_kind: 'inline_base64',
        file_name: 'proof.txt',
        media_type: 'text/plain',
        byte_size: 5,
        storage_status: 'stored',
        storage_error: null,
      },
    ],
  };
}

function createSummary(overrides: Partial<LiveVerificationSummary> = {}): LiveVerificationSummary {
  return {
    queueId: 'queue-uuid-1',
    queueLabel: 'queue-proof',
    submissionId: 'submission-uuid-1',
    submissionExternalId: 'sub-proof-1',
    detailUrl: 'http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1',
    detailApiUrl: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1',
    uploadCounts: {
      queues: 1,
      submissions: 1,
      questions: 1,
      answers: 1,
      attachments: 1,
    },
    persistedAttachments: [
      {
        id: 'attachment-row-1',
        externalAttachmentId: 'attachment-proof-1',
        storageBucket: 'submission-attachments',
        storagePath: 'submissions/submission-uuid-1/attachments/attachment-proof-1',
        storageStatus: 'stored',
        fileName: 'proof.txt',
        mediaType: 'text/plain',
        byteSize: 5,
      },
    ],
    autoStartedLocalApp: false,
    ...overrides,
  };
}

function createReadFileMock(text: string) {
  return (async () => text) as unknown as Parameters<typeof loadFixture>[1];
}

describe('parseVerifierOptions', () => {
  it('requires --base-url when no environment fallback is present', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });

  it('rejects malformed base URLs before localhost probing starts', () => {
    expect(() => parseVerifierOptions(['--base-url', 'localhost:3000'], {} as NodeJS.ProcessEnv)).toThrow(
      '--base-url must be a valid http:// or https:// URL.'
    );
  });

  it('parses fixture and timeout settings from CLI args', () => {
    expect(
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000/',
        '--fixture',
        'scripts/custom.fixture.json',
        '--timeout-ms',
        '9000',
        '--startup-timeout-ms',
        '20000',
        '--probe-timeout-ms',
        '250',
        '--poll-ms',
        '750',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      fixturePath: 'scripts/custom.fixture.json',
      timeoutMs: 9000,
      startupTimeoutMs: 20000,
      probeTimeoutMs: 250,
      pollMs: 750,
    });
  });
});

describe('fixture proof selection', () => {
  it('rejects a fixture that drops all attachments', () => {
    expect(() => selectProofSubmission([createValidatedSubmission({ attachments: [] })], 'http://localhost:3000')).toThrow(
      'Fixture data must include at least one submission attachment for proof.'
    );
  });

  it('rejects invalid fixture JSON shapes before the verifier trusts them', async () => {
    await expect(
      loadFixture('scripts/invalid-fixture.json', createReadFileMock(JSON.stringify([{ queueId: 'queue-only' }])))
    ).rejects.toThrow('Fixture file scripts/invalid-fixture.json did not match the submission schema.');
  });

  it('rejects missing inline attachment base64 payloads', async () => {
    await expect(
      loadFixture(
        'scripts/missing-base64-fixture.json',
        createReadFileMock(
          JSON.stringify([
            createValidatedSubmission({
              attachments: [
                {
                  id: 'attachment-proof-1',
                  fileName: 'proof.txt',
                  mediaType: 'text/plain',
                  byteSize: 5,
                  source: {
                    kind: 'inline_base64',
                  } as unknown as NonNullable<ValidatedSubmission['attachments']>[number]['source'],
                },
              ],
            }),
          ])
        )
      )
    ).rejects.toThrow('Fixture file scripts/missing-base64-fixture.json did not match the submission schema.');
  });

  it('rejects unsupported attachment metadata in the verifier fixture', async () => {
    await expect(
      loadFixture(
        'scripts/unsupported-attachment-fixture.json',
        createReadFileMock(
          JSON.stringify([
            createValidatedSubmission({
              attachments: [
                {
                  id: 'attachment-proof-1',
                  fileName: 'proof.exe',
                  mediaType: 'application/x-msdownload',
                  byteSize: 5,
                  source: {
                    kind: 'inline_base64',
                    base64: 'aGVsbG8=',
                  },
                },
              ],
            }),
          ])
        )
      )
    ).rejects.toThrow('Fixture file scripts/unsupported-attachment-fixture.json did not match the submission schema.');
  });
});

describe('runPhase', () => {
  it('wraps failures with the phase name and proof context', async () => {
    await expect(
      runPhase(
        'storage-object',
        {
          queueId: 'queue-1',
          submissionId: 'submission-1',
          storagePath: 'submissions/submission-1/attachments/attachment-1',
        },
        async () => {
          throw new Error('Attachment object was missing from durable storage.');
        }
      )
    ).rejects.toThrow(
      '[verify:m005-s01] phase=storage-object queueId=queue-1 submissionId=submission-1 storagePath=submissions/submission-1/attachments/attachment-1 Attachment object was missing from durable storage.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('detail-truth', 'Submission detail payload drifted.', {
      detailUrl: 'http://localhost:3000/api/queues/queue-1/submissions/submission-1',
    });

    await expect(
      runPhase('detail-truth', { submissionId: 'submission-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('payload assertions', () => {
  it('requires the upload payload to include attachment counts', () => {
    expect(() =>
      assertAttachmentUploadResultPayload({
        queues: 1,
        submissions: 1,
        questions: 1,
        answers: 1,
      })
    ).toThrow('Upload response attachments must be a non-negative integer.');
  });

  it('rejects malformed persisted attachment rows before storage checks', () => {
    expect(() =>
      assertPersistedAttachmentRow({
        id: 'attachment-row-1',
        submission_id: 'submission-uuid-1',
        external_attachment_id: 'attachment-proof-1',
        source_kind: 'inline_base64',
        file_name: 'proof.txt',
        media_type: 'text/plain',
        byte_size: 5,
        storage_bucket: 'submission-attachments',
        storage_status: 'stored',
        storage_error: null,
        created_at: '2026-03-29T00:00:00.000Z',
        updated_at: '2026-03-29T00:00:01.000Z',
      })
    ).toThrow('Persisted attachment row storage_path must be a non-empty string.');
  });
});

describe('detail truth assertion', () => {
  it('accepts reviewer-safe attachment metadata that matches the persisted row', () => {
    expect(() =>
      assertDetailAttachmentTruth({
        detail: createDetailResponse(),
        submissionId: 'submission-uuid-1',
        persistedAttachments: [
          {
            id: 'attachment-row-1',
            submission_id: 'submission-uuid-1',
            external_attachment_id: 'attachment-proof-1',
            source_kind: 'inline_base64',
            file_name: 'proof.txt',
            media_type: 'text/plain',
            byte_size: 5,
            storage_bucket: 'submission-attachments',
            storage_path: 'submissions/submission-uuid-1/attachments/attachment-proof-1',
            storage_status: 'stored',
            storage_error: null,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:01.000Z',
          },
        ],
      })
    ).not.toThrow();
  });

  it('fails when the detail API drifts from the persisted attachment truth', () => {
    const drifted = createDetailResponse();
    drifted.attachments[0] = {
      ...drifted.attachments[0],
      file_name: 'different.txt',
    };

    expect(() =>
      assertDetailAttachmentTruth({
        detail: drifted,
        submissionId: 'submission-uuid-1',
        persistedAttachments: [
          {
            id: 'attachment-row-1',
            submission_id: 'submission-uuid-1',
            external_attachment_id: 'attachment-proof-1',
            source_kind: 'inline_base64',
            file_name: 'proof.txt',
            media_type: 'text/plain',
            byte_size: 5,
            storage_bucket: 'submission-attachments',
            storage_path: 'submissions/submission-uuid-1/attachments/attachment-proof-1',
            storage_status: 'stored',
            storage_error: null,
            created_at: '2026-03-29T00:00:00.000Z',
            updated_at: '2026-03-29T00:00:01.000Z',
          },
        ],
      })
    ).toThrow('Submission detail attachment attachment-row-1 drifted from persisted truth.');
  });
});

describe('summary formatting', () => {
  it('formats the proof target and storage path for downstream reuse', () => {
    expect(formatProofSummary(createSummary())).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof submission=submission-uuid-1 submissionExternalId=sub-proof-1 detailUrl=http://localhost:3000/queues/queue-uuid-1/submissions/submission-uuid-1 detailApiUrl=http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1 attachments=attachment-row-1:attachment-proof-1:submissions/submission-uuid-1/attachments/attachment-proof-1 uploadCounts=1/1/1/1/1 autoStarted=no'
    );
  });
});
