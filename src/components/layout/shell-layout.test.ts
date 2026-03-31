import { describe, expect, it } from 'bun:test';
import {
  SHELL_LAYOUT,
  appShellDesktopRailSx,
  appShellMainSx,
  appShellMobileTopBarSx,
  navSidebarDrawerSx,
  navSidebarSurfaceHeightSx,
} from './shell-layout';

const globalsCssPath = new URL('../../app/globals.css', import.meta.url);

describe('SHELL_LAYOUT', () => {
  it('keeps the editorial rail width in one shared contract', () => {
    expect(SHELL_LAYOUT.railWidth).toBe(272);
    expect(navSidebarDrawerSx.width).toBe(SHELL_LAYOUT.railWidth);
    expect(navSidebarDrawerSx['& .MuiDrawer-paper'].width).toBe(SHELL_LAYOUT.railWidth);
  });

  it('keeps a visible viewport inset on the drawer paper in the shared shell contract', () => {
    expect(SHELL_LAYOUT.railViewportOffsetLeft).toEqual({ lg: '20px' });
    expect(navSidebarDrawerSx['& .MuiDrawer-paper'].left).toEqual(SHELL_LAYOUT.railViewportOffsetLeft);
  });

  it('keeps the desktop sidebar height derived from the shared shell padding contract', () => {
    expect(SHELL_LAYOUT.outerPaddingY).toEqual({ xs: 1.5, lg: 2.5 });
    expect(navSidebarSurfaceHeightSx).toEqual({
      xs: 'calc(100dvh - 24px)',
      lg: 'calc(100dvh - 40px)',
    });
  });

  it('keeps main content adjacent to the rail instead of offsetting it a second time', () => {
    expect(appShellMainSx.flexGrow).toBe(1);
    expect(appShellMainSx.minWidth).toBe(0);
    expect(appShellMainSx.minHeight).toBe('100vh');
    expect(appShellMainSx.width).toBe('100%');
    expect(appShellMainSx.maxWidth).toBe(SHELL_LAYOUT.mainMaxWidth);
    expect('ml' in appShellMainSx).toBe(false);
    expect('marginLeft' in appShellMainSx).toBe(false);
    expect('pl' in appShellMainSx).toBe(false);
    expect('paddingLeft' in appShellMainSx).toBe(false);
  });

  it('keeps the main content padding in the shared shell contract', () => {
    expect(SHELL_LAYOUT.mainPaddingX).toEqual({ xs: 0, lg: 0.5 });
    expect(SHELL_LAYOUT.mainPaddingY).toEqual({ xs: 0, lg: 0.5 });
    expect(appShellMainSx.px).toEqual(SHELL_LAYOUT.mainPaddingX);
    expect(appShellMainSx.py).toEqual(SHELL_LAYOUT.mainPaddingY);
  });

  it('keeps the mobile top bar as a single row toolbar', () => {
    expect(appShellMobileTopBarSx.display).toEqual({ xs: 'flex', lg: 'none' });
    expect(appShellMobileTopBarSx.flexDirection).toBe('row');
    expect(appShellMobileTopBarSx.justifyContent).toBe('space-between');
  });

  it('does not hide horizontal overflow at the document level', async () => {
    const globalsCss = await Bun.file(globalsCssPath).text();

    expect(globalsCss).not.toContain('overflow-x: hidden');
  });
});
