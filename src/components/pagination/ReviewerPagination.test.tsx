import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewerPagination, {
    REVIEWER_PAGINATION_LABEL,
    getReviewerPaginationItems,
    getReviewerTotalPages,
} from './ReviewerPagination';

describe('getReviewerTotalPages', () => {
    it('treats empty lists as a single normalized page and rejects malformed totals', () => {
        expect(getReviewerTotalPages(25, 0)).toBe(1);
        expect(getReviewerTotalPages(25, 26)).toBe(2);
        expect(() => getReviewerTotalPages(0, 1)).toThrow('Expected pageSize to be a positive safe integer.');
        expect(() => getReviewerTotalPages(25, -1)).toThrow('Expected total to be a non-negative safe integer.');
    });
});

describe('getReviewerPaginationItems', () => {
    it('condenses middle pages into a compact numbered sequence with ellipses', () => {
        expect(getReviewerPaginationItems(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
    });

    it('keeps near-edge pages compact without inserting unnecessary ellipses', () => {
        expect(getReviewerPaginationItems(2, 10)).toEqual([1, 2, 3, 'ellipsis', 10]);
        expect(getReviewerPaginationItems(9, 10)).toEqual([1, 'ellipsis', 8, 9, 10]);
    });
});

describe('ReviewerPagination', () => {
    it('renders nothing when the server metadata says only one page exists', () => {
        const html = renderToStaticMarkup(
            <ReviewerPagination page={1} pageSize={25} total={25} getHref={(page) => `/queues?page=${page}`} />
        );

        expect(html).toBe('');
    });

    it('renders numbered links with a compact current-page marker for multi-page lists', () => {
        const html = renderToStaticMarkup(
            <ReviewerPagination page={5} pageSize={25} total={250} getHref={(page) => `/queues?page=${page}`} />
        );

        expect(html).toContain(`aria-label="${REVIEWER_PAGINATION_LABEL}"`);
        expect(html).toContain('href="/queues?page=4"');
        expect(html).toContain('href="/queues?page=6"');
        expect(html).toContain('href="/queues?page=1"');
        expect(html).toContain('href="/queues?page=10"');
        expect(html).toContain('aria-current="page"');
        expect(html).toContain('>5<');
        expect(html).toContain('…');
    });

    it('keeps previous and next controls truthful at the edges', () => {
        const firstPageHtml = renderToStaticMarkup(
            <ReviewerPagination page={1} pageSize={25} total={60} getHref={(page) => `/queues?page=${page}`} />
        );
        const lastPageHtml = renderToStaticMarkup(
            <ReviewerPagination page={3} pageSize={25} total={60} getHref={(page) => `/queues?page=${page}`} />
        );

        expect(firstPageHtml).not.toContain('href="/queues?page=0"');
        expect(firstPageHtml).toContain('href="/queues?page=2"');
        expect(lastPageHtml).toContain('href="/queues?page=2"');
        expect(lastPageHtml).not.toContain('href="/queues?page=4"');
    });
});
