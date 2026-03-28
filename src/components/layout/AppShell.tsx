'use client';

import { Box } from '@mui/material';
import NavSidebar from './NavSidebar';
import { appShellMainSx, appShellRootSx } from './shell-layout';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={appShellRootSx}>
      <NavSidebar />
      <Box component="main" sx={appShellMainSx}>
        {children}
      </Box>
    </Box>
  );
}
