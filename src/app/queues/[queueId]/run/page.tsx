'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BarChartIcon from '@mui/icons-material/BarChart';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import RunPreviewDialog from '@/components/run/RunPreviewDialog';
import RunProgress from '@/components/run/RunProgress';
import { useRunProgress } from '@/hooks/useRunProgress';

export default function RunPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const { progress, error: pollError } = useRunProgress(queueId, runId);

  async function startRun() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/queues/${queueId}/runs`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to start run');
      setRunId(data.runId);
      setDialogOpen(false);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setStarting(false);
    }
  }

  const isTerminal = progress && ['completed', 'error', 'cancelled'].includes(progress.status);

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(`/queues/${queueId}`)}>
          Back
        </Button>
        <Typography variant="h4" fontWeight={700}>
          Run Evaluations
        </Typography>
      </Stack>

      {!runId ? (
        <Paper sx={{ p: 4, textAlign: 'center', maxWidth: 480, mx: 'auto' }}>
          <Typography variant="h6" mb={1}>
            Ready to evaluate?
          </Typography>
          <Typography color="text.secondary" mb={3}>
            This will run all assigned judges against every submission in the queue.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrowIcon />}
            onClick={() => setDialogOpen(true)}
          >
            Run AI Judges
          </Button>
          {startError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {startError}
            </Alert>
          )}
        </Paper>
      ) : (
        <Box maxWidth={600}>
          {progress ? (
            <>
              <RunProgress progress={progress} />
              {isTerminal && (
                <Box mt={2}>
                  <Button
                    variant="contained"
                    startIcon={<BarChartIcon />}
                    onClick={() => router.push(`/queues/${queueId}/results`)}
                  >
                    View Results
                  </Button>
                </Box>
              )}
            </>
          ) : pollError ? (
            <Alert severity="error">{pollError}</Alert>
          ) : (
            <Box display="flex" justifyContent="center" mt={6}>
              <CircularProgress />
            </Box>
          )}
        </Box>
      )}

      <RunPreviewDialog
        queueId={queueId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={startRun}
        loading={starting}
      />
    </>
  );
}
