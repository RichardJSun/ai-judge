'use client';

import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { startTransition, useMemo, useState } from 'react';
import { editorialRadius } from '@/components/ui/theme';
import { normalizeThemeModeChoice, type ThemeModeChoice } from './theme-preference';

const THEME_MODE_OPTIONS: Array<{
  value: ThemeModeChoice;
  label: string;
  icon: typeof LightModeRoundedIcon;
}> = [
  { value: 'light', label: 'Light', icon: LightModeRoundedIcon },
  { value: 'dark', label: 'Dark', icon: DarkModeRoundedIcon },
  { value: 'system', label: 'System', icon: DesktopWindowsRoundedIcon },
];

function getThemeModeLabel(mode: ThemeModeChoice) {
  return THEME_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'System';
}

export default function ThemeModeControl() {
  const { mode, setMode } = useColorScheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const resolvedMode = normalizeThemeModeChoice(mode);
  const currentOption = useMemo(
    () => THEME_MODE_OPTIONS.find((option) => option.value === resolvedMode) ?? THEME_MODE_OPTIONS[2],
    [resolvedMode]
  );
  const CurrentIcon = currentOption.icon;

  return (
    <>
      <Tooltip title={`Theme: ${getThemeModeLabel(resolvedMode)}`}>
        <IconButton
          aria-label="Open theme mode menu"
          aria-controls={anchorEl ? 'theme-mode-menu' : undefined}
          aria-expanded={anchorEl ? 'true' : undefined}
          aria-haspopup="menu"
          color="inherit"
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            borderRadius: `${editorialRadius.control}px`,
          }}
        >
          <CurrentIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        id="theme-mode-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        keepMounted
      >
        {THEME_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.value === resolvedMode;

          return (
            <MenuItem
              key={option.value}
              selected={selected}
              onClick={() => {
                startTransition(() => {
                  setMode(option.value);
                });
                setAnchorEl(null);
              }}
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{option.label}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
