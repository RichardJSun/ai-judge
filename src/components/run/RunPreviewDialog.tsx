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

export default function RunPreviewDialog({
  queueId,
  open,
  onClose,
  onConfirm,
  loading,
}: RunPreviewDialogProps) {
  const { data: preview, isLoading } = useQuery<RunPreviewResponse>({
    queryKey: ['run-preview', queueId],
    queryFn: () => fetch(`/api/queues/${queueId}/run-preview`).then((r) => r.json()),
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
        ) : (
          <>
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
              This will make <strong>{preview?.total ?? 0}</strong> real LLM API calls. Provider costs apply.
            </Alert>
            {preview?.breakdown && (
              <List dense>
                {preview.breakdown.map((b, i) => (
                  <ListItem key={i} disableGutters>
                    <ListItemText
                      primary={b.questionText}
                      secondary={`${b.judgeCount} judge${b.judgeCount !== 1 ? 's' : ''} assigned`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
            <Typography variant="body2" color="text.secondary" mt={1}>
              Total evaluations: <strong>{preview?.total ?? 0}</strong>
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={loading || isLoading || !preview?.total}
        >
          {loading ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
          {loading ? 'Starting…' : 'Start Evaluations'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
