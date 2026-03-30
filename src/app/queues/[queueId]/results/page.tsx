export {
  areResultsPageStatesEqual,
  buildResultsPageHref,
  buildResultsQueryString,
  createResultsPageCanonicalState,
  getResultsPageQueryKey,
  normalizeResultsPageSearchParams,
  resolveResultsPageSyncHref,
  ResultsPageContent,
} from './ResultsPageClient';
import ResultsPageClient, { type ResultsPageSearchParams } from './ResultsPageClient';

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
