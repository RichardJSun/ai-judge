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

export interface EvaluationWithRelations extends Evaluation {
  submission: Pick<Submission, 'id' | 'external_id'>;
  question: Pick<QuestionTemplate, 'id' | 'external_id' | 'question_text'>;
  judge: Pick<Judge, 'id' | 'name' | 'model'>;
}

export interface ResultsResponse {
  evaluations: EvaluationWithRelations[];
  total: number;
  passRate: number;
  page: number;
  pageSize: number;
}

export interface RunPreviewResponse {
  total: number;
  breakdown: { questionText: string; judgeCount: number }[];
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
