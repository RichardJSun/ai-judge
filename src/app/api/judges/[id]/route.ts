import { createServiceClient } from '@/lib/supabase/server';
import {
  getReviewerDeleteRejection,
  parseJudgeRecord,
  parseJudgeUpdatePatch,
  planJudgeUpdate,
} from '@/lib/judges/judge-lifecycle';
import { NextRequest, NextResponse } from 'next/server';

function buildJudgeRouteErrorResponse(input: {
  status: number;
  error: string;
  detail?: string;
  guidance?: string;
  action?: string;
}) {
  return NextResponse.json(
    {
      error: input.error,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.guidance ? { guidance: input.guidance } : {}),
      ...(input.action ? { action: input.action } : {}),
    },
    { status: input.status }
  );
}

async function getPersistedJudge(id: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('judges')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return {
      kind: 'error' as const,
      response: buildJudgeRouteErrorResponse({
        status: 500,
        error: 'Failed to load judge.',
        detail: error.message,
        guidance: 'Retry the request after confirming the judges table is reachable.',
      }),
    };
  }

  if (!data) {
    return {
      kind: 'missing' as const,
      response: buildJudgeRouteErrorResponse({
        status: 404,
        error: 'Judge not found.',
      }),
    };
  }

  try {
    return {
      kind: 'ok' as const,
      judge: parseJudgeRecord(data, `/api/judges/${id} response`),
    };
  } catch (error) {
    return {
      kind: 'error' as const,
      response: buildJudgeRouteErrorResponse({
        status: 500,
        error: 'Judge route returned a malformed record.',
        detail: error instanceof Error ? error.message : String(error),
        guidance: 'Treat this as an API contract bug before trusting the lifecycle UI.',
      }),
    };
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const judgeResult = await getPersistedJudge(id);

  if (judgeResult.kind !== 'ok') {
    return judgeResult.response;
  }

  return NextResponse.json(judgeResult.judge);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildJudgeRouteErrorResponse({
      status: 400,
      error: 'Invalid JSON body.',
      guidance: 'Send a JSON object with one or more judge fields to update.',
    });
  }

  const parsed = parseJudgeUpdatePatch(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid judge update payload.',
        details: parsed.error.issues,
      },
      { status: 422 }
    );
  }

  const judgeResult = await getPersistedJudge(id);
  if (judgeResult.kind !== 'ok') {
    return judgeResult.response;
  }

  const updatePlan = planJudgeUpdate(judgeResult.judge, parsed.data);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('judges')
    .update(updatePlan.databasePatch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return buildJudgeRouteErrorResponse({
      status: 500,
      error: `Failed to ${updatePlan.action} judge.`,
      detail: error.message,
      guidance: 'Retry the save. The persisted judge record was left unchanged.',
      action: updatePlan.action,
    });
  }

  if (!data) {
    return buildJudgeRouteErrorResponse({
      status: 500,
      error: 'Judge update did not return a persisted record.',
      guidance: 'Retry the save after confirming the judges table still returns rows.',
      action: updatePlan.action,
    });
  }

  try {
    return NextResponse.json(parseJudgeRecord(data, `PATCH /api/judges/${id} response`));
  } catch (error) {
    return buildJudgeRouteErrorResponse({
      status: 500,
      error: 'Judge update returned a malformed record.',
      detail: error instanceof Error ? error.message : String(error),
      guidance: 'Treat this as an API contract bug before trusting the updated lifecycle state.',
      action: updatePlan.action,
    });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const rejection = getReviewerDeleteRejection();

  return NextResponse.json(rejection, {
    status: rejection.status,
    headers: {
      Allow: 'GET, PATCH',
    },
  });
}
