import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditJudgePageContent, fetchJudge } from './page';
import type { Judge } from '@/types/db';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createJudge(overrides: Partial<Judge> = {}): Judge {
  return {
    id: 'judge-27',
    name: 'Judge 27',
    system_prompt: 'Judge 27 prompt',
    model: 'gateway/model-27',
    active: true,
    created_at: '2026-03-27T10:00:00.000Z',
    updated_at: '2026-03-27T11:00:00.000Z',
    ...overrides,
  };
}

describe('fetchJudge', () => {
  it('returns the parsed judge detail payload for the fallback route', async () => {
    const judge = createJudge();
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify(judge), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(fetchJudge(judge.id)).resolves.toEqual(judge);
  });

  it('surfaces unknown judge ids as explicit not-found fallback errors', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: 'Judge not found.' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(fetchJudge('missing-judge')).rejects.toThrow('Judge not found.');
  });

  it('treats malformed fallback payloads as route-level load failures', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ ...createJudge(), active: 'yes' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(fetchJudge('judge-27')).rejects.toThrow('Malformed /api/judges/judge-27 response:');
  });

  it('treats invalid JSON as a retryable fallback load failure', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(fetchJudge('judge-27')).rejects.toThrow('Failed to load judge. The server returned invalid JSON.');
  });
});

describe('EditJudgePageContent', () => {
  it('renders the fallback loading state while judge detail is pending', () => {
    const html = renderToStaticMarkup(<EditJudgePageContent isLoading />);

    expect(html).toContain('MuiCircularProgress');
  });

  it('renders the retryable fallback error state for failed detail fetches', () => {
    const html = renderToStaticMarkup(
      <EditJudgePageContent isLoading={false} isError error={new Error('Failed to load judge. The server returned invalid JSON.')} />
    );

    expect(html).toContain('Failed to load judge. The server returned invalid JSON.');
    expect(html).toContain('Retry');
    expect(html).toContain('Judges');
  });

  it('keeps the fallback page centered on JudgeForm as the only lifecycle control for inactive judges', () => {
    const html = renderToStaticMarkup(
      <EditJudgePageContent
        isLoading={false}
        judge={createJudge({ active: false })}
        statusMessage="Saved Judge 27. This judge is now inactive but still persisted for history."
      />
    );

    expect(html).toContain('Judge 27');
    expect(html).toContain('Inactive');
    expect(html).toContain('This judge is inactive. It remains persisted for history and can be reactivated from the form without losing identity.');
    expect(html).toContain('Judge is inactive');
    expect(html).toContain('Save Changes');
    expect(html).toContain('Saved Judge 27. This judge is now inactive but still persisted for history.');
    expect(html).not.toContain('>Deactivate<');
    expect(html).not.toContain('>Reactivate<');
  });

  it('renders an explicit not-found state when no judge record is available', () => {
    const html = renderToStaticMarkup(<EditJudgePageContent isLoading={false} judge={null} />);

    expect(html).toContain('Judge not found.');
  });
});
