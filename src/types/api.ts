import type { Evaluation, EvaluationRun, Judge, JudgeAssignment, Queue, QuestionTemplate, Submission, VerdictEnum } from './db';

export interface UploadResult {
  queues: number;
  submissions: number;
  questions: number;
  answers: number;
}

export interface QueueWithCounts extends Queue {
  submission_count: number;
  question_count: number;
}

export interface QuestionWithAssignments extends QuestionTemplate {
  assignments: (JudgeAssignment & { judge: Judge })[];
}

export interface ResultsEvaluation {
  id: Evaluation['id'];
  verdict: Evaluation['verdict'];
  reasoning: Evaluation['reasoning'];
  model_used: Evaluation['model_used'];
  tokens_used: Evaluation['tokens_used'];
  latency_ms: Evaluation['latency_ms'];
  retry_count: Evaluation['retry_count'];
  error_message: Evaluation['error_message'];
  created_at: Evaluation['created_at'];
  status: Evaluation['status'];
  submission: Pick<Submission, 'id' | 'external_id'>;
  question: Pick<QuestionTemplate, 'id' | 'external_id' | 'question_text'>;
  judge: Pick<Judge, 'id' | 'name' | 'model'>;
}

export interface JudgePassRate {
  judgeId: Judge['id'];
  name: Judge['name'];
  passRate: number;
  total: number;
}

export interface ResultsResponse {
  evaluations: ResultsEvaluation[];
  total: number;
  passRate: number;
  judgePassRates: JudgePassRate[];
  page: number;
  pageSize: number;
}

export interface RunPreviewResponse {
  total: number;
  inactiveAssignmentCount: number;
  breakdown: {
    questionText: string;
    judgeCount: number;
    excludedInactiveJudgeCount?: number;
  }[];
}

export interface RunResponse {
  runId: string;
  total: number;
}

export interface RunProgressResponse {
  status: EvaluationRun['status'];
  total: number;
  completed: number;
  errored: number;
}

export interface CreateJudgeBody {
  name: string;
  system_prompt: string;
  model: string;
  active?: boolean;
}

export interface UpdateJudgeBody {
  name?: string;
  system_prompt?: string;
  model?: string;
  active?: boolean;
}

export interface CreateAssignmentBody {
  judge_id: string;
  question_template_id: string;
  prompt_fields?: string[];
  attachment_forwarding?: boolean;
}

export interface ResultsFilter {
  judgeId?: string[];
  questionId?: string[];
  verdict?: VerdictEnum[];
  page?: number;
}
