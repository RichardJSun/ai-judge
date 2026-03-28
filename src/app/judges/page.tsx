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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import JudgeForm from '@/components/judges/JudgeForm';
import { parseJudgeList, parseJudgeRecord } from '@/lib/judges/judge-lifecycle';
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

async function fetchJudges() {
  const response = await fetch('/api/judges');
  const body = await readResponseBody(response, 'Failed to load judges.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to load judges.'));
  }

  return parseJudgeList(body, '/api/judges response');
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

export default function JudgesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: judges, isLoading, isError, error, refetch } = useQuery<Judge[], Error>({
    queryKey: ['judges'],
    queryFn: fetchJudges,
  });

  const createMutation = useMutation({
    mutationFn: createJudge,
    onSuccess: (createdJudge) => {
      qc.setQueryData<Judge[]>(['judges'], (current) => [createdJudge, ...(current ?? [])]);
      setOpen(false);
    },
  });

  const counts = useMemo(() => {
    const active = judges?.filter((judge) => judge.active).length ?? 0;
    const inactive = (judges?.length ?? 0) - active;

    return { active, inactive };
  }, [judges]);

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Judges
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Manage persisted judge configurations. Inactive judges stay in history and can be reactivated later.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New Judge
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip color="success" label={`${counts.active} active`} />
        <Chip color="default" label={`${counts.inactive} inactive`} />
      </Stack>

      {isLoading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
      ) : isError ? (
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
      ) : !judges?.length ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No judges yet. Create one to start evaluating submissions.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} sx={{ mt: 2 }} onClick={() => setOpen(true)}>
            New Judge
          </Button>
        </Paper>
      ) : (
        <Paper>
          <Table>
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
              {judges.map((judge) => (
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
                    <Button href={`/judges/${judge.id}`} size="small" startIcon={<EditIcon />}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Dialog open={open} onClose={() => (createMutation.isPending ? undefined : setOpen(false))} maxWidth="sm" fullWidth>
        <DialogTitle>New Judge</DialogTitle>
        <DialogContent>
          <Box pt={1}>
            <JudgeForm
              onSave={async (data) => {
                await createMutation.mutateAsync(data);
              }}
              onCancel={() => setOpen(false)}
            />
          </Box>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
