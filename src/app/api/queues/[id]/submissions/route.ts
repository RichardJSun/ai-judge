import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageSize = 20;
  const from = (page - 1) * pageSize;

  const supabase = createServiceClient();

  const { data, error, count } = await supabase
    .from('submissions')
    .select('id, external_id, labeling_task_id, submitted_at, created_at', { count: 'exact' })
    .eq('queue_id', id)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ submissions: data ?? [], total: count ?? 0, page, pageSize });
}
