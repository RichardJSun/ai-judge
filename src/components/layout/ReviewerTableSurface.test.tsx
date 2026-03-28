import { Table, TableBody, TableCell, TableRow } from '@mui/material';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewerTableSurface, {
  REVIEWER_TABLE_SURFACE_TEST_ID,
  reviewerTableSurfaceSx,
} from './ReviewerTableSurface';

describe('ReviewerTableSurface', () => {
  it('pins the adjacent reviewer overflow contract to a local scroll surface', () => {
    expect(reviewerTableSurfaceSx).toMatchObject({
      width: '100%',
      minWidth: 0,
      overflowX: 'auto',
      overflowY: 'hidden',
    });
  });

  it('renders one identifiable wrapper around reviewer tables', () => {
    const html = renderToStaticMarkup(
      <ReviewerTableSurface>
        <Table sx={{ minWidth: 960 }}>
          <TableBody>
            <TableRow>
              <TableCell>Queue 2026-03-28T12:00:00.000Z</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ReviewerTableSurface>
    );

    expect(html).toContain(`data-testid="${REVIEWER_TABLE_SURFACE_TEST_ID}"`);
    expect(html).toContain('data-overflow-surface="reviewer-table"');
    expect(html).toContain('<table');
    expect(html).toContain('Queue 2026-03-28T12:00:00.000Z');
  });
});
