import type {
    Evaluation,
    EvaluationRun,
    Judge,
    JudgeAssignment,
    Queue,
    QuestionTemplate,
    Submission,
    SubmissionAttachment,
    VerdictEnum,
} from './db';

export type SubmissionDetailAnswer = string | number | boolean | null | Array<string | number | boolean>;

export interface UploadResult {
    queues: number;
    submissions: number;
    questions: number;
    answers: number;
    attachments?: number;
}

export interface QueueWithCounts extends Queue {
    submission_count: number;
    question_count: number;
}

export interface QueuePageQueue extends QueueWithCounts {
    result_count: number;
}

export interface QueuePageResponse {
    queues: QueuePageQueue[];
    total: number;
    page: number;
    pageSize: number;
}

export interface JudgePageResponse {
    judges: Judge[];
    total: number;
    page: number;
    pageSize: number;
}

export interface QueueSubmissionListItem extends Pick<Submission, 'id' | 'external_id' | 'labeling_task_id' | 'submitted_at' | 'created_at'> {}

export interface QueueSubmissionsResponse {
    submissions: QueueSubmissionListItem[];
    total: number;
    page: number;
    pageSize: number;
}

export interface QuestionWithAssignments extends QuestionTemplate {
    assignments: (JudgeAssignment & { judge: Judge })[];
}

export interface ResultsEvaluation {
    id: Evaluation['id'];
    verdict: Evaluation['verdict'];
    reasoning: Evaluation['reasoning'];
    prompt_snapshot: Evaluation['prompt_snapshot'];
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

export interface ResultsFilterJudge {
    id: Judge['id'];
    name: Judge['name'];
    model: Judge['model'];
}

export interface ResultsFilterQuestion {
    id: QuestionTemplate['id'];
    external_id: QuestionTemplate['external_id'] | null;
    question_text: QuestionTemplate['question_text'];
}

export interface ResultsFilterMetadata {
    judges: ResultsFilterJudge[];
    questions: ResultsFilterQuestion[];
    verdicts: VerdictEnum[];
}

export interface ResultsResponse {
    evaluations: ResultsEvaluation[];
    total: number;
    passRate: number;
    judgePassRates: JudgePassRate[];
    page: number;
    pageSize: number;
    filterMetadata: ResultsFilterMetadata;
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

export interface SubmissionDetailSummary {
    totalQuestions: number;
    answeredQuestions: number;
    missingQuestions: number;
}

export interface SubmissionDetailQuestion {
    id: QuestionTemplate['id'];
    external_id: QuestionTemplate['external_id'];
    question_type: QuestionTemplate['question_type'];
    question_text: QuestionTemplate['question_text'];
    created_at: QuestionTemplate['created_at'];
    answerState: 'answered' | 'missing';
    answer: SubmissionDetailAnswer;
    rawAnswer: Record<string, unknown> | null;
}

export interface SubmissionDetailAttachment {
    id: SubmissionAttachment['id'];
    external_attachment_id: SubmissionAttachment['external_attachment_id'];
    source_kind: SubmissionAttachment['source_kind'];
    file_name: SubmissionAttachment['file_name'];
    media_type: SubmissionAttachment['media_type'];
    byte_size: SubmissionAttachment['byte_size'];
    storage_status: SubmissionAttachment['storage_status'];
    storage_error: SubmissionAttachment['storage_error'];
}

export interface SubmissionDetailResponse {
    queue: Pick<Queue, 'id' | 'queue_id' | 'created_at'>;
    submission: Pick<Submission, 'id' | 'queue_id' | 'external_id' | 'labeling_task_id' | 'submitted_at' | 'created_at'>;
    summary: SubmissionDetailSummary;
    questions: SubmissionDetailQuestion[];
    attachments: SubmissionDetailAttachment[];
}
