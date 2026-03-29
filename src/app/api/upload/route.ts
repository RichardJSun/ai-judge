import { NextResponse } from 'next/server';
import {
  persistSubmissions,
  UploadPersistenceError,
  type PersistSubmissionsOptions,
} from '@/lib/parsers/submission';
import { createServiceClient } from '@/lib/supabase/server';
import { SubmissionFileSchema } from '@/lib/validators/upload';

export const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TIMEOUT_MS = 15_000;

type UploadHandlerDeps = {
  createServiceClient: typeof createServiceClient;
  persistSubmissions: (
    supabase: ReturnType<typeof createServiceClient>,
    items: Parameters<typeof persistSubmissions>[1],
    options?: PersistSubmissionsOptions
  ) => ReturnType<typeof persistSubmissions>;
  timeoutMs?: number;
};

const defaultDeps: UploadHandlerDeps = {
  createServiceClient,
  persistSubmissions,
  timeoutMs: UPLOAD_TIMEOUT_MS,
};

function buildUploadSignal(request: Request, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([request.signal, timeoutSignal]);
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

  return controller.signal;
}

export function buildUploadErrorResponse(error: unknown) {
  if (error instanceof UploadPersistenceError) {
    return NextResponse.json(
      {
        error: error.message,
        phase: error.phase,
        table: error.table,
        detail: error.detail,
        guidance: error.guidance,
        attachmentId: error.attachmentId,
        storageBucket: error.storageBucket,
        storagePath: error.storagePath,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: 'Upload failed unexpectedly.',
      phase: 'upload',
      detail: error instanceof Error ? error.message : 'Unknown upload error.',
    },
    { status: 500 }
  );
}

export async function handleUpload(request: Request, deps: UploadHandlerDeps = defaultDeps) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 413 }
      );
    }

    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON file' }, { status: 400 });
    }

    const parsed = SubmissionFileSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid submission format',
          details: parsed.error.issues,
        },
        { status: 422 }
      );
    }

    const signal = buildUploadSignal(request, deps.timeoutMs ?? UPLOAD_TIMEOUT_MS);
    const supabase = deps.createServiceClient();
    const counts = await deps.persistSubmissions(supabase, parsed.data, { signal });

    return NextResponse.json(counts);
  } catch (error) {
    console.error('Upload error:', error);
    return buildUploadErrorResponse(error);
  }
}

export async function POST(request: Request) {
  return handleUpload(request);
}
