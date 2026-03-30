'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import ReviewerWayfinding, {
  createSubmissionDetailBreadcrumbs,
} from '@/components/navigation/ReviewerWayfinding';
import SubmissionDetailView from '@/components/submissions/SubmissionDetailView';
import {
  fetchJson,
  parseSubmissionDetailResponse,
} from '@/lib/submissions/fetch-json';
import { buildQueueResultsHref, type ResultsPageSearchParams } from '@/lib/results/results-page-url';
import type { SubmissionDetailResponse } from '@/types/api';

export function getSubmissionDetailQueryKey(queueId: string, submissionId: string) {
  return ['submission-detail', queueId, submissionId] as const;
}

export function fetchSubmissionDetail(queueId: string, submissionId: string) {
  return fetchJson(`/api/queues/${queueId}/submissions/${submissionId}`, {
    fallbackMessage: 'Failed to load submission detail.',
    parse: (value) =>
      parseSubmissionDetailResponse(
        value,
        `/api/queues/${queueId}/submissions/${submissionId} response`
      ),
  });
}

export type SubmissionDetailNavigationSource = 'queue' | 'results';
export type SubmissionDetailSearchParams = ResultsPageSearchParams & {
  source?: string | string[] | undefined;
};

export interface SubmissionDetailNavigationContext {
  source: SubmissionDetailNavigationSource;
  resultsHref: string | null;
}

export function parseSubmissionDetailNavigationSource(
  source: string | string[] | undefined
): SubmissionDetailNavigationSource {
  return source === 'results' ? 'results' : 'queue';
}

export function resolveSubmissionDetailNavigationContext(
  queueId: string,
  searchParams: SubmissionDetailSearchParams
): SubmissionDetailNavigationContext {
  const source = parseSubmissionDetailNavigationSource(searchParams.source);

  return {
    source,
    resultsHref: source === 'results' ? buildQueueResultsHref(queueId, searchParams) : null,
  };
}

export function getSubmissionDetailBackHref(
  queueId: string,
  source: SubmissionDetailNavigationSource,
  resultsHref?: string | null
) {
  return source === 'results' ? resultsHref ?? buildQueueResultsHref(queueId, {}) : `/queues/${queueId}`;
}

export function getSubmissionDetailBackLabel(source: SubmissionDetailNavigationSource) {
  return source === 'results' ? 'Back to results' : 'Back to queue';
}

export interface SubmissionDetailBackNavigationRouter {
  back: () => void;
  push: (href: string) => void;
}

export function handleSubmissionDetailBack({
  queueId,
  source,
  resultsHref,
  router,
  historyLength,
}: {
  queueId: string;
  source: SubmissionDetailNavigationSource;
  resultsHref?: string | null;
  router: SubmissionDetailBackNavigationRouter;
  historyLength: number;
}) {
  if (source === 'results' && historyLength > 1) {
    router.back();
    return;
  }

  router.push(getSubmissionDetailBackHref(queueId, source, resultsHref));
}

export interface SubmissionDetailPageContentProps {
  queueId: string;
  source: SubmissionDetailNavigationSource;
  resultsHref?: string | null;
  detail?: SubmissionDetailResponse;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void | Promise<unknown>;
  onBack: () => void;
}

export function SubmissionDetailPageContent({
  queueId,
  source,
  resultsHref,
  detail,
  isLoading,
  error,
  onRetry,
  onBack,
}: SubmissionDetailPageContentProps) {
  const backHref = getSubmissionDetailBackHref(queueId, source, resultsHref);

  return (
    <>
      <ReviewerWayfinding
        title="Submission detail"
        backLabel={getSubmissionDetailBackLabel(source)}
        backHref={backHref}
        onBack={onBack}
        breadcrumbs={createSubmissionDetailBreadcrumbs(queueId, source, 'Submission detail', resultsHref ?? undefined)}
      />

      {isLoading ? (
        <Box
          display="flex"
          justifyContent="center"
          mt={6}
          role="status"
          aria-live="polite"
          aria-label="Loading submission detail"
        >
          <CircularProgress aria-label="Loading submission detail" />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void onRetry()}>
              Retry
            </Button>
          }
        >
          {error.message}
        </Alert>
      ) : detail ? (
        <SubmissionDetailView detail={detail} />
      ) : (
        <Alert severity="error">Submission detail did not load.</Alert>
      )}
    </>
  );
}

export default function SubmissionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ queueId: string; submissionId: string }>;
  searchParams: Promise<SubmissionDetailSearchParams>;
}) {
  const { queueId, submissionId } = use(params);
  const resolvedSearchParams = use(searchParams);
  const navigationContext = resolveSubmissionDetailNavigationContext(queueId, resolvedSearchParams);
  const router = useRouter();
  const queryKey = getSubmissionDetailQueryKey(queueId, submissionId);

  const query = useQuery<SubmissionDetailResponse, Error>({
    queryKey,
    queryFn: () => fetchSubmissionDetail(queueId, submissionId),
    retry: false,
  });

  return (
    <SubmissionDetailPageContent
      queueId={queueId}
      source={navigationContext.source}
      resultsHref={navigationContext.resultsHref}
      detail={query.data}
      isLoading={query.isLoading && !query.data}
      error={query.error}
      onRetry={() => query.refetch()}
      onBack={() =>
        handleSubmissionDetailBack({
          queueId,
          source: navigationContext.source,
          resultsHref: navigationContext.resultsHref,
          router,
          historyLength: typeof window === 'undefined' ? 0 : window.history.length,
        })
      }
    />
  );
}
