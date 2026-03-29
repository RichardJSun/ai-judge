import { describe, expect, it, mock } from 'bun:test';
import { scheduleRunExecution, startRun, StartRunError, type StartRunDeps } from '@/lib/run/start-run';

function createStartRunDeps(overrides: Partial<StartRunDeps> = {}) {
  const { getSubmissionAttachments: getSubmissionAttachmentsOverride, ...restOverrides } = overrides;

  const state = {
    createRunCalls: [] as Array<{ queueId: string; total: number }>,
    insertEvaluationCalls: [] as Array<
      Array<{
        runId: string;
        submissionId: string;
        questionTemplateId: string;
        judgeId: string;
        status: 'pending';
      }>
    >,
    markRunErrorCalls: [] as string[],
    getSubmissionAttachmentsCalls: [] as string[][],
  };

  const deps: StartRunDeps = {
    async getAssignments() {
      return [
        {
          question_template_id: 'question-1',
          judge_id: 'judge-1',
          prompt_fields: ['questionText', 'answer'],
          attachment_forwarding: false,
          judges: {
            id: 'judge-1',
            name: 'Judge One',
            system_prompt: 'Be precise.',
            model: 'gateway/model-a',
          },
          question_templates: {
            id: 'question-1',
            question_text: 'How would you answer?',
            question_type: 'short_text',
          },
        },
      ];
    },
    async getSubmissions() {
      return [{ id: 'submission-1', external_id: 'ext-1' }];
    },
    async getAnswers() {
      return [
        {
          submission_id: 'submission-1',
          question_template_id: 'question-1',
          answer_json: { value: 'A thoughtful answer' },
        },
      ];
    },
    async createRun(input) {
      state.createRunCalls.push(input);
      return { id: 'run-1' };
    },
    async insertEvaluations(rows) {
      state.insertEvaluationCalls.push(rows);
      return rows.map((row, index) => ({
        id: `evaluation-${index + 1}`,
        submission_id: row.submissionId,
        question_template_id: row.questionTemplateId,
        judge_id: row.judgeId,
      }));
    },
    async markRunError(runId) {
      state.markRunErrorCalls.push(runId);
    },
    async getSubmissionAttachments(submissionIds) {
      state.getSubmissionAttachmentsCalls.push([...submissionIds]);
      if (getSubmissionAttachmentsOverride) {
        return getSubmissionAttachmentsOverride(submissionIds);
      }

      return [];
    },
    ...restOverrides,
  };

  return { deps, state };
}

function createAttachmentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'attachment-first',
    submission_id: 'submission-1',
    external_attachment_id: 'attachment-external-1',
    source_kind: 'inline_base64',
    file_name: 'first.pdf',
    media_type: 'application/pdf',
    byte_size: 1024,
    storage_bucket: 'submission-attachments',
    storage_path: 'submissions/submission-1/attachments/first.pdf',
    storage_status: 'stored',
    storage_error: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('startRun', () => {
  it('fails fast when the queue has no assignments', async () => {
    const { deps, state } = createStartRunDeps({
      async getAssignments() {
        return [];
      },
    });

    await expect(startRun(deps, 'queue-1')).rejects.toMatchObject({
      name: 'StartRunError',
      status: 400,
      publicMessage: 'No judge assignments found for this queue.',
    } satisfies Partial<StartRunError>);

    expect(state.createRunCalls).toHaveLength(0);
  });

  it('fails fast when the queue has no submissions', async () => {
    const { deps, state } = createStartRunDeps({
      async getSubmissions() {
        return [];
      },
    });

    await expect(startRun(deps, 'queue-1')).rejects.toMatchObject({
      name: 'StartRunError',
      status: 400,
      publicMessage: 'No submissions in this queue.',
    } satisfies Partial<StartRunError>);

    expect(state.createRunCalls).toHaveLength(0);
  });

  it('creates one evaluation per answered submission-question-judge combination', async () => {
    const { deps, state } = createStartRunDeps({
      async getAssignments() {
        return [
          {
            question_template_id: 'question-1',
            judge_id: 'judge-1',
            prompt_fields: ['questionText', 'answer'],
            attachment_forwarding: false,
            judges: {
              id: 'judge-1',
              name: 'Judge One',
              system_prompt: 'Judge one prompt',
              model: 'gateway/model-a',
            },
            question_templates: {
              id: 'question-1',
              question_text: 'Question 1',
              question_type: 'short_text',
            },
          },
          {
            question_template_id: 'question-1',
            judge_id: 'judge-2',
            prompt_fields: ['questionText', 'answer'],
            attachment_forwarding: false,
            judges: {
              id: 'judge-2',
              name: 'Judge Two',
              system_prompt: 'Judge two prompt',
              model: 'gateway/model-b',
            },
            question_templates: {
              id: 'question-1',
              question_text: 'Question 1',
              question_type: 'short_text',
            },
          },
          {
            question_template_id: 'question-2',
            judge_id: 'judge-1',
            prompt_fields: ['questionText', 'answer'],
            attachment_forwarding: false,
            judges: {
              id: 'judge-1',
              name: 'Judge One',
              system_prompt: 'Judge one prompt',
              model: 'gateway/model-a',
            },
            question_templates: {
              id: 'question-2',
              question_text: 'Question 2',
              question_type: 'long_text',
            },
          },
        ];
      },
      async getSubmissions() {
        return [{ id: 'submission-1' }, { id: 'submission-2' }];
      },
      async getAnswers() {
        return [
          {
            submission_id: 'submission-1',
            question_template_id: 'question-1',
            answer_json: { value: 'answer one' },
          },
          {
            submission_id: 'submission-2',
            question_template_id: 'question-2',
            answer_json: { value: 'answer two' },
          },
        ];
      },
      async createRun(input) {
        state.createRunCalls.push(input);
        return { id: 'run-42' };
      },
    });

    const started = await startRun(deps, 'queue-1');

    expect(state.createRunCalls).toEqual([{ queueId: 'queue-1', total: 3 }]);
    expect(state.insertEvaluationCalls).toEqual([
      [
        {
          runId: 'run-42',
          submissionId: 'submission-1',
          questionTemplateId: 'question-1',
          judgeId: 'judge-1',
          status: 'pending',
        },
        {
          runId: 'run-42',
          submissionId: 'submission-1',
          questionTemplateId: 'question-1',
          judgeId: 'judge-2',
          status: 'pending',
        },
        {
          runId: 'run-42',
          submissionId: 'submission-2',
          questionTemplateId: 'question-2',
          judgeId: 'judge-1',
          status: 'pending',
        },
      ],
    ]);
    expect(started).toMatchObject({ runId: 'run-42', total: 3 });
    expect(started.tasks.map((task) => task.evaluationId)).toEqual([
      'evaluation-1',
      'evaluation-2',
      'evaluation-3',
    ]);
    expect(started.tasks.map((task) => task.judge.id)).toEqual(['judge-1', 'judge-2', 'judge-1']);
  });

  it('passes attachment manifests and forwarding intent through to prepared tasks', async () => {
    const { deps, state } = createStartRunDeps({
      async getAssignments() {
        return [
          {
            question_template_id: 'question-1',
            judge_id: 'judge-1',
            prompt_fields: ['questionText', 'answer'],
            attachment_forwarding: true,
            judges: {
              id: 'judge-1',
              name: 'Judge One',
              system_prompt: 'Judge one prompt',
              model: 'gateway/model-a',
            },
            question_templates: {
              id: 'question-1',
              question_text: 'Question 1',
              question_type: 'short_text',
            },
          },
          {
            question_template_id: 'question-2',
            judge_id: 'judge-2',
            prompt_fields: ['questionText', 'answer'],
            attachment_forwarding: false,
            judges: {
              id: 'judge-2',
              name: 'Judge Two',
              system_prompt: 'Judge two prompt',
              model: 'gateway/model-b',
            },
            question_templates: {
              id: 'question-2',
              question_text: 'Question 2',
              question_type: 'long_text',
            },
          },
        ];
      },
      async getSubmissions() {
        return [{ id: 'submission-1' }];
      },
      async getAnswers() {
        return [
          {
            submission_id: 'submission-1',
            question_template_id: 'question-1',
            answer_json: { value: 'first' },
          },
          {
            submission_id: 'submission-1',
            question_template_id: 'question-2',
            answer_json: { value: 'second' },
          },
        ];
      },
      async getSubmissionAttachments() {
        return [
          createAttachmentRow({
            id: 'attachment-first',
            created_at: '2026-01-01T00:00:00.000Z',
            external_attachment_id: 'attachment-external-1',
          }),
          createAttachmentRow({
            id: 'attachment-second',
            created_at: '2026-01-01T00:01:00.000Z',
            external_attachment_id: 'attachment-external-2',
            file_name: 'second.png',
            media_type: 'image/png',
            storage_path: 'submissions/submission-1/attachments/second.png',
          }),
        ];
      },
    });

    const started = await startRun(deps, 'queue-1');

    expect(started.tasks.map((task) => task.attachmentForwarding)).toEqual([true, false]);
    expect(started.tasks[0].attachments).toEqual([
      {
        id: 'attachment-first',
        submissionId: 'submission-1',
        externalAttachmentId: 'attachment-external-1',
        sourceKind: 'inline_base64',
        fileName: 'first.pdf',
        mediaType: 'application/pdf',
        byteSize: 1024,
        storageBucket: 'submission-attachments',
        storagePath: 'submissions/submission-1/attachments/first.pdf',
        storageStatus: 'stored',
        storageError: null,
      },
      {
        id: 'attachment-second',
        submissionId: 'submission-1',
        externalAttachmentId: 'attachment-external-2',
        sourceKind: 'inline_base64',
        fileName: 'second.png',
        mediaType: 'image/png',
        byteSize: 1024,
        storageBucket: 'submission-attachments',
        storagePath: 'submissions/submission-1/attachments/second.png',
        storageStatus: 'stored',
        storageError: null,
      },
    ]);
    expect(state.getSubmissionAttachmentsCalls).toEqual([['submission-1']]);
  });

  it('rejects attachment rows that belong to the wrong submission', async () => {
    const { deps } = createStartRunDeps({
      async getSubmissionAttachments() {
        return [createAttachmentRow({ submission_id: 'other-submission' })];
      },
    });

    await expect(startRun(deps, 'queue-1')).rejects.toMatchObject({
      name: 'StartRunError',
      status: 500,
    } satisfies Partial<StartRunError>);
  });

  it('rejects attachment rows with invalid storage status', async () => {
    const { deps } = createStartRunDeps({
      async getSubmissionAttachments() {
        return [createAttachmentRow({ storage_status: 'missing-status' })];
      },
    });

    await expect(startRun(deps, 'queue-1')).rejects.toMatchObject({
      name: 'StartRunError',
      status: 500,
    } satisfies Partial<StartRunError>);
  });

  it('rejects malformed assignment shapes before creating a run', async () => {
    const { deps, state } = createStartRunDeps({
      async getAssignments() {
        return [
          {
            question_template_id: 'question-1',
            judge_id: 'judge-1',
            prompt_fields: ['questionText', 'answer'],
            attachment_forwarding: false,
            judges: {
              id: 'judge-1',
              name: 'Judge One',
              system_prompt: 'Be precise.',
              model: 'gateway/model-a',
            },
            question_templates: null,
          },
        ];
      },
    });

    await expect(startRun(deps, 'queue-1')).rejects.toMatchObject({
      name: 'StartRunError',
      status: 500,
    } satisfies Partial<StartRunError>);
    expect(state.createRunCalls).toHaveLength(0);
  });
});

describe('scheduleRunExecution', () => {
  it('returns before the scheduled execution finishes', async () => {
    let resolveExecution = () => {};
    const executionDone = new Promise<void>((resolve) => {
      resolveExecution = resolve;
    });
    let scheduledPromise: Promise<void> | undefined;
    const execute = mock(async () => {
      await executionDone;
    });

    await scheduleRunExecution({
      schedule(work) {
        scheduledPromise = Promise.resolve(work());
      },
      execute,
      onScheduleError: mock(async () => {}),
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(scheduledPromise).toBeDefined();

    resolveExecution();
    await scheduledPromise;
  });

  it('marks the persisted run as errored when scheduling fails', async () => {
    const onScheduleError = mock(async () => {});

    await expect(
      scheduleRunExecution({
        schedule() {
          throw new Error('after failed');
        },
        execute: mock(async () => {}),
        onScheduleError,
      })
    ).rejects.toThrow('after failed');

    expect(onScheduleError).toHaveBeenCalledTimes(1);
  });
});
