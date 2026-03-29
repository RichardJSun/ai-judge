import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SubmissionDetailResponse } from '@/types/api';
import {
  fetchSubmissionDetail,
  getSubmissionDetailBackHref,
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

  it('treats only the constrained results marker as a results-origin visit', () => {
    expect(parseSubmissionDetailNavigationSource('results')).toBe('results');
    expect(parseSubmissionDetailNavigationSource(undefined)).toBe('queue');
    expect(parseSubmissionDetailNavigationSource('queue')).toBe('queue');
    expect(parseSubmissionDetailNavigationSource('anything-else')).toBe('queue');
    expect(parseSubmissionDetailNavigationSource(['results'])).toBe('queue');
  });

  it('keeps queue-origin and results fallback targets queue scoped', () => {
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
  it('renders an explicit loading state with deterministic back navigation copy', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        isLoading
        error={null}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Back');
    expect(html).toContain('Queue queue-1');
    expect(html).toContain('Loading submission detail');
  });

  it('renders a reviewer-visible error alert with retry affordance', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        isLoading={false}
        error={new Error('Submission not found for queue.')}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Back');
    expect(html).toContain('Submission not found for queue.');
    expect(html).toContain('Retry');
  });

  it('renders the full ordered question set through SubmissionDetailView without reconstructing rows', () => {
    const html = renderToStaticMarkup(
      <SubmissionDetailPageContent
        queueId="queue-1"
        detail={createDetailResponse()}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(html).toContain('Submission detail');
    expect(html).toContain('QUEUE-001');
    expect(html).toContain('SUB-001');

    const firstIndex = html.indexOf('First question in queue order.');
    const secondIndex = html.indexOf('Second question in queue order.');
    const thirdIndex = html.indexOf('Third question in queue order.');

    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(thirdIndex).toBeGreaterThan(secondIndex);
    expect(html).toContain('First answer.');
    expect(html).toContain('Structured answer recorded. Open raw payload to inspect the stored response.');
    expect(html).toContain('No answer was submitted for this question.');
  });
});
