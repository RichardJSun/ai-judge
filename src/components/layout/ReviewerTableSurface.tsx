import { Paper, TableContainer } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

export const REVIEWER_TABLE_SURFACE_TEST_ID = 'reviewer-table-surface';

export const reviewerTableSurfaceSx = {
  width: '100%',
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
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
