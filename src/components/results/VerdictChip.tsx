'use client';

import { Chip } from '@mui/material';
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
  return <Chip label={label} size="small" color={color} variant={variant} />;
}
