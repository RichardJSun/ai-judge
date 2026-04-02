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
import { editorialRadius, shellTypography } from '@/components/ui/theme';

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
              <Typography
                component="p"
                sx={{
                  ...shellTypography.brandTitle,
                  fontSize: '1.2rem',
                }}
              >
                AI Judge
              </Typography>
              <Typography
                component="span"
                color="text.secondary"
                sx={{
                  ...shellTypography.metaLabel,
                  display: 'block',
                  mt: 0.25,
                }}
              >
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
