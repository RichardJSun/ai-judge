import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunPageContent } from './page';

describe('RunPageContent', () => {
  it('renders explicit queue wayfinding above the existing run-start call to action', () => {
    const html = renderToStaticMarkup(
      <RunPageContent
        queueId="queue-1"
        runId={null}
        progress={null}
        pollError={null}
        startError={null}
        onBack={() => undefined}
        onOpenDialog={() => undefined}
        onViewResults={() => undefined}
        runPreviewDialog={<div data-testid="run-preview-dialog" />}
      />
    );

    expect(html).toContain('Run Evaluations');
    expect(html).toContain('Back to queue');
    expect(html).not.toContain('>Back<');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('Ready to evaluate?');
    expect(html).toContain('This will run all assigned judges against every submission in the queue.');
    expect(html).toContain('Run AI Judges');
    expect(html).toContain('data-testid="run-preview-dialog"');
  });

  it('keeps terminal run progress and the View Results action visible under the shared header', () => {
    const html = renderToStaticMarkup(
      <RunPageContent
        queueId="queue-1"
        runId="run-1"
        progress={{
          status: 'completed',
          total: 5,
          completed: 5,
          errored: 0,
        }}
        pollError={null}
        startError={null}
        onBack={() => undefined}
        onOpenDialog={() => undefined}
        onViewResults={() => undefined}
        runPreviewDialog={<div />}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('Evaluations complete');
    expect(html).toContain('View Results');
    expect(html).toContain('completed');
    expect(html).toContain('100%');
  });

  it('keeps the existing run error state visible even when wayfinding is present', () => {
    const html = renderToStaticMarkup(
      <RunPageContent
        queueId="queue-1"
        runId="run-1"
        progress={null}
        pollError="Failed to load run progress."
        startError={null}
        onBack={() => undefined}
        onOpenDialog={() => undefined}
        onViewResults={() => undefined}
        runPreviewDialog={<div />}
      />
    );

    expect(html).toContain('Back to queue');
    expect(html).toContain('Failed to load run progress.');
    expect(html).not.toContain('View Results');
  });

  it('fails fast when queue breadcrumbs would render without a queue label', () => {
    expect(() =>
      renderToStaticMarkup(
        <RunPageContent
          queueId=""
          runId={null}
          progress={null}
          pollError={null}
          startError={null}
          onBack={() => undefined}
          onOpenDialog={() => undefined}
          onViewResults={() => undefined}
          runPreviewDialog={<div />}
        />
      )
    ).toThrow('ReviewerWayfinding requires a non-empty queueId.');
  });
});
