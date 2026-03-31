'use client';

import { theme } from '@/components/ui/theme';
import {
  AI_JUDGE_THEME_MODE_STORAGE_KEY,
  AI_JUDGE_THEME_SCHEME_STORAGE_KEY,
} from '@/components/ui/theme-preference';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode="system"
        modeStorageKey={AI_JUDGE_THEME_MODE_STORAGE_KEY}
        colorSchemeStorageKey={AI_JUDGE_THEME_SCHEME_STORAGE_KEY}
        disableTransitionOnChange
      >
        <CssBaseline enableColorScheme />
        <AppShell>{children}</AppShell>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
