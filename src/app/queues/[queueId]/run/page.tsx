'use client';

import BarChartIcon from '@mui/icons-material/BarChart';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { use, useState, type ReactNode } from 'react';
import ReviewerWayfinding, {
  createQueueReviewerBreadcrumbs,
} from '@/components/navigation/ReviewerWayfinding';
import RunPreviewDialog from '@/components/run/RunPreviewDialog';
import RunProgress from '@/components/run/RunProgress';
import { EmptyStatePanel, SectionSurface } from '@/components/ui/editorial';
import { useRunProgress } from '@/hooks/useRunProgress';
import type { RunProgressResponse } from '@/types/api';

export interface RunPageContentProps {
  queueId: string;
  runId: string | null;
  progress: RunProgressResponse | null;
  pollError: string | null;
  startError: string | null;
  onBack: () => void;
  onOpenDialog: () => void;
  onViewResults: () => void;
  runPreviewDialog: ReactNode;
}

export function RunPageContent({
  queueId,
  runId,
  progress,
  pollError,
  startError,
  onBack,
  onOpenDialog,
  onViewResults,
  runPreviewDialog,
}: RunPageContentProps) {
  const isTerminal = progress && ['completed', 'error', 'cancelled'].includes(progress.status);

  return (
    <>
      <ReviewerWayfinding
        title="Run Evaluations"
        backLabel="Back to queue"
        onBack={onBack}
        breadcrumbs={createQueueReviewerBreadcrumbs(queueId, 'Run Evaluations')}
      />

      {!runId ? (
        <EmptyStatePanel
          title="Ready to evaluate?"
          description="This will run all assigned judges against every submission in the queue."
          actions={
            <Button
              variant="contained"
              size="large"
              startIcon={<PlayArrowIcon />}
              onClick={onOpenDialog}
            >
              Run AI Judges
            </Button>
          }
        />
      ) : (
        <Box maxWidth={600}>
          {progress ? (
            <>
              <RunProgress progress={progress} />
              {isTerminal ? (
                <Box mt={2}>
                  <Button variant="contained" startIcon={<BarChartIcon />} onClick={onViewResults}>
                    View Results
                  </Button>
                </Box>
              ) : null}
            </>
          ) : pollError ? (
            <Alert severity="error">{pollError}</Alert>
          ) : (
            <SectionSurface sx={{ p: 4 }}>
              <Box display="flex" justifyContent="center" mt={2} mb={2}>
                <CircularProgress />
              </Box>
              <Typography color="text.secondary" textAlign="center">
                Waiting for the latest run state from the server.
              </Typography>
            </SectionSurface>
          )}
        </Box>
      )}

      {!runId && startError ? (
        <Alert severity="error" sx={{ mt: 2, maxWidth: 560, mx: 'auto' }}>
          {startError}
        </Alert>
      ) : null}

      {runPreviewDialog}
    </>
  );
}

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

  return (
    <RunPageContent
      queueId={queueId}
      runId={runId}
      progress={progress}
      pollError={pollError}
      startError={startError}
      onBack={() => router.push(`/queues/${queueId}`)}
      onOpenDialog={() => setDialogOpen(true)}
      onViewResults={() => router.push(`/queues/${queueId}/results`)}
      runPreviewDialog={
        <RunPreviewDialog
          queueId={queueId}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onConfirm={startRun}
          loading={starting}
        />
      }
    />
  );
}
