'use client';

import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { RunPreviewResponse } from '@/types/api';

interface RunPreviewDialogProps {
  queueId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

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
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${fallback} The server returned invalid JSON.`);
  }
}

async function fetchRunPreview(queueId: string) {
  const response = await fetch(`/api/queues/${queueId}/run-preview`);
  const body = await readResponseBody(response, 'Failed to load run preview.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to load run preview.'));
  }

  if (typeof body !== 'object' || body === null) {
    throw new Error('Malformed run preview response.');
  }

  return body as RunPreviewResponse;
}

export default function RunPreviewDialog({
  queueId,
  open,
  onClose,
  onConfirm,
  loading,
}: RunPreviewDialogProps) {
  const {
    data: preview,
    isLoading,
    error,
    refetch,
  } = useQuery<RunPreviewResponse, Error>({
    queryKey: ['run-preview', queueId],
    queryFn: () => fetchRunPreview(queueId),
    enabled: open,
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Confirm Run</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Stack alignItems="center" py={3}>
            <CircularProgress />
          </Stack>
        ) : error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void refetch()}>
                Retry
              </Button>
            }
          >
            {error.message}
          </Alert>
        ) : (
          <>
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
              This will make <strong>{preview?.total ?? 0}</strong> real LLM API calls. Provider costs apply.
            </Alert>
            {preview?.inactiveAssignmentCount ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                {preview.inactiveAssignmentCount} persisted assignment{preview.inactiveAssignmentCount === 1 ? '' : 's'} target inactive judges and will be excluded until those judges are reactivated.
              </Alert>
            ) : null}
            {preview?.breakdown && (
              <List
                dense
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '12px',
                  bgcolor: 'background.default',
                  px: 1,
                }}
              >
                {preview.breakdown.map((item, index) => {
                  const secondary = [`${item.judgeCount} active judge${item.judgeCount !== 1 ? 's' : ''} assigned`];
                  if (item.excludedInactiveJudgeCount) {
                    secondary.push(
                      `${item.excludedInactiveJudgeCount} inactive excluded`
                    );
                  }

                  return (
                    <ListItem key={index} disableGutters>
                      <ListItemText primary={item.questionText} secondary={secondary.join(' • ')} />
                    </ListItem>
                  );
                })}
              </List>
            )}
            <Typography variant="body2" color="text.secondary" mt={1}>
              Total evaluations: <strong>{preview?.total ?? 0}</strong>
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={loading || isLoading || Boolean(error) || !preview?.total}
        >
          {loading ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
          {loading ? 'Starting…' : 'Start Evaluations'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
