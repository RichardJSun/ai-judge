import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fetchJson, parseQueueSubmissionsResponse, parseSubmissionDetailResponse } from './fetch-json';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchJson', () => {
  it('throws reviewer-visible route errors without calling the success parser', async () => {
    const parse = mock((value: unknown) => value);

    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Submission not found for queue.',
            detail: 'No submission detail row matched queue queue-1 and submission submission-1.',
          }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/submissions/submission-1', {
        fallbackMessage: 'Failed to load submission detail.',
        parse,
      })
    ).rejects.toThrow('Submission not found for queue. No submission detail row matched queue queue-1 and submission submission-1.');

    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects malformed successful submission-detail payloads before consumers can render them', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            queue: {
              id: 'queue-1',
              queue_id: 'queue-external-1',
              created_at: '2026-03-28T10:00:00.000Z',
            },
            submission: {
              id: 'submission-1',
              queue_id: 'queue-1',
              external_id: 'submission-external-1',
              labeling_task_id: null,
              submitted_at: null,
              created_at: '2026-03-28T10:05:00.000Z',
            },
            summary: {
              totalQuestions: 2,
              answeredQuestions: 1,
              missingQuestions: 1,
            },
            attachments: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/submissions/submission-1', {
        fallbackMessage: 'Failed to load submission detail.',
        parse: (value) =>
          parseSubmissionDetailResponse(value, '/api/queues/queue-1/submissions/submission-1 response'),
      })
    ).rejects.toThrow(/Malformed \/api\/queues\/queue-1\/submissions\/submission-1 response: /);
  });

  it('rejects malformed successful queue-submissions payloads before pagination state is derived', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            submissions: [
              {
                id: 'submission-1',
                external_id: 'submission-external-1',
                labeling_task_id: null,
                submitted_at: '2026-03-28T10:05:00.000Z',
                created_at: '2026-03-28T10:05:00.000Z',
              },
            ],
            total: 1,
            pageSize: 20,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/submissions?page=1', {
        fallbackMessage: 'Failed to load queue submissions.',
        parse: (value) => parseQueueSubmissionsResponse(value, '/api/queues/queue-1/submissions?page=1 response'),
      })
    ).rejects.toThrow(/Malformed \/api\/queues\/queue-1\/submissions\?page=1 response: /);
  });

  it('surfaces invalid JSON responses with the fallback message context', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/submissions/submission-1', {
        fallbackMessage: 'Failed to load submission detail.',
        parse: (value) => value,
      })
    ).rejects.toThrow('Failed to load submission detail. The server returned invalid JSON.');
  });
});

describe('parseQueueSubmissionsResponse', () => {
  it('accepts the canonical queue submissions pagination payload', () => {
    expect(
      parseQueueSubmissionsResponse({
        submissions: [
          {
            id: 'submission-1',
            external_id: 'submission-external-1',
            labeling_task_id: null,
            submitted_at: '2026-03-28T10:05:00.000Z',
            created_at: '2026-03-28T10:05:00.000Z',
          },
          {
            id: 'submission-2',
            external_id: 'submission-external-2',
            labeling_task_id: 'task-22',
            submitted_at: null,
            created_at: '2026-03-28T10:06:00.000Z',
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      })
    ).toEqual({
      submissions: [
        {
          id: 'submission-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: '2026-03-28T10:05:00.000Z',
          created_at: '2026-03-28T10:05:00.000Z',
        },
        {
          id: 'submission-2',
          external_id: 'submission-external-2',
          labeling_task_id: 'task-22',
          submitted_at: null,
          created_at: '2026-03-28T10:06:00.000Z',
        },
      ],
      total: 21,
      page: 2,
      pageSize: 20,
    });
  });

  it('rejects missing top-level pagination fields', () => {
    expect(() =>
      parseQueueSubmissionsResponse({
        submissions: [],
        total: 0,
        pageSize: 20,
      })
    ).toThrow(/Malformed queue submissions response: /);
  });

  it('rejects malformed submission rows', () => {
    expect(() =>
      parseQueueSubmissionsResponse({
        submissions: [
          {
            id: 'submission-1',
            external_id: 'submission-external-1',
            labeling_task_id: null,
            submitted_at: '2026-03-28T10:05:00.000Z',
            created_at: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      })
    ).toThrow(/Malformed queue submissions response: /);
  });
});

describe('parseSubmissionDetailResponse', () => {
  it('accepts the full queue-scoped submission detail contract', () => {
    expect(
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
          id: 'submission-1',
          queue_id: 'queue-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: '2026-03-28T10:05:00.000Z',
          created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
          totalQuestions: 2,
          answeredQuestions: 1,
          missingQuestions: 1,
        },
        questions: [
          {
            id: 'question-1',
            external_id: 'question-external-1',
            question_type: 'short_text',
            question_text: 'First question?',
            created_at: '2026-03-28T10:01:00.000Z',
            answerState: 'missing',
            answer: null,
            rawAnswer: null,
          },
          {
            id: 'question-2',
            external_id: 'question-external-2',
            question_type: 'multi_select',
            question_text: 'Second question?',
            created_at: '2026-03-28T10:02:00.000Z',
            answerState: 'answered',
            answer: ['a', 'b'],
            rawAnswer: { value: ['a', 'b'], label: 'Answer label' },
          },
        ],
        attachments: [
          {
            id: 'attachment-row-1',
            external_attachment_id: 'attachment-external-1',
            source_kind: 'inline_base64',
            file_name: 'evidence.pdf',
            media_type: 'application/pdf',
            byte_size: 1024,
            storage_status: 'stored',
            storage_error: null,
          },
          {
            id: 'attachment-row-2',
            external_attachment_id: 'attachment-external-2',
            source_kind: 'inline_base64',
            file_name: 'missing.txt',
            media_type: 'text/plain',
            byte_size: 64,
            storage_status: 'unavailable',
            storage_error: 'Attachment metadata exists but the durable file could not be confirmed.',
          },
        ],
      })
    ).toEqual({
      queue: {
        id: 'queue-1',
        queue_id: 'queue-external-1',
        created_at: '2026-03-28T10:00:00.000Z',
      },
      submission: {
        id: 'submission-1',
        queue_id: 'queue-1',
        external_id: 'submission-external-1',
        labeling_task_id: null,
        submitted_at: '2026-03-28T10:05:00.000Z',
        created_at: '2026-03-28T10:05:00.000Z',
      },
      summary: {
        totalQuestions: 2,
        answeredQuestions: 1,
        missingQuestions: 1,
      },
      questions: [
        {
          id: 'question-1',
          external_id: 'question-external-1',
          question_type: 'short_text',
          question_text: 'First question?',
          created_at: '2026-03-28T10:01:00.000Z',
          answerState: 'missing',
          answer: null,
          rawAnswer: null,
        },
        {
          id: 'question-2',
          external_id: 'question-external-2',
          question_type: 'multi_select',
          question_text: 'Second question?',
          created_at: '2026-03-28T10:02:00.000Z',
          answerState: 'answered',
          answer: ['a', 'b'],
          rawAnswer: { value: ['a', 'b'], label: 'Answer label' },
        },
      ],
      attachments: [
        {
          id: 'attachment-row-1',
          external_attachment_id: 'attachment-external-1',
          source_kind: 'inline_base64',
          file_name: 'evidence.pdf',
          media_type: 'application/pdf',
          byte_size: 1024,
          storage_status: 'stored',
          storage_error: null,
        },
        {
          id: 'attachment-row-2',
          external_attachment_id: 'attachment-external-2',
          source_kind: 'inline_base64',
          file_name: 'missing.txt',
          media_type: 'text/plain',
          byte_size: 64,
          storage_status: 'unavailable',
          storage_error: 'Attachment metadata exists but the durable file could not be confirmed.',
        },
      ],
    });
  });

  it('rejects missing top-level fields', () => {
    expect(() =>
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
      })
    ).toThrow(/Malformed submission detail response: /);
  });

  it('rejects malformed question entries', () => {
    expect(() =>
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
          id: 'submission-1',
          queue_id: 'queue-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: null,
          created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
          totalQuestions: 1,
          answeredQuestions: 1,
          missingQuestions: 0,
        },
        questions: [
          {
            id: 'question-1',
            external_id: 'question-external-1',
            question_type: 'short_text',
            question_text: 'First question?',
            created_at: '2026-03-28T10:01:00.000Z',
            answerState: 'answered',
            answer: { nested: 'invalid' },
            rawAnswer: null,
          },
        ],
        attachments: [],
      })
    ).toThrow(/Malformed submission detail response: /);
  });

  it('rejects malformed attachment entries with missing required fields', () => {
    expect(() =>
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
          id: 'submission-1',
          queue_id: 'queue-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: null,
          created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
          totalQuestions: 0,
          answeredQuestions: 0,
          missingQuestions: 0,
        },
        questions: [],
        attachments: [
          {
            id: 'attachment-row-1',
            external_attachment_id: 'attachment-external-1',
            source_kind: 'inline_base64',
            media_type: 'application/pdf',
            byte_size: 1024,
            storage_status: 'stored',
            storage_error: null,
          },
        ],
      })
    ).toThrow(/Malformed submission detail response: /);
  });

  it('rejects null attachment metadata entries', () => {
    expect(() =>
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
          id: 'submission-1',
          queue_id: 'queue-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: null,
          created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
          totalQuestions: 0,
          answeredQuestions: 0,
          missingQuestions: 0,
        },
        questions: [],
        attachments: [null],
      })
    ).toThrow(/Malformed submission detail response: /);
  });

  it('rejects invalid attachment status values', () => {
    expect(() =>
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
          id: 'submission-1',
          queue_id: 'queue-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: null,
          created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
          totalQuestions: 0,
          answeredQuestions: 0,
          missingQuestions: 0,
        },
        questions: [],
        attachments: [
          {
            id: 'attachment-row-1',
            external_attachment_id: 'attachment-external-1',
            source_kind: 'inline_base64',
            file_name: 'evidence.pdf',
            media_type: 'application/pdf',
            byte_size: 1024,
            storage_status: 'pending',
            storage_error: null,
          },
        ],
      })
    ).toThrow(/Malformed submission detail response: /);
  });

  it('rejects impossible stored attachment error combinations', () => {
    expect(() =>
      parseSubmissionDetailResponse({
        queue: {
          id: 'queue-1',
          queue_id: 'queue-external-1',
          created_at: '2026-03-28T10:00:00.000Z',
        },
        submission: {
          id: 'submission-1',
          queue_id: 'queue-1',
          external_id: 'submission-external-1',
          labeling_task_id: null,
          submitted_at: null,
          created_at: '2026-03-28T10:05:00.000Z',
        },
        summary: {
          totalQuestions: 0,
          answeredQuestions: 0,
          missingQuestions: 0,
        },
        questions: [],
        attachments: [
          {
            id: 'attachment-row-1',
            external_attachment_id: 'attachment-external-1',
            source_kind: 'inline_base64',
            file_name: 'evidence.pdf',
            media_type: 'application/pdf',
            byte_size: 1024,
            storage_status: 'stored',
            storage_error: 'Stored attachments cannot report an error.',
          },
        ],
      })
    ).toThrow(/Malformed submission detail response: /);
  });
});
