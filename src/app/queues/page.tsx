export {
    buildQueuePageHref,
    normalizeQueuePageSearchParam,
    parseQueuePageResponse,
    QueuesPageContent,
    resolveQueuePageSyncHref,
} from './QueuesPageClient';
import QueuesPageClient, { type QueueSearchParams } from './QueuesPageClient';

export default async function QueuesPage({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
    const resolvedSearchParams = await searchParams;

    return <QueuesPageClient searchParams={resolvedSearchParams} />;
}
