import type { SxProps, Theme } from '@mui/material/styles';

export const SHELL_LAYOUT = {
  drawerWidth: 208,
  mainPaddingX: { xs: 2, md: 3 },
  mainPaddingY: 3,
} as const;

export const appShellRootSx = {
  display: 'flex',
  minHeight: '100vh',
} satisfies SxProps<Theme>;

export const appShellMainSx = {
  flexGrow: 1,
  minWidth: 0,
  minHeight: '100vh',
  px: SHELL_LAYOUT.mainPaddingX,
  py: SHELL_LAYOUT.mainPaddingY,
  bgcolor: 'background.default',
} satisfies SxProps<Theme>;

export const navSidebarDrawerSx = {
  width: SHELL_LAYOUT.drawerWidth,
  flexShrink: 0,
  '& .MuiDrawer-paper': {
    width: SHELL_LAYOUT.drawerWidth,
    boxSizing: 'border-box',
    borderRight: '1px solid',
    borderColor: 'divider',
  },
} satisfies SxProps<Theme>;
