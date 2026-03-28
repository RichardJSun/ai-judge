import {
  parseQueueAssignmentList,
  QueueAssignmentStateError,
} from '@/lib/assignments/queue-assignment-state';
import { createServiceClient } from '@/lib/supabase/server';
import { CreateAssignmentSchema, DeleteAssignmentSchema } from '@/lib/validators/assignment';
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
      { error: 'Failed to load queue assignments.', detail: error.message },
      { status: 500 }
    );
  }

  try {
    const assignments = parseQueueAssignmentList(data ?? [], {
      context: `/api/queues/${id}/assignments response`,
      requireQuestion: true,
    });

    return NextResponse.json(assignments);
  } catch (error) {
    if (error instanceof QueueAssignmentStateError) {
      return NextResponse.json(
        { error: error.publicMessage, detail: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json({ error: 'Failed to load queue assignments.' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = CreateAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('judge_assignments')
    .upsert(
      {
        queue_id: id,
        question_template_id: parsed.data.question_template_id,
        judge_id: parsed.data.judge_id,
        prompt_fields: parsed.data.prompt_fields,
        attachment_forwarding: parsed.data.attachment_forwarding,
      },
      { onConflict: 'queue_id,question_template_id,judge_id' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to save assignment.', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = DeleteAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('judge_assignments')
    .delete()
    .eq('queue_id', id)
    .eq('question_template_id', parsed.data.question_template_id)
    .eq('judge_id', parsed.data.judge_id);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to remove assignment.', detail: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
