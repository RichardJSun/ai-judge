'use client';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { RunProgressResponse } from '@/types/api';

interface RunProgressProps {
  progress: RunProgressResponse;
}

export default function RunProgress({ progress }: RunProgressProps) {
  const { status, total, completed, errored } = progress;
  const done = completed + errored;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isTerminal = status === 'completed' || status === 'error' || status === 'cancelled';

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        {status === 'completed' && <CheckCircleIcon color="success" />}
        {status === 'error' && <ErrorIcon color="error" />}
        <Typography variant="h6">
          {status === 'running' && 'Running evaluations…'}
          {status === 'completed' && 'Evaluations complete'}
          {status === 'error' && 'Run finished with errors'}
          {status === 'pending' && 'Starting…'}
          {status === 'cancelled' && 'Cancelled'}
        </Typography>
      </Stack>

      <LinearProgress
        variant={isTerminal ? 'determinate' : 'buffer'}
        value={pct}
        valueBuffer={pct}
        color={status === 'error' ? 'error' : 'primary'}
        sx={{ height: 8, borderRadius: 4, mb: 2 }}
      />

      <Stack direction="row" spacing={2}>
        <Box>
          <Typography variant="caption" color="text.secondary">Total</Typography>
          <Typography fontWeight={700}>{total}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Completed</Typography>
          <Typography fontWeight={700} color="success.main">{completed}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Errors</Typography>
          <Typography fontWeight={700} color={errored > 0 ? 'error.main' : 'text.primary'}>
            {errored}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Progress</Typography>
          <Typography fontWeight={700}>{pct}%</Typography>
        </Box>
        <Box>
          <Chip
            label={status}
            size="small"
            color={
              status === 'completed' ? 'success'
              : status === 'error' ? 'error'
              : status === 'running' ? 'primary'
              : 'default'
            }
          />
        </Box>
      </Stack>
    </Paper>
  );
}
