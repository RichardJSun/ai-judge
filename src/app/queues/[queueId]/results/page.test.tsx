import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResultsResponse } from '@/types/api';
import type { Judge } from '@/types/db';
import type { ResultsFilterQuestion } from '@/lib/results/fetch-json';
import { ResultsPageContent } from './page';

const JUDGES: Judge[] = [
  {
    id: 'judge-1',
    name: 'Judge Atlas',
    system_prompt: 'Review carefully.',
    model: 'gateway/model-a',
    active: true,
    created_at: '2026-03-28T10:00:00.000Z',
    updated_at: '2026-03-28T10:00:00.000Z',
  },
];

const QUESTIONS: ResultsFilterQuestion[] = [
  {
    id: 'question-1',
    external_id: 'Q-001',
    question_text: 'Did the answer satisfy the policy requirement?',
  },
];

function createResultsResponse(overrides: Partial<ResultsResponse> = {}): ResultsResponse {
  return {
    evaluations: [
      {
        id: 'evaluation-1',
        verdict: 'pass',
        reasoning: 'The response met the requirement with supporting evidence.',
        prompt_snapshot:
          'Prompt snapshot content describing stored attachments and forwarding.\nPlan marker: {"version":1,"kind":"text-only","forwardingRequested":false}',
        model_used: 'gateway/model-a',
        tokens_used: 321,
        latency_ms: 875,
        retry_count: 0,
        error_message: null,
        created_at: '2026-03-28T12:00:00.000Z',
        status: 'completed',
        submission: {
          id: 'submission-1',
          external_id: 'SUB-001',
        },
        question: {
          id: 'question-1',
          external_id: 'Q-001',
          question_text: 'Did the answer satisfy the policy requirement?',
        },
        judge: {
          id: 'judge-1',
          name: 'Judge Atlas',
          model: 'gateway/model-a',
        },
      },
    ],
    total: 1,
    passRate: 100,
    judgePassRates: [
      {
        judgeId: 'judge-1',
        name: 'Judge Atlas',
        passRate: 100,
        total: 1,
      },
    ],
    page: 1,
    pageSize: 10,
    filterMetadata: {
      judges: JUDGES.map(({ id, name, model }) => ({ id, name, model })),
      questions: QUESTIONS,
      verdicts: ['pass'],
    },
    ...overrides,
  };
}

describe('ResultsPageContent', () => {
  it('renders explicit queue wayfinding while keeping filters and results content visible', () => {
    const html = renderToStaticMarkup(
      <ResultsPageContent
        queueId="queue-1"
        judges={JUDGES}
        questions={QUESTIONS}
        results={createResultsResponse()}
        isInitialLoading={false}
        loadError={null}
        selectedJudges={[]}
        selectedQuestions={[]}
        selectedVerdicts={[]}
        page={1}
        onBack={() => undefined}
        onRetry={() => undefined}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
      />
    );

    expect(html).toContain('Results');
    expect(html).toContain('Back to queue');
    expect(html).not.toContain('>Back<');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('Judge');
    expect(html).toContain('Question');
    expect(html).toContain('Verdict');
    expect(html).toContain('Pass rate across completed evaluations in the current filter set.');
    expect(html).toContain('Pass rate is based on 1 completed evaluation out of 1 matching the current filters.');
    expect(html).toContain('SUB-001');
    expect(html).toContain('href="/queues/queue-1/submissions/submission-1?source=results"');
  });

  it('keeps the retryable load failure visible under the shared header', () => {
    const html = renderToStaticMarkup(
      <ResultsPageContent
        queueId="queue-1"
        judges={[]}
        questions={[]}
        results={undefined}
        isInitialLoading={false}
        loadError={new Error('Failed to load queue results.')}
        selectedJudges={[]}
        selectedQuestions={[]}
        selectedVerdicts={[]}
        page={1}
        onBack={() => undefined}
        onRetry={() => undefined}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('Failed to load queue results.');
    expect(html).toContain('Retry');
  });

  it('keeps the explicit empty results state visible with queue-scoped breadcrumbs', () => {
    const html = renderToStaticMarkup(
      <ResultsPageContent
        queueId="queue-1"
        judges={JUDGES}
        questions={QUESTIONS}
        results={createResultsResponse({
          evaluations: [],
          total: 0,
          passRate: 0,
          judgePassRates: [],
        })}
        isInitialLoading={false}
        loadError={null}
        selectedJudges={['judge-1']}
        selectedQuestions={['question-1']}
        selectedVerdicts={['pass']}
        page={1}
        onBack={() => undefined}
        onRetry={() => undefined}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('No evaluations match the current filters.');
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Q-001');
    expect(html).toContain('pass');
  });

  it('fails fast when queue breadcrumbs would render without a queue label', () => {
    expect(() =>
      renderToStaticMarkup(
        <ResultsPageContent
          queueId=""
          judges={[]}
          questions={[]}
          results={undefined}
          isInitialLoading={false}
          loadError={null}
          selectedJudges={[]}
          selectedQuestions={[]}
          selectedVerdicts={[]}
          page={1}
          onBack={() => undefined}
          onRetry={() => undefined}
          onJudgesChange={() => undefined}
          onQuestionsChange={() => undefined}
          onVerdictsChange={() => undefined}
          onPreviousPage={() => undefined}
          onNextPage={() => undefined}
        />
      )
    ).toThrow('ReviewerWayfinding requires a non-empty queueId.');
  });
});
