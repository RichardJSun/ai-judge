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
      })
    ).toThrow(SubmissionDetailError);

    try {
      createSubmissionDetailResponse({
        queue: createQueue(),
        submission: createSubmission(),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [createSubmissionAnswer({ answer_json: null })],
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
      })
    ).toThrow('did not match any queue question');
  });

  it('rejects mismatched queue ownership across the submission and question rows', () => {
    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue({ id: 'queue-uuid-1' }),
        submission: createSubmission({ queue_id: 'queue-uuid-2' }),
        questionTemplates: [createQuestionTemplate()],
        submissionAnswers: [],
      })
    ).toThrow('belongs to queue queue-uuid-2');

    expect(() =>
      createSubmissionDetailResponse({
        queue: createQueue({ id: 'queue-uuid-1' }),
        submission: createSubmission({ queue_id: 'queue-uuid-1' }),
        questionTemplates: [createQuestionTemplate({ queue_id: 'queue-uuid-2' })],
        submissionAnswers: [],
      })
    ).toThrow('belongs to queue queue-uuid-2');
  });
});
