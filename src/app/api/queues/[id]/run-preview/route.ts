import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Get all assignments with question info
  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('question_template_id, question_templates(question_text)')
    .eq('queue_id', id);

  if (!assignments?.length) {
    return NextResponse.json({ total: 0, breakdown: [] });
  }

  // Get unique assigned question template IDs
  const assignedQtIds = [...new Set(assignments.map((a: { question_template_id: string }) => a.question_template_id))];

  // Count how many submissions have answers for each question template
  const { data: answerCounts } = await supabase
    .from('submission_answers')
    .select('question_template_id, submission_id')
    .in('question_template_id', assignedQtIds);

  const answersPerQuestion = new Map<string, number>();
  for (const row of answerCounts ?? []) {
    answersPerQuestion.set(
      row.question_template_id,
      (answersPerQuestion.get(row.question_template_id) ?? 0) + 1
    );
  }

  // Group assignments by question
  const byQuestion = new Map<string, { questionText: string; judgeCount: number }>();
  for (const a of assignments) {
    const qtRaw = a.question_templates;
    const qt = (Array.isArray(qtRaw) ? qtRaw[0] : qtRaw) as { question_text: string } | null;
    if (!qt) continue;
    const existing = byQuestion.get(a.question_template_id);
    if (existing) {
      existing.judgeCount++;
    } else {
      byQuestion.set(a.question_template_id, { questionText: qt.question_text, judgeCount: 1 });
    }
  }

  const breakdown = [...byQuestion.entries()].map(([qtId, { questionText, judgeCount }]) => ({
    questionText,
    judgeCount,
    submissionsWithAnswers: answersPerQuestion.get(qtId) ?? 0,
  }));

  const total = breakdown.reduce(
    (sum, b) => sum + b.judgeCount * b.submissionsWithAnswers,
    0
  );

  return NextResponse.json({ total, breakdown });
}
