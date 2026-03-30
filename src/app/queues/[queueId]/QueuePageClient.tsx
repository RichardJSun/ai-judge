'use client';

import AssignmentIcon from '@mui/icons-material/Assignment';
import BarChartIcon from '@mui/icons-material/BarChart';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useCallback } from 'react';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import ReviewerPagination from '@/components/pagination/ReviewerPagination';
import {
    fetchQueueSubmissions,
} from '@/lib/submissions/fetch-json';
import {
    buildQueueSubmissionDetailHref,
    buildQueueSubmissionsPageHref,
    getQueueSubmissionsPath,
    normalizeQueueSubmissionsPageSearchParams,
    resolveQueueSubmissionsPageSyncHref,
    type QueueSubmissionsPageSearchParams,
    type QueueSubmissionsPageUrlState,
} from '@/lib/queues/queue-submissions-page-url';
import type { QueueSubmissionsResponse } from '@/types/api';

export interface QueuePageContentProps {
    queueId: string;
    data?: QueueSubmissionsResponse;
    isLoading: boolean;
    loadError: Error | null;
    page: number;
    onRetry: () => void | Promise<unknown>;
    getPageHref?: (page: number) => string;
    getSubmissionHref?: (submissionId: string) => string;
}

export function getQueueSubmissionsPageQueryKey(queueId: string, state: QueueSubmissionsPageUrlState) {
    return ['queue-submissions', queueId, state.page] as const;
}

export function createQueueSubmissionsPageCanonicalState(
    requestedState: QueueSubmissionsPageUrlState,
    results: Pick<QueueSubmissionsResponse, 'page'>
): QueueSubmissionsPageUrlState {
    if (requestedState.page === results.page) {
        return requestedState;
    }

    return { page: results.page };
}

export function getQueueSubmissionsVisibleRangeText(
    results: Pick<QueueSubmissionsResponse, 'page' | 'pageSize' | 'total' | 'submissions'>
) {
    const visibleCount = results.submissions.length;
    const visibleStart = visibleCount > 0 ? (results.page - 1) * results.pageSize + 1 : 0;
    const visibleEnd = visibleCount > 0 ? visibleStart + visibleCount - 1 : 0;

    return `Showing ${visibleStart}-${visibleEnd} of ${results.total} submission${results.total === 1 ? '' : 's'}.`;
}

export function QueuePageContent({
    queueId,
    data,
    isLoading,
    loadError,
    page,
    onRetry,
    getPageHref,
    getSubmissionHref,
}: QueuePageContentProps) {
    const resolvedPageHref =
        getPageHref ?? ((nextPage: number) => buildQueueSubmissionsPageHref(getQueueSubmissionsPath(queueId), { page: nextPage }));
    const resolvedSubmissionHref =
        getSubmissionHref ??
        ((submissionId: string) => buildQueueSubmissionDetailHref(queueId, submissionId, { page }));

    return (
        <>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3} gap={2} flexWrap="wrap">
                <Typography variant="h4" fontWeight={700}>
                    Submissions
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button component={Link} href={`/queues/${queueId}/assign`} startIcon={<AssignmentIcon />}>
                        Assign Judges
                    </Button>
                    <Button
                        component={Link}
                        href={`/queues/${queueId}/run`}
                        variant="contained"
                        startIcon={<PlayArrowIcon />}
                    >
                        Run Evaluations
                    </Button>
                    <Button component={Link} href={`/queues/${queueId}/results`} startIcon={<BarChartIcon />}>
                        Results
                    </Button>
                </Stack>
            </Stack>

            {isLoading ? (
                <Box display="flex" justifyContent="center" mt={6}>
                    <CircularProgress />
                </Box>
            ) : loadError ? (
                <Alert
                    severity="error"
                    action={
                        <Button color="inherit" size="small" onClick={() => void onRetry()}>
                            Retry
                        </Button>
                    }
                >
                    {loadError.message}
                </Alert>
            ) : !data?.submissions.length ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">No submissions in this queue.</Typography>
                </Paper>
            ) : (
                <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                        {getQueueSubmissionsVisibleRangeText(data)}
                    </Typography>

                    <ReviewerTableSurface>
                        <Table sx={{ minWidth: 760 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ minWidth: 260 }}>ID</TableCell>
                                    <TableCell sx={{ minWidth: 220 }}>Task ID</TableCell>
                                    <TableCell sx={{ minWidth: 220, whiteSpace: 'nowrap' }}>Submitted</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {data.submissions.map((submission) => (
                                    <TableRow key={submission.id} hover>
                                        <TableCell>
                                            <Link
                                                href={resolvedSubmissionHref(submission.id)}
                                                prefetch={false}
                                                aria-label={`Open submission ${submission.external_id}`}
                                                style={{ color: 'inherit', display: 'inline-block', textDecoration: 'none' }}
                                            >
                                                <Typography
                                                    fontFamily="monospace"
                                                    fontSize={13}
                                                    sx={{ textDecoration: 'underline', textDecorationColor: 'divider', whiteSpace: 'nowrap' }}
                                                >
                                                    {submission.external_id}
                                                </Typography>
                                            </Link>
                                        </TableCell>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{submission.labeling_task_id ?? '—'}</TableCell>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                            {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ReviewerTableSurface>

                    <Box>
                        <ReviewerPagination
                            page={page}
                            pageSize={data.pageSize}
                            total={data.total}
                            getHref={resolvedPageHref}
                        />
                    </Box>
                </Stack>
            )}
        </>
    );
}

export default function QueuePageClient({
    queueId,
    searchParams,
}: {
    queueId: string;
    searchParams: QueueSubmissionsPageSearchParams;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    const requestedState = useMemo(
        () => normalizeQueueSubmissionsPageSearchParams(searchParams),
        [searchParams]
    );

    const { data, isLoading, error, refetch } = useQuery<QueueSubmissionsResponse, Error>({
        queryKey: getQueueSubmissionsPageQueryKey(queueId, requestedState),
        queryFn: () => fetchQueueSubmissions(queueId, requestedState.page),
        retry: false,
    });

    const canonicalState = useMemo(
        () => (data ? createQueueSubmissionsPageCanonicalState(requestedState, data) : requestedState),
        [data, requestedState]
    );

    useEffect(() => {
        if (!data || requestedState.page === canonicalState.page) {
            return;
        }

        queryClient.setQueryData<QueueSubmissionsResponse>(
            getQueueSubmissionsPageQueryKey(queueId, canonicalState),
            data
        );
    }, [canonicalState, data, queryClient, queueId, requestedState.page]);

    useEffect(() => {
        if (!data) {
            return;
        }

        const syncHref = resolveQueueSubmissionsPageSyncHref(pathname, searchParams, canonicalState);
        if (syncHref) {
            router.replace(syncHref, { scroll: false });
        }
    }, [canonicalState, data, pathname, router, searchParams]);

    const getPageHref = useCallback(
        (nextPage: number) => buildQueueSubmissionsPageHref(pathname, { ...canonicalState, page: nextPage }),
        [canonicalState, pathname]
    );

    const getSubmissionHref = useCallback(
        (submissionId: string) => buildQueueSubmissionDetailHref(queueId, submissionId, canonicalState),
        [canonicalState, queueId]
    );

    return (
        <QueuePageContent
            queueId={queueId}
            data={data}
            isLoading={isLoading && !data}
            loadError={error}
            page={canonicalState.page}
            onRetry={() => refetch()}
            getPageHref={getPageHref}
            getSubmissionHref={getSubmissionHref}
        />
    );
}
