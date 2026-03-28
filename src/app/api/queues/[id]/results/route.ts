import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const judgeIds = url.searchParams.getAll('judgeId');
  const questionIds = url.searchParams.getAll('questionId');
  const verdicts = url.searchParams.getAll('verdict');
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  const supabase = createServiceClient();

  // Build query with joins
  let query = supabase
    .from('evaluations')
    .select(
      `id, verdict, reasoning, model_used, tokens_used, latency_ms, retry_count, error_message, created_at, status,
       submissions!inner(id, external_id, queue_id),
       question_templates!inner(id, external_id, question_text),
       judges!inner(id, name, model)`,
      { count: 'exact' }
    )
    .eq('submissions.queue_id', id)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (judgeIds.length > 0) query = query.in('judge_id', judgeIds);
  if (questionIds.length > 0) query = query.in('question_template_id', questionIds);
  if (verdicts.length > 0) query = query.in('verdict', verdicts);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate pass rate using count queries (avoids loading all rows)
  let completedQuery = supabase
    .from('evaluations')
    .select('id, submissions!inner(queue_id)', { count: 'exact', head: true })
    .eq('submissions.queue_id', id)
    .eq('status', 'completed');

  let passQuery = supabase
    .from('evaluations')
    .select('id, submissions!inner(queue_id)', { count: 'exact', head: true })
    .eq('submissions.queue_id', id)
    .eq('status', 'completed')
    .eq('verdict', 'pass');

  if (judgeIds.length > 0) {
    completedQuery = completedQuery.in('judge_id', judgeIds);
    passQuery = passQuery.in('judge_id', judgeIds);
  }
  if (questionIds.length > 0) {
    completedQuery = completedQuery.in('question_template_id', questionIds);
    passQuery = passQuery.in('question_template_id', questionIds);
  }
  if (verdicts.length > 0) {
    completedQuery = completedQuery.in('verdict', verdicts);
    passQuery = passQuery.in('verdict', verdicts);
  }

  // Per-judge aggregate: completed and pass counts
  const judgeStatsQuery = supabase
    .from('evaluations')
    .select('judge_id, verdict, judges!inner(name), submissions!inner(queue_id)')
    .eq('submissions.queue_id', id)
    .eq('status', 'completed');

  const [{ count: totalCompleted }, { count: totalPass }, { data: judgeStatsRaw }] = await Promise.all([
    completedQuery,
    passQuery,
    judgeStatsQuery,
  ]);
  const passRate = totalCompleted ? Math.round(((totalPass ?? 0) / totalCompleted) * 100) : 0;

  // Build per-judge pass rate
  const judgeAgg = new Map<string, { name: string; total: number; pass: number }>();
  for (const row of judgeStatsRaw ?? []) {
    const judgeRaw = row.judges;
    const judge = (Array.isArray(judgeRaw) ? judgeRaw[0] : judgeRaw) as { name: string } | null;
    if (!judge) continue;
    const entry = judgeAgg.get(row.judge_id) ?? { name: judge.name, total: 0, pass: 0 };
    entry.total++;
    if (row.verdict === 'pass') entry.pass++;
    judgeAgg.set(row.judge_id, entry);
  }
  const judgePassRates = [...judgeAgg.values()].map((j) => ({
    name: j.name,
    passRate: j.total > 0 ? Math.round((j.pass / j.total) * 100) : 0,
    total: j.total,
  }));

  return NextResponse.json({
    evaluations: data ?? [],
    total: count ?? 0,
    passRate,
    judgePassRates,
    page,
    pageSize,
  });
}
