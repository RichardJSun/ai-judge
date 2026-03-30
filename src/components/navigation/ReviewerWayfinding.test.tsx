import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewerWayfinding, {
  createQueueReviewerBreadcrumbs,
  createSubmissionDetailBreadcrumbs,
} from './ReviewerWayfinding';

describe('ReviewerWayfinding', () => {
  it('renders queue-scoped breadcrumbs and an explicit back label', () => {
    const html = renderToStaticMarkup(
      <ReviewerWayfinding
        title="Results"
        backLabel="Back to queue"
        onBack={() => undefined}
        breadcrumbs={createQueueReviewerBreadcrumbs('queue-1', 'Results')}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('Queues');
    expect(html).toContain('queue-1');
    expect(html).toContain('Results');
  });

  it('creates a results-aware breadcrumb trail for submission detail', () => {
    const html = renderToStaticMarkup(
      <ReviewerWayfinding
        title="Submission detail"
        backLabel="Back to results"
        onBack={() => undefined}
        breadcrumbs={createSubmissionDetailBreadcrumbs('queue-1', 'results')}
      />
    );

    expect(html).toContain('Back to results');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('href="/queues/queue-1/results"');
    expect(html).toContain('Submission detail');
  });

  it('fails fast when required labels are empty', () => {
    expect(() =>
      renderToStaticMarkup(
        <ReviewerWayfinding
          title=""
          backLabel="Back to queue"
          onBack={() => undefined}
          breadcrumbs={[]}
        />
      )
    ).toThrow('ReviewerWayfinding requires a non-empty title.');

    expect(() =>
      renderToStaticMarkup(
        <ReviewerWayfinding
          title="Results"
          backLabel=""
          onBack={() => undefined}
          breadcrumbs={[]}
        />
      )
    ).toThrow('ReviewerWayfinding requires a non-empty backLabel.');

    expect(() => createQueueReviewerBreadcrumbs('', 'Results')).toThrow(
      'ReviewerWayfinding requires a non-empty queueId.'
    );
  });
});
