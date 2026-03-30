import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { REVIEWER_TIMESTAMP_SOURCE } from '@/lib/reviewer/reviewer-timestamp';
import {
    createQueueSubmissionsPageCanonicalState,
    getQueueSubmissionsPageQueryKey,
    getQueueSubmissionsVisibleRangeText,
    QueuePageContent,
    type QueueSubmissionsResponse,
} from './page';

function createResponse(overrides: Partial<QueueSubmissionsResponse> = {}): QueueSubmissionsResponse {
    return {
        total: 25,
        page: 2,
        pageSize: 20,
        submissions: [
            {
                id: 'submission-21',
                external_id: 'SUB-021',
                labeling_task_id: 'task-21',
                submitted_at: '2026-03-28T10:05:00.000Z',
                created_at: '2026-03-28T10:05:00.000Z',
            },
            {
                id: 'submission-22',
                external_id: 'SUBMISSION-EXTERNAL-ID-WITH-LONG-TEXT-022',
                labeling_task_id: null,
                submitted_at: null,
                created_at: '2026-03-28T10:10:00.000Z',
            },
            {
                id: 'submission-23',
                external_id: 'SUB-023',
                labeling_task_id: 'task-23',
                submitted_at: '2026-03-28T10:15:00.000Z',
                created_at: '2026-03-28T10:15:00.000Z',
            },
            {
                id: 'submission-24',
                external_id: 'SUB-024',
                labeling_task_id: 'task-24',
                submitted_at: '2026-03-28T10:20:00.000Z',
                created_at: '2026-03-28T10:20:00.000Z',
            },
            {
                id: 'submission-25',
                external_id: 'SUB-025',
                labeling_task_id: 'task-25',
                submitted_at: '2026-03-28T10:25:00.000Z',
                created_at: '2026-03-28T10:25:00.000Z',
            },
        ],
        ...overrides,
    };
}

describe('createQueueSubmissionsPageCanonicalState', () => {
    it('adopts the clamped server page instead of trusting the requested queue page forever', () => {
        expect(createQueueSubmissionsPageCanonicalState({ page: 999 }, createResponse({ page: 2 }))).toEqual({
            page: 2,
        });
    });
});

describe('getQueueSubmissionsPageQueryKey', () => {
    it('keys the queue submissions cache by queue id plus canonical page state', () => {
        expect(getQueueSubmissionsPageQueryKey('queue-1', { page: 2 })).toEqual([
            'queue-submissions',
            'queue-1',
            2,
        ]);
    });
});

describe('getQueueSubmissionsVisibleRangeText', () => {
    it('reports the truthful visible range from server page metadata', () => {
        expect(getQueueSubmissionsVisibleRangeText(createResponse())).toBe('Showing 21-25 of 25 submissions.');
    });
});

describe('QueuePageContent', () => {
    it('renders the existing reviewer actions and loading state', () => {
        const html = renderToStaticMarkup(
            <QueuePageContent queueId="queue-1" isLoading data={undefined} loadError={null} page={1} onRetry={() => undefined} />
        );

        expect(html).toContain('Submissions');
        expect(html).toContain('Back to queues');
        expect(html).toContain('href="/queues"');
        expect(html).toContain('queue-1');
        expect(html).toContain('Assign Judges');
        expect(html).toContain('Run Evaluations');
        expect(html).toContain('Results');
        expect(html).toContain('href="/queues/queue-1/assign"');
        expect(html).toContain('href="/queues/queue-1/run"');
        expect(html).toContain('href="/queues/queue-1/results"');
        expect(html).toContain('MuiCircularProgress');
    });

    it('renders a truthful non-first-page visible range plus shared reviewer pagination links', () => {
        const html = renderToStaticMarkup(
            <QueuePageContent
                queueId="queue-1"
                isLoading={false}
                data={createResponse()}
                loadError={null}
                page={2}
                onRetry={() => undefined}
                getPageHref={(page) => `/queues/queue-1?page=${page}`}
            />
        );

        expect(html).toContain('Showing 21-25 of 25 submissions.');
        expect(html).toContain('Back to queues');
        expect(html).toContain('href="/queues"');
        expect(html).toContain('queue-1');
        expect(html).toContain('>ID<');
        expect(html).toContain('>Task ID<');
        expect(html).toContain('>Submitted<');
        expect(html).not.toContain('>View<');
        expect(html).not.toContain('>Actions<');
        expect(html).toContain('href="/queues/queue-1/submissions/submission-21?source=queue&amp;page=2"');
        expect(html).toContain('href="/queues/queue-1/submissions/submission-22?source=queue&amp;page=2"');
        expect(html).toContain('aria-label="Open submission SUB-021"');
        expect(html).toContain('aria-label="Open submission SUBMISSION-EXTERNAL-ID-WITH-LONG-TEXT-022"');
        expect(html).toContain('href="/queues/queue-1?page=1"');
        expect(html).toContain('aria-current="page"');
        expect(html).toContain('Previous');
        expect(html).toContain('Next');
        expect(html).toContain(`data-reviewer-timestamp-source="${REVIEWER_TIMESTAMP_SOURCE}"`);
        expect(html.split('data-reviewer-timestamp-state="fallback"')).toHaveLength(5);
        expect(html).toContain('>2026-03-28T10:05:00.000Z</time>');
    });

    it('keeps parser or fetch failures visible under the shared header with a retry action', () => {
        const html = renderToStaticMarkup(
            <QueuePageContent
                queueId="queue-1"
                isLoading={false}
                data={undefined}
                loadError={new Error('Malformed /api/queues/queue-1/submissions?page=999 response: page is required.')}
                page={1}
                onRetry={() => undefined}
            />
        );

        expect(html).toContain('Submissions');
        expect(html).toContain('Malformed /api/queues/queue-1/submissions?page=999 response: page is required.');
        expect(html).toContain('Retry');
    });

    it('keeps malformed optional metadata rows navigable', () => {
        const html = renderToStaticMarkup(
            <QueuePageContent
                queueId="queue-1"
                isLoading={false}
                data={createResponse()}
                loadError={null}
                page={2}
                onRetry={() => undefined}
            />
        );

        expect(html).toContain('SUBMISSION-EXTERNAL-ID-WITH-LONG-TEXT-022');
        expect(html).toContain('href="/queues/queue-1/submissions/submission-22?source=queue&amp;page=2"');
        expect(html).toContain('data-reviewer-timestamp-state="empty"');
        expect(html).toContain('>—</span>');
    });

    it('preserves explicit first-page queue context in submission detail links', () => {
        const html = renderToStaticMarkup(
            <QueuePageContent
                queueId="queue-1"
                isLoading={false}
                data={createResponse({ page: 1, submissions: [createResponse().submissions[0]] })}
                loadError={null}
                page={1}
                onRetry={() => undefined}
            />
        );

        expect(html).toContain('href="/queues/queue-1/submissions/submission-21?source=queue&amp;page=1"');
    });

    it('renders the existing empty state when no submissions are available', () => {
        const html = renderToStaticMarkup(
            <QueuePageContent
                queueId="queue-1"
                isLoading={false}
                data={{ submissions: [], total: 0, page: 1, pageSize: 20 }}
                loadError={null}
                page={1}
                onRetry={() => undefined}
            />
        );

        expect(html).toContain('No submissions in this queue.');
    });
});
