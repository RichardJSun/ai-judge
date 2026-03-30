import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    buildJudgeDialogTitle,
    buildJudgePageHref,
    buildJudgeSaveSuccessMessage,
    getJudgePageQueryKey,
    handleJudgeCreateSuccess,
    JudgesPageContent,
    normalizeJudgePageSearchParam,
    parseJudgePageResponse,
    persistJudgeUpdate,
    requireManagedJudgeSelection,
    resolveJudgePageSyncHref,
} from './page';
import {
    getJudgeDetailQueryKey,
    getJudgesQueryKey,
    reconcileSavedJudgeCaches,
    reconcileSavedJudgePage,
    upsertJudgeInList,
} from '@/lib/judges/judge-query-cache';
import type { JudgePageResponse } from '@/types/api';
import type { Judge } from '@/types/db';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createJudge(overrides: Partial<Judge> = {}): Judge {
    return {
        id: 'judge-26',
        name: 'Judge 26',
        system_prompt: 'Judge 26 prompt',
        model: 'gateway/model-26',
        active: true,
        created_at: '2026-03-26T10:00:00.000Z',
        updated_at: '2026-03-26T11:00:00.000Z',
        ...overrides,
    };
}

function createJudgePageResponse(overrides: Partial<JudgePageResponse> = {}): JudgePageResponse {
    return {
        judges: [
            createJudge(),
            createJudge({
                id: 'judge-27',
                name: 'Judge 27',
                system_prompt: 'Judge 27 prompt',
                model: 'gateway/model-27',
                active: false,
                created_at: '2026-03-27T10:00:00.000Z',
                updated_at: '2026-03-27T11:00:00.000Z',
            }),
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

describe('getJudgePageQueryKey', () => {
    it('keeps the paged judges screen on its dedicated page-local cache root', () => {
        expect(getJudgePageQueryKey(2)).toEqual(['judges-page', 2]);
        expect(getJudgePageQueryKey(2)).not.toEqual(['judges']);
    });
});

describe('handleJudgeCreateSuccess', () => {
    it('closes the dialog and invalidates only the active paged query after a successful create', async () => {
        const closeDialogAction = mock(() => undefined);
        const invalidateQueries = mock(async () => undefined);

        await handleJudgeCreateSuccess({
            queryClient: { invalidateQueries },
            page: 2,
            closeDialogAction,
        });

        expect(closeDialogAction).toHaveBeenCalledTimes(1);
        expect(invalidateQueries).toHaveBeenCalledTimes(1);
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['judges-page', 2] });
        expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['judges'] });
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

describe('buildJudgeDialogTitle', () => {
    it('switches between create and same-page manage titles without routing to a detail page', () => {
        expect(buildJudgeDialogTitle(null)).toBe('New Judge');
        expect(buildJudgeDialogTitle({ name: 'Judge 27' })).toBe('Manage Judge 27');
    });
});

describe('buildJudgeSaveSuccessMessage', () => {
    it('describes whether the saved row remains active or became inactive', () => {
        expect(buildJudgeSaveSuccessMessage({ name: 'Judge 26', active: true })).toBe(
            'Saved Judge 26. This judge remains active.'
        );
        expect(buildJudgeSaveSuccessMessage({ name: 'Judge 27', active: false })).toBe(
            'Saved Judge 27. This judge is now inactive but still persisted for history.'
        );
    });
});

describe('requireManagedJudgeSelection', () => {
    it('rejects save attempts that lost the currently selected row state', () => {
        expect(() => requireManagedJudgeSelection(null)).toThrow(
            'Select a judge from the current page before saving changes.'
        );
        expect(requireManagedJudgeSelection(createJudge()).id).toBe('judge-26');
    });
});

describe('persistJudgeUpdate', () => {
    it('returns the saved judge record from the existing PATCH endpoint', async () => {
        const savedJudge = createJudge({ name: 'Judge 26 Updated', updated_at: '2026-03-26T12:00:00.000Z' });
        globalThis.fetch = mock(
            async () =>
                new Response(JSON.stringify(savedJudge), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
        ) as unknown as typeof fetch;

        await expect(
            persistJudgeUpdate(savedJudge.id, {
                name: savedJudge.name,
                system_prompt: savedJudge.system_prompt,
                model: savedJudge.model,
                active: savedJudge.active,
            })
        ).resolves.toEqual(savedJudge);
    });

    it('surfaces PATCH failures without claiming the row was updated', async () => {
        globalThis.fetch = mock(
            async () =>
                new Response(JSON.stringify({ error: 'Failed to save judge.', detail: 'database offline' }), {
                    status: 500,
                    headers: { 'content-type': 'application/json' },
                })
        ) as unknown as typeof fetch;

        await expect(
            persistJudgeUpdate('judge-26', {
                name: 'Judge 26',
                system_prompt: 'Judge 26 prompt',
                model: 'gateway/model-26',
                active: true,
            })
        ).rejects.toThrow('Failed to save judge. database offline');
    });

    it('treats invalid JSON from PATCH as a hard same-page save failure', async () => {
        globalThis.fetch = mock(
            async () =>
                new Response('not-json', {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
        ) as unknown as typeof fetch;

        await expect(
            persistJudgeUpdate('judge-26', {
                name: 'Judge 26',
                system_prompt: 'Judge 26 prompt',
                model: 'gateway/model-26',
                active: true,
            })
        ).rejects.toThrow('Failed to save judge. The server returned invalid JSON.');
    });
});

describe('judge query cache helpers', () => {
    it('updates the active paged row in place while preserving the current page metadata', () => {
        const current = createJudgePageResponse();
        const savedJudge = createJudge({
            id: 'judge-27',
            name: 'Judge 27 Updated',
            model: 'gateway/model-27b',
            active: true,
            updated_at: '2026-03-27T12:00:00.000Z',
        });

        expect(reconcileSavedJudgePage(current, savedJudge)).toEqual({
            ...current,
            judges: [current.judges[0], savedJudge],
        });
    });

    it('keeps the current paged payload untouched when the saved judge is not on that page', () => {
        const current = createJudgePageResponse();
        const savedJudge = createJudge({ id: 'judge-99', name: 'Judge 99' });

        expect(reconcileSavedJudgePage(current, savedJudge)).toBe(current);
    });

    it('upserts the legacy judges list so other reviewer surfaces stay eligible for refresh', () => {
        const existing = [createJudge(), createJudge({ id: 'judge-27', name: 'Judge 27' })];
        const updated = createJudge({ id: 'judge-27', name: 'Judge 27 Updated' });

        expect(upsertJudgeInList(existing, updated)).toEqual([existing[0], updated]);
        expect(upsertJudgeInList(undefined, updated)).toEqual([updated]);
    });

    it('reconciles page, detail, and legacy list caches from one shared helper', async () => {
        const savedJudge = createJudge({ id: 'judge-27', name: 'Judge 27 Updated', active: false });
        const setCalls: Array<[unknown, unknown]> = [];
        const invalidateCalls: unknown[] = [];

        await reconcileSavedJudgeCaches({
            queryClient: {
                getQueryState: (queryKey) => {
                    if (
                        JSON.stringify(queryKey) === JSON.stringify(getJudgeDetailQueryKey(savedJudge.id)) ||
                        JSON.stringify(queryKey) === JSON.stringify(getJudgesQueryKey())
                    ) {
                        return { dataUpdatedAt: 1 } as never;
                    }

                    return undefined;
                },
                invalidateQueries: async (filters) => {
                    invalidateCalls.push(filters);
                },
                setQueryData: (queryKey, updater) => {
                    setCalls.push([queryKey, updater]);
                    return undefined;
                },
            },
            page: 2,
            savedJudge,
        });

        expect(setCalls.map(([queryKey]) => queryKey)).toEqual([
            ['judges-page', 2],
            ['judge', 'judge-27'],
            ['judges'],
        ]);

        const pageUpdater = setCalls[0]?.[1] as (current: JudgePageResponse | undefined) => JudgePageResponse | undefined;
        const legacyUpdater = setCalls[2]?.[1] as (current: Judge[] | undefined) => Judge[];

        expect(pageUpdater(createJudgePageResponse())?.judges[1]).toEqual(savedJudge);
        expect(legacyUpdater([createJudge(), createJudge({ id: 'judge-27', name: 'Judge 27' })])[1]).toEqual(savedJudge);
        expect(invalidateCalls).toEqual([{ queryKey: ['judges'] }]);
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

    it('renders only the active page rows and opens same-space manage without a /judges/[id] link dependency', () => {
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
        expect(html).not.toContain('href="/judges/judge-26"');
        expect(html).toContain('aria-haspopup="dialog"');
        expect(html).toContain('Active');
        expect(html).toContain('Inactive');
        expect(html).toContain('href="/judges?page=1"');
        expect(html).toContain('aria-current="page"');
    });

    it('keeps save-success feedback visible in the same /judges?page=N context', () => {
        const html = renderToStaticMarkup(
            <JudgesPageContent
                isLoading={false}
                data={createJudgePageResponse()}
                statusMessage="Saved Judge 27. This judge is now inactive but still persisted for history."
            />
        );

        expect(html).toContain('Saved Judge 27. This judge is now inactive but still persisted for history.');
        expect(html).toContain('Judge 27');
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
