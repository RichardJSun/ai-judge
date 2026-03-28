'use client';

import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type { ResultsEvaluation } from '@/types/api';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import VerdictChip from './VerdictChip';

export interface ResultsTableProps {
  evaluations: ResultsEvaluation[];
}

const CREATED_AT_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

export function formatCreatedAt(createdAt: string) {
  const value = new Date(createdAt);
  return Number.isNaN(value.getTime()) ? createdAt : CREATED_AT_FORMATTER.format(value);
}

export function summarizeReasoning(reasoning: string | null, maxLength = 160) {
  if (!reasoning) {
    return '—';
  }

  const normalized = reasoning.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatRetryCount(retryCount: number) {
  if (retryCount === 0) {
    return 'No retries';
  }

  return retryCount === 1 ? '1 retry' : `${retryCount} retries`;
}

function AuditField({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string | number;
  monospace?: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" fontFamily={monospace ? 'monospace' : undefined}>
        {value}
      </Typography>
    </Box>
  );
}

function ExpandableRow({ evaluation }: { evaluation: ResultsEvaluation }) {
  const [open, setOpen] = useState(false);
  const reasoningSummary = summarizeReasoning(evaluation.reasoning);
  const hasFullReasoning = Boolean(evaluation.reasoning && evaluation.reasoning.trim().length > 0);

  return (
    <>
      <TableRow hover>
        <TableCell sx={{ verticalAlign: 'top' }}>
          <IconButton
            aria-label={open ? 'Collapse audit details' : 'Expand audit details'}
            size="small"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top' }}>
          <Typography fontFamily="monospace" fontSize={12}>
            {evaluation.submission.external_id}
          </Typography>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 220 }}>
          <Stack spacing={0.5}>
            <Typography fontFamily="monospace" fontSize={12} color="text.secondary">
              {evaluation.question.external_id}
            </Typography>
            <Typography fontSize={13}>{evaluation.question.question_text}</Typography>
          </Stack>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 180 }}>
          <Typography fontSize={13}>{evaluation.judge.name}</Typography>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 120 }}>
          <VerdictChip verdict={evaluation.verdict} status={evaluation.status} />
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 320, maxWidth: 420 }}>
          <Tooltip title={hasFullReasoning ? evaluation.reasoning ?? '' : 'No reasoning returned.'}>
            <Typography fontSize={13} color={evaluation.reasoning ? 'text.primary' : 'text.secondary'}>
              {reasoningSummary}
            </Typography>
          </Tooltip>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 180 }}>
          <Typography fontSize={12} color="text.secondary">
            {formatCreatedAt(evaluation.created_at)}
          </Typography>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ p: 0, borderBottom: open ? undefined : 'none' }}>
          <Collapse in={open}>
            <Box sx={{ p: 2.5, bgcolor: 'action.hover' }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Full reasoning
                  </Typography>
                  <Typography variant="body2" color={evaluation.reasoning ? 'text.primary' : 'text.secondary'}>
                    {evaluation.reasoning ?? 'No reasoning returned.'}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <VerdictChip verdict={evaluation.verdict} status={evaluation.status} />
                  {evaluation.retry_count > 0 ? (
                    <Chip
                      label={formatRetryCount(evaluation.retry_count)}
                      size="small"
                      variant="outlined"
                      color={evaluation.status === 'error' ? 'error' : 'warning'}
                    />
                  ) : null}
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} useFlexGap flexWrap="wrap">
                  <AuditField
                    label="Model"
                    value={evaluation.model_used ?? '—'}
                    monospace={Boolean(evaluation.model_used)}
                  />
                  <AuditField label="Tokens" value={evaluation.tokens_used ?? '—'} />
                  <AuditField
                    label="Latency"
                    value={evaluation.latency_ms != null ? `${evaluation.latency_ms}ms` : '—'}
                  />
                  <AuditField label="Retries" value={formatRetryCount(evaluation.retry_count)} />
                </Stack>

                {evaluation.error_message ? (
                  <Box>
                    <Typography variant="caption" color="error" display="block" mb={0.5}>
                      Error text
                    </Typography>
                    <Typography variant="body2" color="error">
                      {evaluation.error_message}
                    </Typography>
                  </Box>
                ) : null}
              </Stack>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function ResultsTable({ evaluations }: ResultsTableProps) {
  if (evaluations.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No evaluations match the current filters.</Typography>
      </Paper>
    );
  }

  return (
    <ReviewerTableSurface>
      <Table size="small" sx={{ minWidth: 980 }}>
        <TableHead>
          <TableRow>
            <TableCell width={40} />
            <TableCell>Submission</TableCell>
            <TableCell>Question</TableCell>
            <TableCell>Judge</TableCell>
            <TableCell>Verdict</TableCell>
            <TableCell>Reasoning</TableCell>
            <TableCell>Created</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {evaluations.map((evaluation) => (
            <ExpandableRow key={evaluation.id} evaluation={evaluation} />
          ))}
        </TableBody>
      </Table>
    </ReviewerTableSurface>
  );
}
