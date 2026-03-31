import { normalizeListPageRequest, resolveListPage } from '@/lib/pagination/list-page';
import { parseJudgeList } from '@/lib/judges/judge-lifecycle';
import { createServiceClient } from '@/lib/supabase/server';
import { CreateJudgeSchema } from '@/lib/validators/judge';
import type { JudgePageResponse } from '@/types/api';
import { NextRequest, NextResponse } from 'next/server';

const SAFE_JUDGES_ERROR = 'Failed to load judges.';

type JudgesRouteDeps = {
  createServiceClient: typeof createServiceClient;
};

const defaultDeps: JudgesRouteDeps = {
  createServiceClient,
};

function isRangeNotSatisfiable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'PGRST103';
}

async function fetchJudgeTotal(supabase: ReturnType<typeof createServiceClient>) {
  const { count, error } = await supabase.from('judges').select('id', { count: 'exact', head: true });

  if (error) {
    throw new Error('Failed to load judge count.');
  }

  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

async function runPagedJudgeQuery(
  supabase: ReturnType<typeof createServiceClient>,
  page: { from: number; to: number }
) {
  return await supabase
    .from('judges')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page.from, page.to);
}

function resolvePagedJudgeTotal(count: number | null | undefined, rows: unknown[] | null | undefined) {
  if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
    return count;
  }

  if ((rows ?? []).length === 0) {
    return 0;
  }

  throw new Error('Failed to resolve paged judge total.');
}

export async function handleGetJudges(request: NextRequest, deps: JudgesRouteDeps = defaultDeps) {
  try {
    const supabase = deps.createServiceClient();
    const searchParams = new URL(request.url).searchParams;
    const hasExplicitPage = searchParams.has('page');

    if (!hasExplicitPage) {
      const { data, error } = await supabase
        .from('judges')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: SAFE_JUDGES_ERROR }, { status: 500 });
      }

      return NextResponse.json(parseJudgeList(data ?? [], '/api/judges response'));
    }

    const requestedPage = normalizeListPageRequest(searchParams);
    let pagedResult = await runPagedJudgeQuery(supabase, requestedPage);
    let resolvedPage;

    if (pagedResult.error) {
      if (!isRangeNotSatisfiable(pagedResult.error)) {
        return NextResponse.json({ error: SAFE_JUDGES_ERROR }, { status: 500 });
      }

      resolvedPage = resolveListPage(requestedPage, await fetchJudgeTotal(supabase));

      if (resolvedPage.total === 0) {
        const emptyResponse: JudgePageResponse = {
          judges: [],
          total: 0,
          page: resolvedPage.page,
          pageSize: resolvedPage.pageSize,
        };

        return NextResponse.json(emptyResponse);
      }

      pagedResult = await runPagedJudgeQuery(supabase, resolvedPage);

      if (pagedResult.error) {
        return NextResponse.json({ error: SAFE_JUDGES_ERROR }, { status: 500 });
      }
    } else {
      resolvedPage = resolveListPage(requestedPage, resolvePagedJudgeTotal(pagedResult.count, pagedResult.data ?? []));

      if (resolvedPage.wasClamped && resolvedPage.total > 0) {
        pagedResult = await runPagedJudgeQuery(supabase, resolvedPage);

        if (pagedResult.error) {
          return NextResponse.json({ error: SAFE_JUDGES_ERROR }, { status: 500 });
        }
      }
    }

    const judges = parseJudgeList(pagedResult.data ?? [], `/api/judges?page=${resolvedPage.page} response`);
    const response: JudgePageResponse = {
      judges,
      total: resolvedPage.total,
      page: resolvedPage.page,
      pageSize: resolvedPage.pageSize,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: SAFE_JUDGES_ERROR }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleGetJudges(request);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = CreateJudgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('judges').insert(parsed.data).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
