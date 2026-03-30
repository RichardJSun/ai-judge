import { normalizeListPageRequest, resolveListPage, type RequestedListPage } from '@/lib/pagination/list-page';
import { createServiceClient } from '@/lib/supabase/server';
import type { QueueSubmissionsResponse } from '@/types/api';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SAFE_QUEUE_SUBMISSIONS_ERROR = 'Failed to load queue submissions.';
const QUEUE_SUBMISSIONS_PAGE_SIZE = 20;

const QueueSubmissionRowSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().min(1),
  labeling_task_id: z.string().min(1).nullable(),
  submitted_at: z.string().min(1).nullable(),
  created_at: z.string().min(1),
});

type QueueSubmissionRow = z.infer<typeof QueueSubmissionRowSchema>;

type QueueSubmissionsRouteDeps = {
  createServiceClient: typeof createServiceClient;
};

const defaultDeps: QueueSubmissionsRouteDeps = {
  createServiceClient,
};

function isRangeNotSatisfiable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'PGRST103';
}

function parseQueueSubmissionRows(value: unknown, context: string): QueueSubmissionRow[] {
  const parsed = z.array(QueueSubmissionRowSchema).safeParse(value);

  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

async function fetchQueueSubmissionTotal(
  supabase: ReturnType<typeof createServiceClient>,
  queueId: string
) {
  const { count, error } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('queue_id', queueId);

  if (error) {
    throw new Error('Failed to load queue submissions count.');
  }

  return count;
}

async function runPagedQueueSubmissionsQuery(
  supabase: ReturnType<typeof createServiceClient>,
  queueId: string,
  page: Pick<RequestedListPage, 'from' | 'to'>
) {
  return await supabase
    .from('submissions')
    .select('id, external_id, labeling_task_id, submitted_at, created_at', { count: 'exact' })
    .eq('queue_id', queueId)
    .order('created_at', { ascending: false })
    .range(page.from, page.to);
}

export async function handleGetQueueSubmissions(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  deps: QueueSubmissionsRouteDeps = defaultDeps
) {
  const { id } = await params;

  try {
    const requestedPage = normalizeListPageRequest(new URL(request.url).searchParams, {
      pageSize: QUEUE_SUBMISSIONS_PAGE_SIZE,
    });
    const supabase = deps.createServiceClient();
    let pagedResult = await runPagedQueueSubmissionsQuery(supabase, id, requestedPage);
    let resolvedPage;

    if (pagedResult.error) {
      if (!isRangeNotSatisfiable(pagedResult.error)) {
        return NextResponse.json({ error: SAFE_QUEUE_SUBMISSIONS_ERROR }, { status: 500 });
      }

      resolvedPage = resolveListPage(requestedPage, await fetchQueueSubmissionTotal(supabase, id));
      pagedResult = await runPagedQueueSubmissionsQuery(supabase, id, resolvedPage);

      if (pagedResult.error) {
        return NextResponse.json({ error: SAFE_QUEUE_SUBMISSIONS_ERROR }, { status: 500 });
      }
    } else {
      resolvedPage = resolveListPage(requestedPage, pagedResult.count);

      if (resolvedPage.wasClamped && resolvedPage.total > 0) {
        pagedResult = await runPagedQueueSubmissionsQuery(supabase, id, resolvedPage);

        if (pagedResult.error) {
          return NextResponse.json({ error: SAFE_QUEUE_SUBMISSIONS_ERROR }, { status: 500 });
        }
      }
    }

    const response: QueueSubmissionsResponse = {
      submissions: parseQueueSubmissionRows(
        pagedResult.data ?? [],
        `/api/queues/${id}/submissions?page=${resolvedPage.page} response`
      ),
      total: resolvedPage.total,
      page: resolvedPage.page,
      pageSize: resolvedPage.pageSize,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: SAFE_QUEUE_SUBMISSIONS_ERROR }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleGetQueueSubmissions(request, context);
}
