'use client';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import type { UploadResult } from '@/types/api';

interface UploadPreviewProps {
  result: UploadResult;
  onReset: () => void;
}

export default function UploadPreview({ result, onReset }: UploadPreviewProps) {
  const router = useRouter();

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <CheckCircleIcon color="success" />
        <Typography variant="h6">Upload successful</Typography>
      </Stack>
      <Stack direction="row" spacing={1} flexWrap="wrap" mb={3}>
        <Chip label={`${result.queues} queue${result.queues !== 1 ? 's' : ''}`} color="primary" variant="outlined" />
        <Chip label={`${result.submissions} submission${result.submissions !== 1 ? 's' : ''}`} variant="outlined" />
        <Chip label={`${result.questions} question template${result.questions !== 1 ? 's' : ''}`} variant="outlined" />
        <Chip label={`${result.answers} answer${result.answers !== 1 ? 's' : ''}`} variant="outlined" />
        <Chip label={`${result.attachments ?? 0} attachment${(result.attachments ?? 0) !== 1 ? 's' : ''}`} variant="outlined" />
      </Stack>
      <Box display="flex" gap={1}>
        <Button variant="contained" onClick={() => router.push('/queues')}>
          View Queues
        </Button>
        <Button variant="outlined" onClick={onReset}>
          Upload Another
        </Button>
      </Box>
    </Paper>
  );
}
