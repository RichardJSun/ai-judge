'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import JudgeForm from '@/components/judges/JudgeForm';
import type { Judge } from '@/types/db';

export default function EditJudgePage({ params }: { params: Promise<{ judgeId: string }> }) {
  const { judgeId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: judge, isLoading } = useQuery<Judge>({
    queryKey: ['judge', judgeId],
    queryFn: () => fetch(`/api/judges/${judgeId}`).then((r) => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: (body: object) =>
      fetch(`/api/judges/${judgeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['judges'] });
      qc.invalidateQueries({ queryKey: ['judge', judgeId] });
      router.push('/judges');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/judges/${judgeId}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error('Delete failed');
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['judges'] });
      router.push('/judges');
    },
  });

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (!judge) return <Typography>Judge not found.</Typography>;

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/judges')}>
            Judges
          </Button>
          <Typography variant="h5" fontWeight={700}>
            Edit: {judge.name}
          </Typography>
        </Stack>
        <Button
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => setDeleteOpen(true)}
        >
          Delete
        </Button>
      </Stack>

      <Paper sx={{ p: 3, maxWidth: 600 }}>
        <JudgeForm
          initial={judge}
          onSave={async (data) => { await updateMutation.mutateAsync(data); }}
          onCancel={() => router.push('/judges')}
        />
      </Paper>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete Judge</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete &ldquo;{judge.name}&rdquo;? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
