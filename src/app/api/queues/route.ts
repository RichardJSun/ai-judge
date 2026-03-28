import { createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createServiceClient();

  const { data: queues, error } = await supabase
    .from('queues')
    .select('id, queue_id, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type QueueRow = { id: string; queue_id: string; created_at: string };
  const queueRows = (queues ?? []) as QueueRow[];
  const queueIds = queueRows.map((q) => q.id);
  if (queueIds.length === 0) return NextResponse.json([]);

  const [subCounts, qtCounts] = await Promise.all([
    supabase
      .from('submissions')
      .select('queue_id')
      .in('queue_id', queueIds),
    supabase
      .from('question_templates')
      .select('queue_id')
      .in('queue_id', queueIds),
  ]);

  const subMap = new Map<string, number>();
  const qtMap = new Map<string, number>();
  for (const r of (subCounts.data ?? []) as Array<{ queue_id: string }>) {
    subMap.set(r.queue_id, (subMap.get(r.queue_id) ?? 0) + 1);
  }
  for (const r of (qtCounts.data ?? []) as Array<{ queue_id: string }>) {
    qtMap.set(r.queue_id, (qtMap.get(r.queue_id) ?? 0) + 1);
  }

  const result = queueRows.map((q) => ({
    ...q,
    submission_count: subMap.get(q.id) ?? 0,
    question_count: qtMap.get(q.id) ?? 0,
  }));

  return NextResponse.json(result);
}
