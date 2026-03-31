'use client';

import { Alert, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { use, type ReactNode } from 'react';
import AssignmentMatrix from '@/components/assign/AssignmentMatrix';
import ReviewerWayfinding, {
  createQueueReviewerBreadcrumbs,
} from '@/components/navigation/ReviewerWayfinding';
import { SectionSurface } from '@/components/ui/editorial';

export const ASSIGN_PAGE_INTRO_COPY =
  'Check the boxes to assign judges to questions. Click a row to configure prompt fields.';

export const ASSIGN_PAGE_ATTACHMENT_COPY =
  'Stored attachment visibility stays on each submission detail page. Use this matrix to control whether a persisted assignment forwards those stored attachments when the judge runs.';

export interface AssignPageContentProps {
  queueId: string;
  onBack: () => void;
  assignmentMatrix: ReactNode;
}

export function AssignPageContent({
  queueId,
  onBack,
  assignmentMatrix,
}: AssignPageContentProps) {
  return (
    <>
      <ReviewerWayfinding
        title="Assign Judges"
        backLabel="Back to queue"
        onBack={onBack}
        breadcrumbs={createQueueReviewerBreadcrumbs(queueId, 'Assign Judges')}
      />
      <SectionSurface sx={{ p: { xs: 2, md: 2.5 }, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {ASSIGN_PAGE_INTRO_COPY}
        </Typography>
        <Alert severity="info">
          <Typography variant="body2" color="inherit">
            {ASSIGN_PAGE_ATTACHMENT_COPY}
          </Typography>
          <Typography variant="body2" color="inherit" sx={{ mt: 0.5 }}>
            Open a submission from Queue {queueId} to inspect attachment metadata and storage status.
          </Typography>
        </Alert>
      </SectionSurface>
      {assignmentMatrix}
    </>
  );
}

export default function AssignPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const router = useRouter();

  return (
    <AssignPageContent
      queueId={queueId}
      onBack={() => router.push(`/queues/${queueId}`)}
      assignmentMatrix={<AssignmentMatrix queueId={queueId} />}
    />
  );
}
