import { describe, expect, it } from 'bun:test';
import {
  buildVisibleJudgeRoster,
  DEFAULT_PROMPT_FIELDS,
  getActiveQueueAssignments,
  getInactiveQueueAssignments,
  getQuestionPromptFieldDefaults,
  hydrateQuestionsWithAssignments,
  parseQueueAssignmentList,
  parseQueueQuestionList,
  QueueAssignmentStateError,
  summarizeAssignmentsByQuestion,
} from '@/lib/assignments/queue-assignment-state';

function makeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-1',
    queue_id: 'queue-1',
    question_template_id: 'question-1',
    judge_id: 'judge-1',
    prompt_fields: ['questionText', 'answer'],
    attachment_forwarding: false,
    created_at: '2026-03-28T00:00:00.000Z',
    judges: {
      id: 'judge-1',
      name: 'Judge One',
      model: 'gateway/model-a',
      active: true,
      system_prompt: 'Be precise.',
    },
    question_templates: {
      id: 'question-1',
      external_id: 'Q1',
      question_text: 'How would you answer?',
      question_type: 'short_text',
      created_at: '2026-03-28T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('parseQueueAssignmentList', () => {
  it('normalizes active and inactive persisted assignments', () => {
    const assignments = parseQueueAssignmentList([
      makeAssignment(),
      makeAssignment({
        id: 'assignment-2',
        judge_id: 'judge-2',
        prompt_fields: null,
        judges: [
          {
            id: 'judge-2',
            name: 'Judge Two',
            model: 'gateway/model-b',
            active: false,
            system_prompt: 'Be strict.',
          },
        ],
      }),
    ], {
      context: 'assignment fixture',
      requireQuestion: true,
      requireJudgeSystemPrompt: true,
    });

    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toMatchObject({
      question_template_id: 'question-1',
      judge_id: 'judge-1',
      judge_status: 'active',
      prompt_fields: ['questionText', 'answer'],
    });
    expect(assignments[1]).toMatchObject({
      judge_id: 'judge-2',
      judge_status: 'inactive',
      prompt_fields: [...DEFAULT_PROMPT_FIELDS],
    });
  });

  it('rejects malformed prompt field payloads', () => {
    expect(() =>
      parseQueueAssignmentList([
        makeAssignment({
          prompt_fields: ['questionText', 42],
        }),
      ])
    ).toThrowError(QueueAssignmentStateError);
  });

  it('rejects missing judge system prompts when the run path requires them', () => {
    expect(() =>
      parseQueueAssignmentList(
        [
          makeAssignment({
            judges: {
              id: 'judge-1',
              name: 'Judge One',
              model: 'gateway/model-a',
              active: true,
            },
          }),
        ],
        { requireJudgeSystemPrompt: true }
      )
    ).toThrowError(QueueAssignmentStateError);
  });
});

describe('hydrateQuestionsWithAssignments', () => {
  it('hydrates question rows and sorts active assignments ahead of inactive ones', () => {
    const assignments = parseQueueAssignmentList([
      makeAssignment({
        judge_id: 'judge-2',
        judges: {
          id: 'judge-2',
          name: 'Judge Two',
          model: 'gateway/model-b',
          active: false,
          system_prompt: 'Inactive judge.',
        },
      }),
      makeAssignment(),
    ]);

    const questions = hydrateQuestionsWithAssignments(
      [
        {
          id: 'question-1',
          external_id: 'Q1',
          question_text: 'How would you answer?',
          question_type: 'short_text',
          created_at: '2026-03-28T00:00:00.000Z',
        },
      ],
      assignments
    );

    expect(questions).toHaveLength(1);
    expect(questions[0].assignments.map((assignment) => assignment.judge_id)).toEqual([
      'judge-1',
      'judge-2',
    ]);
  });

  it('fails when a persisted assignment points at a missing question row', () => {
    const assignments = parseQueueAssignmentList([makeAssignment()]);

    expect(() => hydrateQuestionsWithAssignments([], assignments)).toThrowError(
      QueueAssignmentStateError
    );
  });
});

describe('parseQueueQuestionList', () => {
  it('rejects malformed hydrated question payloads instead of hiding bad rows', () => {
    expect(() =>
      parseQueueQuestionList([
        {
          id: 'question-1',
          external_id: 'Q1',
          question_text: 'How would you answer?',
          question_type: 'short_text',
          created_at: '2026-03-28T00:00:00.000Z',
          assignments: {},
        },
      ])
    ).toThrowError(QueueAssignmentStateError);
  });

  it('keeps attachment_forwarding values when parsing queued question assignments', () => {
    const questions = parseQueueQuestionList([
      {
        id: 'question-1',
        external_id: 'Q1',
        question_text: 'How would you answer?',
        question_type: 'short_text',
        created_at: '2026-03-28T00:00:00.000Z',
        assignments: [makeAssignment({ attachment_forwarding: true })],
      },
    ]);

    expect(questions[0].assignments[0].attachment_forwarding).toBe(true);
  });
});

describe('derived assignment state', () => {
  it('builds a visible judge roster with active judges and inactive assigned judges only', () => {
    const assignments = parseQueueAssignmentList([
      makeAssignment(),
      makeAssignment({
        id: 'assignment-2',
        judge_id: 'judge-2',
        judges: {
          id: 'judge-2',
          name: 'Judge Two',
          model: 'gateway/model-b',
          active: false,
          system_prompt: 'Inactive judge.',
        },
      }),
    ]);

    const roster = buildVisibleJudgeRoster(
      [
        {
          id: 'judge-1',
          name: 'Judge One',
          model: 'gateway/model-a',
          active: true,
        },
        {
          id: 'judge-3',
          name: 'Judge Three',
          model: 'gateway/model-c',
          active: true,
        },
        {
          id: 'judge-4',
          name: 'Judge Four',
          model: 'gateway/model-d',
          active: false,
        },
      ],
      assignments
    );

    expect(roster.map((judge) => judge.id)).toEqual(['judge-1', 'judge-3', 'judge-2']);
    expect(roster[2]).toMatchObject({ inactive_assigned: true, persisted_assignment_count: 1 });
  });

  it('prefers active prompt fields when deriving question defaults', () => {
    const assignments = parseQueueAssignmentList([
      makeAssignment({
        judge_id: 'judge-2',
        prompt_fields: ['questionType'],
        judges: {
          id: 'judge-2',
          name: 'Judge Two',
          model: 'gateway/model-b',
          active: false,
          system_prompt: 'Inactive judge.',
        },
      }),
      makeAssignment({ prompt_fields: ['questionText', 'questionType'] }),
    ]);

    expect(getQuestionPromptFieldDefaults(assignments)).toEqual({
      'question-1': ['questionText', 'questionType'],
    });
  });

  it('splits active and inactive assignments and summarizes preview counts truthfully', () => {
    const assignments = parseQueueAssignmentList([
      makeAssignment(),
      makeAssignment({
        id: 'assignment-2',
        judge_id: 'judge-2',
        judges: {
          id: 'judge-2',
          name: 'Judge Two',
          model: 'gateway/model-b',
          active: false,
          system_prompt: 'Inactive judge.',
        },
      }),
      makeAssignment({
        id: 'assignment-3',
        question_template_id: 'question-2',
        question_templates: {
          id: 'question-2',
          external_id: 'Q2',
          question_text: 'Why?',
          question_type: 'short_text',
          created_at: '2026-03-28T00:00:00.000Z',
        },
      }),
    ], {
      requireQuestion: true,
    });

    expect(getActiveQueueAssignments(assignments).map((assignment) => assignment.id)).toEqual([
      'assignment-1',
      'assignment-3',
    ]);
    expect(getInactiveQueueAssignments(assignments).map((assignment) => assignment.id)).toEqual([
      'assignment-2',
    ]);
    expect([...summarizeAssignmentsByQuestion(assignments).entries()]).toEqual([
      [
        'question-1',
        {
          questionText: 'How would you answer?',
          activeJudgeCount: 1,
          inactiveJudgeCount: 1,
        },
      ],
      [
        'question-2',
        {
          questionText: 'Why?',
          activeJudgeCount: 1,
          inactiveJudgeCount: 0,
        },
      ],
    ]);
  });
});

describe('attachment forwarding state', () => {
  it('preserves explicit attachment_forwarding values through parse and hydration', () => {
    const assignments = parseQueueAssignmentList([
      makeAssignment({ attachment_forwarding: true }),
    ]);

    expect(assignments[0].attachment_forwarding).toBe(true);

    const hydrated = hydrateQuestionsWithAssignments(
      [
        {
          id: 'question-1',
          external_id: 'Q1',
          question_text: 'How would you answer?',
          question_type: 'short_text',
          created_at: '2026-03-28T00:00:00.000Z',
        },
      ],
      assignments
    );

    expect(hydrated[0].assignments[0].attachment_forwarding).toBe(true);
  });

  it('defaults missing attachment_forwarding payloads to false while keeping hydration aligned', () => {
    const rowWithoutField = makeAssignment();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (rowWithoutField as any).attachment_forwarding;

    const assignments = parseQueueAssignmentList([rowWithoutField]);

    expect(assignments[0].attachment_forwarding).toBe(false);

    const hydrated = hydrateQuestionsWithAssignments(
      [
        {
          id: 'question-1',
          external_id: 'Q1',
          question_text: 'How would you answer?',
          question_type: 'short_text',
          created_at: '2026-03-28T00:00:00.000Z',
        },
      ],
      assignments
    );

    expect(hydrated[0].assignments[0].attachment_forwarding).toBe(false);
  });
});
