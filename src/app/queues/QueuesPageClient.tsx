'use client';

import AssignmentIcon from '@mui/icons-material/Assignment';
import BarChartIcon from '@mui/icons-material/BarChart';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { z } from 'zod';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import ReviewerPagination from '@/components/pagination/ReviewerPagination';
import { EmptyStatePanel, MetricCard, PageHeader } from '@/components/ui/editorial';
import type { QueuePageResponse } from '@/types/api';

const SAFE_QUEUES_ERROR = 'Failed to load queues.';
const CREATED_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const QueuePageResponseSchema = z.object({
  queues: z.array(
    z.object({
      id: z.string().min(1),
      queue_id: z.string().min(1),
      created_at: z.string().min(1),
      submission_count: z.number().int().nonnegative(),
      question_count: z.number().int().nonnegative(),
      result_count: z.number().int().nonnegative(),
    })
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export type QueueSearchParams = Record<string, string | string[] | undefined>;

type QueuePageParam = string | string[] | undefined;

export interface QueuesPageContentProps {
  data?: QueuePageResponse;
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => unknown | Promise<unknown>;
  getPageHref?: (page: number) => string;
}

export function normalizeQueuePageSearchParam(value: QueuePageParam) {
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

export function parseQueuePageResponse(value: unknown, context = '/api/queues page response'): QueuePageResponse {
  const parsed = QueuePageResponseSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function formatQueueCreatedAt(createdAt: string) {
  const value = new Date(createdAt);
  return Number.isNaN(value.getTime()) ? createdAt : CREATED_DATE_FORMATTER.format(value);
}

export function buildQueuePageHref(pathname: string, searchParams: QueueSearchParams, page: number) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page' || value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const candidate of value) {
        nextSearchParams.append(key, candidate);
      }
      continue;
    }

    nextSearchParams.set(key, value);
  }

  nextSearchParams.set('page', String(page));

  const query = nextSearchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function resolveQueuePageSyncHref(pathname: string, searchParams: QueueSearchParams, page: number) {
  const currentPage = searchParams.page;
  const currentValue = Array.isArray(currentPage) ? currentPage[0] : currentPage;
  const isCanonical = typeof currentPage === 'string';

  if (isCanonical && currentValue === String(page)) {
    return null;
  }

  return buildQueuePageHref(pathname, searchParams, page);
}

async function fetchQueuesPage(page: number) {
  const response = await fetch(`/api/queues?page=${page}`);
  const body = await readResponseBody(response, SAFE_QUEUES_ERROR);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, SAFE_QUEUES_ERROR));
  }

  return parseQueuePageResponse(body, `/api/queues?page=${page} response`);
}

export function QueuesPageContent({
  data,
  isLoading,
  isError = false,
  error = null,
  onRetry = () => undefined,
  getPageHref = (page) => `/queues?page=${page}`,
}: QueuesPageContentProps) {
  const visibleStart = data && data.queues.length > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const visibleEnd = data && data.queues.length > 0 ? visibleStart + data.queues.length - 1 : 0;
  const pageSubmissionCount = data?.queues.reduce((sum, queue) => sum + queue.submission_count, 0) ?? 0;
  const pageResultCount = data?.queues.reduce((sum, queue) => sum + queue.result_count, 0) ?? 0;

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Review desk"
        title="Queues"
        description="Browse uploaded queue batches, inspect submission counts, and move quickly into assignment, evaluation, or results."
        actions={
          <Button component={Link} href="/upload" variant="contained">
            Upload
          </Button>
        }
      />

      {isLoading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void onRetry()}>
              Retry
            </Button>
          }
        >
          {error?.message ?? SAFE_QUEUES_ERROR}
        </Alert>
      ) : !data?.queues.length ? (
        <EmptyStatePanel
          title="No queues yet"
          description="No queues yet. Upload a submission file to get started."
          actions={
            <Button component={Link} href="/upload" variant="contained">
              Upload
            </Button>
          }
        />
      ) : (
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <MetricCard label="Visible page" value={data.page} hint={`${data.pageSize} rows per page`} />
            <MetricCard label="Visible queues" value={data.queues.length} hint={`Showing ${visibleStart}-${visibleEnd} of ${data.total}`} />
            <MetricCard label="Submissions on page" value={pageSubmissionCount} hint="Current page total" />
            <MetricCard label="Results on page" value={pageResultCount} hint="Historical result rows available" />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Showing {visibleStart}-{visibleEnd} of {data.total} queue{data.total === 1 ? '' : 's'}.
          </Typography>

          <ReviewerTableSurface>
            <Table sx={{ minWidth: 940 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 280 }}>Queue ID</TableCell>
                  <TableCell align="right" sx={{ minWidth: 110 }}>
                    Submissions
                  </TableCell>
                  <TableCell align="right" sx={{ minWidth: 110 }}>
                    Questions
                  </TableCell>
                  <TableCell sx={{ minWidth: 180, whiteSpace: 'nowrap' }}>Created</TableCell>
                  <TableCell align="right" sx={{ minWidth: 360, whiteSpace: 'nowrap' }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.queues.map((queue) => (
                  <TableRow key={queue.id} hover>
                    <TableCell>
                      <Typography fontFamily="monospace" fontSize={13} sx={{ whiteSpace: 'nowrap' }}>
                        {queue.queue_id}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Chip label={queue.submission_count} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Chip label={queue.question_count} size="small" />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatQueueCreatedAt(queue.created_at)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button component={Link} href={`/queues/${queue.id}`} size="small" startIcon={<VisibilityIcon />}>
                          View
                        </Button>
                        <Button component={Link} href={`/queues/${queue.id}/assign`} size="small" startIcon={<AssignmentIcon />}>
                          Assign
                        </Button>
                        <Button
                          component={Link}
                          href={`/queues/${queue.id}/run`}
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrowIcon />}
                        >
                          Run
                        </Button>
                        {queue.result_count > 0 ? (
                          <Button
                            component={Link}
                            href={`/queues/${queue.id}/results`}
                            size="small"
                            startIcon={<BarChartIcon />}
                          >
                            Results
                          </Button>
                        ) : (
                          <Tooltip title="No results yet">
                            <span>
                              <Button
                                size="small"
                                startIcon={<BarChartIcon />}
                                disabled
                                aria-label={`Results unavailable for ${queue.queue_id}`}
                              >
                                Results
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReviewerTableSurface>

          <ReviewerPagination page={data.page} pageSize={data.pageSize} total={data.total} getHref={getPageHref} />
        </Stack>
      )}
    </Stack>
  );
}

export default function QueuesPageClient({ searchParams }: { searchParams: QueueSearchParams }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedPage = normalizeQueuePageSearchParam(searchParams.page);

  const { data, isLoading, isError, error, refetch } = useQuery<QueuePageResponse, Error>({
    queryKey: ['queues', requestedPage],
    queryFn: () => fetchQueuesPage(requestedPage),
    retry: false,
  });

  useEffect(() => {
    if (!data || data.page === requestedPage) {
      return;
    }

    queryClient.setQueryData<QueuePageResponse>(['queues', data.page], data);
  }, [data, queryClient, requestedPage]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const syncHref = resolveQueuePageSyncHref(pathname, searchParams, data.page);
    if (syncHref) {
      router.replace(syncHref, { scroll: false });
    }
  }, [data, pathname, router, searchParams]);

  const getPageHref = useCallback(
    (page: number) => buildQueuePageHref(pathname, searchParams, page),
    [pathname, searchParams]
  );

  return (
    <QueuesPageContent
      data={data}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      getPageHref={getPageHref}
    />
  );
}

async function readResponseBody(response: Response, fallbackMessage: string) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${fallbackMessage} The server returned invalid JSON.`);
  }
}

function getApiErrorMessage(payload: unknown, fallbackMessage: string) {
  if (typeof payload === 'object' && payload !== null) {
    const candidate = payload as { error?: unknown; detail?: unknown };

    if (typeof candidate.error === 'string' && typeof candidate.detail === 'string') {
      return `${candidate.error} ${candidate.detail}`;
    }

    if (typeof candidate.error === 'string') {
      return candidate.error;
    }
  }

  return fallbackMessage;
}
