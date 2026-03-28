import { describe, expect, it } from 'bun:test';
import { SHELL_LAYOUT, appShellMainSx, navSidebarDrawerSx } from './shell-layout';

const globalsCssPath = new URL('../../app/globals.css', import.meta.url);

describe('SHELL_LAYOUT', () => {
  it('keeps the permanent drawer width in one shared contract', () => {
    expect(SHELL_LAYOUT.drawerWidth).toBe(208);
    expect(navSidebarDrawerSx.width).toBe(SHELL_LAYOUT.drawerWidth);
    expect(navSidebarDrawerSx['& .MuiDrawer-paper'].width).toBe(SHELL_LAYOUT.drawerWidth);
  });

  it('keeps main content adjacent to the drawer instead of offsetting it a second time', () => {
    expect(appShellMainSx.flexGrow).toBe(1);
    expect(appShellMainSx.minWidth).toBe(0);
    expect(appShellMainSx.minHeight).toBe('100vh');
    expect(appShellMainSx.bgcolor).toBe('background.default');
    expect('ml' in appShellMainSx).toBe(false);
    expect('marginLeft' in appShellMainSx).toBe(false);
    expect('pl' in appShellMainSx).toBe(false);
    expect('paddingLeft' in appShellMainSx).toBe(false);
  });

  it('keeps laptop-friendly horizontal padding in the shared shell contract', () => {
    expect(SHELL_LAYOUT.mainPaddingX).toEqual({ xs: 2, md: 3 });
    expect(SHELL_LAYOUT.mainPaddingY).toBe(3);
    expect(appShellMainSx.px).toEqual(SHELL_LAYOUT.mainPaddingX);
    expect(appShellMainSx.py).toBe(SHELL_LAYOUT.mainPaddingY);
  });

  it('does not hide horizontal overflow at the document level', async () => {
    const globalsCss = await Bun.file(globalsCssPath).text();

    expect(globalsCss).not.toContain('overflow-x: hidden');
  });
});
