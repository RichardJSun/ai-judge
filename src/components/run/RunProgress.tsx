'use client';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { AlertColor, ChipProps, LinearProgressProps } from '@mui/material';
import type { RunProgressResponse } from '@/types/api';
import type { RunStatusEnum } from '@/types/db';

interface RunProgressProps {
  progress: RunProgressResponse;
}

interface RunProgressPresentation {
  title: string;
  chipLabel: string;
  chipColor: NonNullable<ChipProps['color']>;
  progressColor: NonNullable<LinearProgressProps['color']>;
  icon: 'success' | 'warning' | 'error' | null;
  alertSeverity: AlertColor | null;
  alertMessage: string | null;
}

const RUN_STATUSES: RunStatusEnum[] = ['pending', 'running', 'completed', 'error', 'cancelled'];

function isRunStatus(status: string | null | undefined): status is RunStatusEnum {
  return typeof status === 'string' && RUN_STATUSES.includes(status as RunStatusEnum);
}

function formatCountLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function resolveRunProgressPresentation(
  progress: Pick<RunProgressResponse, 'status' | 'total' | 'completed' | 'errored'> & {
    status?: string | null;
  }
): RunProgressPresentation {
  const { errored, total } = progress;
  const status = progress.status;

  if (!isRunStatus(status)) {
    return {
      title: 'Invalid run state',
      chipLabel: 'invalid state',
      chipColor: 'warning',
      progressColor: 'warning',
      icon: 'warning',
      alertSeverity: 'error',
      alertMessage: 'Run progress data is missing a valid status. Refresh the page or inspect the API response.',
    };
  }

  if (status === 'error') {
    return {
      title: 'Run failed',
      chipLabel: 'error',
      chipColor: 'error',
      progressColor: 'error',
      icon: 'error',
      alertSeverity: 'error',
      alertMessage:
        errored > 0
          ? `${formatCountLabel(errored, 'evaluation')} failed. Review the error rows in Results.`
          : 'The run ended in an error state before evaluations could finish.',
    };
  }

  if (status === 'cancelled') {
    return {
      title: 'Cancelled',
      chipLabel: 'cancelled',
      chipColor: 'default',
      progressColor: 'warning',
      icon: 'warning',
      alertSeverity: 'warning',
      alertMessage: 'The run was cancelled before all evaluations finished.',
    };
  }

  if (errored > 0) {
    if (status === 'completed') {
      return {
        title: 'Completed with warnings',
        chipLabel: 'completed with errors',
        chipColor: 'warning',
        progressColor: 'warning',
        icon: 'warning',
        alertSeverity: 'warning',
        alertMessage: `${errored} of ${total} evaluations need review in Results.`,
      };
    }

    return {
      title: status === 'running' ? 'Running with warnings' : 'Starting with warnings',
      chipLabel: status === 'running' ? 'running with errors' : 'pending with errors',
      chipColor: 'warning',
      progressColor: 'warning',
      icon: 'warning',
      alertSeverity: 'warning',
      alertMessage: `${formatCountLabel(errored, 'evaluation')} failed so far. Polling will continue until the run settles.`,
    };
  }

  if (status === 'completed') {
    return {
      title: 'Evaluations complete',
      chipLabel: 'completed',
      chipColor: 'success',
      progressColor: 'success',
      icon: 'success',
      alertSeverity: null,
      alertMessage: null,
    };
  }

  return {
    title: status === 'running' ? 'Running evaluations…' : 'Starting…',
    chipLabel: status,
    chipColor: status === 'running' ? 'primary' : 'default',
    progressColor: 'primary',
    icon: null,
    alertSeverity: null,
    alertMessage: null,
  };
}

export default function RunProgress({ progress }: RunProgressProps) {
  const { total, completed, errored } = progress;
  const presentation = resolveRunProgressPresentation(progress);
  const terminalStatus =
    progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled';
  const settled = total > 0 ? Math.min(total, completed + errored) : 0;
  const pct = total > 0 ? Math.round((settled / total) * 100) : terminalStatus ? 100 : 0;
  const errorCountColor = presentation.progressColor === 'error' ? 'error.main' : errored > 0 ? 'warning.main' : 'text.primary';

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        {presentation.icon === 'success' && <CheckCircleIcon color="success" />}
        {presentation.icon === 'warning' && <WarningAmberIcon color="warning" />}
        {presentation.icon === 'error' && <ErrorIcon color="error" />}
        <Typography variant="h6">{presentation.title}</Typography>
      </Stack>

      <LinearProgress
        variant={terminalStatus ? 'determinate' : 'buffer'}
        value={pct}
        valueBuffer={pct}
        color={presentation.progressColor}
        sx={{ height: 8, borderRadius: 4, mb: 2 }}
      />

      <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
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
          <Typography fontWeight={700} color={errorCountColor}>
            {errored}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Progress</Typography>
          <Typography fontWeight={700}>{pct}%</Typography>
        </Box>
        <Box>
          <Chip label={presentation.chipLabel} size="small" color={presentation.chipColor} />
        </Box>
      </Stack>

      {presentation.alertMessage && presentation.alertSeverity && (
        <Alert severity={presentation.alertSeverity} sx={{ mt: 2 }}>
          {presentation.alertMessage}
        </Alert>
      )}
    </Paper>
  );
}
