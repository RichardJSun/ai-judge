import { createTheme } from '@mui/material/styles';

export const bodyFontFamily = 'var(--font-geist-sans), system-ui, sans-serif';
export const displayFontFamily = 'var(--font-dm-serif-display), Georgia, serif';
export const monoFontFamily =
  '"SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
export const shellTypography = {
  brandTitle: {
    fontFamily: displayFontFamily,
    fontWeight: 400,
    lineHeight: 1.02,
    letterSpacing: '-0.03em',
  },
  metaLabel: {
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.5,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
  },
} as const;
export const editorialRadius = {
  surface: 12,
  control: 10,
  dialog: 14,
  pill: 999,
} as const;

export const editorialMotion = {
  fast: '120ms cubic-bezier(0.23, 1, 0.32, 1)',
  standard: '180ms cubic-bezier(0.23, 1, 0.32, 1)',
  expressive: '240ms cubic-bezier(0.77, 0, 0.175, 1)',
} as const;

export const theme = createTheme({
  cssVariables: {
    cssVarPrefix: 'ai-judge',
    colorSchemeSelector: 'class',
  },
  colorSchemes: {
    light: {
      palette: {
        mode: 'light',
        primary: {
          main: '#a26146',
          light: '#c18670',
          dark: '#7f422e',
          contrastText: '#fff9f4',
        },
        secondary: {
          main: '#3d7574',
          light: '#73a8a7',
          dark: '#244f4e',
          contrastText: '#f4fbfb',
        },
        success: {
          main: '#2f7d65',
        },
        warning: {
          main: '#bd7a2f',
        },
        error: {
          main: '#b84a4a',
        },
        info: {
          main: '#406d93',
        },
        background: {
          default: '#f5efe8',
          paper: '#fffaf4',
        },
        text: {
          primary: '#1f1a16',
          secondary: '#675b52',
        },
        divider: 'rgba(75, 59, 45, 0.12)',
      },
    },
    dark: {
      palette: {
        mode: 'dark',
        primary: {
          main: '#d69276',
          light: '#e5b39c',
          dark: '#b27156',
          contrastText: '#201614',
        },
        secondary: {
          main: '#74afad',
          light: '#95cbc9',
          dark: '#4e8382',
          contrastText: '#122020',
        },
        success: {
          main: '#6cc5a4',
        },
        warning: {
          main: '#e0a35e',
        },
        error: {
          main: '#de7d7d',
        },
        info: {
          main: '#88b1da',
        },
        background: {
          default: '#161311',
          paper: '#201b19',
        },
        text: {
          primary: '#f6ede3',
          secondary: '#bcaea1',
        },
        divider: 'rgba(246, 237, 227, 0.1)',
      },
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: bodyFontFamily,
    h1: {
      fontFamily: displayFontFamily,
      fontWeight: 400,
      lineHeight: 0.98,
      letterSpacing: '-0.04em',
    },
    h2: {
      fontFamily: displayFontFamily,
      fontWeight: 400,
      lineHeight: 1,
      letterSpacing: '-0.035em',
    },
    h3: {
      fontFamily: displayFontFamily,
      fontWeight: 400,
      lineHeight: 1.02,
      letterSpacing: '-0.03em',
    },
    h4: {
      fontFamily: displayFontFamily,
      fontWeight: 400,
      lineHeight: 1.05,
      letterSpacing: '-0.025em',
    },
    h5: {
      fontWeight: 700,
      lineHeight: 1.12,
      letterSpacing: '-0.02em',
    },
    h6: {
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: '-0.015em',
    },
    subtitle1: {
      fontWeight: 600,
    },
    subtitle2: {
      fontWeight: 600,
      letterSpacing: '0.01em',
    },
    body1: {
      lineHeight: 1.65,
    },
    body2: {
      lineHeight: 1.6,
    },
    button: {
      fontWeight: 600,
      letterSpacing: '0.01em',
      textTransform: 'none',
    },
    caption: {
      lineHeight: 1.5,
    },
    overline: {
      fontSize: '0.72rem',
      fontWeight: 700,
      lineHeight: 1.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (themeParam) => ({
        ':root': {
          colorScheme: themeParam.palette.mode,
        },
        body: {
          minHeight: '100vh',
          backgroundColor: themeParam.vars.palette.background.default,
          backgroundImage:
            `radial-gradient(circle at top, color-mix(in srgb, ${themeParam.vars.palette.primary.main} 16%, transparent), transparent 28%), radial-gradient(circle at 85% 12%, color-mix(in srgb, ${themeParam.vars.palette.secondary.main} 16%, transparent), transparent 30%)`,
          color: themeParam.vars.palette.text.primary,
        },
      }),
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: ({ theme: themeParam }) => ({
          borderRadius: editorialRadius.control + 2,
          paddingInline: themeParam.spacing(1.6),
          paddingBlock: themeParam.spacing(1.15),
          transition: [
            `transform ${editorialMotion.fast}`,
            `background-color ${editorialMotion.standard}`,
            `border-color ${editorialMotion.standard}`,
            `box-shadow ${editorialMotion.standard}`,
            `color ${editorialMotion.standard}`,
          ].join(', '),
          '&:hover': {
            transform: 'translateY(-1px)',
          },
          '&:active': {
            transform: 'translateY(1px) scale(0.985)',
          },
        }),
        contained: ({ theme: themeParam }) => ({
          color: themeParam.vars.palette.primary.contrastText,
          background:
            `linear-gradient(135deg, ${themeParam.vars.palette.primary.dark} 0%, ${themeParam.vars.palette.primary.main} 100%)`,
          boxShadow: 'none',
          '&:hover': {
            boxShadow: `0 16px 34px color-mix(in srgb, ${themeParam.vars.palette.primary.main} 28%, transparent)`,
          },
        }),
        outlined: ({ theme: themeParam }) => ({
          borderColor: themeParam.vars.palette.divider,
          backgroundColor: 'color-mix(in srgb, var(--ai-judge-palette-background-paper) 88%, transparent)',
          '&:hover': {
            borderColor: themeParam.vars.palette.primary.main,
            backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.primary.main} 8%, ${themeParam.vars.palette.background.paper})`,
          },
        }),
        text: ({ theme: themeParam }) => ({
          '&:hover': {
            backgroundColor: themeParam.vars.palette.action.hover,
          },
        }),
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
        variant: 'outlined',
      },
      styleOverrides: {
        root: ({ theme: themeParam }) => ({
          backgroundImage: 'none',
          borderColor: themeParam.vars.palette.divider,
        }),
      },
    },
    MuiChip: {
      styleOverrides: {
        root: () => ({
          borderRadius: editorialRadius.pill,
          fontWeight: 600,
        }),
        filled: ({ theme: themeParam }) => ({
          backgroundColor: themeParam.vars.palette.action.hover,
        }),
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: () => ({
          border: 'none',
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme: themeParam }) => ({
          borderRadius: editorialRadius.dialog,
          overflow: 'hidden',
          borderColor: themeParam.vars.palette.divider,
          backgroundImage:
            `linear-gradient(180deg, color-mix(in srgb, ${themeParam.vars.palette.primary.main} 10%, transparent), transparent 18%)`,
        }),
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: editorialRadius.surface,
        },
        standardInfo: ({ theme: themeParam }) => ({
          backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.info.main} 14%, transparent)`,
          color: themeParam.vars.palette.text.primary,
        }),
        standardWarning: ({ theme: themeParam }) => ({
          backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.warning.main} 14%, transparent)`,
          color: themeParam.vars.palette.text.primary,
        }),
        standardError: ({ theme: themeParam }) => ({
          backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.error.main} 14%, transparent)`,
          color: themeParam.vars.palette.text.primary,
        }),
        standardSuccess: ({ theme: themeParam }) => ({
          backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.success.main} 14%, transparent)`,
          color: themeParam.vars.palette.text.primary,
        }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme: themeParam }) => ({
          borderRadius: editorialRadius.control,
          backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.background.paper} 90%, transparent)`,
          transition: `border-color ${editorialMotion.standard}, box-shadow ${editorialMotion.standard}, background-color ${editorialMotion.standard}`,
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: themeParam.vars.palette.text.secondary,
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 4px color-mix(in srgb, ${themeParam.vars.palette.primary.main} 18%, transparent)`,
          },
        }),
        notchedOutline: ({ theme: themeParam }) => ({
          borderColor: themeParam.vars.palette.divider,
        }),
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: ({ theme: themeParam }) => ({
          color: themeParam.vars.palette.text.secondary,
        }),
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: ({ theme: themeParam }) => ({
          marginTop: themeParam.spacing(1),
          borderRadius: editorialRadius.surface,
          borderColor: themeParam.vars.palette.divider,
        }),
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme: themeParam }) => ({
          borderBottomColor: themeParam.vars.palette.divider,
          paddingTop: themeParam.spacing(1.4),
          paddingBottom: themeParam.spacing(1.4),
        }),
        head: ({ theme: themeParam }) => ({
          fontSize: '0.74rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: themeParam.vars.palette.text.secondary,
          backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.background.paper} 92%, transparent)`,
        }),
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: ({ theme: themeParam }) => ({
          transition: `background-color ${editorialMotion.standard}`,
          '&.MuiTableRow-hover:hover': {
            backgroundColor: `color-mix(in srgb, ${themeParam.vars.palette.primary.main} 6%, transparent)`,
          },
        }),
      },
    },
    MuiBreadcrumbs: {
      styleOverrides: {
        li: ({ theme: themeParam }) => ({
          color: themeParam.vars.palette.text.secondary,
        }),
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          padding: 10,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme: themeParam }) => ({
          borderRadius: editorialRadius.control,
          backgroundColor: themeParam.vars.palette.text.primary,
          color: themeParam.vars.palette.background.default,
        }),
      },
    },
  },
});
