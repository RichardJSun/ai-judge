'use client';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import ReviewerTableSurface from '@/components/layout/ReviewerTableSurface';
import {
  buildVisibleJudgeRoster,
  DEFAULT_PROMPT_FIELDS,
  getQuestionPromptFieldDefaults,
  parseQueueAssignmentList,
  parseQueueQuestionList,
  type QueueAssignmentRecord,
  type QueueQuestionWithAssignments,
  type VisibleAssignmentJudge,
} from '@/lib/assignments/queue-assignment-state';
import { parseJudgeList } from '@/lib/judges/judge-lifecycle';
import type { Judge } from '@/types/db';
import PromptFieldSelector from './PromptFieldSelector';

interface AssignmentMatrixProps {
  queueId: string;
}

type AssignmentToggleArgs = {
  questionId: string;
  judgeId: string;
  assigned: boolean;
  fields: string[];
};

export interface AssignmentMatrixContentProps {
  loading: boolean;
  loadError: Error | null;
  hasPersistedState: boolean;
  onRetryLoads: () => void | Promise<void>;
  mutationError: Error | null;
  inactiveAssignmentCount: number;
  questions: QueueQuestionWithAssignments[];
  visibleJudges: VisibleAssignmentJudge[];
  assignmentsByPair: ReadonlyMap<string, QueueAssignmentRecord>;
  expandedQuestionId: string | null;
  onToggleExpanded: (questionId: string) => void;
  getFields: (questionId: string) => string[];
  onToggleAssignment: (args: AssignmentToggleArgs) => void;
  onPromptFieldsChange: (questionId: string, fields: string[]) => void;
  togglePending: boolean;
}

interface AssignmentMatrixTableProps {
  questions: QueueQuestionWithAssignments[];
  visibleJudges: VisibleAssignmentJudge[];
  assignmentsByPair: ReadonlyMap<string, QueueAssignmentRecord>;
  expandedQuestionId: string | null;
  onToggleExpanded: (questionId: string) => void;
  getFields: (questionId: string) => string[];
  onToggleAssignment: (args: AssignmentToggleArgs) => void;
  onPromptFieldsChange: (questionId: string, fields: string[]) => void;
  togglePending: boolean;
}

function getAssignmentQuestionsQueryKey(queueId: string) {
  return ['assignment-questions', queueId] as const;
}

const PROMPT_FIELD_LABELS: Record<string, string> = {
  questionText: 'Question Text',
  answer: 'Answer',
  questionType: 'Question Type',
};

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

async function fetchQuestions(queueId: string) {
  const response = await fetch(`/api/queues/${queueId}/questions`);
  const body = await readResponseBody(response, 'Failed to load queue questions.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to load queue questions.'));
  }

  return parseQueueQuestionList(body, `/api/queues/${queueId}/questions response`);
}

async function fetchJudges() {
  const response = await fetch('/api/judges');
  const body = await readResponseBody(response, 'Failed to load judges.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to load judges.'));
  }

  return parseJudgeList(body, '/api/judges response');
}

async function fetchAssignments(queueId: string) {
  const response = await fetch(`/api/queues/${queueId}/assignments`);
  const body = await readResponseBody(response, 'Failed to load queue assignments.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to load queue assignments.'));
  }

  return parseQueueAssignmentList(body, {
    context: `/api/queues/${queueId}/assignments response`,
    requireQuestion: true,
  });
}

async function createAssignment(
  queueId: string,
  payload: {
    question_template_id: string;
    judge_id: string;
    prompt_fields: string[];
  }
) {
  const response = await fetch(`/api/queues/${queueId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readResponseBody(response, 'Failed to save assignment.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to save assignment.'));
  }

  return body;
}

async function removeAssignment(
  queueId: string,
  payload: {
    question_template_id: string;
    judge_id: string;
  }
) {
  const response = await fetch(`/api/queues/${queueId}/assignments`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.status === 204) {
    return null;
  }

  const body = await readResponseBody(response, 'Failed to remove assignment.');

  if (!response.ok) {
    throw new Error(getApiErrorMessage(body, 'Failed to remove assignment.'));
  }

  return body;
}

function formatPromptField(field: string) {
  return PROMPT_FIELD_LABELS[field] ?? field;
}

export function AssignmentMatrixTable({
  questions,
  visibleJudges,
  assignmentsByPair,
  expandedQuestionId,
  onToggleExpanded,
  getFields,
  onToggleAssignment,
  onPromptFieldsChange,
  togglePending,
}: AssignmentMatrixTableProps) {
  return (
    <ReviewerTableSurface>
      <Table sx={{ minWidth: 240 + visibleJudges.length * 160 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 240 }}>Question</TableCell>
            {visibleJudges.map((judge) => (
              <TableCell key={judge.id} align="center" sx={{ minWidth: 140 }}>
                <Tooltip
                  title={
                    judge.active
                      ? judge.model
                      : `${judge.model} — inactive judges remain visible while persisted assignments exist.`
                  }
                >
                  <Stack spacing={0.5} alignItems="center">
                    <Typography fontSize={13} fontWeight={500}>
                      {judge.name}
                    </Typography>
                    {!judge.active ? <Chip size="small" label="Inactive" /> : null}
                  </Stack>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {questions.map((question) => {
            const questionAssignments = Array.isArray(question.assignments)
              ? question.assignments
              : [];
            const inactiveQuestionAssignments = questionAssignments.filter(
              (assignment) => assignment.judge_status === 'inactive'
            );

            return (
              <Fragment key={question.id}>
                <TableRow
                  hover
                  onClick={() => onToggleExpanded(question.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography fontSize={13}>{question.question_text}</Typography>
                    <Typography fontSize={11} color="text.secondary">
                      {question.external_id}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mt={1}>
                      <Chip size="small" label={`${questionAssignments.length} persisted`} />
                      {inactiveQuestionAssignments.length > 0 ? (
                        <Chip
                          size="small"
                          color="warning"
                          label={`${inactiveQuestionAssignments.length} inactive excluded`}
                        />
                      ) : null}
                    </Stack>
                  </TableCell>
                  {visibleJudges.map((judge) => {
                    const assignment = assignmentsByPair.get(`${question.id}::${judge.id}`);
                    const assigned = Boolean(assignment);
                    const disabled = togglePending || !judge.active;
                    const statusMessage = judge.active
                      ? assigned
                        ? 'Remove persisted assignment.'
                        : 'Create persisted assignment.'
                      : assigned
                        ? 'Inactive persisted assignment. Reactivate this judge before it can run again.'
                        : 'Reactivate this judge before creating new assignments.';

                    return (
                      <TableCell
                        key={judge.id}
                        align="center"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Tooltip title={statusMessage}>
                          <Box>
                            <Checkbox
                              checked={assigned}
                              onChange={() =>
                                onToggleAssignment({
                                  questionId: question.id,
                                  judgeId: judge.id,
                                  assigned,
                                  fields: getFields(question.id),
                                })
                              }
                              disabled={disabled}
                            />
                            {!judge.active && assigned ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                              >
                                Excluded
                              </Typography>
                            ) : null}
                          </Box>
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
                <TableRow>
                  <TableCell
                    colSpan={visibleJudges.length + 1}
                    sx={{ p: 0, borderBottom: expandedQuestionId === question.id ? undefined : 'none' }}
                  >
                    <Collapse in={expandedQuestionId === question.id}>
                      <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                        <Stack spacing={2}>
                          <Box>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              display="block"
                              mb={1}
                            >
                              Persisted assignments for this question:
                            </Typography>
                            {questionAssignments.length > 0 ? (
                              <Stack spacing={1}>
                                {questionAssignments.map((assignment) => (
                                  <Paper
                                    key={`${assignment.question_template_id}::${assignment.judge_id}`}
                                    variant="outlined"
                                    sx={{ p: 1.5 }}
                                  >
                                    <Stack
                                      direction={{ xs: 'column', sm: 'row' }}
                                      justifyContent="space-between"
                                      spacing={1}
                                    >
                                      <Box>
                                        <Typography fontSize={13} fontWeight={600}>
                                          {assignment.judge.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {assignment.judge.model}
                                        </Typography>
                                      </Box>
                                      <Chip
                                        size="small"
                                        color={
                                          assignment.judge_status === 'active'
                                            ? 'success'
                                            : 'default'
                                        }
                                        label={
                                          assignment.judge_status === 'active'
                                            ? 'Active in preview/run'
                                            : 'Inactive — excluded from preview/run'
                                        }
                                      />
                                    </Stack>
                                    <Stack
                                      direction="row"
                                      spacing={1}
                                      flexWrap="wrap"
                                      useFlexGap
                                      mt={1.5}
                                    >
                                      {assignment.prompt_fields.map((field) => (
                                        <Chip
                                          key={field}
                                          size="small"
                                          variant="outlined"
                                          label={formatPromptField(field)}
                                        />
                                      ))}
                                    </Stack>
                                  </Paper>
                                ))}
                              </Stack>
                            ) : (
                              <Typography fontSize={12} color="text.secondary">
                                No persisted assignments for this question yet.
                              </Typography>
                            )}
                          </Box>

                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Prompt fields for newly checked active judges on this question:
                            </Typography>
                            <PromptFieldSelector
                              value={getFields(question.id)}
                              onChange={(fields) => onPromptFieldsChange(question.id, fields)}
                            />
                          </Box>
                        </Stack>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </ReviewerTableSurface>
  );
}

export function AssignmentMatrixContent({
  loading,
  loadError,
  hasPersistedState,
  onRetryLoads,
  mutationError,
  inactiveAssignmentCount,
  questions,
  visibleJudges,
  assignmentsByPair,
  expandedQuestionId,
  onToggleExpanded,
  getFields,
  onToggleAssignment,
  onPromptFieldsChange,
  togglePending,
}: AssignmentMatrixContentProps) {
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError && !hasPersistedState) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void onRetryLoads()}>
            Retry
          </Button>
        }
      >
        {loadError.message}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      {loadError ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void onRetryLoads()}>
              Retry
            </Button>
          }
        >
          {loadError.message} Showing the last confirmed persisted assignment state below.
        </Alert>
      ) : null}

      {mutationError ? <Alert severity="error">{mutationError.message}</Alert> : null}

      {inactiveAssignmentCount > 0 ? (
        <Alert severity="info">
          {inactiveAssignmentCount} persisted assignment{inactiveAssignmentCount === 1 ? '' : 's'} now target inactive judges. They stay visible here for inspection but are excluded from run preview and execution until reactivated.
        </Alert>
      ) : null}

      <AssignmentMatrixTable
        questions={questions}
        visibleJudges={visibleJudges}
        assignmentsByPair={assignmentsByPair}
        expandedQuestionId={expandedQuestionId}
        onToggleExpanded={onToggleExpanded}
        getFields={getFields}
        onToggleAssignment={onToggleAssignment}
        onPromptFieldsChange={onPromptFieldsChange}
        togglePending={togglePending}
      />
    </Stack>
  );
}

export default function AssignmentMatrix({ queueId }: AssignmentMatrixProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [promptFields, setPromptFields] = useState<Record<string, string[]>>({});

  const {
    data: questions,
    isLoading: loadingQ,
    error: questionsError,
    refetch: refetchQuestions,
  } = useQuery<QueueQuestionWithAssignments[], Error>({
    queryKey: getAssignmentQuestionsQueryKey(queueId),
    queryFn: () => fetchQuestions(queueId),
  });

  const {
    data: judges,
    isLoading: loadingJ,
    error: judgesError,
    refetch: refetchJudges,
  } = useQuery<Judge[], Error>({
    queryKey: ['judges'],
    queryFn: fetchJudges,
  });

  const {
    data: assignments,
    isLoading: loadingA,
    error: assignmentsError,
    refetch: refetchAssignments,
  } = useQuery<QueueAssignmentRecord[], Error>({
    queryKey: ['assignments', queueId],
    queryFn: () => fetchAssignments(queueId),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ questionId, judgeId, assigned, fields }: AssignmentToggleArgs) => {
      if (assigned) {
        return removeAssignment(queueId, {
          question_template_id: questionId,
          judge_id: judgeId,
        });
      }

      return createAssignment(queueId, {
        question_template_id: questionId,
        judge_id: judgeId,
        prompt_fields: fields,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments', queueId] });
      qc.invalidateQueries({ queryKey: getAssignmentQuestionsQueryKey(queueId) });
      qc.invalidateQueries({ queryKey: ['run-preview', queueId] });
    },
  });

  const visibleJudges = useMemo(
    () => buildVisibleJudgeRoster(judges ?? [], assignments ?? []),
    [assignments, judges]
  );
  const promptFieldDefaults = useMemo(
    () => getQuestionPromptFieldDefaults(assignments ?? []),
    [assignments]
  );
  const assignmentsByPair = useMemo(
    () =>
      new Map(
        (assignments ?? []).map((assignment) => [
          `${assignment.question_template_id}::${assignment.judge_id}`,
          assignment,
        ])
      ),
    [assignments]
  );
  const inactiveAssignmentCount = useMemo(
    () =>
      (assignments ?? []).filter((assignment) => assignment.judge_status === 'inactive').length,
    [assignments]
  );

  const hasPersistedState = Boolean(questions || judges || assignments);
  const combinedLoadError = questionsError ?? judgesError ?? assignmentsError;
  const isLoading =
    (loadingQ && !questions) || (loadingJ && !judges) || (loadingA && !assignments);

  function getFields(questionId: string): string[] {
    return (
      promptFields[questionId] ?? promptFieldDefaults[questionId] ?? [...DEFAULT_PROMPT_FIELDS]
    );
  }

  async function retryLoads() {
    await Promise.all([refetchQuestions(), refetchJudges(), refetchAssignments()]);
  }

  return (
    <AssignmentMatrixContent
      loading={isLoading}
      loadError={combinedLoadError}
      hasPersistedState={hasPersistedState}
      onRetryLoads={retryLoads}
      mutationError={toggleMutation.error}
      inactiveAssignmentCount={inactiveAssignmentCount}
      questions={questions ?? []}
      visibleJudges={visibleJudges}
      assignmentsByPair={assignmentsByPair}
      expandedQuestionId={expanded}
      onToggleExpanded={(questionId) =>
        setExpanded((current) => (current === questionId ? null : questionId))
      }
      getFields={getFields}
      onToggleAssignment={(args) => toggleMutation.mutate(args)}
      onPromptFieldsChange={(questionId, fields) =>
        setPromptFields((current) => ({ ...current, [questionId]: fields }))
      }
      togglePending={toggleMutation.isPending}
    />
  );
}
