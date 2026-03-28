'use client';

import FileDropzone from '@/components/upload/FileDropzone';
import UploadPreview from '@/components/upload/UploadPreview';
import { Typography } from '@mui/material';
import { useState } from 'react';
import type { UploadResult } from '@/types/api';

export default function UploadPage() {
  const [result, setResult] = useState<UploadResult | null>(null);

  return (
    <>
      <Typography variant="h4" fontWeight={700} mb={1}>
        Upload Submissions
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>
        Upload a JSON file containing submissions to get started.
      </Typography>

      {result ? (
        <UploadPreview result={result} onReset={() => setResult(null)} />
      ) : (
        <FileDropzone onSuccess={setResult} />
      )}
    </>
  );
}
