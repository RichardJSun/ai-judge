import type { SxProps, Theme } from '@mui/material/styles';

const SPACING_UNIT_PX = 8;

function toViewportInset(spacingUnits: number) {
  return `${spacingUnits * SPACING_UNIT_PX * 2}px`;
}

export const SHELL_LAYOUT = {
  railWidth: 272,
  railViewportOffsetLeft: { lg: '20px' },
  outerPaddingX: { xs: 1.5, sm: 2, lg: 3 },
  outerPaddingY: { xs: 1.5, lg: 2.5 },
  mainPaddingX: { xs: 0, lg: 0.5 },
  mainPaddingY: { xs: 0, lg: 0.5 },
  mainMaxWidth: 1360,
  mobileTopBarHeight: 72,
} as const;

export const appShellRootSx = {
  display: 'flex',
  minHeight: '100vh',
  px: SHELL_LAYOUT.outerPaddingX,
  py: SHELL_LAYOUT.outerPaddingY,
  gap: { lg: 2 },
} satisfies SxProps<Theme>;

export const appShellDesktopRailSx = {
  display: { xs: 'none', lg: 'block' },
  width: SHELL_LAYOUT.railWidth,
  flexShrink: 0,
} satisfies SxProps<Theme>;

export const appShellContentSx = {
  flexGrow: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
} satisfies SxProps<Theme>;

export const appShellMobileTopBarSx = {
  display: { xs: 'flex', lg: 'none' },
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
  minHeight: SHELL_LAYOUT.mobileTopBarHeight,
  mb: 1.5,
  px: 1,
} satisfies SxProps<Theme>;

export const appShellMainSx = {
  flexGrow: 1,
  minWidth: 0,
  minHeight: '100vh',
  width: '100%',
  maxWidth: SHELL_LAYOUT.mainMaxWidth,
  mx: 'auto',
  px: SHELL_LAYOUT.mainPaddingX,
  py: SHELL_LAYOUT.mainPaddingY,
} satisfies SxProps<Theme>;

export const navSidebarDrawerSx = {
  width: SHELL_LAYOUT.railWidth,
  flexShrink: 0,
  '& .MuiDrawer-paper': {
    width: SHELL_LAYOUT.railWidth,
    left: SHELL_LAYOUT.railViewportOffsetLeft,
    boxSizing: 'border-box',
    backgroundColor: 'transparent',
    border: 'none',
  },
} satisfies SxProps<Theme>;

export const navSidebarSurfaceHeightSx = {
  xs: `calc(100dvh - ${toViewportInset(SHELL_LAYOUT.outerPaddingY.xs)})`,
  lg: `calc(100dvh - ${toViewportInset(SHELL_LAYOUT.outerPaddingY.lg)})`,
} as const;
