import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { REVIEWER_TABLE_SURFACE_TEST_ID } from '@/components/layout/ReviewerTableSurface';
import type {
  QueueAssignmentRecord,
  QueueQuestionWithAssignments,
  VisibleAssignmentJudge,
} from '@/lib/assignments/queue-assignment-state';
import {
  AssignmentMatrixContent,
  fetchAssignments,
  type AssignmentMatrixContentProps,
} from './AssignmentMatrix';

const originalFetch = globalThis.fetch;

const ACTIVE_JUDGE: VisibleAssignmentJudge = {
  id: 'judge-active',
  name: 'Judge Atlas With A Very Long Visible Reviewer Name',
  model: 'gateway/model-a',
  active: true,
  inactive_assigned: false,
  persisted_assignment_count: 1,
};

const INACTIVE_JUDGE: VisibleAssignmentJudge = {
  id: 'judge-inactive',
  name: 'Judge Borealis Archived But Still Persisted',
  model: 'gateway/model-b',
  active: false,
  inactive_assigned: true,
  persisted_assignment_count: 1,
};

const ACTIVE_ASSIGNMENT: QueueAssignmentRecord = {
  id: 'assignment-1',
  queue_id: 'queue-1',
  question_template_id: 'question-1',
  judge_id: ACTIVE_JUDGE.id,
  prompt_fields: ['questionText', 'answer'],
  attachment_forwarding: true,
  created_at: '2026-03-28T12:00:00.000Z',
  judge: {
    id: ACTIVE_JUDGE.id,
    name: ACTIVE_JUDGE.name,
    model: ACTIVE_JUDGE.model,
    active: true,
  },
  question: {
    id: 'question-1',
    external_id: 'Q-001',
    question_text:
      'A reviewer-visible question with enough detail to pressure the table width at 1280px.',
    question_type: 'free_text',
    created_at: '2026-03-28T12:00:00.000Z',
  },
  judge_status: 'active',
};

const INACTIVE_ASSIGNMENT: QueueAssignmentRecord = {
  id: 'assignment-2',
  queue_id: 'queue-1',
  question_template_id: 'question-1',
  judge_id: INACTIVE_JUDGE.id,
  prompt_fields: ['questionText', 'answer', 'questionType'],
  attachment_forwarding: false,
  created_at: '2026-03-28T12:01:00.000Z',
  judge: {
    id: INACTIVE_JUDGE.id,
    name: INACTIVE_JUDGE.name,
    model: INACTIVE_JUDGE.model,
    active: false,
  },
  question: ACTIVE_ASSIGNMENT.question,
  judge_status: 'inactive',
};

const QUESTIONS: QueueQuestionWithAssignments[] = [
  {
    id: 'question-1',
    external_id: 'Q-001',
    question_text:
      'A reviewer-visible question with enough detail to pressure the table width at 1280px.',
    question_type: 'free_text',
    created_at: '2026-03-28T12:00:00.000Z',
    assignments: [ACTIVE_ASSIGNMENT, INACTIVE_ASSIGNMENT],
  },
];

function createProps(
  overrides: Partial<AssignmentMatrixContentProps> = {}
): AssignmentMatrixContentProps {
  return {
    loading: false,
    loadError: null,
    hasPersistedState: true,
    onRetryLoads: () => undefined,
    mutationError: null,
    inactiveAssignmentCount: 1,
    questions: QUESTIONS,
    visibleJudges: [ACTIVE_JUDGE, INACTIVE_JUDGE],
    assignmentsByPair: new Map([
      [`${ACTIVE_ASSIGNMENT.question_template_id}::${ACTIVE_ASSIGNMENT.judge_id}`, ACTIVE_ASSIGNMENT],
      [`${INACTIVE_ASSIGNMENT.question_template_id}::${INACTIVE_ASSIGNMENT.judge_id}`, INACTIVE_ASSIGNMENT],
    ]),
    expandedQuestionId: 'question-1',
    onToggleExpanded: () => undefined,
    getFields: () => ['questionText', 'answer', 'questionType'],
    onToggleAssignmentPresence: () => undefined,
    onUpdateAttachmentForwarding: () => undefined,
    onPromptFieldsChange: () => undefined,
    togglePending: false,
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AssignmentMatrixContent', () => {
  it('renders the shared reviewer-table surface while keeping warning, inactive-assignment, and forwarding context visible', () => {
    const html = renderToStaticMarkup(
      <AssignmentMatrixContent
        {...createProps({
          loadError: new Error('Assignments changed while refreshing.'),
        })}
      />
    );

    expect(html).toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
    expect(html).toContain('data-overflow-surface="reviewer-table"');
    expect(html).toContain(
      'Assignments changed while refreshing. Showing the last confirmed persisted assignment state below.'
    );
    expect(html).toContain('1 persisted assignment now target inactive judges.');
    expect(html).toContain(QUESTIONS[0].question_text);
    expect(html).toContain(QUESTIONS[0].external_id ?? '');
    expect(html).toContain(ACTIVE_JUDGE.name);
    expect(html).toContain(INACTIVE_JUDGE.name);
    expect(html).toContain('Inactive');
    expect(html).toContain('2 persisted');
    expect(html).toContain('1 inactive excluded');
    expect(html).toContain('Excluded');
    expect(html).toContain('Persisted assignments for this question:');
    expect(html).toContain('Attachment forwarding enabled');
    expect(html).toContain('Attachment forwarding disabled');
    expect(html).toContain('Forward stored attachments');
    expect(html).toContain('Attachment forwarding is enabled while this judge is active and included in previews and runs.');
    expect(html).toContain('Attachment forwarding is disabled while this judge is inactive and excluded from runs.');
    expect(html).toContain('Prompt fields for newly checked active judges on this question:');
    expect(html).toContain('Question Type');
  });

  it('keeps the mutation error visible while preserving the last confirmed persisted state', () => {
    const html = renderToStaticMarkup(
      <AssignmentMatrixContent
        {...createProps({
          mutationError: new Error('Failed to save assignment.'),
        })}
      />
    );

    expect(html).toContain('Failed to save assignment.');
    expect(html).toContain('Attachment forwarding enabled');
    expect(html).toContain('Attachment forwarding disabled');
    expect(html).toContain('Forward stored attachments');
    expect(html).toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
  });

  it('renders the empty persisted-assignment state for questions that do not have saved rows yet', () => {
    const html = renderToStaticMarkup(
      <AssignmentMatrixContent
        {...createProps({
          inactiveAssignmentCount: 0,
          questions: [
            {
              ...QUESTIONS[0],
              assignments: [],
            },
          ],
          assignmentsByPair: new Map(),
          visibleJudges: [ACTIVE_JUDGE],
        })}
      />
    );

    expect(html).toContain('No persisted assignments for this question yet.');
    expect(html).toContain('0 persisted');
    expect(html).toContain('Prompt fields for newly checked active judges on this question:');
    expect(html).not.toContain('Attachment forwarding enabled');
    expect(html).not.toContain('Attachment forwarding disabled');
  });

  it('keeps the fatal load error visible instead of rendering a hidden table surface', () => {
    const html = renderToStaticMarkup(
      <AssignmentMatrixContent
        {...createProps({
          hasPersistedState: false,
          loadError: new Error('Failed to load queue assignments.'),
          questions: [],
          visibleJudges: [],
          assignmentsByPair: new Map(),
          inactiveAssignmentCount: 0,
          expandedQuestionId: null,
        })}
      />
    );

    expect(html).toContain('Failed to load queue assignments.');
    expect(html).toContain('Retry');
    expect(html).not.toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
    expect(html).not.toContain('<table');
  });

  it('preserves the loading state until assignment data is ready', () => {
    const html = renderToStaticMarkup(
      <AssignmentMatrixContent
        {...createProps({
          loading: true,
          hasPersistedState: false,
          loadError: null,
          questions: [],
          visibleJudges: [],
          assignmentsByPair: new Map(),
          inactiveAssignmentCount: 0,
          expandedQuestionId: null,
        })}
      />
    );

    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
    expect(html).not.toContain('<table');
  });
});

describe('fetchAssignments', () => {
  it('rejects malformed persisted assignment payloads instead of guessing forwarding state', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 'assignment-1',
              queue_id: 'queue-1',
              question_template_id: 'question-1',
              judge_id: 'judge-active',
              prompt_fields: ['questionText', 'answer'],
              attachment_forwarding: 'yes',
              created_at: '2026-03-28T12:00:00.000Z',
              judges: {
                id: 'judge-active',
                name: 'Judge Atlas',
                model: 'gateway/model-a',
                active: true,
              },
              question_templates: {
                id: 'question-1',
                external_id: 'Q-001',
                question_text: 'Question text',
                question_type: 'free_text',
                created_at: '2026-03-28T12:00:00.000Z',
              },
            },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(fetchAssignments('queue-1')).rejects.toThrow(
      'Expected /api/queues/queue-1/assignments response[0].attachment_forwarding to be a boolean.'
    );
  });
});
