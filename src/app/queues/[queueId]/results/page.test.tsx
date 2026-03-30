import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  areResultsPageStatesEqual,
  buildResultsPageHref,
  buildResultsQueryString,
  createResultsPageCanonicalState,
  getResultsPageQueryKey,
  normalizeResultsPageSearchParams,
  resolveResultsPageSyncHref,
  ResultsPageContent,
} from './page';
import type { ResultsFilterJudge, ResultsFilterQuestion, ResultsResponse } from '@/types/api';
import type { VerdictEnum } from '@/types/db';

const JUDGES: ResultsFilterJudge[] = [
  {
    id: 'judge-1',
    name: 'Judge Atlas',
    model: 'gateway/model-a',
  },
  {
    id: 'judge-2',
    name: 'Judge Borealis',
    model: 'gateway/model-b',
  },
];

const QUESTIONS: ResultsFilterQuestion[] = [
  {
    id: 'question-1',
    external_id: 'Q-001',
    question_text: 'Did the answer satisfy the policy requirement?',
  },
  {
    id: 'question-2',
    external_id: 'Q-002',
    question_text: 'Was the evidence grounded in the provided attachment?',
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
    total: 250,
    passRate: 100,
    judgePassRates: [
      {
        judgeId: 'judge-1',
        name: 'Judge Atlas',
        passRate: 100,
        total: 1,
      },
    ],
    page: 5,
    pageSize: 25,
    filterMetadata: {
      judges: JUDGES,
      questions: QUESTIONS,
      verdicts: ['pass', 'fail'],
    },
    ...overrides,
  };
}

describe('normalizeResultsPageSearchParams', () => {
  it('drops malformed page values, duplicates, blanks, and unsupported verdicts before querying', () => {
    expect(
      normalizeResultsPageSearchParams({
        page: ['999999999999999999999999', '3'],
        judgeId: [' judge-1 ', 'judge-1', '', 'judge-2'],
        questionId: ['question-1', 'question-1', ''],
        verdict: ['pass', 'maybe', 'pass', ''],
      })
    ).toEqual({
      page: 1,
      selectedJudges: ['judge-1', 'judge-2'],
      selectedQuestions: ['question-1'],
      selectedVerdicts: ['pass'],
    });
  });
});

describe('buildResultsQueryString', () => {
  it('serializes canonical filter state into the API contract query order', () => {
    expect(
      buildResultsQueryString({
        page: 2,
        selectedJudges: ['judge-1'],
        selectedQuestions: ['question-1'],
        selectedVerdicts: ['pass'],
      })
    ).toBe('page=2&judgeId=judge-1&questionId=question-1&verdict=pass');
  });
});

describe('buildResultsPageHref', () => {
  it('serializes only the whitelisted reviewer-truth results params into the page href', () => {
    expect(
      buildResultsPageHref('/queues/queue-1/results', {
        page: 2,
        selectedJudges: ['judge-1'],
        selectedQuestions: ['question-1'],
        selectedVerdicts: ['pass'],
      })
    ).toBe('/queues/queue-1/results?page=2&judgeId=judge-1&questionId=question-1&verdict=pass');
  });
});

describe('resolveResultsPageSyncHref', () => {
  it('requests a URL rewrite for missing, duplicated, stale, or non-whitelisted params and skips already-canonical URLs', () => {
    const canonicalState = {
      page: 2,
      selectedJudges: ['judge-1'],
      selectedQuestions: ['question-1'],
      selectedVerdicts: ['pass'],
    } satisfies {
      page: number;
      selectedJudges: string[];
      selectedQuestions: string[];
      selectedVerdicts: VerdictEnum[];
    };

    expect(resolveResultsPageSyncHref('/queues/queue-1/results', {}, canonicalState)).toBe(
      '/queues/queue-1/results?page=2&judgeId=judge-1&questionId=question-1&verdict=pass'
    );

    expect(
      resolveResultsPageSyncHref(
        '/queues/queue-1/results',
        {
          page: ['2', '3'],
          judgeId: ['judge-1', 'judge-1'],
          questionId: ['question-1', 'stale-question'],
          verdict: ['pass', 'maybe'],
          source: 'reviewer',
        },
        canonicalState
      )
    ).toBe('/queues/queue-1/results?page=2&judgeId=judge-1&questionId=question-1&verdict=pass');

    expect(
      resolveResultsPageSyncHref(
        '/queues/queue-1/results',
        {
          page: '2',
          judgeId: 'judge-1',
          questionId: 'question-1',
          verdict: 'pass',
        },
        canonicalState
      )
    ).toBeNull();
  });
});

describe('createResultsPageCanonicalState', () => {
  it('drops stale selections that are absent from queue-truth metadata and adopts the clamped server page', () => {
    expect(
      createResultsPageCanonicalState(
        {
          page: 999,
          selectedJudges: ['judge-1', 'judge-stale'],
          selectedQuestions: ['question-1', 'question-stale'],
          selectedVerdicts: ['pass', 'inconclusive'],
        },
        createResultsResponse({
          page: 2,
          filterMetadata: {
            judges: [JUDGES[0]!],
            questions: [QUESTIONS[0]!],
            verdicts: ['pass'],
          },
        })
      )
    ).toEqual({
      page: 2,
      selectedJudges: ['judge-1'],
      selectedQuestions: ['question-1'],
      selectedVerdicts: ['pass'],
    });
  });
});

describe('getResultsPageQueryKey', () => {
  it('keys the results cache by queue id plus normalized URL state instead of local component state', () => {
    expect(
      getResultsPageQueryKey('queue-1', {
        page: 2,
        selectedJudges: ['judge-1'],
        selectedQuestions: ['question-1'],
        selectedVerdicts: ['pass'],
      })
    ).toEqual(['results', 'queue-1', 2, ['judge-1'], ['question-1'], ['pass']]);
  });
});

describe('areResultsPageStatesEqual', () => {
  it('treats order-sensitive canonical URL state as the cache and rewrite comparison source of truth', () => {
    const left: {
      page: number;
      selectedJudges: string[];
      selectedQuestions: string[];
      selectedVerdicts: VerdictEnum[];
    } = {
      page: 2,
      selectedJudges: ['judge-1'],
      selectedQuestions: ['question-1'],
      selectedVerdicts: ['pass'],
    };

    expect(areResultsPageStatesEqual(left, { ...left })).toBe(true);
    expect(areResultsPageStatesEqual(left, { ...left, page: 3 })).toBe(false);
  });
});

describe('ResultsPageContent', () => {
  it('renders queue-truth filters, deep-linked chips, pass-rate summary, and shared reviewer pagination links', () => {
    const html = renderToStaticMarkup(
      <ResultsPageContent
        queueId="queue-1"
        judges={JUDGES}
        questions={QUESTIONS}
        availableVerdicts={['pass', 'fail']}
        results={createResultsResponse()}
        isInitialLoading={false}
        loadError={null}
        selectedJudges={['judge-1']}
        selectedQuestions={['question-1']}
        selectedVerdicts={['pass']}
        page={5}
        onBack={() => undefined}
        onRetry={() => undefined}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
        getPageHref={(page) => `/queues/queue-1/results?page=${page}&judgeId=judge-1&questionId=question-1&verdict=pass`}
      />
    );

    expect(html).toContain('Results');
    expect(html).toContain('Back to queue');
    expect(html).not.toContain('>Back<');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Q-001');
    expect(html).toContain('pass');
    expect(html).toContain('Pass rate across completed evaluations in the current filter set.');
    expect(html).toContain('Pass rate is based on 1 completed evaluation out of 250 matching the current filters.');
    expect(html).toContain('SUB-001');
    expect(html).toContain(
      'href="/queues/queue-1/submissions/submission-1?source=results&amp;page=5&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"'
    );
    expect(html).toContain('data-audit-toggle="icon"');
    expect(html).toContain(
      'aria-label="Expand audit details for submission SUB-001 from the reasoning cell"'
    );
    expect(html).toContain('href="/queues/queue-1/results?page=4&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"');
    expect(html).toContain('href="/queues/queue-1/results?page=6&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"');
    expect(html).toContain('href="/queues/queue-1/results?page=1&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"');
    expect(html).toContain('href="/queues/queue-1/results?page=10&amp;judgeId=judge-1&amp;questionId=question-1&amp;verdict=pass"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('…');
    expect(html).not.toContain('Judge Outside');
    expect(html).not.toContain('Q-999');
    expect(html).not.toContain('Inconclusive');
  });

  it('keeps the retryable load failure visible under the shared header', () => {
    const html = renderToStaticMarkup(
      <ResultsPageContent
        queueId="queue-1"
        judges={[]}
        questions={[]}
        availableVerdicts={[]}
        results={undefined}
        isInitialLoading={false}
        loadError={new Error('Failed to load queue results.')}
        selectedJudges={['judge-1']}
        selectedQuestions={['question-1']}
        selectedVerdicts={['pass']}
        page={1}
        onBack={() => undefined}
        onRetry={() => undefined}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('Failed to load queue results.');
    expect(html).toContain('Retry');
  });

  it('keeps the explicit empty results state visible while rendering only queue-truth filter options', () => {
    const html = renderToStaticMarkup(
      <ResultsPageContent
        queueId="queue-1"
        judges={[JUDGES[0]!]}
        questions={[QUESTIONS[0]!]}
        availableVerdicts={['pass']}
        results={createResultsResponse({
          evaluations: [],
          total: 0,
          passRate: 0,
          judgePassRates: [],
          page: 1,
          filterMetadata: {
            judges: [JUDGES[0]!],
            questions: [QUESTIONS[0]!],
            verdicts: ['pass'],
          },
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
      />
    );

    expect(html).toContain('No evaluations match the current filters.');
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Q-001');
    expect(html).toContain('pass');
    expect(html).not.toContain('Judge Borealis');
    expect(html).not.toContain('Q-002');
    expect(html).not.toContain('Fail');
  });

  it('fails fast when queue breadcrumbs would render without a queue label', () => {
    expect(() =>
      renderToStaticMarkup(
        <ResultsPageContent
          queueId=""
          judges={[]}
          questions={[]}
          availableVerdicts={[]}
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
        />
      )
    ).toThrow('ReviewerWayfinding requires a non-empty queueId.');
  });
});
