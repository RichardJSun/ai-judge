import { Button, Stack, Typography } from '@mui/material';
import Link from 'next/link';

export const REVIEWER_PAGINATION_LABEL = 'Reviewer pagination';

export type ReviewerPaginationItem = number | 'ellipsis';

export interface ReviewerPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  getHref: (page: number) => string;
  ariaLabel?: string;
}

export function getReviewerTotalPages(pageSize: number, total: number) {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error('Expected pageSize to be a positive safe integer.');
  }

  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Expected total to be a non-negative safe integer.');
  }

  return Math.max(1, Math.ceil(total / pageSize));
}

export function getReviewerPaginationItems(page: number, totalPages: number): ReviewerPaginationItem[] {
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new Error('Expected page to be a positive safe integer.');
  }

  if (!Number.isSafeInteger(totalPages) || totalPages <= 0) {
    throw new Error('Expected totalPages to be a positive safe integer.');
  }

  if (page > totalPages) {
    throw new Error('Expected page to be within totalPages.');
  }

  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const visiblePages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const orderedPages = Array.from(visiblePages)
    .filter((candidate) => candidate >= 1 && candidate <= totalPages)
    .sort((left, right) => left - right);

  const items: ReviewerPaginationItem[] = [];

  for (const candidate of orderedPages) {
    const previous = items[items.length - 1];

    if (typeof previous === 'number' && candidate - previous > 1) {
      if (candidate - previous === 2) {
        items.push(previous + 1);
      } else {
        items.push('ellipsis');
      }
    }

    items.push(candidate);
  }

  return items;
}

export default function ReviewerPagination({
  page,
  pageSize,
  total,
  getHref,
  ariaLabel = REVIEWER_PAGINATION_LABEL,
}: ReviewerPaginationProps) {
  const totalPages = getReviewerTotalPages(pageSize, total);

  if (totalPages <= 1) {
    return null;
  }

  const items = getReviewerPaginationItems(page, totalPages);

  return (
    <Stack
      component="nav"
      aria-label={ariaLabel}
      direction="row"
      spacing={0.75}
      flexWrap="wrap"
      useFlexGap
      alignItems="center"
      justifyContent="flex-end"
    >
      {page <= 1 ? (
        <Button size="small" disabled>
          Previous
        </Button>
      ) : (
        <Button size="small" component={Link} href={getHref(page - 1)}>
          Previous
        </Button>
      )}

      {items.map((item, index) => {
        if (item === 'ellipsis') {
          return (
            <Typography key={`ellipsis-${index}`} component="span" color="text.secondary" aria-hidden="true">
              …
            </Typography>
          );
        }

        if (item === page) {
          return (
            <Button key={item} size="small" variant="contained" aria-current="page" disableElevation>
              {item}
            </Button>
          );
        }

        return (
          <Button
            key={item}
            size="small"
            component={Link}
            href={getHref(item)}
            aria-label={`Go to page ${item}`}
          >
            {item}
          </Button>
        );
      })}

      {page >= totalPages ? (
        <Button size="small" disabled>
          Next
        </Button>
      ) : (
        <Button size="small" component={Link} href={getHref(page + 1)}>
          Next
        </Button>
      )}
    </Stack>
  );
}
