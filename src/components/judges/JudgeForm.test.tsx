import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import JudgeForm from './JudgeForm';

function createSave() {
  return async () => undefined;
}

describe('JudgeForm', () => {
  it('keeps whitespace-only required fields visibly invalid for same-page save retries', () => {
    const html = renderToStaticMarkup(
      <JudgeForm
        initial={{
          id: 'judge-27',
          name: '   ',
          system_prompt: '   ',
          model: '   ',
          active: false,
        }}
        onSave={createSave()}
      />
    );

    expect(html).toContain('Name cannot be blank.');
    expect(html).toContain('System prompt cannot be blank.');
    expect(html).toContain('Model cannot be blank.');
    expect(html).toContain('disabled=""');
  });

  it('uses the switch label as the only lifecycle affordance instead of separate deactivate/reactivate buttons', () => {
    const html = renderToStaticMarkup(
      <JudgeForm
        initial={{
          id: 'judge-27',
          name: 'Judge 27',
          system_prompt: 'Judge 27 prompt',
          model: 'gateway/model-27',
          active: false,
        }}
        onSave={createSave()}
        onCancel={() => undefined}
        submitLabel="Save Changes"
      />
    );

    expect(html).toContain('Judge is inactive');
    expect(html).toContain('Inactive judges stay persisted for history and can be reactivated later.');
    expect(html).toContain('Save Changes');
    expect(html).not.toContain('Deactivate');
    expect(html).not.toContain('Reactivate');
  });
});
