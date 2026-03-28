'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Button, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import AssignmentMatrix from '@/components/assign/AssignmentMatrix';

export default function AssignPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const router = useRouter();

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(`/queues/${queueId}`)}>
          Back
        </Button>
        <Typography variant="h4" fontWeight={700}>
          Assign Judges
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Check the boxes to assign judges to questions. Click a row to configure prompt fields.
      </Typography>
      <AssignmentMatrix queueId={queueId} />
    </>
  );
}
