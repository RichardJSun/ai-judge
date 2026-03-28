import {
  hydrateQuestionsWithAssignments,
  parseQueueAssignmentList,
  QueueAssignmentStateError,
} from '@/lib/assignments/queue-assignment-state';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const [questionsResult, assignmentsResult] = await Promise.all([
    supabase
      .from('question_templates')
      .select('id, external_id, question_type, question_text, created_at')
      .eq('queue_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('judge_assignments')
      .select(
        'id, queue_id, question_template_id, judge_id, prompt_fields, attachment_forwarding, created_at, judges(id, name, model, active)'
      )
      .eq('queue_id', id),
  ]);

  if (questionsResult.error) {
    return NextResponse.json(
      { error: 'Failed to load queue questions.', detail: questionsResult.error.message },
      { status: 500 }
    );
  }

  if (assignmentsResult.error) {
    return NextResponse.json(
      { error: 'Failed to load queue assignments.', detail: assignmentsResult.error.message },
      { status: 500 }
    );
  }

  try {
    const assignments = parseQueueAssignmentList(assignmentsResult.data ?? [], {
      context: `/api/queues/${id}/questions assignments`,
    });
    const hydratedQuestions = hydrateQuestionsWithAssignments(questionsResult.data ?? [], assignments);

    return NextResponse.json(hydratedQuestions);
  } catch (error) {
    if (error instanceof QueueAssignmentStateError) {
      return NextResponse.json(
        { error: error.publicMessage, detail: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json({ error: 'Failed to load queue questions.' }, { status: 500 });
  }
}
