'use client';

import AssignmentIcon from '@mui/icons-material/Assignment';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Button,
  Chip,
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
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { QueueWithCounts } from '@/types/api';

export default function QueuesPage() {
  const { data: queues, isLoading } = useQuery<QueueWithCounts[]>({
    queryKey: ['queues'],
    queryFn: () => fetch('/api/queues').then((r) => r.json()),
  });

  return (
    <>
      <Typography variant="h4" fontWeight={700} mb={3}>
        Queues
      </Typography>

      {isLoading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
      ) : !queues?.length ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No queues yet. Upload a submission file to get started.
          </Typography>
          <Button component={Link} href="/upload" variant="contained" sx={{ mt: 2 }}>
            Upload
          </Button>
        </Paper>
      ) : (
        <Paper>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Queue ID</TableCell>
                <TableCell align="center">Submissions</TableCell>
                <TableCell align="center">Questions</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {queues.map((q) => (
                <TableRow key={q.id} hover>
                  <TableCell>
                    <Typography fontWeight={500}>{q.queue_id}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip label={q.submission_count} size="small" />
                  </TableCell>
                  <TableCell align="center">
                    <Chip label={q.question_count} size="small" />
                  </TableCell>
                  <TableCell>
                    {new Date(q.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        component={Link}
                        href={`/queues/${q.id}`}
                        size="small"
                        startIcon={<VisibilityIcon />}
                      >
                        View
                      </Button>
                      <Button
                        component={Link}
                        href={`/queues/${q.id}/assign`}
                        size="small"
                        startIcon={<AssignmentIcon />}
                      >
                        Assign
                      </Button>
                      <Button
                        component={Link}
                        href={`/queues/${q.id}/run`}
                        size="small"
                        variant="contained"
                        startIcon={<PlayArrowIcon />}
                      >
                        Run
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </>
  );
}
