'use client';

import {
  Box,
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
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { useState } from 'react';
import VerdictChip from './VerdictChip';

interface EvalRow {
  id: string;
  verdict: 'pass' | 'fail' | 'inconclusive' | null;
  reasoning: string | null;
  model_used: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  status: string;
  submissions: { id: string; external_id: string };
  question_templates: { id: string; external_id: string; question_text: string };
  judges: { id: string; name: string; model: string };
}

interface ResultsTableProps {
  evaluations: EvalRow[];
}

function ExpandableRow({ ev }: { ev: EvalRow }) {
  const [open, setOpen] = useState(false);

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
            {ev.submissions?.external_id ?? '—'}
          </Typography>
        </TableCell>
        <TableCell>
          <Tooltip title={ev.question_templates?.question_text ?? ''}>
            <Typography fontSize={13} noWrap sx={{ maxWidth: 180 }}>
              {ev.question_templates?.question_text ?? '—'}
            </Typography>
          </Tooltip>
        </TableCell>
        <TableCell>
          <Typography fontSize={13}>{ev.judges?.name ?? '—'}</Typography>
        </TableCell>
        <TableCell>
          <VerdictChip verdict={ev.verdict} />
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
                <Stack direction="row" spacing={3}>
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
                  {ev.retry_count > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Retries</Typography>
                      <Typography variant="body2">{ev.retry_count}</Typography>
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
            <TableCell>Verdict</TableCell>
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
