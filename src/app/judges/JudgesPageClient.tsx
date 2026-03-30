'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import JudgeForm from '@/components/judges/JudgeForm';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import ReviewerPagination from '@/components/pagination/ReviewerPagination';
import { JudgeRecordSchema, parseJudgeRecord } from '@/lib/judges/judge-lifecycle';
import type { JudgePageResponse } from '@/types/api';

const SAFE_JUDGES_ERROR = 'Failed to load judges.';

const JudgePageResponseSchema = z.object({
    judges: z.array(JudgeRecordSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
});

export type JudgeSearchParams = Record<string, string | string[] | undefined>;

type JudgePageParam = string | string[] | undefined;

export interface JudgesPageContentProps {
    data?: JudgePageResponse;
    isLoading: boolean;
    isError?: boolean;
    error?: Error | null;
    onRetry?: () => unknown | Promise<unknown>;
    onOpenCreate?: () => void;
    getPageHref?: (page: number) => string;
}

export function normalizeJudgePageSearchParam(value: JudgePageParam) {
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

export function parseJudgePageResponse(value: unknown, context = '/api/judges page response'): JudgePageResponse {
    const parsed = JudgePageResponseSchema.safeParse(value);

    if (!parsed.success) {
        throw new Error(`Malformed ${context}: ${parsed.error.message}`);
    }

    return parsed.data;
}

export function buildJudgePageHref(pathname: string, searchParams: JudgeSearchParams, page: number) {
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

export function resolveJudgePageSyncHref(pathname: string, searchParams: JudgeSearchParams, page: number) {
    const currentPage = searchParams.page;
    const currentValue = Array.isArray(currentPage) ? currentPage[0] : currentPage;
    const isCanonical = typeof currentPage === 'string';

    if (isCanonical && currentValue === String(page)) {
        return null;
    }

    return buildJudgePageHref(pathname, searchParams, page);
}

async function fetchJudgesPage(page: number) {
    const response = await fetch(`/api/judges?page=${page}`);
    const body = await readResponseBody(response, SAFE_JUDGES_ERROR);

    if (!response.ok) {
        throw new Error(getApiErrorMessage(body, SAFE_JUDGES_ERROR));
    }

    return parseJudgePageResponse(body, `/api/judges?page=${page} response`);
}

async function createJudge(payload: {
    name: string;
    system_prompt: string;
    model: string;
    active: boolean;
}) {
    const response = await fetch('/api/judges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await readResponseBody(response, 'Failed to create judge.');

    if (!response.ok) {
        throw new Error(getApiErrorMessage(body, 'Failed to create judge.'));
    }

    return parseJudgeRecord(body, 'POST /api/judges response');
}

export function JudgesPageContent({
    data,
    isLoading,
    isError = false,
    error = null,
    onRetry = () => undefined,
    onOpenCreate = () => undefined,
    getPageHref = (page) => `/judges?page=${page}`,
}: JudgesPageContentProps) {
    const visibleStart = data && data.judges.length > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
    const visibleEnd = data && data.judges.length > 0 ? visibleStart + data.judges.length - 1 : 0;

    return (
        <Stack spacing={3}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
                <Box>
                    <Typography variant="h4" fontWeight={700}>
                        Judges
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                        Manage persisted judge configurations. Inactive judges stay in history and can be reactivated later.
                    </Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={onOpenCreate}>
                    New Judge
                </Button>
            </Stack>

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
                    {error?.message ?? SAFE_JUDGES_ERROR}
                </Alert>
            ) : !data?.judges.length ? (
                <ReviewerTableSurface>
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="text.secondary">No judges yet. Create one to start evaluating submissions.</Typography>
                        <Button variant="contained" startIcon={<AddIcon />} sx={{ mt: 2 }} onClick={onOpenCreate}>
                            New Judge
                        </Button>
                    </Box>
                </ReviewerTableSurface>
            ) : (
                <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                        Showing {visibleStart}-{visibleEnd} of {data.total} judge{data.total === 1 ? '' : 's'}.
                    </Typography>

                    <ReviewerTableSurface>
                        <Table sx={{ minWidth: 940 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Model</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Updated</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {data.judges.map((judge) => (
                                    <TableRow key={judge.id} hover sx={{ opacity: judge.active ? 1 : 0.72 }}>
                                        <TableCell>
                                            <Typography fontWeight={500}>{judge.name}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography fontFamily="monospace" fontSize={13}>
                                                {judge.model}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Stack spacing={0.5}>
                                                <Chip
                                                    label={judge.active ? 'Active' : 'Inactive'}
                                                    color={judge.active ? 'success' : 'default'}
                                                    size="small"
                                                    sx={{ width: 'fit-content' }}
                                                />
                                                <Typography variant="body2" color="text.secondary">
                                                    {judge.active
                                                        ? 'Eligible for assignments and runs.'
                                                        : 'Retained for history. Reactivate to use again.'}
                                                </Typography>
                                            </Stack>
                                        </TableCell>
                                        <TableCell>{new Date(judge.updated_at).toLocaleString()}</TableCell>
                                        <TableCell align="right">
                                            <Button component={Link} href={`/judges/${judge.id}`} size="small" startIcon={<EditIcon />}>
                                                Manage
                                            </Button>
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

export default function JudgesPageClient({ searchParams }: { searchParams: JudgeSearchParams }) {
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const requestedPage = normalizeJudgePageSearchParam(searchParams.page);

    const { data, isLoading, isError, error, refetch } = useQuery<JudgePageResponse, Error>({
        queryKey: ['judges-page', requestedPage],
        queryFn: () => fetchJudgesPage(requestedPage),
        retry: false,
    });

    useEffect(() => {
        if (!data || data.page === requestedPage) {
            return;
        }

        queryClient.setQueryData<JudgePageResponse>(['judges-page', data.page], data);
    }, [data, queryClient, requestedPage]);

    useEffect(() => {
        if (!data) {
            return;
        }

        const syncHref = resolveJudgePageSyncHref(pathname, searchParams, data.page);
        if (syncHref) {
            router.replace(syncHref, { scroll: false });
        }
    }, [data, pathname, router, searchParams]);

    const getActivePage = data?.page ?? requestedPage;

    const createMutation = useMutation({
        mutationFn: createJudge,
        onSuccess: async () => {
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['judges-page', getActivePage] });
        },
    });

    const handleOpenCreate = useCallback(() => setOpen(true), []);
    const handleCloseCreate = useCallback(() => {
        if (createMutation.isPending) {
            return;
        }

        setOpen(false);
    }, [createMutation.isPending]);

    const getPageHref = useCallback(
        (page: number) => buildJudgePageHref(pathname, searchParams, page),
        [pathname, searchParams]
    );

    return (
        <>
            <JudgesPageContent
                data={data}
                isLoading={isLoading}
                isError={isError}
                error={error}
                onRetry={refetch}
                onOpenCreate={handleOpenCreate}
                getPageHref={getPageHref}
            />

            <Dialog open={open} onClose={handleCloseCreate} maxWidth="sm" fullWidth>
                <DialogTitle>New Judge</DialogTitle>
                <DialogContent>
                    <Box pt={1}>
                        <JudgeForm
                            onSave={async (formData) => {
                                await createMutation.mutateAsync(formData);
                            }}
                            onCancel={handleCloseCreate}
                        />
                    </Box>
                </DialogContent>
            </Dialog>
        </>
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
