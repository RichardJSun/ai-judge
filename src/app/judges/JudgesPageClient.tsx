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
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import JudgeForm from '@/components/judges/JudgeForm';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import ReviewerPagination from '@/components/pagination/ReviewerPagination';
import { parseJudgeRecord, JudgeRecordSchema } from '@/lib/judges/judge-lifecycle';
import { getJudgePageQueryKey, reconcileSavedJudgeCaches } from '@/lib/judges/judge-query-cache';
import type { JudgePageResponse } from '@/types/api';
import type { Judge } from '@/types/db';

const SAFE_JUDGES_ERROR = 'Failed to load judges.';
const MISSING_MANAGED_JUDGE_ERROR = 'Select a judge from the current page before saving changes.';
const JUDGE_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
});

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
    onManageJudge?: (judge: Judge) => void;
    getPageHref?: (page: number) => string;
    statusMessage?: string | null;
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

export function buildJudgeDialogTitle(selectedJudge: Pick<Judge, 'name'> | null) {
    return selectedJudge ? `Manage ${selectedJudge.name}` : 'New Judge';
}

export function buildJudgeSaveSuccessMessage(savedJudge: Pick<Judge, 'name' | 'active'>) {
    return savedJudge.active
        ? `Saved ${savedJudge.name}. This judge remains active.`
        : `Saved ${savedJudge.name}. This judge is now inactive but still persisted for history.`;
}

export function formatJudgeUpdatedAt(updatedAt: string) {
    const value = new Date(updatedAt);
    return Number.isNaN(value.getTime()) ? updatedAt : JUDGE_UPDATED_AT_FORMATTER.format(value);
}

export function requireManagedJudgeSelection(selectedJudge: Judge | null) {
    if (!selectedJudge) {
        throw new Error(MISSING_MANAGED_JUDGE_ERROR);
    }

    return selectedJudge;
}

export async function handleJudgeCreateSuccess({
    queryClient,
    page,
    closeDialogAction,
}: {
    queryClient: Pick<QueryClient, 'invalidateQueries'>;
    page: number;
    closeDialogAction: () => void;
}) {
    closeDialogAction();
    await queryClient.invalidateQueries({ queryKey: getJudgePageQueryKey(page) });
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

export async function persistJudgeUpdate(
    judgeId: string,
    payload: { name?: string; system_prompt?: string; model?: string; active?: boolean }
) {
    const response = await fetch(`/api/judges/${judgeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await readResponseBody(response, 'Failed to save judge.');

    if (!response.ok) {
        throw new Error(getApiErrorMessage(body, 'Failed to save judge.'));
    }

    return parseJudgeRecord(body, `PATCH /api/judges/${judgeId} response`);
}

export function JudgesPageContent({
    data,
    isLoading,
    isError = false,
    error = null,
    onRetry = () => undefined,
    onOpenCreate = () => undefined,
    onManageJudge = () => undefined,
    getPageHref = (page) => `/judges?page=${page}`,
    statusMessage = null,
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

            {statusMessage ? <Alert severity="success">{statusMessage}</Alert> : null}

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
                                        <TableCell>{formatJudgeUpdatedAt(judge.updated_at)}</TableCell>
                                        <TableCell align="right">
                                            <Button
                                                type="button"
                                                size="small"
                                                startIcon={<EditIcon />}
                                                onClick={() => onManageJudge(judge)}
                                                aria-haspopup="dialog"
                                            >
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
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedJudge, setSelectedJudge] = useState<Judge | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const requestedPage = normalizeJudgePageSearchParam(searchParams.page);

    const { data, isLoading, isError, error, refetch } = useQuery<JudgePageResponse, Error>({
        queryKey: getJudgePageQueryKey(requestedPage),
        queryFn: () => fetchJudgesPage(requestedPage),
        retry: false,
    });

    useEffect(() => {
        if (!data || data.page === requestedPage) {
            return;
        }

        queryClient.setQueryData<JudgePageResponse>(getJudgePageQueryKey(data.page), data);
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
        onMutate: () => {
            setStatusMessage(null);
        },
        onSuccess: async () => {
            await handleJudgeCreateSuccess({
                queryClient,
                page: getActivePage,
                closeDialogAction: () => {
                    setDialogOpen(false);
                    setSelectedJudge(null);
                },
            });
            setStatusMessage('Created a new judge and refreshed this page of results.');
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (formData: { name: string; system_prompt: string; model: string; active: boolean }) => {
            const managedJudge = requireManagedJudgeSelection(selectedJudge);
            return await persistJudgeUpdate(managedJudge.id, formData);
        },
        onMutate: () => {
            setStatusMessage(null);
        },
        onSuccess: async (savedJudge) => {
            await reconcileSavedJudgeCaches({
                queryClient,
                page: getActivePage,
                savedJudge,
            });
            setDialogOpen(false);
            setSelectedJudge(null);
            setStatusMessage(buildJudgeSaveSuccessMessage(savedJudge));
        },
    });

    const handleOpenCreate = useCallback(() => {
        setSelectedJudge(null);
        setDialogOpen(true);
    }, []);

    const handleOpenManage = useCallback((judge: Judge) => {
        setSelectedJudge(judge);
        setDialogOpen(true);
    }, []);

    const handleCloseDialog = useCallback(() => {
        if (createMutation.isPending || updateMutation.isPending) {
            return;
        }

        setDialogOpen(false);
        setSelectedJudge(null);
    }, [createMutation.isPending, updateMutation.isPending]);

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
                onManageJudge={handleOpenManage}
                getPageHref={getPageHref}
                statusMessage={statusMessage}
            />

            <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle>{buildJudgeDialogTitle(selectedJudge)}</DialogTitle>
                <DialogContent>
                    <Box pt={1}>
                        <JudgeForm
                            initial={selectedJudge ?? undefined}
                            onSave={async (formData) => {
                                if (selectedJudge) {
                                    await updateMutation.mutateAsync(formData);
                                    return;
                                }

                                await createMutation.mutateAsync(formData);
                            }}
                            onCancel={handleCloseDialog}
                            submitLabel={selectedJudge ? 'Save Changes' : undefined}
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
