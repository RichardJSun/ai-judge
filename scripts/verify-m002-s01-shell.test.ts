import { describe, expect, it } from 'bun:test';
import {
  assertInspectionUrls,
  assertPageContract,
  buildInspectionUrls,
  formatInspectionTargets,
  parseVerifierOptions,
  runPhase,
  VerifierPhaseError,
} from './verify-m002-s01-shell';

describe('parseVerifierOptions', () => {
  it('requires --base-url when it is missing', () => {
    expect(() => parseVerifierOptions(['--queue-id', '6d5de9e7-c642-4e1d-bca8-d50b489f2934'])).toThrow(
      '--base-url is required.'
    );
  });

  it('requires --queue-id when it is missing', () => {
    expect(() => parseVerifierOptions(['--base-url', 'http://localhost:3000'])).toThrow('--queue-id is required.');
  });

  it('rejects malformed base URLs and queue ids before emitting proof targets', () => {
    expect(() =>
      parseVerifierOptions(['--base-url', 'localhost:3000', '--queue-id', '6d5de9e7-c642-4e1d-bca8-d50b489f2934'])
    ).toThrow('--base-url must be a valid http:// or https:// URL.');

    expect(() => parseVerifierOptions(['--base-url', 'http://localhost:3000', '--queue-id', 'not-a-uuid'])).toThrow(
      '--queue-id must be a valid UUID.'
    );
  });

  it('normalizes the proof targets and timeout configuration', () => {
    expect(
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000/',
        '--queue-id',
        '6d5de9e7-c642-4e1d-bca8-d50b489f2934',
        '--timeout-ms',
        '9000',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      queueId: '6d5de9e7-c642-4e1d-bca8-d50b489f2934',
      timeoutMs: 9000,
    });
  });
});

describe('runPhase', () => {
  it('wraps failures with the phase name and page-specific context', async () => {
    await expect(
      runPhase('queues-page', { page: '/queues', url: 'http://localhost:3000/queues' }, async () => {
        throw new Error('Page returned 500.');
      })
    ).rejects.toThrow(
      '[verify:m002-s01] phase=queues-page page=/queues url=http://localhost:3000/queues Page returned 500.'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('judges-page', 'Page HTML still included removed copy "now a bug".', {
      page: '/judges',
      url: 'http://localhost:3000/judges',
    });

    await expect(
      runPhase('judges-page', { page: '/judges', url: 'http://localhost:3000/judges' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('assertPageContract', () => {
  it('fails when the expected heading is missing', () => {
    expect(() =>
      assertPageContract({
        body: '<main><p>Queue page only</p></main>',
        expectedHeading: 'Judges',
      })
    ).toThrow('Page HTML did not include expected heading "Judges".');
  });

  it('fails when removed judges copy is still present', () => {
    expect(() =>
      assertPageContract({
        body: '<main><h1>Judges</h1><p>This reviewer-facing lifecycle surface is now a bug.</p></main>',
        expectedHeading: 'Judges',
        forbiddenText: ['reviewer-facing lifecycle surface', 'now a bug'],
      })
    ).toThrow('Page HTML still included removed copy "reviewer-facing lifecycle surface".');
  });
});

describe('inspection target helpers', () => {
  it('builds canonical reviewer URLs for the browser handoff', () => {
    expect(
      buildInspectionUrls('http://localhost:3000/', '6d5de9e7-c642-4e1d-bca8-d50b489f2934')
    ).toEqual({
      judges: 'http://localhost:3000/judges',
      queues: 'http://localhost:3000/queues',
      queueDetail: 'http://localhost:3000/queues/6d5de9e7-c642-4e1d-bca8-d50b489f2934',
    });
  });

  it('rejects summaries that omit one of the browser proof URLs', () => {
    expect(() =>
      assertInspectionUrls({
        judges: 'http://localhost:3000/judges',
        queues: 'http://localhost:3000/queues',
      })
    ).toThrow('Verification summary is missing inspection URL queueDetail.');
  });

  it('formats browser proof targets in a stable order', () => {
    expect(
      formatInspectionTargets({
        judges: 'http://localhost:3000/judges',
        queues: 'http://localhost:3000/queues',
        queueDetail: 'http://localhost:3000/queues/6d5de9e7-c642-4e1d-bca8-d50b489f2934',
      })
    ).toBe(
      'judges=http://localhost:3000/judges queues=http://localhost:3000/queues queueDetail=http://localhost:3000/queues/6d5de9e7-c642-4e1d-bca8-d50b489f2934'
    );
  });
});
