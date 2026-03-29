import type { SupabaseClient } from '@supabase/supabase-js';

export const SUBMISSION_ATTACHMENT_STORAGE_BUCKET = 'submission-attachments';
export const MAX_SUBMISSION_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_SUBMISSION_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024;

export const SUPPORTED_SUBMISSION_ATTACHMENT_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
] as const;

export type SupportedSubmissionAttachmentMediaType =
  (typeof SUPPORTED_SUBMISSION_ATTACHMENT_MEDIA_TYPES)[number];

export interface UploadSubmissionAttachmentInput {
  attachmentId: string;
  mediaType: string;
  bytes: Uint8Array;
  submissionId: string;
  signal?: AbortSignal;
}

export interface UploadedSubmissionAttachmentObject {
  bucket: string;
  path: string;
  fullPath: string;
}

export interface DownloadSubmissionAttachmentInput {
  attachmentId: string;
  externalAttachmentId: string;
  storageBucket: string;
  storagePath: string;
  byteSize: number;
  fileName: string;
  mediaType: string;
}

export interface DownloadedSubmissionAttachment {
  attachmentId: string;
  externalAttachmentId: string;
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export class SubmissionAttachmentStorageError extends Error {
  readonly attachmentId: string;
  readonly bucket: string;
  readonly path: string;
  readonly detail: string;
  readonly status: number;

  constructor({
    attachmentId,
    bucket,
    path,
    detail,
    message,
    status,
  }: {
    attachmentId: string;
    bucket: string;
    path: string;
    detail: string;
    message: string;
    status: number;
  }) {
    super(message);
    this.name = 'SubmissionAttachmentStorageError';
    this.attachmentId = attachmentId;
    this.bucket = bucket;
    this.path = path;
    this.detail = detail;
    this.status = status;
  }
}

export function createSubmissionAttachmentStoragePath({
  submissionId,
  attachmentId,
}: {
  submissionId: string;
  attachmentId: string;
}) {
  return `submissions/${submissionId}/attachments/${attachmentId}`;
}

export async function uploadSubmissionAttachment(
  supabase: SupabaseClient,
  input: UploadSubmissionAttachmentInput
): Promise<UploadedSubmissionAttachmentObject> {
  const bucket = SUBMISSION_ATTACHMENT_STORAGE_BUCKET;
  const path = createSubmissionAttachmentStoragePath({
    submissionId: input.submissionId,
    attachmentId: input.attachmentId,
  });

  if (input.signal?.aborted) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: 'Attachment upload was aborted before the storage write started.',
      message: `Attachment ${input.attachmentId} storage write timed out before upload began.`,
      status: 504,
    });
  }

  const uploadPromise = supabase.storage.from(bucket).upload(path, input.bytes, {
    contentType: input.mediaType,
    upsert: true,
  });

  const result = await raceWithAbort(
    uploadPromise,
    input.signal,
    () =>
      new SubmissionAttachmentStorageError({
        attachmentId: input.attachmentId,
        bucket,
        path,
        detail: 'Attachment upload was aborted while the storage write was in flight.',
        message: `Attachment ${input.attachmentId} storage write timed out.`,
        status: 504,
      })
  );

  if (result.error) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: result.error.message,
      message: `Attachment ${input.attachmentId} failed to upload to durable storage.`,
      status: 500,
    });
  }

  if (!result.data || typeof result.data.path !== 'string' || result.data.path.length === 0) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: 'Supabase Storage returned a success response without a usable object path.',
      message: `Attachment ${input.attachmentId} returned an invalid durable-storage response.`,
      status: 500,
    });
  }

  const fullPath =
    typeof result.data.fullPath === 'string' && result.data.fullPath.length > 0
      ? result.data.fullPath
      : `${bucket}/${result.data.path}`;

  return {
    bucket,
    path: result.data.path,
    fullPath,
  };
}

export async function downloadSubmissionAttachment(
  supabase: SupabaseClient,
  input: DownloadSubmissionAttachmentInput
): Promise<DownloadedSubmissionAttachment> {
  const { storageBucket: bucket, storagePath: path } = input;
  const downloadResult = await supabase.storage.from(bucket).download(path);
  const { data, error } = downloadResult ?? {};

  if (error) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: getStorageErrorMessage(error),
      message: `Attachment ${input.externalAttachmentId} failed to download from durable storage.`,
      status: getStorageStatusCode(error),
    });
  }

  if (!data) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: 'Supabase Storage returned no blob data during download.',
      message: `Attachment ${input.externalAttachmentId} storage object could not be retrieved.`,
      status: 500,
    });
  }

  const bytes = await resolveBlobBytes(data);

  if (bytes.length === 0) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: 'Downloaded attachment blob is empty.',
      message: `Attachment ${input.externalAttachmentId} storage object is empty.`,
      status: 500,
    });
  }

  if (input.byteSize > 0 && bytes.length !== input.byteSize) {
    throw new SubmissionAttachmentStorageError({
      attachmentId: input.attachmentId,
      bucket,
      path,
      detail: `Downloaded blob size ${bytes.length} does not match expected ${input.byteSize}.`,
      message: `Attachment ${input.externalAttachmentId} storage object size mismatch.`,
      status: 500,
    });
  }

  return {
    attachmentId: input.attachmentId,
    externalAttachmentId: input.externalAttachmentId,
    fileName: input.fileName,
    mediaType: input.mediaType,
    bytes,
  };
}

async function resolveBlobBytes(data: { arrayBuffer(): Promise<ArrayBuffer> }) {
  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}

function getStorageStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number | string }).status;
    if (typeof status === 'number') {
      return status;
    }
    if (typeof status === 'string' && !Number.isNaN(Number(status))) {
      return Number(status);
    }

    const statusCode = (error as { statusCode?: number | string }).statusCode;
    if (typeof statusCode === 'number') {
      return statusCode;
    }
    if (typeof statusCode === 'string' && !Number.isNaN(Number(statusCode))) {
      return Number(statusCode);
    }
  }

  return 500;
}

function getStorageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Storage download failed.';
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, createAbortError: () => Error) {
  if (!signal) {
    return await promise;
  }

  if (signal.aborted) {
    throw createAbortError();
  }

  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(createAbortError());
        },
        { once: true }
      );
    }),
  ]);
}
