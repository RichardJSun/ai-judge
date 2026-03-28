import {
  getActiveQueueAssignments,
  getInactiveQueueAssignments,
  parseQueueAssignmentList,
  QueueAssignmentStateError,
  summarizeAssignmentsByQuestion,
} from '@/lib/assignments/queue-assignment-state';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('judge_assignments')
    .select(
      'id, queue_id, question_template_id, judge_id, prompt_fields, attachment_forwarding, created_at, judges(id, name, model, active), question_templates(id, external_id, question_text, question_type, created_at)'
    )
    .eq('queue_id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load queue assignments for preview.', detail: error.message },
      { status: 500 }
    );
  }

  try {
    const assignments = parseQueueAssignmentList(data ?? [], {
      context: `/api/queues/${id}/run-preview assignments`,
      requireQuestion: true,
    });

    if (!assignments.length) {
      return NextResponse.json({ total: 0, breakdown: [], inactiveAssignmentCount: 0 });
    }

    const activeAssignments = getActiveQueueAssignments(assignments);
    const inactiveAssignments = getInactiveQueueAssignments(assignments);
    const summaryByQuestion = summarizeAssignmentsByQuestion(assignments);

    const assignedQtIds = [...new Set(activeAssignments.map((assignment) => assignment.question_template_id))];

    const { data: answerCounts, error: answerError } = assignedQtIds.length
      ? await supabase
          .from('submission_answers')
          .select('question_template_id, submission_id')
          .in('question_template_id', assignedQtIds)
      : { data: [], error: null };

    if (answerError) {
      return NextResponse.json(
        { error: 'Failed to load submission answers for preview.', detail: answerError.message },
        { status: 500 }
      );
    }

    const answersPerQuestion = new Map<string, number>();
    for (const row of answerCounts ?? []) {
      answersPerQuestion.set(
        row.question_template_id,
        (answersPerQuestion.get(row.question_template_id) ?? 0) + 1
      );
    }

    const breakdown = [...summaryByQuestion.entries()].map(
      ([questionTemplateId, { questionText, activeJudgeCount, inactiveJudgeCount }]) => ({
        questionText,
        judgeCount: activeJudgeCount,
        excludedInactiveJudgeCount: inactiveJudgeCount,
        submissionsWithAnswers: answersPerQuestion.get(questionTemplateId) ?? 0,
      })
    );

    const total = breakdown.reduce(
      (sum, item) => sum + item.judgeCount * item.submissionsWithAnswers,
      0
    );

    return NextResponse.json({
      total,
      inactiveAssignmentCount: inactiveAssignments.length,
      breakdown: breakdown.map(({ questionText, judgeCount, excludedInactiveJudgeCount }) => ({
        questionText,
        judgeCount,
        excludedInactiveJudgeCount,
      })),
    });
  } catch (error) {
    if (error instanceof QueueAssignmentStateError) {
      return NextResponse.json(
        { error: error.publicMessage, detail: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json({ error: 'Failed to load queue preview.' }, { status: 500 });
  }
}
