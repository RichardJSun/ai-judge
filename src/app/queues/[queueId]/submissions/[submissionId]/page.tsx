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

export function parseSubmissionDetailNavigationSource(
  source: string | string[] | undefined
): SubmissionDetailNavigationSource {
  return source === 'results' ? 'results' : 'queue';
}

export function getSubmissionDetailBackHref(
  queueId: string,
  source: SubmissionDetailNavigationSource
) {
  return source === 'results' ? `/queues/${queueId}/results` : `/queues/${queueId}`;
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
  router,
  historyLength,
}: {
  queueId: string;
  source: SubmissionDetailNavigationSource;
  router: SubmissionDetailBackNavigationRouter;
  historyLength: number;
}) {
  if (source === 'results' && historyLength > 1) {
    router.back();
    return;
  }

  router.push(getSubmissionDetailBackHref(queueId, source));
}

export interface SubmissionDetailPageContentProps {
  queueId: string;
  source: SubmissionDetailNavigationSource;
  detail?: SubmissionDetailResponse;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void | Promise<unknown>;
  onBack: () => void;
}

export function SubmissionDetailPageContent({
  queueId,
  source,
  detail,
  isLoading,
  error,
  onRetry,
  onBack,
}: SubmissionDetailPageContentProps) {
  return (
    <>
      <ReviewerWayfinding
        title="Submission detail"
        backLabel={getSubmissionDetailBackLabel(source)}
        onBack={onBack}
        breadcrumbs={createSubmissionDetailBreadcrumbs(queueId, source)}
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
  searchParams: Promise<{ source?: string | string[] | undefined }>;
}) {
  const { queueId, submissionId } = use(params);
  const { source } = use(searchParams);
  const navigationSource = parseSubmissionDetailNavigationSource(source);
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
      source={navigationSource}
      detail={query.data}
      isLoading={query.isLoading && !query.data}
      error={query.error}
      onRetry={() => query.refetch()}
      onBack={() =>
        handleSubmissionDetailBack({
          queueId,
          source: navigationSource,
          router,
          historyLength: typeof window === 'undefined' ? 0 : window.history.length,
        })
      }
    />
  );
}
