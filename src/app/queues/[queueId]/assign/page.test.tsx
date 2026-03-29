import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ASSIGN_PAGE_ATTACHMENT_COPY,
  ASSIGN_PAGE_INTRO_COPY,
  AssignPageContent,
} from './page';

describe('AssignPageContent', () => {
  it('keeps the existing workflow copy and explains that attachment visibility still lives on submission detail pages', () => {
    const html = renderToStaticMarkup(
      <AssignPageContent
        queueId="queue-1"
        onBack={() => undefined}
        assignmentMatrix={<div data-testid="assignment-matrix">Matrix</div>}
      />
    );

    expect(html).toContain('Assign Judges');
    expect(html).toContain('Back');
    expect(html).toContain(ASSIGN_PAGE_INTRO_COPY);
    expect(html).toContain(ASSIGN_PAGE_ATTACHMENT_COPY);
    expect(html).toContain(
      'Open a submission from Queue queue-1 to inspect attachment metadata and storage status.'
    );
    expect(html).toContain('data-testid="assignment-matrix"');
  });
});
