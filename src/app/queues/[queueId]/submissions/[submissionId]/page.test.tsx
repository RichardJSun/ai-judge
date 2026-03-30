import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SubmissionDetailResponse } from '@/types/api';
import {
  fetchSubmissionDetail,
  getSubmissionDetailBackHref,
  getSubmissionDetailBackLabel,
  getSubmissionDetailQueryKey,
  handleSubmissionDetailBack,
  parseSubmissionDetailNavigationSource,
  SubmissionDetailPageContent,
} from './page';

const originalFetch = globalThis.fetch;

function createDetailResponse(): SubmissionDetailResponse {
  return {
    queue: {
      id: 'queue-1',
      queue_id: 'QUEUE-001',
      created_at: '2026-03-28T10:00:00.000Z',
    },
    submission: {
      id: 'submission-1',
      queue_id: 'queue-1',
      external_id: 'SUB-001',
      labeling_task_id: 'task-17',
      submitted_at: '2026-03-28T10:05:00.000Z',
      created_at: '2026-03-28T10:05:00.000Z',
    },
    summary: {
      totalQuestions: 3,
      answeredQuestions: 2,
      missingQuestions: 1,
    },
    questions: [
      {
        id: 'question-1',
        external_id: 'Q-001',
        question_type: 'short_text',
        question_text: 'First question in queue order.',
        created_at: '2026-03-28T10:01:00.000Z',
        answerState: 'answered',
        answer: 'First answer.',
        rawAnswer: { value: 'First answer.' },
      },
      {
        id: 'question-2',
        external_id: 'Q-002',
        question_type: 'json',
        question_text: 'Second question in queue order.',
        created_at: '2026-03-28T10:02:00.000Z',
        answerState: 'answered',
        answer: null,
        rawAnswer: { value: { nested: true } },
      },
      {
        id: 'question-3',
        external_id: 'Q-003',
        question_type: null,
        question_text: 'Third question in queue order.',
        created_at: '2026-03-28T10:03:00.000Z',
        answerState: 'missing',
        answer: null,
        rawAnswer: null,
      },
    ],
    attachments: [],
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('submission detail page helpers', () => {
  it('builds a stable queue-scoped query key', () => {
    expect(getSubmissionDetailQueryKey('queue-1', 'submission-1')).toEqual([
      'submission-detail',
      'queue-1',
      'submission-1',
    ]);
  });

  it('fetches the queue-scoped detail payload once and parses it unchanged', async () => {
    const detail = createDetailResponse();
    let requestedUrl: RequestInfo | URL | undefined;
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      requestedUrl = input;

      return new Response(JSON.stringify(detail), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchSubmissionDetail('queue-1', 'submission-1')).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl).toBe('/api/queues/queue-1/submissions/submission-1');
  });

  it('surfaces reviewer-safe route errors from the detail fetch helper', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Submission not found for queue.',
            detail: 'No submission detail row matched queue queue-1 and submission submission-missing.',
          }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(fetchSubmissionDetail('queue-1', 'submission-missing')).rejects.toThrow(
      'Submission not found for queue. No submission detail row matched queue queue-1 and submission submission-missing.'
    );
  });

  it('rejects malformed attachment payloads before the page can render them', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            ...createDetailResponse(),
            attachments: [
              {
                id: 'attachment-1',
                external_attachment_id: 'ATT-001',
                source_kind: 'inline_base64',
                file_name: 'evidence.pdf',
                media_type: 'application/pdf',
                byte_size: 1024,
                storage_status: 'stored',
                storage_error: 'should-not-exist',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(fetchSubmissionDetail('queue-1', 'submission-1')).rejects.toThrow(
      /Malformed \/api\/queues\/queue-1\/submissions\/submission-1 response: /
    );
  });

  it('treats only the constrained results marker as a results-origin visit', () => {
    expect(parseSubmissionDetailNavigationSource('results')).toBe('results');
    expect(parseSubmissionDetailNavigationSource(undefined)).toBe('queue');
    expect(parseSubmissionDetailNavigationSource('queue')).toBe('queue');
    expect(parseSubmissionDetailNavigationSource('anything-else')).toBe('queue');
    expect(parseSubmissionDetailNavigationSource(['results'])).toBe('queue');
    expect(parseSubmissionDetailNavigationSource(['results', 'queue'])).toBe('queue');
  });

  it('keeps queue-origin and results fallback labels and targets queue scoped', () => {
    expect(getSubmissionDetailBackLabel('queue')).toBe('Back to queue');
    expect(getSubmissionDetailBackLabel('results')).toBe('Back to results');
    expect(getSubmissionDetailBackHref('queue-1', 'queue')).toBe('/queues/queue-1');
    expect(getSubmissionDetailBackHref('queue-1', 'results')).toBe('/queues/queue-1/results');
  });

  it('returns queue-origin visits to the queue page', () => {
    const router = {
      back: mock(() => undefined),
      push: mock((_href: string) => undefined),
    };

    handleSubmissionDetailBack({
      queueId: 'queue-1',
      source: 'queue',
      router,
      historyLength: 5,
    });

    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/queues/queue-1');
  });

  it('prefers browser history for results-origin visits when history is available', () => {
    const router = {
      back: mock(() => undefined),
      push: mock((_href: string) => undefined),
    };

    handleSubmissionDetailBack({
      queueId: 'queue-1',
      source: 'results',
      router,
      historyLength: 2,
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('falls back to queue-scoped results when a results-origin visit has no history', () => {
    const router = {
      back: mock(() => undefined),
      push: mock((_href: string) => undefined),
    };

    handleSubmissionDetailBack({
      queueId: 'queue-1',
      source: parseSubmissionDetailNavigationSource('unknown-source'),
      router,
      historyLength: 0,
    });

    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/queues/queue-1');

    handleSubmissionDetailBack({
      queueId: 'queue-1',
      source: 'results',
      router,
      historyLength: 1,
    });

    expect(router.push).toHaveBeenLastCalledWith('/queues/queue-1/results');
  });
});

describe('SubmissionDetailPageContent', () => {
  it('renders queue-origin loading state with queue-scoped return copy and breadcrumbs', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        source="queue"
        isLoading
        error={null}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('Submission detail');
    expect(html).toContain('Loading submission detail');
    expect(html).not.toContain('href="/queues/queue-1/results"');
  });

  it('renders results-origin error state with results-scoped return copy and breadcrumbs', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        source="results"
        isLoading={false}
        error={new Error('Submission not found for queue.')}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Back to results');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('href="/queues/queue-1/results"');
    expect(html).toContain('Results');
    expect(html).toContain('Submission not found for queue.');
    expect(html).toContain('Retry');
  });

  it('renders attachment truth through SubmissionDetailView without exposing storage internals', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        source="results"
        detail={{
          ...createDetailResponse(),
          attachments: [
            {
              id: 'attachment-1',
              external_attachment_id: 'ATT-001',
              source_kind: 'inline_base64',
              file_name: 'review-evidence.pdf',
              media_type: 'application/pdf',
              byte_size: 1024,
              storage_status: 'stored',
              storage_error: null,
            },
            {
              id: 'attachment-2',
              external_attachment_id: 'ATT-002',
              source_kind: 'inline_base64',
              file_name: 'missing-reference.txt',
              media_type: 'text/plain',
              byte_size: 256,
              storage_status: 'unavailable',
              storage_error: 'private/path/that-should-not-render.txt',
            },
          ],
        }}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Back to results');
    expect(html).toContain('href="/queues/queue-1/results"');
    expect(html).toContain('Submission detail');
    expect(html).toContain('Attachments');
    expect(html).toContain('review-evidence.pdf');
    expect(html).toContain('application/pdf');
    expect(html).toContain('Stored');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Attachment metadata was captured, but the durable file is currently unavailable.');
    expect(html).not.toContain('private/path/that-should-not-render.txt');

    const firstIndex = html.indexOf('First question in queue order.');
    const secondIndex = html.indexOf('Second question in queue order.');
    const thirdIndex = html.indexOf('Third question in queue order.');

    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(thirdIndex).toBeGreaterThan(secondIndex);
  });

  it('renders the explicit no-attachments state when the payload contains none', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        source="queue"
        detail={createDetailResponse()}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('No attachments were included with this submission.');
  });
});
