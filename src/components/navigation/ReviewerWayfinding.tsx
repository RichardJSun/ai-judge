'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, Breadcrumbs, Button, Stack, Typography } from '@mui/material';
import Link from 'next/link';
import type { MouseEvent } from 'react';
import { SectionSurface } from '@/components/ui/editorial';
import { buildQueueSubmissionsHref } from '@/lib/queues/queue-submissions-page-url';
import { buildQueueResultsHref } from '@/lib/results/results-page-url';

export interface ReviewerWayfindingBreadcrumb {
    label: string;
    href?: string;
    current?: boolean;
}

export interface ReviewerWayfindingProps {
    title: string;
    backLabel: string;
    backHref?: string;
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
    currentLabel = 'Submission detail',
    {
        queueHref,
        resultsHref,
    }: {
        queueHref?: string;
        resultsHref?: string;
    } = {}
): ReviewerWayfindingBreadcrumb[] {
    assertNonEmpty(queueId, 'queueId');
    assertNonEmpty(currentLabel, 'currentLabel');

    const breadcrumbs: ReviewerWayfindingBreadcrumb[] = [
        { label: 'Queues', href: '/queues' },
        {
            label: queueId,
            href: source === 'queue' ? (queueHref ?? buildQueueSubmissionsHref(queueId, {})) : `/queues/${queueId}`,
        },
    ];

    if (source === 'results') {
        breadcrumbs.push({ label: 'Results', href: resultsHref ?? buildQueueResultsHref(queueId, {}) });
    }

    breadcrumbs.push({ label: currentLabel, current: true });

    return breadcrumbs;
}

export default function ReviewerWayfinding({
  title,
  backLabel,
    backHref,
    onBack,
    breadcrumbs = [],
}: ReviewerWayfindingProps) {
    assertNonEmpty(title, 'title');
    assertNonEmpty(backLabel, 'backLabel');
    validateBreadcrumbs(breadcrumbs);

    const handleBackClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
        if (backHref) {
            event.preventDefault();
        }

        onBack();
    };

    return (
        <Box mb={3}>
            <SectionSurface sx={{ p: { xs: 2, md: 2.5 } }}>
                <Stack spacing={1.5}>
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

                    <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        alignItems={{ xs: 'flex-start', md: 'center' }}
                        justifyContent="space-between"
                        spacing={1.25}
                    >
                        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1.25}>
                            <Button
                                startIcon={<ArrowBackIcon />}
                                aria-label={backLabel}
                                onClick={handleBackClick}
                                component={backHref ? Link : 'button'}
                                href={backHref}
                                variant="outlined"
                            >
                                {backLabel}
                            </Button>
                            <Typography component="h1" variant="h4" sx={{ overflowWrap: 'anywhere' }}>
                                {title}
                            </Typography>
                        </Stack>
                    </Stack>
                </Stack>
            </SectionSurface>
        </Box>
    );
}
