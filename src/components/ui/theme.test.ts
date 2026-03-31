import { describe, expect, it } from 'bun:test';
import { theme } from './theme';

describe('theme color scheme configuration', () => {
  it('uses a class selector so useColorScheme().setMode() can toggle manually', () => {
    const configuredTheme = theme as typeof theme & { colorSchemeSelector?: string };

    expect(configuredTheme.colorSchemeSelector).toBe('class');
  });
});
