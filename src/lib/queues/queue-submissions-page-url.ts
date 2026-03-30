export type QueueSubmissionsPageParamValue = string | string[] | undefined;
export type QueueSubmissionsPageSearchParams = Record<string, QueueSubmissionsPageParamValue>;

const QUEUE_SUBMISSIONS_PARAM_KEYS = ['page'] as const;
const QUEUE_SUBMISSIONS_PARAM_KEY_SET = new Set<string>(QUEUE_SUBMISSIONS_PARAM_KEYS);

export interface QueueSubmissionsPageUrlState {
    page: number;
}

function normalizeQueueSubmissionsPageParam(value: QueueSubmissionsPageParamValue) {
    const candidate = Array.isArray(value) ? value[0] : value;

    if (typeof candidate !== 'string') {
        return 1;
    }

    const trimmed = candidate.trim();

    if (!/^[1-9]\d*$/.test(trimmed)) {
        return 1;
    }

    const parsed = BigInt(trimmed);
    const maxSafePage = BigInt(Number.MAX_SAFE_INTEGER);

    if (parsed > maxSafePage) {
        return 1;
    }

    return Number(parsed);
}

function hasCanonicalSingleValue(value: QueueSubmissionsPageParamValue, expected: string) {
    return typeof value === 'string' && value === expected;
}

function hasOnlyWhitelistedQueueSubmissionsParams(searchParams: QueueSubmissionsPageSearchParams) {
    return Object.entries(searchParams).every(
        ([key, value]) => value == null || QUEUE_SUBMISSIONS_PARAM_KEY_SET.has(key)
    );
}

export function normalizeQueueSubmissionsPageSearchParams(
    searchParams: QueueSubmissionsPageSearchParams
): QueueSubmissionsPageUrlState {
    return {
        page: normalizeQueueSubmissionsPageParam(searchParams.page),
    };
}

export function buildQueueSubmissionsQueryString(state: QueueSubmissionsPageUrlState) {
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set('page', String(state.page));
    return nextSearchParams.toString();
}

export function buildQueueSubmissionsPageHref(pathname: string, state: QueueSubmissionsPageUrlState) {
    const query = buildQueueSubmissionsQueryString(state);
    return query ? `${pathname}?${query}` : pathname;
}

export function resolveQueueSubmissionsPageSyncHref(
    pathname: string,
    searchParams: QueueSubmissionsPageSearchParams,
    state: QueueSubmissionsPageUrlState
) {
    const pageIsCanonical = hasCanonicalSingleValue(searchParams.page, String(state.page));
    const onlyWhitelistedParams = hasOnlyWhitelistedQueueSubmissionsParams(searchParams);

    if (pageIsCanonical && onlyWhitelistedParams) {
        return null;
    }

    return buildQueueSubmissionsPageHref(pathname, state);
}

export function getQueueSubmissionsPath(queueId: string) {
    return `/queues/${queueId}`;
}

export function buildQueueSubmissionsHref(
    queueId: string,
    searchParams: QueueSubmissionsPageSearchParams
) {
    return buildQueueSubmissionsPageHref(
        getQueueSubmissionsPath(queueId),
        normalizeQueueSubmissionsPageSearchParams(searchParams)
    );
}
