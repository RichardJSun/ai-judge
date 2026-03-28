import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { runId } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('evaluation_runs')
    .select('status, total, completed, errored')
    .eq('id', runId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}
