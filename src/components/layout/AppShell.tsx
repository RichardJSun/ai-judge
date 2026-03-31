'use client';

import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import {
  Box,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import ThemeModeControl from '@/components/ui/ThemeModeControl';
import NavSidebar from './NavSidebar';
import {
  appShellContentSx,
  appShellDesktopRailSx,
  appShellMainSx,
  appShellMobileTopBarSx,
  appShellRootSx,
} from './shell-layout';
import { editorialRadius } from '@/components/ui/theme';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={appShellRootSx}>
      <Box sx={appShellDesktopRailSx}>
        <NavSidebar />
      </Box>

      <Box sx={appShellContentSx}>
        <Stack sx={appShellMobileTopBarSx}>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                borderRadius: `${editorialRadius.control}px`,
              }}
            >
              <MenuRoundedIcon />
            </IconButton>
            <Box>
              <Typography variant="overline" color="text.secondary">
                AI Judge
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                Review workspace
              </Typography>
            </Box>
          </Stack>
          <ThemeModeControl />
        </Stack>

        <Box component="main" sx={appShellMainSx}>
          {children}
        </Box>
      </Box>

      <NavSidebar variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </Box>
  );
}
