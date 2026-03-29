-- Submission attachment storage status
CREATE TYPE attachment_storage_status_enum AS ENUM ('stored', 'unavailable', 'error');

-- Durable reviewer attachments
CREATE TABLE submission_attachments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id          uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  external_attachment_id text NOT NULL,
  source_kind            text NOT NULL,
  file_name              text NOT NULL,
  media_type             text NOT NULL,
  byte_size              bigint NOT NULL CHECK (byte_size > 0),
  storage_bucket         text NOT NULL,
  storage_path           text NOT NULL,
  storage_status         attachment_storage_status_enum NOT NULL DEFAULT 'stored',
  storage_error          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, external_attachment_id)
);

CREATE INDEX idx_submission_attachments_submission_id
  ON submission_attachments(submission_id, created_at, id);

CREATE INDEX idx_submission_attachments_status
  ON submission_attachments(storage_status);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submission-attachments',
  'submission-attachments',
  false,
  8388608,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
