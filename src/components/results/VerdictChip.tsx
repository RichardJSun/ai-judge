'use client';

import { Box, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material';
import type { EvalStatusEnum, VerdictEnum } from '@/types/db';

export interface VerdictChipProps {
  verdict: VerdictEnum | null;
  status: EvalStatusEnum | null | undefined;
}

interface VerdictChipPresentation {
  label: string;
  color: NonNullable<ChipProps['color']>;
  variant?: ChipProps['variant'];
}

const VERDICT_CONFIG: Record<VerdictEnum, VerdictChipPresentation> = {
  pass: { label: 'Pass', color: 'success' },
  fail: { label: 'Fail', color: 'error' },
  inconclusive: { label: 'Inconclusive', color: 'warning' },
};

const EVAL_STATUSES: EvalStatusEnum[] = ['pending', 'running', 'completed', 'error'];

function isEvalStatus(status: string | null | undefined): status is EvalStatusEnum {
  return typeof status === 'string' && EVAL_STATUSES.includes(status as EvalStatusEnum);
}

export function resolveVerdictChipPresentation({ verdict, status }: VerdictChipProps): VerdictChipPresentation {
  if (!isEvalStatus(status)) {
    return verdict
      ? VERDICT_CONFIG[verdict]
      : { label: 'Invalid state', color: 'warning', variant: 'outlined' };
  }

  if (status === 'error') {
    return { label: 'Error', color: 'error' };
  }

  if (status === 'running') {
    return { label: 'Running', color: 'info' };
  }

  if (status === 'pending') {
    return { label: 'Queued', color: 'default', variant: 'outlined' };
  }

  if (!verdict) {
    return { label: 'Review needed', color: 'warning', variant: 'outlined' };
  }

  return VERDICT_CONFIG[verdict];
}

export default function VerdictChip(props: VerdictChipProps) {
  const { label, color, variant } = resolveVerdictChipPresentation(props);

  return (
    <Box
      component="span"
      sx={(theme) => {
        const varsPalette = theme.vars?.palette;
        const defaultPaper = varsPalette?.background.paper ?? theme.palette.background.paper;
        const defaultText = varsPalette?.text.secondary ?? theme.palette.text.secondary;
        const accent =
          color === 'default'
            ? defaultText
            : (varsPalette?.[color]?.main ?? theme.palette[color].main);
        const backgroundColor =
          variant === 'outlined'
            ? `color-mix(in srgb, ${defaultPaper} 92%, ${accent} 8%)`
            : `color-mix(in srgb, ${accent} 14%, ${defaultPaper})`;
        const borderColor =
          variant === 'outlined'
            ? `color-mix(in srgb, ${accent} 34%, ${defaultPaper})`
            : `color-mix(in srgb, ${accent} 22%, ${defaultPaper})`;

        return {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.9,
          minWidth: 92,
          px: 1.15,
          py: 0.55,
          borderRadius: '10px',
          justifyContent: 'center',
          border: '1px solid',
          fontVariantNumeric: 'tabular-nums',
          color: accent,
          backgroundColor,
          borderColor,
          boxShadow:
            variant === 'outlined'
              ? 'none'
              : `inset 0 1px 0 color-mix(in srgb, ${defaultPaper} 72%, transparent)`,
        };
      }}
    >
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '999px',
          backgroundColor: 'currentColor',
          flexShrink: 0,
        }}
      />
      <Typography
        component="span"
        variant="caption"
        sx={{
          fontWeight: 800,
          letterSpacing: '0.03em',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
