'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import {
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
import { useState } from 'react';
import JudgeForm from '@/components/judges/JudgeForm';
import type { Judge } from '@/types/db';

export default function JudgesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: judges, isLoading } = useQuery<Judge[]>({
    queryKey: ['judges'],
    queryFn: () => fetch('/api/judges').then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      fetch('/api/judges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['judges'] });
      setOpen(false);
    },
  });

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h4" fontWeight={700}>
          Judges
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New Judge
        </Button>
      </Stack>

      {isLoading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
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
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {judges.map((j) => (
                <TableRow key={j.id} hover>
                  <TableCell>
                    <Typography fontWeight={500}>{j.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" fontSize={13}>{j.model}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={j.active ? 'Active' : 'Inactive'}
                      color={j.active ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{new Date(j.created_at).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <Button
                      href={`/judges/${j.id}`}
                      size="small"
                      startIcon={<EditIcon />}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Judge</DialogTitle>
        <DialogContent>
          <Box pt={1}>
            <JudgeForm
              onSave={async (data) => { await createMutation.mutateAsync(data); }}
              onCancel={() => setOpen(false)}
            />
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
