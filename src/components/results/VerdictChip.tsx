'use client';

import { Chip } from '@mui/material';
import type { VerdictEnum } from '@/types/db';

const VERDICT_CONFIG: Record<VerdictEnum, { label: string; color: 'success' | 'error' | 'warning' }> = {
  pass: { label: 'Pass', color: 'success' },
  fail: { label: 'Fail', color: 'error' },
  inconclusive: { label: 'Inconclusive', color: 'warning' },
};

export default function VerdictChip({ verdict }: { verdict: VerdictEnum | null }) {
  if (!verdict) return <Chip label="Pending" size="small" variant="outlined" />;
  const { label, color } = VERDICT_CONFIG[verdict];
  return <Chip label={label} size="small" color={color} />;
}
