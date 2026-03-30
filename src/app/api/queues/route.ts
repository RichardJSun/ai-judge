import { normalizeListPageRequest, resolveListPage } from '@/lib/pagination/list-page';
import { createServiceClient } from '@/lib/supabase/server';
import type { QueuePageResponse, QueueWithCounts } from '@/types/api';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SAFE_QUEUES_ERROR = 'Failed to load queues.';

const QueueRowSchema = z.object({
  id: z.string().min(1),
  queue_id: z.string().min(1),
  created_at: z.string().min(1),
});

const QueueCountRowSchema = z.object({
  queue_id: z.string().min(1),
});

type QueueRow = z.infer<typeof QueueRowSchema>;
type QueueCountRow = z.infer<typeof QueueCountRowSchema>;

type QueuesRouteDeps = {
  createServiceClient: typeof createServiceClient;
};

const defaultDeps: QueuesRouteDeps = {
  createServiceClient,
};

function isRangeNotSatisfiable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'PGRST103';
}

async function fetchQueueTotal(supabase: ReturnType<typeof createServiceClient>) {
  const { count, error } = await supabase.from('queues').select('id', { count: 'exact', head: true });

  if (error) {
    throw new Error('Failed to load queue count.');
  }

  return count;
}

function parseQueueRows(value: unknown, context: string): QueueRow[] {
  const parsed = z.array(QueueRowSchema).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  return parsed.data;
}

function parseScopedCountRows(value: unknown, allowedQueueIds: Set<string>, context: string): QueueCountRow[] {
  const parsed = z.array(QueueCountRowSchema).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Malformed ${context}: ${parsed.error.message}`);
  }

  for (const row of parsed.data) {
    if (!allowedQueueIds.has(row.queue_id)) {
      throw new Error(`Malformed ${context}: queue_id ${row.queue_id} was not part of the visible page.`);
    }
  }

  return parsed.data;
}

async function fetchQueueCounts(
  supabase: ReturnType<typeof createServiceClient>,
  queueRows: QueueRow[]
): Promise<QueueWithCounts[]> {
  if (queueRows.length === 0) {
    return [];
  }

  const queueIds = queueRows.map((queue) => queue.id);
  const visibleQueueIds = new Set(queueIds);
  const [submissionCounts, questionCounts] = await Promise.all([
    supabase.from('submissions').select('queue_id').in('queue_id', queueIds),
    supabase.from('question_templates').select('queue_id').in('queue_id', queueIds),
  ]);

  if (submissionCounts.error || questionCounts.error) {
    throw new Error('Failed to load derived queue counts.');
  }

  const submissionRows = parseScopedCountRows(
    submissionCounts.data ?? [],
    visibleQueueIds,
    '/api/queues submission counts response'
  );
  const questionRows = parseScopedCountRows(
    questionCounts.data ?? [],
    visibleQueueIds,
    '/api/queues question counts response'
  );

  const submissionCountByQueueId = new Map<string, number>();
  const questionCountByQueueId = new Map<string, number>();

  for (const row of submissionRows) {
    submissionCountByQueueId.set(row.queue_id, (submissionCountByQueueId.get(row.queue_id) ?? 0) + 1);
  }

  for (const row of questionRows) {
    questionCountByQueueId.set(row.queue_id, (questionCountByQueueId.get(row.queue_id) ?? 0) + 1);
  }

  return queueRows.map((queue) => ({
    ...queue,
    submission_count: submissionCountByQueueId.get(queue.id) ?? 0,
    question_count: questionCountByQueueId.get(queue.id) ?? 0,
  }));
}

async function runPagedQueueQuery(
  supabase: ReturnType<typeof createServiceClient>,
  page: { from: number; to: number }
) {
  return await supabase
    .from('queues')
    .select('id, queue_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page.from, page.to);
}

export async function handleGetQueues(request: NextRequest, deps: QueuesRouteDeps = defaultDeps) {
  try {
    const supabase = deps.createServiceClient();
    const searchParams = new URL(request.url).searchParams;
    const hasExplicitPage = searchParams.has('page');

    if (!hasExplicitPage) {
      const { data, error } = await supabase
        .from('queues')
        .select('id, queue_id, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: SAFE_QUEUES_ERROR }, { status: 500 });
      }

      const queueRows = parseQueueRows(data ?? [], '/api/queues response');
      return NextResponse.json(await fetchQueueCounts(supabase, queueRows));
    }

    const requestedPage = normalizeListPageRequest(searchParams);
    let pagedResult = await runPagedQueueQuery(supabase, requestedPage);
    let resolvedPage;

    if (pagedResult.error) {
      if (!isRangeNotSatisfiable(pagedResult.error)) {
        return NextResponse.json({ error: SAFE_QUEUES_ERROR }, { status: 500 });
      }

      resolvedPage = resolveListPage(requestedPage, await fetchQueueTotal(supabase));
      pagedResult = await runPagedQueueQuery(supabase, resolvedPage);

      if (pagedResult.error) {
        return NextResponse.json({ error: SAFE_QUEUES_ERROR }, { status: 500 });
      }
    } else {
      resolvedPage = resolveListPage(requestedPage, pagedResult.count);

      if (resolvedPage.wasClamped && resolvedPage.total > 0) {
        pagedResult = await runPagedQueueQuery(supabase, resolvedPage);

        if (pagedResult.error) {
          return NextResponse.json({ error: SAFE_QUEUES_ERROR }, { status: 500 });
        }
      }
    }

    const queueRows = parseQueueRows(pagedResult.data ?? [], `/api/queues?page=${resolvedPage.page} response`);
    const queues = await fetchQueueCounts(supabase, queueRows);
    const response: QueuePageResponse = {
      queues,
      total: resolvedPage.total,
      page: resolvedPage.page,
      pageSize: resolvedPage.pageSize,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: SAFE_QUEUES_ERROR }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleGetQueues(request);
}
