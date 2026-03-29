export const SUPPORTED_MODELS = [
  'zai/glm-4.7-flashx',
  'deepseek/deepseek-v3.2',
  'alibaba/qwen-3-235b',
  'xai/grok-4.1-fast-non-reasoning',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash',
  'meta/llama-4-scout',
  'meta/llama-4-maverick',
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];
export type SubmissionAttachmentSourceKind = 'inline_base64';

export interface RawQuestion {
  rev: number;
  data: {
    id: string;
    questionType?: string;
    questionText: string;
    [key: string]: unknown;
  };
}

export interface RawSubmissionAttachmentSource {
  kind: SubmissionAttachmentSourceKind;
  base64: string;
}

export interface RawSubmissionAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  source: RawSubmissionAttachmentSource;
}

export interface RawSubmission {
  id: string;
  queueId: string;
  labelingTaskId?: string;
  createdAt?: number;
  questions: RawQuestion[];
  answers: Record<string, Record<string, unknown>>;
  attachments?: RawSubmissionAttachment[];
  [key: string]: unknown;
}
