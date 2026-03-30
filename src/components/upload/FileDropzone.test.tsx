import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import FileDropzone from './FileDropzone';

describe('FileDropzone', () => {
  it('renders one keyboard-accessible upload affordance with explicit file guidance', () => {
    const html = renderToStaticMarkup(<FileDropzone onSuccess={() => undefined} />);

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Upload submission JSON file"');
    expect(html).toContain('Drop your JSON file here');
    expect(html).toContain('Click, press Enter, or drop a file to browse');
    expect(html).toContain('JSON queue only, up to 50 MB.');
    expect(html).toContain('type="file"');
  });
});
