import { afterEach, describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildQueuePageHref,
  formatQueueCreatedAt,
  normalizeQueuePageSearchParam,
  parseQueuePageResponse,
  QueuesPageContent,
  resolveQueuePageSyncHref,
} from './page';
import type { QueuePageResponse } from '@/types/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createQueuePageResponse(overrides: Partial<QueuePageResponse> = {}): QueuePageResponse {
  return {
    queues: [
      {
        id: 'queue-26',
        queue_id: 'QUEUE-026',
        created_at: '2026-03-26T10:00:00.000Z',
        submission_count: 2,
        question_count: 1,
        result_count: 3,
      },
      {
        id: 'queue-27',
        queue_id: 'QUEUE-027',
        created_at: '2026-03-27T10:00:00.000Z',
        submission_count: 0,
        question_count: 3,
        result_count: 0,
      },
    ],
    total: 27,
    page: 2,
    pageSize: 25,
    ...overrides,
  };
}

describe('normalizeQueuePageSearchParam', () => {
  it('normalizes missing, malformed, and repeated page params to the first valid positive integer', () => {
    expect(normalizeQueuePageSearchParam(undefined)).toBe(1);
    expect(normalizeQueuePageSearchParam('0')).toBe(1);
    expect(normalizeQueuePageSearchParam('-2')).toBe(1);
    expect(normalizeQueuePageSearchParam('2.5')).toBe(1);
    expect(normalizeQueuePageSearchParam(['3', '9'])).toBe(3);
    expect(normalizeQueuePageSearchParam('999')).toBe(999);
  });
});

describe('buildQueuePageHref', () => {
  it('preserves non-page params while replacing page with a canonical numbered value', () => {
    expect(buildQueuePageHref('/queues', { sort: 'recent', page: '999', label: ['open', 'closed'] }, 2)).toBe(
      '/queues?sort=recent&label=open&label=closed&page=2'
    );
  });
});

describe('resolveQueuePageSyncHref', () => {
  it('returns a sync target when the URL is missing, duplicated, invalid, or clamped by the server', () => {
    expect(resolveQueuePageSyncHref('/queues', {}, 1)).toBe('/queues?page=1');
    expect(resolveQueuePageSyncHref('/queues', { page: '999' }, 2)).toBe('/queues?page=2');
    expect(resolveQueuePageSyncHref('/queues', { page: ['2', '3'], sort: 'recent' }, 2)).toBe(
      '/queues?sort=recent&page=2'
    );
    expect(resolveQueuePageSyncHref('/queues', { page: '2' }, 2)).toBeNull();
  });
});

describe('parseQueuePageResponse', () => {
  it('treats malformed page metadata, missing results metadata, and legacy array payloads as hard paged-query errors', () => {
    expect(() => parseQueuePageResponse([{ id: 'queue-1' }] as never, '/api/queues?page=1 response')).toThrow(
      'Malformed /api/queues?page=1 response:'
    );

    expect(() =>
      parseQueuePageResponse(
        {
          queues: [
            {
              id: 'queue-1',
              queue_id: 'QUEUE-001',
              created_at: '2026-03-01T10:00:00.000Z',
              submission_count: 1,
              question_count: 1,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        },
        '/api/queues?page=1 response'
      )
    ).toThrow('Malformed /api/queues?page=1 response:');

    expect(() =>
      parseQueuePageResponse(
        {
          queues: [],
          total: '27',
          page: 1,
          pageSize: 25,
        },
        '/api/queues?page=1 response'
      )
    ).toThrow('Malformed /api/queues?page=1 response:');
  });
});

describe('formatQueueCreatedAt', () => {
  it('formats queue creation timestamps deterministically in UTC', () => {
    expect(formatQueueCreatedAt('2026-03-26T10:00:00.000Z')).toBe('Mar 26, 2026');
    expect(formatQueueCreatedAt('not-a-date')).toBe('not-a-date');
  });
});

describe('QueuesPageContent', () => {
  it('renders the existing loading state while a page request is pending', () => {
    const html = renderToStaticMarkup(<QueuesPageContent isLoading />);

    expect(html).toContain('Queues');
    expect(html).toContain('MuiCircularProgress');
  });

  it('renders an explicit retryable error state for failed paged fetches', () => {
    const html = renderToStaticMarkup(
      <QueuesPageContent isLoading={false} isError error={new Error('Failed to load queues. The server returned invalid JSON.')} />
    );

    expect(html).toContain('Failed to load queues. The server returned invalid JSON.');
    expect(html).toContain('Retry');
  });

  it('renders the existing empty state when the active page has no queues', () => {
    const html = renderToStaticMarkup(
      <QueuesPageContent isLoading={false} data={createQueuePageResponse({ queues: [], total: 0, page: 1 })} />
    );

    expect(html).toContain('No queues yet. Upload a submission file to get started.');
    expect(html).toContain('href="/upload"');
  });

  it('renders only the active page rows, keeps reviewer actions aligned, and exposes a disabled Results button when a queue has no result history', () => {
    const html = renderToStaticMarkup(
      <QueuesPageContent
        isLoading={false}
        data={createQueuePageResponse()}
        getPageHref={(page) => `/queues?page=${page}`}
      />
    );

    expect(html).toContain('Showing 26-27 of 27 queues.');
    expect(html).toContain('QUEUE-026');
    expect(html).toContain('QUEUE-027');
    expect(html).not.toContain('QUEUE-001');

    expect(html).toContain('Mar 26, 2026');
    expect(html).toContain('Mar 27, 2026');

    expect(html).toContain('href="/queues/queue-26"');
    expect(html).toContain('href="/queues/queue-26/assign"');
    expect(html).toContain('href="/queues/queue-26/run"');
    expect(html).toContain('href="/queues/queue-27"');
    expect(html).toContain('href="/queues/queue-27/assign"');
    expect(html).toContain('href="/queues/queue-27/run"');
    expect(html).toContain('href="/queues/queue-26/results"');
    expect(html).not.toContain('href="/queues/queue-27/results"');
    expect(html).toContain('aria-label="Results unavailable for QUEUE-027"');
    expect(html).toContain('disabled=""');

    const resultsLinkCount = html.match(/href="\/queues\/queue-\d+\/results"/g)?.length ?? 0;
    expect(resultsLinkCount).toBe(1);

    expect(html).toContain('href="/queues?page=1"');
    expect(html).toContain('aria-current="page"');
  });
});
