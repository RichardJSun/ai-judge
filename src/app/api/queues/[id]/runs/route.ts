import { evaluateSingle, runWithConcurrency, type EvaluateParams } from '@/lib/ai/evaluator';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Fetch assignments with judge info
  const { data: assignments, error: assignErr } = await supabase
    .from('judge_assignments')
    .select('id, question_template_id, judge_id, prompt_fields, judges(*), question_templates(id, question_text, question_type)')
    .eq('queue_id', id);

  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });
  if (!assignments?.length) {
    return NextResponse.json({ error: 'No judge assignments found for this queue.' }, { status: 400 });
  }

  // Fetch all submissions
  const { data: submissions, error: subErr } = await supabase
    .from('submissions')
    .select('id, external_id')
    .eq('queue_id', id);

  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
  if (!submissions?.length) {
    return NextResponse.json({ error: 'No submissions in this queue.' }, { status: 400 });
  }

  // Fetch submission answers for lookup
  const submissionIds = (submissions as Array<{ id: string; external_id: string }>).map((s) => s.id);
  const { data: answers } = await supabase
    .from('submission_answers')
    .select('submission_id, question_template_id, answer_json')
    .in('submission_id', submissionIds);

  const answerMap = new Map<string, Record<string, unknown>>();
  for (const a of answers ?? []) {
    answerMap.set(`${a.submission_id}::${a.question_template_id}`, a.answer_json ?? {});
  }

  // Build evaluation tasks
  const evalRows: {
    run_id: string;
    submission_id: string;
    question_template_id: string;
    judge_id: string;
    status: 'pending';
  }[] = [];

  for (const submission of submissions) {
    for (const assignment of assignments) {
      // Only create evaluation where submission has an answer for this question
      if (!answerMap.has(`${submission.id}::${assignment.question_template_id}`)) continue;
      evalRows.push({
        run_id: '', // filled after run is created
        submission_id: submission.id,
        question_template_id: assignment.question_template_id,
        judge_id: assignment.judge_id,
        status: 'pending',
      });
    }
  }

  const total = evalRows.length;

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from('evaluation_runs')
    .insert({ queue_id: id, status: 'running', total })
    .select()
    .single();

  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });

  // Insert all evaluation rows
  const evalInserts = evalRows.map((r) => ({ ...r, run_id: run.id }));
  const { data: evalData, error: evalInsertErr } = await supabase
    .from('evaluations')
    .insert(evalInserts)
    .select('id, submission_id, question_template_id, judge_id');

  if (evalInsertErr) {
    await supabase.from('evaluation_runs').update({ status: 'error' }).eq('id', run.id);
    return NextResponse.json({ error: evalInsertErr.message }, { status: 500 });
  }

  // Build eval tasks with full context
  type AssignmentRow = {
    question_template_id: string;
    judge_id: string;
    prompt_fields: unknown;
    judges: unknown;
    question_templates: unknown;
  };
  const assignmentMap = new Map(
    (assignments as AssignmentRow[]).map((a) => {
      const judgeRaw = a.judges;
      const qtRaw = a.question_templates;
      return [
        `${a.question_template_id}::${a.judge_id}`,
        {
          judge: (Array.isArray(judgeRaw) ? judgeRaw[0] : judgeRaw) as { id: string; name: string; system_prompt: string; model: string },
          question: (Array.isArray(qtRaw) ? qtRaw[0] : qtRaw) as { id: string; question_text: string; question_type: string | null },
          promptFields: (a.prompt_fields as string[]) ?? ['questionText', 'answer'],
        },
      ];
    })
  );

  type EvalRow = { id: string; submission_id: string; question_template_id: string; judge_id: string };
  const tasks = (evalData ?? [] as EvalRow[]).map((ev: EvalRow): EvaluateParams => {
    const key = `${ev.question_template_id}::${ev.judge_id}`;
    const ctx = assignmentMap.get(key)!;
    const answerJson = answerMap.get(`${ev.submission_id}::${ev.question_template_id}`) ?? {};
    return {
      evaluationId: ev.id,
      submissionId: ev.submission_id,
      questionText: ctx.question.question_text,
      questionType: ctx.question.question_type,
      answerJson,
      judge: ctx.judge,
      promptFields: ctx.promptFields,
    };
  });

  // Run evaluations with bounded concurrency (5 at a time)
  try {
    await runWithConcurrency<EvaluateParams>(tasks, 5, async (task) => {
      try {
        await evaluateSingle(supabase, task);
        await supabase.rpc('increment_run_completed', { p_run_id: run.id });
      } catch {
        await supabase.rpc('increment_run_errored', { p_run_id: run.id });
      }
    });

    const { data: finalRun } = await supabase
      .from('evaluation_runs')
      .select('errored, total')
      .eq('id', run.id)
      .single();
    const finalStatus = finalRun && finalRun.errored === finalRun.total ? 'error' : 'completed';
    await supabase
      .from('evaluation_runs')
      .update({ status: finalStatus, updated_at: new Date().toISOString() })
      .eq('id', run.id);
  } catch {
    await supabase.from('evaluation_runs').update({ status: 'error' }).eq('id', run.id);
  }

  return NextResponse.json({ runId: run.id, total });
}
