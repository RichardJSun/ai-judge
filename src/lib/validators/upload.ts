import { z } from 'zod';
import {
  MAX_SUBMISSION_ATTACHMENT_BYTES,
  MAX_SUBMISSION_ATTACHMENT_TOTAL_BYTES,
  SUPPORTED_SUBMISSION_ATTACHMENT_MEDIA_TYPES,
} from '@/lib/submissions/attachment-storage';

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const RawQuestionSchema = z.object({
  rev: z.number(),
  data: z
    .object({
      id: z.string(),
      questionType: z.string().optional(),
      questionText: z.string(),
    })
    .passthrough(),
});

const InlineAttachmentSourceSchema = z
  .object({
    kind: z.string().min(1),
    base64: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.kind !== 'inline_base64') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'Unsupported attachment source kind. Only inline_base64 is supported in this slice.',
      });
      return;
    }

    if (typeof value.base64 !== 'string' || value.base64.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['base64'],
        message: 'Inline attachments must include a non-empty base64 payload.',
      });
      return;
    }

    const normalized = normalizeBase64(value.base64);
    if (!BASE64_PATTERN.test(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['base64'],
        message: 'Inline attachments must contain valid base64 content.',
      });
      return;
    }

    try {
      Buffer.from(normalized, 'base64');
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['base64'],
        message: 'Inline attachments must contain decodable base64 content.',
      });
    }
  })
  .transform((value) => ({
    kind: 'inline_base64' as const,
    base64: typeof value.base64 === 'string' ? normalizeBase64(value.base64) : '',
  }));

const RawSubmissionAttachmentSchema = z
  .object({
    id: z.string().trim().min(1, 'Attachment id is required.'),
    fileName: z.string().trim().min(1, 'Attachment fileName is required.'),
    mediaType: z
      .string()
      .trim()
      .min(1, 'Attachment mediaType is required.')
      .refine(
        (value) => SUPPORTED_SUBMISSION_ATTACHMENT_MEDIA_TYPES.includes(value as never),
        `Unsupported attachment mediaType. Supported values: ${SUPPORTED_SUBMISSION_ATTACHMENT_MEDIA_TYPES.join(', ')}`
      ),
    byteSize: z.number().int().positive('Attachment byteSize must be greater than zero.'),
    source: InlineAttachmentSourceSchema,
  })
  .superRefine((value, ctx) => {
    if (typeof value.source?.base64 !== 'string' || value.source.base64.length === 0) {
      return;
    }

    const decodedByteSize = getBase64ByteSize(value.source.base64);

    if (decodedByteSize !== value.byteSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['byteSize'],
        message: `Attachment byteSize ${value.byteSize} does not match decoded content size ${decodedByteSize}.`,
      });
    }

    if (decodedByteSize > MAX_SUBMISSION_ATTACHMENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['byteSize'],
        message: `Attachment exceeds the ${MAX_SUBMISSION_ATTACHMENT_BYTES} byte per-file limit.`,
      });
    }
  });

export const RawSubmissionSchema = z
  .object({
    id: z.string(),
    queueId: z.string(),
    labelingTaskId: z.string().optional(),
    createdAt: z.number().optional(),
    questions: z.array(RawQuestionSchema),
    answers: z.record(z.string(), z.record(z.string(), z.unknown())),
    attachments: z.array(RawSubmissionAttachmentSchema).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const attachments = value.attachments ?? [];
    const seen = new Set<string>();
    let totalBytes = 0;

    for (const [index, attachment] of attachments.entries()) {
      if (seen.has(attachment.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attachments', index, 'id'],
          message: `Duplicate attachment id ${attachment.id}.`,
        });
      }
      seen.add(attachment.id);
      totalBytes += attachment.byteSize;
    }

    if (totalBytes > MAX_SUBMISSION_ATTACHMENT_TOTAL_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: `Attachments exceed the ${MAX_SUBMISSION_ATTACHMENT_TOTAL_BYTES} byte total limit for one submission.`,
      });
    }
  });

export const SubmissionFileSchema = z.array(RawSubmissionSchema);

export type ValidatedSubmission = z.infer<typeof RawSubmissionSchema>;

function normalizeBase64(value: string) {
  return value.replace(/\s+/g, '');
}

function getBase64ByteSize(value: string) {
  const normalized = normalizeBase64(value);
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return (normalized.length * 3) / 4 - padding;
}
