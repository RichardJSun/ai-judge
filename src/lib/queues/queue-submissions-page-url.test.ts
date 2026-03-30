import { describe, expect, it } from 'bun:test';
import {
    buildQueueSubmissionDetailBackHref,
    buildQueueSubmissionDetailHref,
    buildQueueSubmissionsHref,
    buildQueueSubmissionsPageHref,
    buildQueueSubmissionsQueryString,
    normalizeQueueSubmissionsPageSearchParams,
    resolveQueueSubmissionsPageSyncHref,
} from './queue-submissions-page-url';

describe('normalizeQueueSubmissionsPageSearchParams', () => {
    it('normalizes missing, blank, repeated, malformed, and unsafe page params to the first valid positive integer', () => {
        expect(normalizeQueueSubmissionsPageSearchParams({})).toEqual({ page: 1 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: '' })).toEqual({ page: 1 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: '  ' })).toEqual({ page: 1 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: ['3', '9'] })).toEqual({ page: 3 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: '0' })).toEqual({ page: 1 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: '-2' })).toEqual({ page: 1 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: '9007199254740992' })).toEqual({ page: 1 });
        expect(normalizeQueueSubmissionsPageSearchParams({ page: '999' })).toEqual({ page: 999 });
    });
});

describe('buildQueueSubmissionsQueryString', () => {
    it('serializes the canonical queue page state into the reviewer pagination query contract', () => {
        expect(buildQueueSubmissionsQueryString({ page: 2 })).toBe('page=2');
    });
});

describe('buildQueueSubmissionsPageHref', () => {
    it('builds the canonical queue page href from normalized state', () => {
        expect(buildQueueSubmissionsPageHref('/queues/queue-1', { page: 2 })).toBe('/queues/queue-1?page=2');
    });
});

describe('buildQueueSubmissionDetailHref', () => {
    it('builds queue-origin submission detail hrefs that preserve the canonical queue page in the detail URL', () => {
        expect(buildQueueSubmissionDetailHref('queue-1', 'submission-21', { page: 2 })).toBe(
            '/queues/queue-1/submissions/submission-21?source=queue&page=2'
        );
        expect(buildQueueSubmissionDetailHref('queue-1', 'submission-1', { page: 1 })).toBe(
            '/queues/queue-1/submissions/submission-1?source=queue&page=1'
        );
    });
});

describe('buildQueueSubmissionsHref', () => {
    it('drops unsupported params and malformed page input before linking back into the queue page', () => {
        expect(
            buildQueueSubmissionsHref('queue-1', {
                page: ['999999999999999999999999', '3'],
                source: 'reviewer',
            })
        ).toBe('/queues/queue-1?page=1');
    });
});

describe('buildQueueSubmissionDetailBackHref', () => {
    it('sanitizes malformed or mixed queue-origin context down to the canonical queue page href', () => {
        expect(
            buildQueueSubmissionDetailBackHref('queue-1', {
                source: 'queue',
                page: ['4', '9'],
                judgeId: 'judge-1',
                verdict: 'pass',
            })
        ).toBe('/queues/queue-1?page=4');

        expect(
            buildQueueSubmissionDetailBackHref('queue-1', {
                source: 'queue',
                page: ['999999999999999999999999', '3'],
                extra: 'drop-me',
            })
        ).toBe('/queues/queue-1?page=1');
    });
});

describe('resolveQueueSubmissionsPageSyncHref', () => {
    it('requests a URL rewrite for missing, duplicated, stale, or unsupported params and skips canonical URLs', () => {
        expect(resolveQueueSubmissionsPageSyncHref('/queues/queue-1', {}, { page: 1 })).toBe(
            '/queues/queue-1?page=1'
        );

        expect(
            resolveQueueSubmissionsPageSyncHref(
                '/queues/queue-1',
                {
                    page: ['2', '3'],
                    source: 'reviewer',
                },
                { page: 2 }
            )
        ).toBe('/queues/queue-1?page=2');

        expect(
            resolveQueueSubmissionsPageSyncHref(
                '/queues/queue-1',
                {
                    page: '2',
                },
                { page: 2 }
            )
        ).toBeNull();
    });
});
