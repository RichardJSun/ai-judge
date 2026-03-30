import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_LIST_PAGE_SIZE,
  normalizeListPageRequest,
  resolveListPage,
} from './list-page';

describe('normalizeListPageRequest', () => {
  it('defaults to the first page and fixed page size when page is missing', () => {
    expect(normalizeListPageRequest(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: DEFAULT_LIST_PAGE_SIZE,
      from: 0,
      to: 24,
    });
  });

  it('normalizes malformed page params to page 1 before range math executes', () => {
    for (const rawPage of ['0', '-1', 'abc', '2.5', '', '999999999999999999999999']) {
      expect(normalizeListPageRequest(new URLSearchParams([['page', rawPage]]))).toEqual({
        page: 1,
        pageSize: DEFAULT_LIST_PAGE_SIZE,
        from: 0,
        to: 24,
      });
    }
  });

  it('computes the requested range for positive integer pages', () => {
    expect(normalizeListPageRequest(new URLSearchParams([['page', '3']]))).toEqual({
      page: 3,
      pageSize: DEFAULT_LIST_PAGE_SIZE,
      from: 50,
      to: 74,
    });
  });
});

describe('resolveListPage', () => {
  it('keeps in-range pages stable and reports total metadata', () => {
    expect(resolveListPage({ page: 2, pageSize: DEFAULT_LIST_PAGE_SIZE }, 60)).toEqual({
      page: 2,
      pageSize: DEFAULT_LIST_PAGE_SIZE,
      from: 25,
      to: 49,
      total: 60,
      totalPages: 3,
      wasClamped: false,
    });
  });

  it('clamps out-of-range pages to the last available page', () => {
    expect(resolveListPage({ page: 8, pageSize: DEFAULT_LIST_PAGE_SIZE }, 52)).toEqual({
      page: 3,
      pageSize: DEFAULT_LIST_PAGE_SIZE,
      from: 50,
      to: 74,
      total: 52,
      totalPages: 3,
      wasClamped: true,
    });
  });

  it('treats empty result sets as a single empty page', () => {
    expect(resolveListPage({ page: 4, pageSize: DEFAULT_LIST_PAGE_SIZE }, 0)).toEqual({
      page: 1,
      pageSize: DEFAULT_LIST_PAGE_SIZE,
      from: 0,
      to: 24,
      total: 0,
      totalPages: 1,
      wasClamped: true,
    });
  });

  it('rejects missing or malformed totals instead of inventing pagination metadata', () => {
    expect(() => resolveListPage({ page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE }, null)).toThrow(
      'Expected total to be a non-negative safe integer.'
    );
    expect(() => resolveListPage({ page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE }, -1)).toThrow(
      'Expected total to be a non-negative safe integer.'
    );
  });
});
