import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueuePageContent, type QueueSubmissionsResponse } from './page';

function createResponse(): QueueSubmissionsResponse {
  return {
    total: 2,
    submissions: [
      {
        id: 'submission-1',
        external_id: 'SUB-001',
        labeling_task_id: 'task-17',
        submitted_at: '2026-03-28T10:05:00.000Z',
        created_at: '2026-03-28T10:05:00.000Z',
      },
      {
        id: 'submission-2',
        external_id: 'SUBMISSION-EXTERNAL-ID-WITH-LONG-TEXT-002',
        labeling_task_id: null,
        submitted_at: null,
        created_at: '2026-03-28T10:10:00.000Z',
      },
    ],
  };
}

describe('QueuePageContent', () => {
  it('renders the existing reviewer actions and loading state', () => {
    const html = renderToStaticMarkup(
      <QueuePageContent queueId="queue-1" isLoading data={undefined} />
    );

    expect(html).toContain('Submissions');
    expect(html).toContain('Assign Judges');
    expect(html).toContain('Run Evaluations');
    expect(html).toContain('Results');
    expect(html).toContain('href="/queues/queue-1/assign"');
    expect(html).toContain('href="/queues/queue-1/run"');
    expect(html).toContain('href="/queues/queue-1/results"');
    expect(html).toContain('MuiCircularProgress');
  });

  it('renders one linked submission cell per visible row without adding a new action column', () => {
    const html = renderToStaticMarkup(
      <QueuePageContent queueId="queue-1" isLoading={false} data={createResponse()} />
    );

    expect(html).toContain('2 submissions');
    expect(html).toContain('>ID<');
    expect(html).toContain('>Task ID<');
    expect(html).toContain('>Submitted<');
    expect(html).not.toContain('>View<');
    expect(html).not.toContain('>Actions<');

    expect(html).toContain('href="/queues/queue-1/submissions/submission-1"');
    expect(html).toContain('href="/queues/queue-1/submissions/submission-2"');
    expect(html).toContain('aria-label="Open submission SUB-001"');
    expect(html).toContain('aria-label="Open submission SUBMISSION-EXTERNAL-ID-WITH-LONG-TEXT-002"');

    const detailLinkCount = html.match(/href="\/queues\/queue-1\/submissions\//g)?.length ?? 0;
    expect(detailLinkCount).toBe(2);
  });

  it('keeps malformed optional metadata rows navigable', () => {
    const html = renderToStaticMarkup(
      <QueuePageContent queueId="queue-1" isLoading={false} data={createResponse()} />
    );

    expect(html).toContain('SUBMISSION-EXTERNAL-ID-WITH-LONG-TEXT-002');
    expect(html).toContain('href="/queues/queue-1/submissions/submission-2"');
    expect(html).toContain('>—<');
  });

  it('renders the existing empty state when no submissions are available', () => {
    const html = renderToStaticMarkup(
      <QueuePageContent queueId="queue-1" isLoading={false} data={{ submissions: [], total: 0 }} />
    );

    expect(html).toContain('No submissions in this queue.');
  });
});
