export {
    buildQueueSubmissionsHref,
    buildQueueSubmissionsPageHref,
    buildQueueSubmissionsQueryString,
    getQueueSubmissionsPath,
    normalizeQueueSubmissionsPageSearchParams,
    resolveQueueSubmissionsPageSyncHref,
    type QueueSubmissionsPageSearchParams,
    type QueueSubmissionsPageUrlState,
} from '@/lib/queues/queue-submissions-page-url';
export type { QueueSubmissionsResponse } from '@/types/api';
export {
    createQueueSubmissionsPageCanonicalState,
    getQueueSubmissionsPageQueryKey,
    getQueueSubmissionsVisibleRangeText,
    QueuePageContent,
} from './QueuePageClient';
import QueuePageClient from './QueuePageClient';
import type { QueueSubmissionsPageSearchParams } from '@/lib/queues/queue-submissions-page-url';

export default async function QueuePage({
    params,
    searchParams,
}: {
    params: Promise<{ queueId: string }>;
    searchParams: Promise<QueueSubmissionsPageSearchParams>;
}) {
    const [{ queueId }, resolvedSearchParams] = await Promise.all([params, searchParams]);

    return <QueuePageClient queueId={queueId} searchParams={resolvedSearchParams} />;
}
