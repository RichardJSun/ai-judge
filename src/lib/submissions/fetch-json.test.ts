import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fetchJson, parseSubmissionDetailResponse } from './fetch-json';

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
      })
    ).toThrow(/Malformed submission detail response: /);
  });
});
