export type VerdictEnum = 'pass' | 'fail' | 'inconclusive';
export type RunStatusEnum = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
export type EvalStatusEnum = 'pending' | 'running' | 'completed' | 'error';

export interface Queue {
  id: string;
  queue_id: string;
  created_at: string;
}

export interface Submission {
  id: string;
  queue_id: string;
  external_id: string;
  labeling_task_id: string | null;
  submitted_at: string | null;
  raw_json: Record<string, unknown> | null;
  created_at: string;
}

export interface QuestionTemplate {
  id: string;
  queue_id: string;
  external_id: string;
  question_type: string | null;
  question_text: string;
  created_at: string;
}

export interface SubmissionAnswer {
  id: string;
  submission_id: string;
  question_template_id: string;
  answer_json: Record<string, unknown> | null;
  created_at: string;
}

export interface Judge {
  id: string;
  name: string;
  system_prompt: string;
  model: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JudgeAssignment {
  id: string;
  queue_id: string;
  question_template_id: string;
  judge_id: string;
  prompt_fields: string[];
  attachment_forwarding: boolean;
  created_at: string;
}

export interface EvaluationRun {
  id: string;
  queue_id: string;
  status: RunStatusEnum;
  total: number;
  completed: number;
  errored: number;
  created_at: string;
  updated_at: string;
}

export interface Evaluation {
  id: string;
  run_id: string;
  submission_id: string;
  question_template_id: string;
  judge_id: string;
  status: EvalStatusEnum;
  verdict: VerdictEnum | null;
  reasoning: string | null;
  prompt_snapshot: string | null;
  model_used: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
}
