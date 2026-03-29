import { describe, expect, it } from 'bun:test';
import { createSubmissionDetailResponse, SubmissionDetailError } from './submission-detail';

function createQueue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-uuid-1',
    queue_id: 'queue-external-1',
    created_at: '2026-03-28T12:00:00.000Z',
    ...overrides,
  };
}

function createSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'submission-uuid-1',
    queue_id: 'queue-uuid-1',
    external_id: 'submission-external-1',
    labeling_task_id: 'task-1',
    submitted_at: '2026-03-28T12:05:00.000Z',
    created_at: '2026-03-28T12:05:00.000Z',
    ...overrides,
  };
}

function createQuestionTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'question-uuid-1',
    queue_id: 'queue-uuid-1',
    external_id: 'question-external-1',
    question_type: 'short_text',
    question_text: 'What happened?',
    created_at: '2026-03-28T12:01:00.000Z',
    ...overrides,
  };
}

function createSubmissionAnswer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'answer-uuid-1',
    submission_id: 'submission-uuid-1',
    question_template_id: 'question-uuid-1',
    answer_json: { value: 'The reviewer supplied an answer.' },
    created_at: '2026-03-28T12:06:00.000Z',
    ...overrides,
  };
}

function createSubmissionAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-row-1',
    submission_id: 'submission-uuid-1',
    external_attachment_id: 'attachment-external-1',
    source_kind: 'inline_base64',
    file_name: 'evidence.pdf',
    media_type: 'application/pdf',
    byte_size: 1024,
    storage_status: 'stored',
    storage_error: null,
    created_at: '2026-03-28T12:04:00.000Z',
    ...overrides,
  };
}

describe('createSubmissionDetailResponse', () => {
  it('keeps the full queue question set authoritative, preserves created_at ordering, and marks missing answers explicitly', () => {
    const response = createSubmissionDetailResponse({
      queue: createQueue(),
      submission: createSubmission(),
      questionTemplates: [
        createQuestionTemplate({
          id: 'question-uuid-2',
          external_id: 'question-external-2',
          question_text: 'Second question?',
          created_at: '2026-03-28T12:03:00.000Z',
        }),
        createQuestionTemplate({
          id: 'question-uuid-1',
          external_id: 'question-external-1',
          question_text: 'First question?',
          created_at: '2026-03-28T12:01:00.000Z',
        }),
        createQuestionTemplate({
          id: 'question-uuid-3',
          external_id: 'question-external-3',
          question_text: 'Third question?',
          created_at: '2026-03-28T12:05:00.000Z',
        }),
      ],
      submissionAnswers: [
        createSubmissionAnswer({
          question_template_id: 'question-uuid-2',
          answer_json: { value: 'Answered second.' },
        }),
      ],
      submissionAttachments: [],
    });

    expect(response.queue).toEqual({
      id: 'queue-uuid-1',
      queue_id: 'queue-external-1',
      created_at: '2026-03-28T12:00:00.000Z',
    });
    expect(response.submission).toEqual({
      id: 'submission-uuid-1',
      queue_id: 'queue-uuid-1',
      external_id: 'submission-external-1',
      labeling_task_id: 'task-1',
      submitted_at: '2026-03-28T12:05:00.000Z',
      created_at: '2026-03-28T12:05:00.000Z',
    });
    expect(response.summary).toEqual({
      totalQuestions: 3,
      answeredQuestions: 1,
      missingQuestions: 2,
    });
    expect(response.questions).toEqual([
      {
        id: 'question-uuid-1',
        external_id: 'question-external-1',
        question_type: 'short_text',
        question_text: 'First question?',
        created_at: '2026-03-28T12:01:00.000Z',
        answerState: 'missing',
        answer: null,
        rawAnswer: null,
      },
      {
        id: 'question-uuid-2',
        external_id: 'question-external-2',
        question_type: 'short_text',
        question_text: 'Second question?',
        created_at: '2026-03-28T12:03:00.000Z',
        answerState: 'answered',
        answer: 'Answered second.',
        rawAnswer: { value: 'Answered second.' },
      },
      {
        id: 'question-uuid-3',
        external_id: 'question-external-3',
        question_type: 'short_text',
        question_text: 'Third question?',
        created_at: '2026-03-28T12:05:00.000Z',
        answerState: 'missing',
        answer: null,
        rawAnswer: null,
      },
    ]);
    expect(response.attachments).toEqual([]);
  });

  it('normalizes one truthful attachment entry per persisted row and keeps ordering stable', () => {
    const response = createSubmissionDetailResponse({
      queue: createQueue(),
      submission: createSubmission(),
      questionTemplates: [createQuestionTemplate()],
      submissionAnswers: [],
      submissionAttachments: [
        createSubmissionAttachment({
          id: 'attachment-row-2',
          external_attachment_id: 'attachment-external-2',
          file_name: 'second.png',
          media_type: 'image/png',
          byte_size: 2048,
          storage_status: 'unavailable',
          storage_error: 'Object is not currently retrievable.',
          created_at: '2026-03-28T12:07:00.000Z',
        }),
        createSubmissionAttachment({
          id: 'attachment-row-1',
          external_attachment_id: 'attachment-external-1',
          file_name: 'first.pdf',
          media_type: 'application/pdf',
          byte_size: 1024,
          storage_status: 'stored',
          storage_error: null,
          created_at: '2026-03-28T12:04:00.000Z',
        }),
        createSubmissionAttachment({
          id: 'attachment-row-3',
          external_attachment_id: 'attachment-external-3',
          file_name: 'third.txt',
          media_type: 'text/plain',
          byte_size: 512,
          storage_status: 'error',
          storage_error: 'Storage metadata could not be refreshed.',
          created_at: '2026-03-28T12:08:00.000Z',
        }),
      ],
    });

    expect(response.attachments).toEqual([
      {
        id: 'attachment-row-1',
        external_attachment_id: 'attachment-external-1',
        source_kind: 'inline_base64',
        file_name: 'first.pdf',
        media_type: 'application/pdf',
        byte_size: 1024,
        storage_status: 'stored',
        storage_error: null,
      },
      {
        id: 'attachment-row-2',
        external_attachment_id: 'attachment-external-2',
        source_kind: 'inline_base64',
        file_name: 'second.png',
        media_type: 'image/png',
        byte_size: 2048,
        storage_status: 'unavailable',
        storage_error: 'Object is not currently retrievable.',
      },
      {
        id: 'attachment-row-3',
        external_attachment_id: 'attachment-external-3',
        source_kind: 'inline_base64',
        file_name: 'third.txt',
        media_type: 'text/plain',
        byte_size: 512,
        storage_status: 'error',
        storage_error: 'Storage metadata could not be refreshed.',
      },
    ]);
  });

  it('matches answers by question_template_id instead of external_id lookalikes', () => {
    const response = createSubmissionDetailResponse({
      queue: createQueue(),
      submission: createSubmission(),
      questionTemplates: [
        createQuestionTemplate({
          id: 'question-uuid-alpha',
          external_id: 'shared-external-id',
          question_text: 'Alpha question',
          created_at: '2026-03-28T12:01:00.000Z',
        }),
        createQuestionTemplate({
          id: 'question-uuid-beta',
          external_id: 'shared-external-id',
          question_text: 'Beta question',
          created_at: '2026-03-28T12:02:00.000Z',
        }),
      ],
      submissionAnswers: [
        createSubmissionAnswer({
          question_template_id: 'question-uuid-beta',
          answer_json: { value: 'Beta answer' },
        }),
      ],
      submissionAttachments: [],
    });

    expect(response.questions.map((question) => [question.id, question.answerState, question.answer])).toEqual([
      ['question-uuid-alpha', 'missing', null],
      ['question-uuid-beta', 'answered', 'Beta answer'],
    ]);
  });

  it('keeps raw answer objects while normalizing only conservative scalar or scalar-array values', () => {
    const response = createSubmissionDetailResponse({
      queue: createQueue(),
      submission: createSubmission(),
      questionTemplates: [createQuestionTemplate()],
      submissionAnswers: [
        createSubmissionAnswer({
          answer_json: {
            value: { nested: 'too-rich-for-normalized-answer' },
            label: 'Nested answer payload',
          },
        }),
      ],
      submissionAttachments: [],
    });

    expect(response.questions[0]).toMatchObject({
      answerState: 'answered',
      answer: null,
      rawAnswer: {
        value: { nested: 'too-rich-for-normalized-answer' },
        label: 'Nested answer payload',
      },
    });
  });

  it('rejects malformed answer payloads before runtime consumers can render them', () => {
    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [createSubmissionAnswer({ answer_json: null })],
        submissionAttachments: [],
      })
    ).toThrow(SubmissionDetailError);

    try {
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [createSubmissionAnswer({ answer_json: null })],
        submissionAttachments: [],
      });
      throw new Error('Expected malformed answer_json to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(SubmissionDetailError);
      expect((error as SubmissionDetailError).publicMessage).toBe('Malformed submission detail returned from storage.');
    }
  });

  it('rejects duplicate answer collisions and orphaned answer rows', () => {
    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [
          createSubmissionAnswer({ id: 'answer-uuid-1', question_template_id: 'question-uuid-1' }),
          createSubmissionAnswer({ id: 'answer-uuid-2', question_template_id: 'question-uuid-1' }),
        ],
        submissionAttachments: [],
      })
    ).toThrow('duplicate answers');

    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [
          createSubmissionAnswer({
            id: 'answer-uuid-3',
            question_template_id: 'question-uuid-missing',
          }),
        ],
        submissionAttachments: [],
      })
    ).toThrow('did not match any queue question');
  });

  it('rejects malformed attachment rows instead of silently omitting them', () => {
    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
        submissionAttachments: [createSubmissionAttachment({ submission_id: 'submission-uuid-2' })],
      })
    ).toThrow('belongs to submission submission-uuid-2');

    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
        submissionAttachments: [createSubmissionAttachment({ file_name: '' })],
      })
    ).toThrow('submission_attachment.file_name');

    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
        submissionAttachments: [createSubmissionAttachment({ storage_status: 'pending' })],
      })
    ).toThrow('submission_attachment.storage_status');

    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
        submissionAttachments: [
          createSubmissionAttachment({ id: 'attachment-row-dup' }),
          createSubmissionAttachment({
            id: 'attachment-row-dup',
            external_attachment_id: 'attachment-external-2',
          }),
        ],
      })
    ).toThrow('duplicate attachment ids');
  });

  it('rejects impossible stored attachment error combinations', () => {
    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
        submissionAttachments: [
          createSubmissionAttachment({
            storage_status: 'stored',
            storage_error: 'Stored attachments cannot report an error.',
          }),
        ],
      })
    ).toThrow('reported storage_status stored with a storage_error');
  });

  it('rejects mismatched queue ownership across the submission and question rows', () => {
    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue({ id: 'queue-uuid-1' }),
        submission: createSubmission({ queue_id: 'queue-uuid-2' }),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
        submissionAttachments: [],
      })
    ).toThrow('belongs to queue queue-uuid-2');

    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue({ id: 'queue-uuid-1' }),
        submission: createSubmission({ queue_id: 'queue-uuid-1' }),
        questionTemplates: [createQuestionTemplate({ queue_id: 'queue-uuid-2' })],
        submissionAnswers: [],
        submissionAttachments: [],
      })
    ).toThrow('belongs to queue queue-uuid-2');
  });
});
