import {
  applyResultsFilters,
  createResultsResponse,
  DEFAULT_RESULTS_PAGE_SIZE,
  normalizeResultsFilters,
  ResultsResponseError,
} from '@/lib/results/results-response';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const SAFE_RESULTS_ERROR = 'Failed to load queue results.';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const filters = normalizeResultsFilters(request.nextUrl.searchParams, {
      pageSize: DEFAULT_RESULTS_PAGE_SIZE,
    });
    const supabase = createServiceClient();

    let resultsQuery = supabase
      .from('evaluations')
      .select(
        `id, verdict, reasoning, prompt_snapshot, model_used, tokens_used, latency_ms, retry_count, error_message, created_at, status,
         submissions!inner(id, external_id, queue_id),
         question_templates!inner(id, external_id, question_text),
         judges!inner(id, name, model)`,
        { count: 'exact' }
      )
      .eq('submissions.queue_id', id);

    resultsQuery = applyResultsFilters(resultsQuery, filters)
      .order('created_at', { ascending: false })
      .range(filters.from, filters.from + filters.pageSize - 1);

    let aggregateQuery = supabase
      .from('evaluations')
      .select(
        `judge_id, verdict, status,
         judges!inner(id, name),
         submissions!inner(queue_id)`
      )
      .eq('submissions.queue_id', id);

    aggregateQuery = applyResultsFilters(aggregateQuery, filters);

    const [results, aggregates] = await Promise.all([resultsQuery, aggregateQuery]);

    if (results.error || aggregates.error) {
      return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
    }

    const response = createResultsResponse({
      evaluationRows: results.data ?? [],
      aggregateRows: aggregates.data ?? [],
      total: results.count,
      page: filters.page,
      pageSize: filters.pageSize,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ResultsResponseError) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }

    return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
  }
}
