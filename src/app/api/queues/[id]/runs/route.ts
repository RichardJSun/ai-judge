import { evaluateSingle, runWithConcurrency } from '@/lib/ai/evaluator';
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
          'id, question_template_id, judge_id, prompt_fields, judges(*), question_templates(id, question_text, question_type)'
        )
        .eq('queue_id', queueId);

      if (error) {
        throw new StartRunError(error.message, { status: 500, publicMessage: error.message, cause: error });
      }

      return data ?? [];
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
