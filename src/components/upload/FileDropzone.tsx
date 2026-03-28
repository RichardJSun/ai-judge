'use client';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import type { UploadResult } from '@/types/api';

interface FileDropzoneProps {
  onSuccess: (result: UploadResult) => void;
}

export default function FileDropzone({ onSuccess }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      onSuccess(data as UploadResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <Box>
      <Paper
        sx={{
          border: '2px dashed',
          borderColor: dragging ? 'primary.main' : 'divider',
          borderRadius: 2,
          p: 6,
          textAlign: 'center',
          cursor: loading ? 'not-allowed' : 'pointer',
          bgcolor: dragging ? 'action.hover' : 'background.paper',
          transition: 'border-color 0.2s, background-color 0.2s',
        }}
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {loading ? (
          <CircularProgress />
        ) : (
          <>
            <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6">Drop your JSON file here</Typography>
            <Typography variant="body2" color="text.secondary">
              or click to browse
            </Typography>
          </>
        )}
      </Paper>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </Box>
  );
}
