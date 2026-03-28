import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import VerdictChip, { resolveVerdictChipPresentation } from './VerdictChip';

describe('resolveVerdictChipPresentation', () => {
  it('keeps successful completed evaluations mapped to verdict labels', () => {
    expect(resolveVerdictChipPresentation({ verdict: 'pass', status: 'completed' })).toEqual({
      label: 'Pass',
      color: 'success',
    });
  });

  it('labels errored evaluations as errors instead of pending', () => {
    expect(resolveVerdictChipPresentation({ verdict: null, status: 'error' })).toEqual({
      label: 'Error',
      color: 'error',
    });
  });

  it('marks completed rows without verdicts as review needed', () => {
    expect(resolveVerdictChipPresentation({ verdict: null, status: 'completed' })).toEqual({
      label: 'Review needed',
      color: 'warning',
      variant: 'outlined',
    });
  });

  it('treats missing status as an invalid state when no verdict is present', () => {
    expect(resolveVerdictChipPresentation({ verdict: null, status: undefined })).toEqual({
      label: 'Invalid state',
      color: 'warning',
      variant: 'outlined',
    });
  });
});

describe('VerdictChip', () => {
  it('renders the terminal error label for failed evaluations', () => {
    const html = renderToStaticMarkup(<VerdictChip verdict={null} status="error" />);

    expect(html).toContain('Error');
    expect(html).not.toContain('Pending');
  });
});
