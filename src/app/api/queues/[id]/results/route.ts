import {
  applyResultsFilters,
  createResultsResponse,
  DEFAULT_RESULTS_PAGE_SIZE,
  normalizeResultsFilters,
  resolveResultsPage,
  ResultsResponseError,
  type ResultsQueryFilters,
} from '@/lib/results/results-response';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const SAFE_RESULTS_ERROR = 'Failed to load queue results.';

type ResultsRouteDeps = {
  createServiceClient: typeof createServiceClient;
};

const defaultDeps: ResultsRouteDeps = {
  createServiceClient,
};

function isRangeNotSatisfiable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'PGRST103';
}

function buildPagedResultsQuery(
  supabase: ReturnType<typeof createServiceClient>,
  queueId: string,
  filters: Pick<ResultsQueryFilters, 'judgeIds' | 'questionIds' | 'verdicts' | 'from' | 'to'>
) {
  let query = supabase
    .from('evaluations')
    .select(
      `id, verdict, reasoning, prompt_snapshot, model_used, tokens_used, latency_ms, retry_count, error_message, created_at, status,
       submissions!inner(id, external_id, queue_id),
       question_templates!inner(id, external_id, question_text),
       judges!inner(id, name, model)`,
      { count: 'exact' }
    )
    .eq('submissions.queue_id', queueId);

  query = applyResultsFilters(query, filters)
    .order('created_at', { ascending: false })
    .range(filters.from, filters.to);

  return query;
}

function buildAggregateQuery(
  supabase: ReturnType<typeof createServiceClient>,
  queueId: string,
  filters: Pick<ResultsQueryFilters, 'judgeIds' | 'questionIds' | 'verdicts'>
) {
  const query = supabase
    .from('evaluations')
    .select(
      `judge_id, verdict, status,
       judges!inner(id, name),
       submissions!inner(queue_id)`
    )
    .eq('submissions.queue_id', queueId);

  return applyResultsFilters(query, filters);
}

function buildFilterMetadataQuery(supabase: ReturnType<typeof createServiceClient>, queueId: string) {
  return supabase
    .from('evaluations')
    .select(
      `verdict,
       submissions!inner(queue_id),
       question_templates!inner(id, external_id, question_text),
       judges!inner(id, name, model)`
    )
    .eq('submissions.queue_id', queueId);
}

async function fetchResultsTotal(
  supabase: ReturnType<typeof createServiceClient>,
  queueId: string,
  filters: Pick<ResultsQueryFilters, 'judgeIds' | 'questionIds' | 'verdicts'>
) {
  let query = supabase
    .from('evaluations')
    .select('id, submissions!inner(queue_id)', { count: 'exact', head: true })
    .eq('submissions.queue_id', queueId);

  query = applyResultsFilters(query, filters);

  const { count, error } = await query;

  if (error) {
    throw new Error('Failed to load results count.');
  }

  return count;
}

export async function handleGetResults(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  deps: ResultsRouteDeps = defaultDeps
) {
  const { id } = await params;

  try {
    const filters = normalizeResultsFilters(new URL(request.url).searchParams, {
      pageSize: DEFAULT_RESULTS_PAGE_SIZE,
    });
    const supabase = deps.createServiceClient();
    const aggregatePromise = buildAggregateQuery(supabase, id, filters);
    const filterMetadataPromise = buildFilterMetadataQuery(supabase, id);
    let results = await buildPagedResultsQuery(supabase, id, filters);
    let resolvedPage;

    if (results.error) {
      if (!isRangeNotSatisfiable(results.error)) {
        return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
      }

      resolvedPage = resolveResultsPage(filters, await fetchResultsTotal(supabase, id, filters));
      results = await buildPagedResultsQuery(supabase, id, { ...filters, ...resolvedPage });

      if (results.error) {
        return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
      }
    } else {
      resolvedPage = resolveResultsPage(filters, results.count);

      if (resolvedPage.wasClamped && resolvedPage.total > 0) {
        results = await buildPagedResultsQuery(supabase, id, { ...filters, ...resolvedPage });

        if (results.error) {
          return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
        }
      }
    }

    const [aggregates, filterMetadata] = await Promise.all([aggregatePromise, filterMetadataPromise]);

    if (aggregates.error || filterMetadata.error) {
      return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
    }

    const response = createResultsResponse({
      queueId: id,
      evaluationRows: results.data ?? [],
      aggregateRows: aggregates.data ?? [],
      filterMetadataRows: filterMetadata.data ?? [],
      total: resolvedPage.total,
      page: resolvedPage.page,
      pageSize: resolvedPage.pageSize,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ResultsResponseError) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }

    return NextResponse.json({ error: SAFE_RESULTS_ERROR }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleGetResults(request, context);
}
