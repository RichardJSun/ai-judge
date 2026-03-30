import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ASSIGN_PAGE_ATTACHMENT_COPY,
  ASSIGN_PAGE_INTRO_COPY,
  AssignPageContent,
} from './page';

describe('AssignPageContent', () => {
  it('renders explicit queue wayfinding without changing the existing assignment workflow copy', () => {
    const html = renderToStaticMarkup(
      <AssignPageContent
        queueId="queue-1"
        onBack={() => undefined}
        assignmentMatrix={<div data-testid="assignment-matrix">Matrix</div>}
      />
    );

    expect(html).toContain('Assign Judges');
    expect(html).toContain('Back to queue');
    expect(html).not.toContain('>Back<');
    expect(html).toContain('href="/queues"');
    expect(html).toContain('href="/queues/queue-1"');
    expect(html).toContain('Queues');
    expect(html).toContain('queue-1');
    expect(html).toContain(ASSIGN_PAGE_INTRO_COPY);
    expect(html).toContain(ASSIGN_PAGE_ATTACHMENT_COPY);
    expect(html).toContain(
      'Open a submission from Queue queue-1 to inspect attachment metadata and storage status.'
    );
    expect(html).toContain('data-testid="assignment-matrix"');
  });

  it('keeps long queue ids visible in breadcrumbs and attachment guidance', () => {
    const queueId = 'QUEUE-WITH-A-LONG-REVIEWER-VISIBLE-ID-0000000000001';
    const html = renderToStaticMarkup(
      <AssignPageContent
        queueId={queueId}
        onBack={() => undefined}
        assignmentMatrix={<div />}
      />
    );

    expect(html).toContain(`href="/queues/${queueId}"`);
    expect(html).toContain(queueId);
    expect(html).toContain(`Open a submission from Queue ${queueId} to inspect attachment metadata and storage status.`);
  });

  it('fails fast when queue breadcrumbs would lose their queue label', () => {
    expect(() =>
      renderToStaticMarkup(
        <AssignPageContent
          queueId=""
          onBack={() => undefined}
          assignmentMatrix={<div />}
        />
      )
    ).toThrow('ReviewerWayfinding requires a non-empty queueId.');
  });
});
