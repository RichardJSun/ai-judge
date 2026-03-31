'use client';

import FileDropzone from '@/components/upload/FileDropzone';
import UploadPreview from '@/components/upload/UploadPreview';
import { Stack } from '@mui/material';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/editorial';
import type { UploadResult } from '@/types/api';

export default function UploadPage() {
  const [result, setResult] = useState<UploadResult | null>(null);

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Ingest"
        title="Upload Submissions"
        description="Upload a JSON file containing submissions to get started."
      />
      {result ? (
        <UploadPreview result={result} onReset={() => setResult(null)} />
      ) : (
        <FileDropzone onSuccess={setResult} />
      )}
    </Stack>
  );
}
