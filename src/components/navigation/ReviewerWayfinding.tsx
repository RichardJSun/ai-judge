'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Breadcrumbs, Button, Stack, Typography } from '@mui/material';
import Link from 'next/link';

export interface ReviewerWayfindingBreadcrumb {
  label: string;
  href?: string;
  current?: boolean;
}

export interface ReviewerWayfindingProps {
  title: string;
  backLabel: string;
  onBack: () => void;
  breadcrumbs?: ReviewerWayfindingBreadcrumb[];
}

function assertNonEmpty(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new Error(`ReviewerWayfinding requires a non-empty ${fieldName}.`);
  }
}

function validateBreadcrumbs(breadcrumbs: ReviewerWayfindingBreadcrumb[]) {
  breadcrumbs.forEach((breadcrumb, index) => {
    assertNonEmpty(breadcrumb.label, `breadcrumbs[${index}].label`);
  });
}

export function createQueueReviewerBreadcrumbs(
  queueId: string,
  currentLabel: string
): ReviewerWayfindingBreadcrumb[] {
  assertNonEmpty(queueId, 'queueId');
  assertNonEmpty(currentLabel, 'currentLabel');

  return [
    { label: 'Queues', href: '/queues' },
    { label: queueId, href: `/queues/${queueId}` },
    { label: currentLabel, current: true },
  ];
}

export function createSubmissionDetailBreadcrumbs(
  queueId: string,
  source: 'queue' | 'results',
  currentLabel = 'Submission detail'
): ReviewerWayfindingBreadcrumb[] {
  assertNonEmpty(queueId, 'queueId');
  assertNonEmpty(currentLabel, 'currentLabel');

  const breadcrumbs: ReviewerWayfindingBreadcrumb[] = [
    { label: 'Queues', href: '/queues' },
    { label: queueId, href: `/queues/${queueId}` },
  ];

  if (source === 'results') {
    breadcrumbs.push({ label: 'Results', href: `/queues/${queueId}/results` });
  }

  breadcrumbs.push({ label: currentLabel, current: true });

  return breadcrumbs;
}

export default function ReviewerWayfinding({
  title,
  backLabel,
  onBack,
  breadcrumbs = [],
}: ReviewerWayfindingProps) {
  assertNonEmpty(title, 'title');
  assertNonEmpty(backLabel, 'backLabel');
  validateBreadcrumbs(breadcrumbs);

  return (
    <Stack spacing={1.5} mb={3}>
      {breadcrumbs.length > 0 ? (
        <Breadcrumbs aria-label={`${title} breadcrumbs`}>
          {breadcrumbs.map((breadcrumb, index) => {
            const href = breadcrumb.href;
            const isCurrent = breadcrumb.current || index === breadcrumbs.length - 1 || !href;

            return isCurrent ? (
              <Typography key={`${breadcrumb.label}-${index}`} variant="body2" color="text.primary">
                {breadcrumb.label}
              </Typography>
            ) : (
              <Link
                key={`${breadcrumb.label}-${index}`}
                href={href}
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {breadcrumb.label}
              </Link>
            );
          })}
        </Breadcrumbs>
      ) : null}

      <Stack direction="row" alignItems="center" spacing={1}>
        <Button startIcon={<ArrowBackIcon />} onClick={onBack} aria-label={backLabel}>
          {backLabel}
        </Button>
        <Typography component="h1" variant="h4" fontWeight={700}>
          {title}
        </Typography>
      </Stack>
    </Stack>
  );
}
