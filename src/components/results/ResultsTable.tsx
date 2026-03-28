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
import type { EvalStatusEnum, VerdictEnum } from '@/types/db';
import VerdictChip from './VerdictChip';

interface EvalRow {
  id: string;
  verdict: VerdictEnum | null;
  reasoning: string | null;
  model_used: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  status: EvalStatusEnum | string | null;
  submission?: { id: string; external_id: string };
  question?: { id: string; external_id: string; question_text: string };
  judge?: { id: string; name: string; model: string };
  submissions?: { id: string; external_id: string };
  question_templates?: { id: string; external_id: string; question_text: string };
  judges?: { id: string; name: string; model: string };
}

interface ResultsTableProps {
  evaluations: EvalRow[];
}

function getRetryChipColor(status: EvalStatusEnum | string | null) {
  return status === 'error' ? 'error' : 'warning';
}

function getRetryLabel(retryCount: number) {
  return retryCount === 1 ? '1 retry' : `${retryCount} retries`;
}

function ExpandableRow({ ev }: { ev: EvalRow }) {
  const [open, setOpen] = useState(false);
  const submission = ev.submission ?? ev.submissions;
  const question = ev.question ?? ev.question_templates;
  const judge = ev.judge ?? ev.judges;

  return (
    <>
      <TableRow hover>
        <TableCell>
          <IconButton size="small" onClick={() => setOpen(!open)}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography fontFamily="monospace" fontSize={12}>
            {submission?.external_id ?? '—'}
          </Typography>
        </TableCell>
        <TableCell>
          <Tooltip title={question?.question_text ?? ''}>
            <Typography fontSize={13} noWrap sx={{ maxWidth: 180 }}>
              {question?.question_text ?? '—'}
            </Typography>
          </Tooltip>
        </TableCell>
        <TableCell>
          <Typography fontSize={13}>{judge?.name ?? '—'}</Typography>
        </TableCell>
        <TableCell>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <VerdictChip verdict={ev.verdict} status={ev.status as EvalStatusEnum | null | undefined} />
            {ev.retry_count > 0 && (
              <Chip
                label={getRetryLabel(ev.retry_count)}
                size="small"
                variant="outlined"
                color={getRetryChipColor(ev.status)}
              />
            )}
          </Stack>
        </TableCell>
        <TableCell>
          <Typography fontSize={12} color="text.secondary">
            {ev.latency_ms != null ? `${ev.latency_ms}ms` : '—'}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography fontSize={12} color="text.secondary">
            {new Date(ev.created_at).toLocaleDateString()}
          </Typography>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ p: 0, borderBottom: open ? undefined : 'none' }}>
          <Collapse in={open}>
            <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
              <Stack spacing={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">State</Typography>
                  <Stack direction="row" spacing={1} mt={0.5} useFlexGap flexWrap="wrap">
                    <VerdictChip verdict={ev.verdict} status={ev.status as EvalStatusEnum | null | undefined} />
                    {ev.retry_count > 0 && (
                      <Chip
                        label={getRetryLabel(ev.retry_count)}
                        size="small"
                        variant="outlined"
                        color={getRetryChipColor(ev.status)}
                      />
                    )}
                  </Stack>
                </Box>
                {ev.reasoning && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Reasoning</Typography>
                    <Typography variant="body2">{ev.reasoning}</Typography>
                  </Box>
                )}
                {ev.error_message && (
                  <Box>
                    <Typography variant="caption" color="error">Error</Typography>
                    <Typography variant="body2" color="error">{ev.error_message}</Typography>
                  </Box>
                )}
                <Stack direction="row" spacing={3} useFlexGap flexWrap="wrap">
                  {ev.model_used && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Model</Typography>
                      <Typography variant="body2" fontFamily="monospace" fontSize={12}>{ev.model_used}</Typography>
                    </Box>
                  )}
                  {ev.tokens_used != null && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Tokens</Typography>
                      <Typography variant="body2">{ev.tokens_used}</Typography>
                    </Box>
                  )}
                  {ev.latency_ms != null && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Latency</Typography>
                      <Typography variant="body2">{ev.latency_ms}ms</Typography>
                    </Box>
                  )}
                </Stack>
              </Stack>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function ResultsTable({ evaluations }: ResultsTableProps) {
  if (!evaluations.length) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No evaluations match the current filters.</Typography>
      </Paper>
    );
  }

  return (
    <Paper>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell width={40} />
            <TableCell>Submission</TableCell>
            <TableCell>Question</TableCell>
            <TableCell>Judge</TableCell>
            <TableCell>Outcome</TableCell>
            <TableCell>Latency</TableCell>
            <TableCell>Date</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {evaluations.map((ev) => (
            <ExpandableRow key={ev.id} ev={ev} />
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
