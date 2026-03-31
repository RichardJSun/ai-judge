export const AI_JUDGE_THEME_MODE_STORAGE_KEY = 'ai-judge-color-scheme';
export const AI_JUDGE_THEME_SCHEME_STORAGE_KEY = 'ai-judge-color-scheme-name';

export type ThemeModeChoice = 'light' | 'dark' | 'system';

export function normalizeThemeModeChoice(value: unknown): ThemeModeChoice {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return 'system';
}
