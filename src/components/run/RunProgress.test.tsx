import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import RunProgress, { resolveRunProgressPresentation } from './RunProgress';

describe('resolveRunProgressPresentation', () => {
  it('marks completed runs with errored evaluations as warnings instead of clean success', () => {
    expect(
      resolveRunProgressPresentation({
        status: 'completed',
        total: 5,
        completed: 3,
        errored: 2,
      })
    ).toEqual({
      title: 'Completed with warnings',
      chipLabel: 'completed with errors',
      chipColor: 'warning',
      progressColor: 'warning',
      icon: 'warning',
      alertSeverity: 'warning',
      alertMessage: '2 of 5 evaluations need review in Results.',
    });
  });

  it('keeps running runs with failures visibly warning-led while polling continues', () => {
    expect(
      resolveRunProgressPresentation({
        status: 'running',
        total: 6,
        completed: 2,
        errored: 1,
      })
    ).toEqual({
      title: 'Running with warnings',
      chipLabel: 'running with errors',
      chipColor: 'warning',
      progressColor: 'warning',
      icon: 'warning',
      alertSeverity: 'warning',
      alertMessage: '1 evaluation failed so far. Polling will continue until the run settles.',
    });
  });

  it('treats missing status as an invalid run state', () => {
    expect(
      resolveRunProgressPresentation({
        status: undefined,
        total: 1,
        completed: 0,
        errored: 0,
      })
    ).toEqual({
      title: 'Invalid run state',
      chipLabel: 'invalid state',
      chipColor: 'warning',
      progressColor: 'warning',
      icon: 'warning',
      alertSeverity: 'error',
      alertMessage: 'Run progress data is missing a valid status. Refresh the page or inspect the API response.',
    });
  });
});

describe('RunProgress', () => {
  it('renders reviewer-facing warning copy for mixed completed runs', () => {
    const html = renderToStaticMarkup(
      <RunProgress
        progress={{
          status: 'completed',
          total: 5,
          completed: 3,
          errored: 2,
        }}
      />
    );

    expect(html).toContain('Completed with warnings');
    expect(html).toContain('2 of 5 evaluations need review in Results.');
    expect(html).toContain('completed with errors');
  });
});
