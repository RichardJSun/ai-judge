'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, type ReactNode, useState } from 'react';
import { buildJudgeSaveSuccessMessage, persistJudgeUpdate } from '../JudgesPageClient';
import JudgeForm from '@/components/judges/JudgeForm';
import { PageHeader, SectionSurface, StatusBadge } from '@/components/ui/editorial';
import { parseJudgeRecord } from '@/lib/judges/judge-lifecycle';
import { reconcileSavedJudgeCaches } from '@/lib/judges/judge-query-cache';
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

export async function fetchJudge(judgeId: string) {
  const response = await fetch(`/api/judges/${judgeId}`);
  const body = await readResponseBody(response, 'Failed to load judge.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, response.status === 404 ? 'Judge not found.' : 'Failed to load judge.'));
  }

  return parseJudgeRecord(body, `/api/judges/${judgeId} response`);
}

type JudgeFormData = {
  name: string;
  system_prompt: string;
  model: string;
  active: boolean;
};

export interface EditJudgePageContentProps {
  judge?: Judge | null;
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => unknown | Promise<unknown>;
  onBack?: () => void;
  onSave?: (data: JudgeFormData) => Promise<void>;
  saveError?: Error | null;
  statusMessage?: ReactNode;
}

export function EditJudgePageContent({
  judge,
  isLoading,
  isError = false,
  error = null,
  onRetry = () => undefined,
  onBack = () => undefined,
  onSave = async () => undefined,
  saveError = null,
  statusMessage = null,
}: EditJudgePageContentProps) {
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
        <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ width: 'fit-content' }}>
          Judges
        </Button>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void onRetry()}>
              Retry
            </Button>
          }
        >
          {error?.message ?? 'Failed to load judge.'}
        </Alert>
      </Stack>
    );
  }

  if (!judge) {
    return <Alert severity="error">Judge not found.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Judge detail"
        title={judge.name}
        description="Adjust the judge prompt, model, and activation state without changing its identity."
        actions={
          <>
            <StatusBadge label={judge.active ? 'Active' : 'Inactive'} tone={judge.active ? 'success' : 'neutral'} />
            <Button startIcon={<ArrowBackIcon />} onClick={onBack} variant="outlined">
              Judges
            </Button>
          </>
        }
      />

      <Alert severity={judge.active ? 'info' : 'warning'}>
        {judge.active
          ? 'Active judges can be assigned and used in runs. Save the form to change this judge\'s active state.'
          : 'This judge is inactive. It remains persisted for history and can be reactivated from the form without losing identity.'}
      </Alert>

      {statusMessage ? <Alert severity="success">{statusMessage}</Alert> : null}
      {saveError ? <Alert severity="error">{saveError.message}</Alert> : null}

      <SectionSurface sx={{ p: 3, maxWidth: 720 }}>
        <JudgeForm initial={judge} onSave={onSave} onCancel={onBack} submitLabel="Save Changes" />
      </SectionSurface>
    </Stack>
  );
}

export default function EditJudgePage({ params }: { params: Promise<{ judgeId: string }> }) {
  const { judgeId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const { data: judge, isLoading, isError, error, refetch } = useQuery<Judge, Error>({
    queryKey: ['judge', judgeId],
    queryFn: () => fetchJudge(judgeId),
  });

  const saveJudgeMutation = useMutation({
    mutationFn: (body: JudgeFormData) => persistJudgeUpdate(judgeId, body),
    onMutate: () => {
      setStatusMessage(null);
    },
    onSuccess: async (savedJudge) => {
      await reconcileSavedJudgeCaches({
        queryClient,
        savedJudge,
      });
      setStatusMessage(buildJudgeSaveSuccessMessage(savedJudge));
    },
  });

  return (
    <EditJudgePageContent
      judge={judge}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      onBack={() => router.push('/judges')}
      onSave={async (data) => {
        await saveJudgeMutation.mutateAsync(data);
      }}
      saveError={saveJudgeMutation.error}
      statusMessage={statusMessage}
    />
  );
}
