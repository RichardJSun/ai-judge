import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fetchJson, parseResultsResponse } from './fetch-json';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchJson', () => {
  it('throws reviewer-visible errors for failed HTTP responses without calling the success parser', async () => {
    const parse = mock((value: unknown) => value);

    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Failed to load queue results.',
            detail: 'Database connection dropped.',
          }),
          {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/results', {
        fallbackMessage: 'Failed to load queue results.',
        parse,
      })
    ).rejects.toThrow('Failed to load queue results. Database connection dropped.');

    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects malformed successful results payloads before the page can render inconsistent aggregates', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            evaluations: [],
            total: 1,
            passRate: 100,
            page: 1,
            pageSize: 25,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/results', {
        fallbackMessage: 'Failed to load queue results.',
        parse: (value) => parseResultsResponse(value, '/api/queues/queue-1/results response'),
      })
    ).rejects.toThrow(/Malformed \/api\/queues\/queue-1\/results response: /);
  });

  it('surfaces invalid JSON responses with the fallback message context', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(
      fetchJson('/api/queues/queue-1/results', {
        fallbackMessage: 'Failed to load queue results.',
        parse: (value) => value,
      })
    ).rejects.toThrow('Failed to load queue results. The server returned invalid JSON.');
  });
});
