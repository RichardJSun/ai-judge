import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    buildJudgePageHref,
    JudgesPageContent,
    normalizeJudgePageSearchParam,
    parseJudgePageResponse,
    resolveJudgePageSyncHref,
} from './page';
import type { JudgePageResponse } from '@/types/api';

function createJudgePageResponse(overrides: Partial<JudgePageResponse> = {}): JudgePageResponse {
    return {
        judges: [
            {
                id: 'judge-26',
                name: 'Judge 26',
                system_prompt: 'Judge 26 prompt',
                model: 'gateway/model-26',
                active: true,
                created_at: '2026-03-26T10:00:00.000Z',
                updated_at: '2026-03-26T11:00:00.000Z',
            },
            {
                id: 'judge-27',
                name: 'Judge 27',
                system_prompt: 'Judge 27 prompt',
                model: 'gateway/model-27',
                active: false,
                created_at: '2026-03-27T10:00:00.000Z',
                updated_at: '2026-03-27T11:00:00.000Z',
            },
        ],
        total: 27,
        page: 2,
        pageSize: 25,
        ...overrides,
    };
}

describe('normalizeJudgePageSearchParam', () => {
    it('normalizes missing, malformed, repeated, and unsafe page params to the first valid positive integer', () => {
        expect(normalizeJudgePageSearchParam(undefined)).toBe(1);
        expect(normalizeJudgePageSearchParam('0')).toBe(1);
        expect(normalizeJudgePageSearchParam('-2')).toBe(1);
        expect(normalizeJudgePageSearchParam('2.5')).toBe(1);
        expect(normalizeJudgePageSearchParam(['3', '9'])).toBe(3);
        expect(normalizeJudgePageSearchParam('999')).toBe(999);
        expect(normalizeJudgePageSearchParam('9007199254740992')).toBe(1);
    });
});

describe('buildJudgePageHref', () => {
    it('preserves non-page params while replacing page with a canonical numbered value', () => {
        expect(buildJudgePageHref('/judges', { filter: 'active', page: '999', scope: ['reviewer', 'history'] }, 2)).toBe(
            '/judges?filter=active&scope=reviewer&scope=history&page=2'
        );
    });
});

describe('resolveJudgePageSyncHref', () => {
    it('returns a sync target when the URL is missing, duplicated, invalid, or clamped by the server', () => {
        expect(resolveJudgePageSyncHref('/judges', {}, 1)).toBe('/judges?page=1');
        expect(resolveJudgePageSyncHref('/judges', { page: '999' }, 2)).toBe('/judges?page=2');
        expect(resolveJudgePageSyncHref('/judges', { page: ['2', '3'], filter: 'active' }, 2)).toBe(
            '/judges?filter=active&page=2'
        );
        expect(resolveJudgePageSyncHref('/judges', { page: '2' }, 2)).toBeNull();
    });
});

describe('parseJudgePageResponse', () => {
    it('treats malformed page metadata and legacy array payloads as hard paged-query errors', () => {
        expect(() => parseJudgePageResponse([{ id: 'judge-1' }] as never, '/api/judges?page=1 response')).toThrow(
            'Malformed /api/judges?page=1 response:'
        );

        expect(() =>
            parseJudgePageResponse(
                {
                    judges: [],
                    total: '27',
                    page: 1,
                    pageSize: 25,
                },
                '/api/judges?page=1 response'
            )
        ).toThrow('Malformed /api/judges?page=1 response:');
    });
});

describe('JudgesPageContent', () => {
    it('renders the existing loading state while a page request is pending', () => {
        const html = renderToStaticMarkup(<JudgesPageContent isLoading />);

        expect(html).toContain('Judges');
        expect(html).toContain('MuiCircularProgress');
    });

    it('renders an explicit retryable error state for failed paged fetches', () => {
        const html = renderToStaticMarkup(
            <JudgesPageContent isLoading={false} isError error={new Error('Failed to load judges. The server returned invalid JSON.')} />
        );

        expect(html).toContain('Failed to load judges. The server returned invalid JSON.');
        expect(html).toContain('Retry');
    });

    it('renders the existing empty state when the active page has no judges', () => {
        const html = renderToStaticMarkup(
            <JudgesPageContent isLoading={false} data={createJudgePageResponse({ judges: [], total: 0, page: 1 })} />
        );

        expect(html).toContain('No judges yet. Create one to start evaluating submissions.');
        expect(html).toContain('New Judge');
    });

    it('renders only the active page rows, a truthful summary, and numbered pager links', () => {
        const html = renderToStaticMarkup(
            <JudgesPageContent
                isLoading={false}
                data={createJudgePageResponse()}
                getPageHref={(page) => `/judges?page=${page}`}
            />
        );

        expect(html).toContain('Showing 26-27 of 27 judges.');
        expect(html).toContain('Judge 26');
        expect(html).toContain('Judge 27');
        expect(html).not.toContain('Judge 1');
        expect(html).toContain('gateway/model-26');
        expect(html).toContain('href="/judges/judge-26"');
        expect(html).toContain('Active');
        expect(html).toContain('Inactive');
        expect(html).toContain('href="/judges?page=1"');
        expect(html).toContain('aria-current="page"');
    });

    it('exposes the shared compact pager for long judge lists', () => {
        const html = renderToStaticMarkup(
            <JudgesPageContent
                isLoading={false}
                data={createJudgePageResponse({ page: 5, total: 250 })}
                getPageHref={(page) => `/judges?page=${page}`}
            />
        );

        expect(html).toContain('href="/judges?page=1"');
        expect(html).toContain('href="/judges?page=4"');
        expect(html).toContain('href="/judges?page=6"');
        expect(html).toContain('href="/judges?page=10"');
        expect(html).toContain('…');
    });
});
