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
  Typography,
} from '@mui/material';
import Link from 'next/link';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useState } from 'react';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import { parsePlanMarker, type EvaluationPlanMarker } from '@/lib/ai/plan-marker';
import ReviewerTimestamp from '@/lib/reviewer/reviewer-timestamp';
import {
  buildSubmissionDetailResultsHref,
  type ResultsPageUrlState,
} from '@/lib/results/results-page-url';
import type { ResultsEvaluation } from '@/types/api';
import VerdictChip from './VerdictChip';

export interface ResultsTableProps {
  queueId: string;
  evaluations: ResultsEvaluation[];
  resultsContext?: ResultsPageUrlState;
}

const DEFAULT_RESULTS_CONTEXT: ResultsPageUrlState = {
  page: 1,
  selectedJudges: [],
  selectedQuestions: [],
  selectedVerdicts: [],
};

const RESULT_ROW_SX = {
  cursor: 'pointer',
  '&:focus-visible > *': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: -2,
    backgroundColor: 'action.hover',
  },
} as const;

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

type PlanMarkerState =
  | { state: 'missing' }
  | { state: 'error'; error: string }
  | { state: 'ok'; marker: EvaluationPlanMarker };

function planMarkerErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Plan marker is malformed.';
}

function getPlanMarkerState(snapshot: string | null): PlanMarkerState {
  if (!snapshot) {
    return { state: 'missing' };
  }

  try {
    return { state: 'ok', marker: parsePlanMarker(snapshot) };
  } catch (error) {
    return { state: 'error', error: planMarkerErrorMessage(error) };
  }
}

function getDisclosureToggleLabel(submissionExternalId: string, open: boolean) {
  return `${open ? 'Collapse' : 'Expand'} audit details for submission ${submissionExternalId}`;
}

function getRowToggleLabel(submissionExternalId: string, open: boolean) {
  return `${open ? 'Collapse' : 'Expand'} audit details for submission ${submissionExternalId} from the row`;
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

function ExpandableRow({
  queueId,
  evaluation,
  resultsContext,
}: {
  queueId: string;
  evaluation: ResultsEvaluation;
  resultsContext: ResultsPageUrlState;
}) {
  const [open, setOpen] = useState(false);
  const reasoningSummary = summarizeReasoning(evaluation.reasoning);
  const planMarkerState = getPlanMarkerState(evaluation.prompt_snapshot);
  const detailPanelId = `results-audit-details-${evaluation.id}`;
  const detailHref = buildSubmissionDetailResultsHref(queueId, evaluation.submission.id, resultsContext);
  const toggleRow = () => setOpen((current) => !current);
  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    toggleRow();
  };

  return (
    <>
      <TableRow
        hover
        tabIndex={0}
        data-audit-toggle="row"
        aria-label={getRowToggleLabel(evaluation.submission.external_id, open)}
        aria-controls={detailPanelId}
        aria-expanded={open}
        onClick={toggleRow}
        onKeyDown={handleRowKeyDown}
        sx={RESULT_ROW_SX}
      >
        <TableCell sx={{ verticalAlign: 'top' }}>
          <IconButton
            aria-label={getDisclosureToggleLabel(evaluation.submission.external_id, open)}
            aria-controls={detailPanelId}
            aria-expanded={open}
            data-audit-toggle="icon"
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              toggleRow();
            }}
          >
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top' }}>
          <Link
            href={detailHref}
            prefetch={false}
            aria-label={`Open submission ${evaluation.submission.external_id} from results`}
            onClick={(event) => event.stopPropagation()}
            style={{ color: 'inherit', display: 'inline-block', textDecoration: 'none' }}
          >
            <Typography
              component="span"
              fontFamily="monospace"
              fontSize={12}
              sx={{
                textDecoration: 'underline',
                textDecorationColor: 'divider',
                whiteSpace: 'nowrap',
              }}
            >
              {evaluation.submission.external_id}
            </Typography>
          </Link>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 220 }}>
          <Stack spacing={0.5}>
            <Typography component="span" fontFamily="monospace" fontSize={12} color="text.secondary">
              {evaluation.question.external_id}
            </Typography>
            <Typography component="span" fontSize={13}>
              {evaluation.question.question_text}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 180 }}>
          <Typography component="span" fontSize={13}>
            {evaluation.judge.name}
          </Typography>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 120 }}>
          <VerdictChip verdict={evaluation.verdict} status={evaluation.status} />
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 320, maxWidth: 420 }}>
          <Typography component="span" fontSize={13} color={evaluation.reasoning ? 'text.primary' : 'text.secondary'}>
            {reasoningSummary}
          </Typography>
        </TableCell>
        <TableCell sx={{ verticalAlign: 'top', minWidth: 180 }}>
          <Typography component="span" fontSize={12} color="text.secondary">
            <ReviewerTimestamp value={evaluation.created_at} />
          </Typography>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ p: 0, borderBottom: open ? undefined : 'none' }}>
          <Collapse in={open}>
            <Box id={detailPanelId} sx={{ p: 2.5, bgcolor: 'action.hover' }}>
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

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Evaluation status
                  </Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ textTransform: 'capitalize' }}>
                    {evaluation.status}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Prompt snapshot
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1, bgcolor: 'grey.50' }}>
                    <Typography
                      component="pre"
                      variant="body2"
                      sx={{
                        m: 0,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {evaluation.prompt_snapshot ?? 'Prompt snapshot was not captured for this run.'}
                    </Typography>
                  </Paper>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Plan marker
                  </Typography>
                  {planMarkerState.state === 'missing' ? (
                    <Typography variant="body2" color="text.secondary">
                      Plan marker was not captured for this run.
                    </Typography>
                  ) : planMarkerState.state === 'error' ? (
                    <Typography variant="body2" color="error">
                      {planMarkerState.error}
                    </Typography>
                  ) : (
                    <>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} useFlexGap flexWrap="wrap">
                        <AuditField label="Plan marker kind" value={planMarkerState.marker.kind} monospace />
                        <AuditField
                          label="Forwarding requested"
                          value={planMarkerState.marker.forwardingRequested ? 'yes' : 'no'}
                        />
                        {planMarkerState.marker.supportedMedia && planMarkerState.marker.supportedMedia.length > 0 ? (
                          <AuditField
                            label="Supported media"
                            value={planMarkerState.marker.supportedMedia.join(', ')}
                            monospace
                          />
                        ) : null}
                      </Stack>
                      {planMarkerState.marker.blockedReason ? (
                        <Box mt={1}>
                          <Typography variant="caption" color="error" display="block" mb={0.5}>
                            Blocked diagnostics
                          </Typography>
                          <Typography variant="body2" color="error">
                            {planMarkerState.marker.blockedReason}
                          </Typography>
                        </Box>
                      ) : null}
                    </>
                  )}
                </Box>

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

export default function ResultsTable({
  queueId,
  evaluations,
  resultsContext = DEFAULT_RESULTS_CONTEXT,
}: ResultsTableProps) {
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
            <ExpandableRow
              key={evaluation.id}
              queueId={queueId}
              evaluation={evaluation}
              resultsContext={resultsContext}
            />
          ))}
        </TableBody>
      </Table>
    </ReviewerTableSurface>
  );
}
