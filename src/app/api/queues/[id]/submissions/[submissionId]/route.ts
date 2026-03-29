import { createSubmissionDetailResponse, SubmissionDetailError } from '@/lib/submissions/submission-detail';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const SUBMISSION_DETAIL_TIMEOUT_MS = 10_000;

type QueryError = {
  message: string;
};

type QueryResult<T> = {
  data: T | null;
  error: QueryError | null;
};

type AbortableQuery<T> = PromiseLike<QueryResult<T>> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<QueryResult<T>>;
};

type SubmissionDetailRouteDeps = {
  createServiceClient: typeof createServiceClient;
  timeoutMs?: number;
};

type RoutePhase = 'client' | 'queue' | 'submission' | 'questions' | 'answers' | 'attachments' | 'normalize' | 'lookup';

const defaultDeps: SubmissionDetailRouteDeps = {
  createServiceClient,
  timeoutMs: SUBMISSION_DETAIL_TIMEOUT_MS,
};

class SubmissionDetailRouteError extends Error {
  readonly status: number;
  readonly phase: RoutePhase;
  readonly publicMessage: string;
  readonly detail?: string;

  constructor(options: {
    status: number;
    phase: RoutePhase;
    publicMessage: string;
    detail?: string;
    cause?: unknown;
  }) {
    super(options.detail ?? options.publicMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SubmissionDetailRouteError';
    this.status = options.status;
    this.phase = options.phase;
    this.publicMessage = options.publicMessage;
    this.detail = options.detail;
  }
}

function buildSubmissionDetailSignal(request: Request, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any([request.signal, timeoutSignal]),
      timeoutSignal,
    };
  }

  const controller = new AbortController();
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (request.signal.aborted) {
    abort(request.signal.reason);
  } else {
    request.signal.addEventListener('abort', () => abort(request.signal.reason), { once: true });
  }

  if (timeoutSignal.aborted) {
    abort(timeoutSignal.reason);
  } else {
    timeoutSignal.addEventListener('abort', () => abort(timeoutSignal.reason), { once: true });
  }

  return {
    signal: controller.signal,
    timeoutSignal,
  };
}

function buildRouteErrorResponse(error: unknown) {
  if (error instanceof SubmissionDetailRouteError) {
    return NextResponse.json(
      {
        error: error.publicMessage,
        phase: error.phase,
        ...(error.detail ? { detail: error.detail } : {}),
      },
      { status: error.status }
    );
  }

  if (error instanceof SubmissionDetailError) {
    return NextResponse.json(
      {
        error: error.publicMessage,
        phase: 'normalize',
        detail: error.message,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: 'Failed to load submission detail.',
      phase: 'normalize',
      detail: error instanceof Error ? error.message : 'Unknown submission detail error.',
    },
    { status: 500 }
  );
}

async function runPhaseQuery<T>(
  query: AbortableQuery<T>,
  options: {
    phase: Exclude<RoutePhase, 'client' | 'normalize' | 'lookup'>;
    signal: AbortSignal;
    timeoutSignal: AbortSignal;
  }
) {
  const queryPromise = typeof query.abortSignal === 'function' ? query.abortSignal(options.signal) : query;

  const timeoutPromise = new Promise<never>((_, reject) => {
    const abort = () => {
      const detail = options.timeoutSignal.aborted
        ? `The ${options.phase} read did not finish before the route timeout.`
        : `The ${options.phase} read was aborted before a complete response was available.`;

      reject(
        new SubmissionDetailRouteError({
          status: options.timeoutSignal.aborted ? 504 : 499,
          phase: options.phase,
          publicMessage: options.timeoutSignal.aborted
            ? 'Submission detail request timed out.'
            : 'Submission detail request was aborted.',
          detail,
        })
      );
    };

    if (options.signal.aborted) {
      abort();
      return;
    }

    options.signal.addEventListener('abort', abort, { once: true });
  });

  const result = await Promise.race([queryPromise, timeoutPromise]);

  if (result.error) {
    throw new SubmissionDetailRouteError({
      status: 500,
      phase: options.phase,
      publicMessage: 'Failed to load submission detail.',
      detail: `The ${options.phase} read failed before a complete submission detail response could be built.`,
      cause: result.error,
    });
  }

  return result.data;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new SubmissionDetailError(`Expected ${label} to be an array.`);
}

export async function handleGetSubmissionDetail(
  request: Request,
  { params }: { params: Promise<{ id: string; submissionId: string }> },
  deps: SubmissionDetailRouteDeps = defaultDeps
) {
  const { id, submissionId } = await params;
  const { signal, timeoutSignal } = buildSubmissionDetailSignal(
    request,
    deps.timeoutMs ?? SUBMISSION_DETAIL_TIMEOUT_MS
  );

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = deps.createServiceClient();
  } catch (error) {
    return buildRouteErrorResponse(
      new SubmissionDetailRouteError({
        status: 500,
        phase: 'client',
        publicMessage: 'Failed to initialize submission detail storage access.',
        detail: error instanceof Error ? error.message : 'Unknown storage client error.',
        cause: error,
      })
    );
  }

  try {
    const queueQuery = supabase.from('queues').select('id, queue_id, created_at').eq('id', id).maybeSingle();
    const submissionQuery = supabase
      .from('submissions')
      .select('id, queue_id, external_id, labeling_task_id, submitted_at, created_at')
      .eq('id', submissionId)
      .eq('queue_id', id)
      .maybeSingle();
    const questionTemplatesQuery = supabase
      .from('question_templates')
      .select('id, queue_id, external_id, question_type, question_text, created_at')
      .eq('queue_id', id)
      .order('created_at', { ascending: true });
    const submissionAnswersQuery = supabase
      .from('submission_answers')
      .select('id, submission_id, question_template_id, answer_json, created_at')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: true });
    const submissionAttachmentsQuery = supabase
      .from('submission_attachments')
      .select(
        'id, submission_id, external_attachment_id, source_kind, file_name, media_type, byte_size, storage_status, storage_error, created_at'
      )
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: true });

    const [queue, submission, questionTemplates, submissionAnswers, submissionAttachments] = await Promise.all([
      runPhaseQuery(queueQuery, { phase: 'queue', signal, timeoutSignal }),
      runPhaseQuery(submissionQuery, { phase: 'submission', signal, timeoutSignal }),
      runPhaseQuery(questionTemplatesQuery, { phase: 'questions', signal, timeoutSignal }),
      runPhaseQuery(submissionAnswersQuery, { phase: 'answers', signal, timeoutSignal }),
      runPhaseQuery(submissionAttachmentsQuery, { phase: 'attachments', signal, timeoutSignal }),
    ]);

    if (!queue || !submission) {
      throw new SubmissionDetailRouteError({
        status: 404,
        phase: 'lookup',
        publicMessage: 'Submission not found for queue.',
        detail: `No submission detail row matched queue ${id} and submission ${submissionId}.`,
      });
    }

    const response = createSubmissionDetailResponse({
      queue,
      submission,
      questionTemplates: expectArray(questionTemplates, 'question templates'),
      submissionAnswers: expectArray(submissionAnswers, 'submission answers'),
      submissionAttachments: expectArray(submissionAttachments, 'submission attachments'),
    });

    return NextResponse.json(response);
  } catch (error) {
    return buildRouteErrorResponse(error);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; submissionId: string }> }
) {
  return handleGetSubmissionDetail(request, context);
}
