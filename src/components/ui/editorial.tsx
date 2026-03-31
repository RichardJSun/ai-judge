'use client';

import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import type { ChipProps, PaperProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { editorialRadius } from '@/components/ui/theme';

type StatusBadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';
type StatusBadgeVariant = 'soft' | 'outline';

const statusBadgeColorMap: Record<StatusBadgeTone, NonNullable<ChipProps['color']>> = {
  neutral: 'default',
  accent: 'primary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export function ActionCluster({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      justifyContent={{ xs: 'stretch', md: 'flex-end' }}
      sx={sx}
    >
      {children}
    </Stack>
  );
}

export function SectionSurface({
  children,
  sx,
  ...props
}: PaperProps & { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper
      variant="outlined"
      sx={[
        (theme) => {
          const varsPalette = theme.vars?.palette;
          const divider = varsPalette?.divider ?? theme.palette.divider;
          const paper = varsPalette?.background.paper ?? theme.palette.background.paper;
          const primary = varsPalette?.primary.main ?? theme.palette.primary.main;
          const secondary = varsPalette?.secondary.main ?? theme.palette.secondary.main;

          return {
            position: 'relative',
            overflow: 'hidden',
            borderRadius: `${editorialRadius.surface}px`,
            borderColor: divider,
            backgroundColor: paper,
            boxShadow: `0 1px 0 color-mix(in srgb, ${divider} 82%, transparent)`,
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background:
                `linear-gradient(140deg, color-mix(in srgb, ${primary} 10%, transparent), transparent 42%, color-mix(in srgb, ${secondary} 10%, transparent))`,
              opacity: 0.55,
            },
            ...theme.applyStyles('dark', {
              backgroundColor: paper,
              '&::before': {
                opacity: 0.38,
              },
            }),
          };
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...props}
    >
      {children}
    </Paper>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <SectionSurface sx={{ p: { xs: 2.5, md: 3 } }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2.5} justifyContent="space-between" alignItems="flex-start">
        <Box minWidth={0} maxWidth={760}>
          {eyebrow ? (
            <Typography
              variant="overline"
              sx={{
                display: 'block',
                mb: 0.75,
                color: 'text.secondary',
                letterSpacing: '0.18em',
              }}
            >
              {eyebrow}
            </Typography>
          ) : null}
          <Typography
            component="h1"
            variant="h4"
            sx={{
              mb: description ? 0.75 : 0,
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </Typography>
          {description ? (
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 64 * 8 }}>
              {description}
            </Typography>
          ) : null}
        </Box>
        {actions ? <ActionCluster sx={{ width: { xs: '100%', lg: 'auto' } }}>{actions}</ActionCluster> : null}
      </Stack>
    </SectionSurface>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <SectionSurface sx={{ p: 2.25, minHeight: '100%' }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', letterSpacing: '0.14em' }}>
        {label}
      </Typography>
      <Typography
        variant="h3"
        sx={{
          mt: 1,
          fontSize: { xs: '2rem', md: '2.375rem' },
          lineHeight: 1,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
      {hint ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
          {hint}
        </Typography>
      ) : null}
    </SectionSurface>
  );
}

export function InlineStat({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={600}>
        {value}
      </Typography>
    </Box>
  );
}

export function FilterToolbar({
  label,
  children,
}: {
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionSurface sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={1.5}>
        {label ? (
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.16em' }}>
            {label}
          </Typography>
        ) : null}
        {children}
      </Stack>
    </SectionSurface>
  );
}

export function EmptyStatePanel({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <SectionSurface sx={{ p: { xs: 3, md: 4 }, textAlign: 'center' }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 560, mx: 'auto' }}>
        {description}
      </Typography>
      {actions ? (
        <ActionCluster
          sx={{
            mt: 2.5,
            justifyContent: 'center',
          }}
        >
          {actions}
        </ActionCluster>
      ) : null}
    </SectionSurface>
  );
}

export function StatusBadge({
  label,
  tone = 'neutral',
  variant = 'soft',
}: {
  label: ReactNode;
  tone?: StatusBadgeTone;
  variant?: StatusBadgeVariant;
}) {
  return (
    <Chip
      label={label}
      size="small"
      color={statusBadgeColorMap[tone]}
      variant={variant === 'outline' ? 'outlined' : 'filled'}
      sx={(theme) => {
        const paletteKey = statusBadgeColorMap[tone];
        const varsPalette = theme.vars?.palette;
        const accentColor =
          paletteKey === 'default'
            ? varsPalette?.text.primary ?? theme.palette.text.primary
            : varsPalette?.[paletteKey].main ?? theme.palette[paletteKey].main;

        return {
          borderRadius: 999,
          height: 28,
          fontWeight: 600,
          letterSpacing: '0.01em',
          ...(variant === 'soft'
            ? {
                backgroundColor:
                  paletteKey === 'default'
                    ? varsPalette?.action.hover ?? theme.palette.action.hover
                    : `color-mix(in srgb, ${accentColor} 14%, transparent)`,
                color: accentColor,
              }
            : {}),
        };
      }}
    />
  );
}
