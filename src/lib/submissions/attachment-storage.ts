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
