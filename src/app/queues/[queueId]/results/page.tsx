export {
  buildQueueResultsHref,
  buildResultsPageHref,
  buildResultsQueryString,
  getQueueResultsPath,
  normalizeResultsPageSearchParams,
  resolveResultsPageSyncHref,
  type ResultsPageSearchParams,
  type ResultsPageUrlState,
} from '@/lib/results/results-page-url';
export {
  areResultsPageStatesEqual,
  createResultsPageCanonicalState,
  getResultsPageQueryKey,
  ResultsPageContent,
} from './ResultsPageClient';
import ResultsPageClient from './ResultsPageClient';
import type { ResultsPageSearchParams } from '@/lib/results/results-page-url';

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ queueId: string }>;
  searchParams: Promise<ResultsPageSearchParams>;
}) {
  const [{ queueId }, resolvedSearchParams] = await Promise.all([params, searchParams]);

  return <ResultsPageClient queueId={queueId} searchParams={resolvedSearchParams} />;
}
