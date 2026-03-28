'use client';

import AssignmentIcon from '@mui/icons-material/Assignment';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import BarChartIcon from '@mui/icons-material/BarChart';
import {
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
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';

interface Submission {
  id: string;
  external_id: string;
  labeling_task_id: string | null;
  submitted_at: string | null;
  created_at: string;
}

export default function QueuePage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);

  const { data, isLoading } = useQuery<{ submissions: Submission[]; total: number }>({
    queryKey: ['queue-submissions', queueId],
    queryFn: () => fetch(`/api/queues/${queueId}/submissions`).then((r) => r.json()),
  });

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h4" fontWeight={700}>
          Submissions
        </Typography>
        <Stack direction="row" spacing={1}>
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
      ) : !data?.submissions?.length ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No submissions in this queue.</Typography>
        </Paper>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" mb={1}>
            {data.total} submission{data.total !== 1 ? 's' : ''}
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
                {data.submissions.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Typography fontFamily="monospace" fontSize={13} sx={{ whiteSpace: 'nowrap' }}>
                        {s.external_id}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{s.labeling_task_id ?? '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReviewerTableSurface>
        </>
      )}
    </>
  );
}
