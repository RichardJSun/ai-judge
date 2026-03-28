import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: questions, error } = await supabase
    .from('question_templates')
    .select('id, external_id, question_type, question_text, created_at')
    .eq('queue_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch assignments with judge info for each question
  const questionRows = (questions ?? []) as Array<{
    id: string;
    external_id: string;
    question_type: string | null;
    question_text: string;
    created_at: string;
  }>;
  const questionIds = questionRows.map((q) => q.id);
  if (questionIds.length === 0) return NextResponse.json([]);

  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('id, question_template_id, judge_id, prompt_fields, attachment_forwarding, created_at, judges(id, name, model, active)')
    .eq('queue_id', id)
    .in('question_template_id', questionIds);

  const assignMap = new Map<string, typeof assignments>();
  for (const a of assignments ?? []) {
    const list = assignMap.get(a.question_template_id) ?? [];
    list.push(a);
    assignMap.set(a.question_template_id, list);
  }

  const result = questionRows.map((q) => ({
    ...q,
    assignments: assignMap.get(q.id) ?? [],
  }));

  return NextResponse.json(result);
}
