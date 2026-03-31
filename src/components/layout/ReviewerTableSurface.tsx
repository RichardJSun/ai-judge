import { Paper, TableContainer } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { editorialRadius } from '@/components/ui/theme';

export const REVIEWER_TABLE_SURFACE_TEST_ID = 'reviewer-table-surface';

export const reviewerTableSurfaceSx = {
  width: '100%',
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  borderRadius: `${editorialRadius.surface}px`,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.paper',
  backgroundImage:
    'linear-gradient(180deg, color-mix(in srgb, var(--ai-judge-palette-primary-main) 6%, transparent), transparent 14%)',
} satisfies SxProps<Theme>;

interface ReviewerTableSurfaceProps {
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export default function ReviewerTableSurface({ children, sx }: ReviewerTableSurfaceProps) {
  return (
    <TableContainer
      component={Paper}
      data-testid={REVIEWER_TABLE_SURFACE_TEST_ID}
      data-overflow-surface="reviewer-table"
      sx={Array.isArray(sx) ? [reviewerTableSurfaceSx, ...sx] : [reviewerTableSurfaceSx, sx]}
    >
      {children}
    </TableContainer>
  );
}
