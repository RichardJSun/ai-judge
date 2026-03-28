'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import JudgeForm from '@/components/judges/JudgeForm';
import { parseJudgeRecord } from '@/lib/judges/judge-lifecycle';
import type { Judge } from '@/types/db';

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    const candidate = payload as { error?: unknown; detail?: unknown };
    if (typeof candidate.error === 'string' && typeof candidate.detail === 'string') {
      return `${candidate.error} ${candidate.detail}`;
    }
    if (typeof candidate.error === 'string') {
      return candidate.error;
    }
  }

  return fallback;
}

async function readResponseBody(response: Response, fallback: string) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${fallback} The server returned invalid JSON.`);
  }
}

function upsertJudgeInList(current: Judge[] | undefined, nextJudge: Judge) {
  if (!current?.length) {
    return [nextJudge];
  }

  let found = false;
  const updated = current.map((judge) => {
    if (judge.id !== nextJudge.id) {
      return judge;
    }

    found = true;
    return nextJudge;
  });

  return found ? updated : [nextJudge, ...updated];
}

async function fetchJudge(judgeId: string) {
  const response = await fetch(`/api/judges/${judgeId}`);
  const body = await readResponseBody(response, 'Failed to load judge.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, response.status === 404 ? 'Judge not found.' : 'Failed to load judge.'));
  }

  return parseJudgeRecord(body, `/api/judges/${judgeId} response`);
}

async function persistJudgeUpdate(
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

export default function EditJudgePage({ params }: { params: Promise<{ judgeId: string }> }) {
  const { judgeId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const { data: judge, isLoading, isError, error, refetch } = useQuery<Judge, Error>({
    queryKey: ['judge', judgeId],
    queryFn: () => fetchJudge(judgeId),
  });

  const saveJudgeMutation = useMutation({
    mutationFn: (body: { name: string; system_prompt: string; model: string; active: boolean }) =>
      persistJudgeUpdate(judgeId, body),
    onMutate: () => {
      setStatusMessage(null);
    },
    onSuccess: (savedJudge) => {
      qc.setQueryData(['judge', judgeId], savedJudge);
      qc.setQueryData<Judge[]>(['judges'], (current) => upsertJudgeInList(current, savedJudge));
      setStatusMessage(
        savedJudge.active
          ? 'Saved judge changes. This judge remains active.'
          : 'Saved judge changes. This judge is now inactive but still persisted for history.'
      );
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: (active: boolean) => persistJudgeUpdate(judgeId, { active }),
    onMutate: () => {
      setStatusMessage(null);
    },
    onSuccess: (savedJudge) => {
      qc.setQueryData(['judge', judgeId], savedJudge);
      qc.setQueryData<Judge[]>(['judges'], (current) => upsertJudgeInList(current, savedJudge));
      setStatusMessage(
        savedJudge.active
          ? 'Judge reactivated. The same persisted judge row is active again.'
          : 'Judge deactivated. The row stays visible for history and can be reactivated later.'
      );
    },
  });

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/judges')} sx={{ width: 'fit-content' }}>
          Judges
        </Button>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {error.message}
        </Alert>
      </Stack>
    );
  }

  if (!judge) {
    return <Alert severity="error">Judge not found.</Alert>;
  }

  const lifecycleBusy = lifecycleMutation.isPending || saveJudgeMutation.isPending;

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/judges')}>
            Judges
          </Button>
          <Typography variant="h5" fontWeight={700}>
            {judge.name}
          </Typography>
          <Chip
            label={judge.active ? 'Active' : 'Inactive'}
            color={judge.active ? 'success' : 'default'}
            size="small"
          />
        </Stack>
        <Button
          color={judge.active ? 'warning' : 'success'}
          variant="outlined"
          startIcon={judge.active ? <PauseCircleOutlineIcon /> : <PlayCircleOutlineIcon />}
          onClick={() => lifecycleMutation.mutate(!judge.active)}
          disabled={lifecycleBusy}
        >
          {judge.active ? 'Deactivate' : 'Reactivate'}
        </Button>
      </Stack>

      <Alert severity={judge.active ? 'info' : 'warning'}>
        {judge.active
          ? 'Active judges can be assigned and used in runs. Deactivate instead of deleting when you want to preserve history.'
          : 'This judge is inactive. It remains persisted for history and can be reactivated without losing identity.'}
      </Alert>

      {statusMessage ? <Alert severity="success">{statusMessage}</Alert> : null}
      {lifecycleMutation.isError ? <Alert severity="error">{lifecycleMutation.error.message}</Alert> : null}

      <Paper sx={{ p: 3, maxWidth: 720 }}>
        <JudgeForm
          initial={judge}
          onSave={async (data) => {
            await saveJudgeMutation.mutateAsync(data);
          }}
          onCancel={() => router.push('/judges')}
          submitLabel="Save Changes"
        />
      </Paper>
    </Stack>
  );
}
