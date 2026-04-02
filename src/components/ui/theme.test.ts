import { describe, expect, it } from 'bun:test';
import { displayFontFamily, shellTypography, theme } from './theme';

describe('theme color scheme configuration', () => {
  it('uses a class selector so useColorScheme().setMode() can toggle manually', () => {
    const configuredTheme = theme as typeof theme & { colorSchemeSelector?: string };

    expect(configuredTheme.colorSchemeSelector).toBe('class');
  });

  it('keeps shell brand typography on the display font stack', () => {
    expect(shellTypography.brandTitle.fontFamily).toBe(displayFontFamily);
    expect(shellTypography.metaLabel.textTransform).toBe('uppercase');
  });
});
