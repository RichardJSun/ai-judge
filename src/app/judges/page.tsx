export {
    buildJudgeDialogTitle,
    buildJudgePageHref,
    buildJudgeSaveSuccessMessage,
    handleJudgeCreateSuccess,
    JudgesPageContent,
    normalizeJudgePageSearchParam,
    parseJudgePageResponse,
    persistJudgeUpdate,
    requireManagedJudgeSelection,
    resolveJudgePageSyncHref,
} from './JudgesPageClient';
export { getJudgePageQueryKey } from '@/lib/judges/judge-query-cache';
import JudgesPageClient, { type JudgeSearchParams } from './JudgesPageClient';

export default async function JudgesPage({ searchParams }: { searchParams: Promise<JudgeSearchParams> }) {
    const resolvedSearchParams = await searchParams;

    return <JudgesPageClient searchParams={resolvedSearchParams} />;
}
