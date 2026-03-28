'use client';

import {
  Box,
  Checkbox,
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
import { Fragment, useState } from 'react';
import PromptFieldSelector from './PromptFieldSelector';
import type { Judge, JudgeAssignment, QuestionTemplate } from '@/types/db';

interface AssignmentMatrixProps {
  queueId: string;
}

interface QuestionWithAssignments extends QuestionTemplate {
  assignments: (JudgeAssignment & { judges: Judge })[];
}

export default function AssignmentMatrix({ queueId }: AssignmentMatrixProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [promptFields, setPromptFields] = useState<Record<string, string[]>>({});

  const { data: questions, isLoading: loadingQ } = useQuery<QuestionWithAssignments[]>({
    queryKey: ['questions', queueId],
    queryFn: () => fetch(`/api/queues/${queueId}/questions`).then((r) => r.json()),
  });

  const { data: judges, isLoading: loadingJ } = useQuery<Judge[]>({
    queryKey: ['judges'],
    queryFn: () => fetch('/api/judges').then((r) => r.json()),
  });

  const { data: assignments } = useQuery<(JudgeAssignment & { judges: Judge })[]>({
    queryKey: ['assignments', queueId],
    queryFn: () => fetch(`/api/queues/${queueId}/assignments`).then((r) => r.json()),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({
      questionId,
      judgeId,
      assigned,
      fields,
    }: {
      questionId: string;
      judgeId: string;
      assigned: boolean;
      fields: string[];
    }) => {
      if (assigned) {
        return fetch(`/api/queues/${queueId}/assignments`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_template_id: questionId, judge_id: judgeId }),
        });
      } else {
        return fetch(`/api/queues/${queueId}/assignments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_template_id: questionId,
            judge_id: judgeId,
            prompt_fields: fields,
          }),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments', queueId] });
      qc.invalidateQueries({ queryKey: ['questions', queueId] });
    },
  });

  if (loadingQ || loadingJ) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  const activeJudges = (judges ?? []).filter((j) => j.active);
  const assignedSet = new Set(
    (assignments ?? []).map((a) => `${a.question_template_id}::${a.judge_id}`)
  );

  function getFields(questionId: string): string[] {
    return promptFields[questionId] ?? ['questionText', 'answer'];
  }

  return (
    <Paper>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 200 }}>Question</TableCell>
            {activeJudges.map((j) => (
              <TableCell key={j.id} align="center" sx={{ minWidth: 120 }}>
                <Tooltip title={j.model}>
                  <Typography fontSize={13} fontWeight={500}>
                    {j.name}
                  </Typography>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {(questions ?? []).map((q) => (
            <Fragment key={q.id}>
              <TableRow hover onClick={() => setExpanded(expanded === q.id ? null : q.id)} sx={{ cursor: 'pointer' }}>
                <TableCell>
                  <Typography fontSize={13}>{q.question_text}</Typography>
                  <Typography fontSize={11} color="text.secondary">{q.external_id}</Typography>
                </TableCell>
                {activeJudges.map((j) => {
                  const assigned = assignedSet.has(`${q.id}::${j.id}`);
                  return (
                    <TableCell key={j.id} align="center" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={assigned}
                        onChange={() =>
                          toggleMutation.mutate({
                            questionId: q.id,
                            judgeId: j.id,
                            assigned,
                            fields: getFields(q.id),
                          })
                        }
                        disabled={toggleMutation.isPending}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
              <TableRow>
                <TableCell colSpan={activeJudges.length + 1} sx={{ p: 0, borderBottom: expanded === q.id ? undefined : 'none' }}>
                  <Collapse in={expanded === q.id}>
                    <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                      <Stack spacing={1}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Prompt fields for this question (applied to all judges):
                        </Typography>
                        <PromptFieldSelector
                          value={getFields(q.id)}
                          onChange={(fields) =>
                            setPromptFields((prev) => ({ ...prev, [q.id]: fields }))
                          }
                        />
                      </Stack>
                    </Box>
                  </Collapse>
                </TableCell>
              </TableRow>
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
