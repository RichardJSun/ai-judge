import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResultsFilterJudge, ResultsFilterQuestion } from '@/types/api';
import ResultsFilters from './ResultsFilters';

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

describe('ResultsFilters', () => {
  it('renders only queue-truth judge, question, and verdict options while preserving selected chip labels', () => {
    const html = renderToStaticMarkup(
      <ResultsFilters
        judges={[JUDGES[0]! ]}
        questions={[QUESTIONS[0]! ]}
        availableVerdicts={['pass']}
        selectedJudges={['judge-1']}
        selectedQuestions={['question-1']}
        selectedVerdicts={['pass']}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
      />
    );

    expect(html).toContain('Judge');
    expect(html).toContain('Question');
    expect(html).toContain('Verdict');
    expect(html).toContain('Judge Atlas');
    expect(html).toContain('Q-001');
    expect(html).toContain('pass');
    expect(html).not.toContain('Judge Borealis');
    expect(html).not.toContain('Q-002');
    expect(html).not.toContain('Fail');
    expect(html).not.toContain('Inconclusive');
  });

  it('does not fall back to global defaults when queue metadata is empty', () => {
    const html = renderToStaticMarkup(
      <ResultsFilters
        judges={[]}
        questions={[]}
        availableVerdicts={[]}
        selectedJudges={[]}
        selectedQuestions={[]}
        selectedVerdicts={[]}
        onJudgesChange={() => undefined}
        onQuestionsChange={() => undefined}
        onVerdictsChange={() => undefined}
      />
    );

    expect(html).toContain('Judge');
    expect(html).toContain('Question');
    expect(html).toContain('Verdict');
    expect(html).not.toContain('Judge Atlas');
    expect(html).not.toContain('Q-001');
    expect(html).not.toContain('Pass');
    expect(html).not.toContain('Fail');
    expect(html).not.toContain('Inconclusive');
  });
});
