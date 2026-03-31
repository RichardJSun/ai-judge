import type { Metadata } from 'next';
import { DM_Serif_Display, Geist } from 'next/font/google';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import './globals.css';
import Providers from './providers';
import {
  AI_JUDGE_THEME_MODE_STORAGE_KEY,
  AI_JUDGE_THEME_SCHEME_STORAGE_KEY,
} from '@/components/ui/theme-preference';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif-display',
});

export const metadata: Metadata = {
  title: 'AI Judge',
  description: 'AI-powered evaluation platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${dmSerifDisplay.variable}`}>
        <InitColorSchemeScript
          attribute="class"
          defaultMode="system"
          modeStorageKey={AI_JUDGE_THEME_MODE_STORAGE_KEY}
          colorSchemeStorageKey={AI_JUDGE_THEME_SCHEME_STORAGE_KEY}
        />
        <AppRouterCacheProvider>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
