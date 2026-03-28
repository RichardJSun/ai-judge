import { evaluateSingle, runWithConcurrency } from '@/lib/ai/evaluator';
import {
  getActiveQueueAssignments,
  parseQueueAssignmentList,
  QueueAssignmentStateError,
} from '@/lib/assignments/queue-assignment-state';
import { createServiceClient } from '@/lib/supabase/server';
import { executeRun, type ExecuteRunDeps } from '@/lib/run/execute-run';
import { scheduleRunExecution, startRun, StartRunError, type StartRunDeps } from '@/lib/run/start-run';
import { after, NextRequest, NextResponse } from 'next/server';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const startDeps: StartRunDeps = {
    async getAssignments(queueId) {
      const { data, error } = await supabase
        .from('judge_assignments')
        .select(
          'id, queue_id, question_template_id, judge_id, prompt_fields, attachment_forwarding, created_at, judges(id, name, system_prompt, model, active), question_templates(id, external_id, question_text, question_type, created_at)'
        )
        .eq('queue_id', queueId);

      if (error) {
        throw new StartRunError('Failed to load queue assignments.', {
          status: 500,
          publicMessage: 'Failed to load queue assignments.',
          cause: error,
        });
      }

      try {
        const assignments = parseQueueAssignmentList(data ?? [], {
          context: `/api/queues/${queueId}/runs assignments`,
          requireQuestion: true,
          requireJudgeSystemPrompt: true,
        });
        const activeAssignments = getActiveQueueAssignments(assignments);

        if (!activeAssignments.length && assignments.length > 0) {
          throw new StartRunError('All persisted assignments target inactive judges.', {
            status: 400,
            publicMessage:
              'All assigned judges for this queue are inactive. Reactivate a judge or add an active assignment before starting a run.',
          });
        }

        return activeAssignments.map((assignment) => ({
          question_template_id: assignment.question_template_id,
          judge_id: assignment.judge_id,
          prompt_fields: assignment.prompt_fields,
          judges: {
            id: assignment.judge.id,
            name: assignment.judge.name,
            system_prompt: assignment.judge.system_prompt,
            model: assignment.judge.model,
          },
          question_templates: {
            id: assignment.question?.id,
            question_text: assignment.question?.question_text,
            question_type: assignment.question?.question_type,
          },
        }));
      } catch (error) {
        if (error instanceof QueueAssignmentStateError) {
          throw new StartRunError(error.message, {
            status: error.status,
            publicMessage: error.publicMessage,
            cause: error,
          });
        }

        throw error;
      }
    },
    async getSubmissions(queueId) {
      const { data, error } = await supabase
        .from('submissions')
        .select('id, external_id')
        .eq('queue_id', queueId);

      if (error) {
        throw new StartRunError(error.message, { status: 500, publicMessage: error.message, cause: error });
      }

      return data ?? [];
    },
    async getAnswers(submissionIds) {
      if (!submissionIds.length) {
        return [];
      }

      const { data, error } = await supabase
        .from('submission_answers')
        .select('submission_id, question_template_id, answer_json')
        .in('submission_id', submissionIds);

      if (error) {
        throw new StartRunError(error.message, { status: 500, publicMessage: error.message, cause: error });
      }

      return data ?? [];
    },
    async createRun({ queueId, total }) {
      const { data, error } = await supabase
        .from('evaluation_runs')
        .insert({ queue_id: queueId, status: 'running', total })
        .select('id')
        .single();

      if (error || !data) {
        throw new StartRunError(error?.message ?? 'Failed to create evaluation run.', {
          status: 500,
          publicMessage: error?.message ?? 'Failed to create evaluation run.',
          cause: error,
        });
      }

      return { id: data.id };
    },
    async insertEvaluations(rows) {
      if (!rows.length) {
        return [];
      }

      const { data, error } = await supabase
        .from('evaluations')
        .insert(
          rows.map((row) => ({
            run_id: row.runId,
            submission_id: row.submissionId,
            question_template_id: row.questionTemplateId,
            judge_id: row.judgeId,
            status: row.status,
          }))
        )
        .select('id, submission_id, question_template_id, judge_id');

      if (error) {
        throw new StartRunError(error.message, { status: 500, publicMessage: error.message, cause: error });
      }

      return data ?? [];
    },
    async markRunError(runId) {
      await supabase
        .from('evaluation_runs')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('id', runId);
    },
  };

  const executeDeps: ExecuteRunDeps = {
    evaluate(task) {
      return evaluateSingle(supabase, task);
    },
    async incrementCompleted(runId) {
      await supabase.rpc('increment_run_completed', { p_run_id: runId });
    },
    async incrementErrored(runId) {
      await supabase.rpc('increment_run_errored', { p_run_id: runId });
    },
    async getRunSummary(runId) {
      const { data, error } = await supabase
        .from('evaluation_runs')
        .select('total, errored')
        .eq('id', runId)
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to load persisted run counters.');
      }

      return data;
    },
    async updateRunStatus(runId, status) {
      const { error } = await supabase
        .from('evaluation_runs')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', runId);

      if (error) {
        throw new Error(error.message);
      }
    },
    async markRunError(runId) {
      const { error } = await supabase
        .from('evaluation_runs')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('id', runId);

      if (error) {
        throw new Error(error.message);
      }
    },
    runWithConcurrency,
  };

  try {
    const started = await startRun(startDeps, id);

    try {
      await scheduleRunExecution({
        schedule: after,
        execute: () => executeRun({ runId: started.runId, tasks: started.tasks, deps: executeDeps }),
        onScheduleError: () => startDeps.markRunError(started.runId),
        onExecutionError: () => startDeps.markRunError(started.runId),
      });
    } catch {
      return NextResponse.json({ error: 'Failed to dispatch evaluation run.' }, { status: 500 });
    }

    return NextResponse.json({ runId: started.runId, total: started.total });
  } catch (error) {
    const message = error instanceof StartRunError ? error.publicMessage : 'Failed to start run.';
    const status = error instanceof StartRunError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
