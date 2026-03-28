-- Enums
CREATE TYPE verdict_enum AS ENUM ('pass', 'fail', 'inconclusive');
CREATE TYPE run_status_enum AS ENUM ('pending', 'running', 'completed', 'error', 'cancelled');
CREATE TYPE eval_status_enum AS ENUM ('pending', 'running', 'completed', 'error');

-- Queues
CREATE TABLE queues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id   text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Submissions
CREATE TABLE submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id         uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  external_id      text NOT NULL,
  labeling_task_id text,
  submitted_at     timestamptz,
  raw_json         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, external_id)
);

CREATE INDEX idx_submissions_queue_id ON submissions(queue_id);

-- Question Templates
CREATE TABLE question_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id      uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  question_type text,
  question_text text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, external_id)
);

CREATE INDEX idx_question_templates_queue_id ON question_templates(queue_id);

-- Submission Answers
CREATE TABLE submission_answers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id        uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_template_id uuid NOT NULL REFERENCES question_templates(id) ON DELETE CASCADE,
  answer_json          jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, question_template_id)
);

CREATE INDEX idx_submission_answers_question_template_id ON submission_answers(question_template_id);

-- Judges
CREATE TABLE judges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  system_prompt text NOT NULL,
  model         text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Judge Assignments
CREATE TABLE judge_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id             uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  question_template_id uuid NOT NULL REFERENCES question_templates(id) ON DELETE CASCADE,
  judge_id             uuid NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  prompt_fields        jsonb NOT NULL DEFAULT '["questionText","answer"]',
  attachment_forwarding boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, question_template_id, judge_id)
);

CREATE INDEX idx_judge_assignments_queue_id_question ON judge_assignments(queue_id, question_template_id);
CREATE INDEX idx_judge_assignments_judge_id ON judge_assignments(judge_id);

-- Evaluation Runs
CREATE TABLE evaluation_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id   uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  status     run_status_enum NOT NULL DEFAULT 'pending',
  total      integer NOT NULL DEFAULT 0,
  completed  integer NOT NULL DEFAULT 0,
  errored    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_evaluation_runs_queue_id ON evaluation_runs(queue_id);

-- Evaluations
CREATE TABLE evaluations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               uuid NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  submission_id        uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_template_id uuid NOT NULL REFERENCES question_templates(id) ON DELETE CASCADE,
  judge_id             uuid NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  status               eval_status_enum NOT NULL DEFAULT 'pending',
  verdict              verdict_enum,
  reasoning            text,
  prompt_snapshot      text,
  model_used           text,
  tokens_used          integer,
  latency_ms           integer,
  retry_count          integer NOT NULL DEFAULT 0,
  error_message        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, submission_id, question_template_id, judge_id)
);

CREATE INDEX idx_evaluations_run_id ON evaluations(run_id);
CREATE INDEX idx_evaluations_judge_id ON evaluations(judge_id);
CREATE INDEX idx_evaluations_question_template_id ON evaluations(question_template_id);
CREATE INDEX idx_evaluations_verdict ON evaluations(verdict);
CREATE INDEX idx_evaluations_submission_id ON evaluations(submission_id);
CREATE INDEX idx_evaluations_created_at ON evaluations(created_at DESC);

-- Atomic counter RPCs to prevent race conditions
CREATE OR REPLACE FUNCTION increment_run_completed(p_run_id uuid) RETURNS void AS $$
  UPDATE evaluation_runs
  SET completed = completed + 1,
      updated_at = now()
  WHERE id = p_run_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION increment_run_errored(p_run_id uuid) RETURNS void AS $$
  UPDATE evaluation_runs
  SET errored = errored + 1,
      updated_at = now()
  WHERE id = p_run_id;
$$ LANGUAGE sql;
