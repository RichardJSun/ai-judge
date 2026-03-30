export const DEFAULT_LIST_PAGE_SIZE = 25;

export interface RequestedListPage {
    page: number;
    pageSize: number;
    from: number;
    to: number;
}

export interface ResolvedListPage extends RequestedListPage {
    total: number;
    totalPages: number;
    wasClamped: boolean;
}

export function normalizeListPageRequest(
    searchParams: URLSearchParams,
    options: { pageSize?: number } = {}
): RequestedListPage {
    const pageSize = normalizePageSize(options.pageSize ?? DEFAULT_LIST_PAGE_SIZE, 'pageSize');
    const page = normalizePageParam(searchParams.get('page'), pageSize);

    return buildRequestedListPage(page, pageSize);
}

export function resolveListPage(
    request: Pick<RequestedListPage, 'page' | 'pageSize'>,
    total: unknown
): ResolvedListPage {
    const pageSize = normalizePageSize(request.pageSize, 'pageSize');
    const requestedPage = normalizeResolvedPage(request.page, pageSize);
    const normalizedTotal = normalizeTotal(total);
    const totalPages = normalizedTotal === 0 ? 1 : Math.ceil(normalizedTotal / pageSize);
    const page = Math.min(requestedPage, totalPages);
    const resolvedPage = buildRequestedListPage(page, pageSize);

    return {
        ...resolvedPage,
        total: normalizedTotal,
        totalPages,
        wasClamped: page !== requestedPage,
    };
}

function buildRequestedListPage(page: number, pageSize: number): RequestedListPage {
    const from = (page - 1) * pageSize;

    return {
        page,
        pageSize,
        from,
        to: from + pageSize - 1,
    };
}

function normalizePageParam(value: string | null, pageSize: number): number {
    if (value == null) {
        return 1;
    }

    const trimmed = value.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) {
        return 1;
    }

    const parsed = BigInt(trimmed);
    const maxSafePage = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / pageSize));

    if (parsed > maxSafePage) {
        return 1;
    }

    return Number(parsed);
}

function normalizeResolvedPage(value: unknown, pageSize: number): number {
    const maxSafePage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize);

    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maxSafePage) {
        return value;
    }

    throw new Error('Expected page to be a safe positive integer.');
}

function normalizePageSize(value: unknown, label: string): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }

    throw new Error(`Expected ${label} to be a positive safe integer.`);
}

function normalizeTotal(value: unknown): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return value;
    }

    throw new Error('Expected total to be a non-negative safe integer.');
}
