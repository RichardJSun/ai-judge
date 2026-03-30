export {
    buildJudgePageHref,
    getJudgePageQueryKey,
    handleJudgeCreateSuccess,
    JudgesPageContent,
    normalizeJudgePageSearchParam,
    parseJudgePageResponse,
    resolveJudgePageSyncHref,
} from './JudgesPageClient';
import JudgesPageClient, { type JudgeSearchParams } from './JudgesPageClient';

export default async function JudgesPage({ searchParams }: { searchParams: Promise<JudgeSearchParams> }) {
    const resolvedSearchParams = await searchParams;

    return <JudgesPageClient searchParams={resolvedSearchParams} />;
}
