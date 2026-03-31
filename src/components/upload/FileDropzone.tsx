'use client';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { editorialRadius } from '@/components/ui/theme';
import type { UploadResult } from '@/types/api';

interface FileDropzoneProps {
  onSuccess: (result: UploadResult) => void;
}

export default function FileDropzone({ onSuccess }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openFilePicker() {
    if (loading) {
      return;
    }

    inputRef.current?.click();
  }

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

  function handleKeyDown(event: React.KeyboardEvent) {
    if (loading) {
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    openFilePicker();
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
          borderRadius: `${editorialRadius.surface}px`,
          p: { xs: 4, md: 6 },
          textAlign: 'center',
          cursor: loading ? 'not-allowed' : 'pointer',
          bgcolor: dragging ? 'action.hover' : 'background.paper',
          backgroundImage:
            'linear-gradient(150deg, color-mix(in srgb, var(--ai-judge-palette-primary-main) 12%, transparent), transparent 42%, color-mix(in srgb, var(--ai-judge-palette-secondary-main) 12%, transparent))',
          boxShadow: dragging
            ? '0 18px 40px color-mix(in srgb, var(--ai-judge-palette-primary-main) 20%, transparent)'
            : 'none',
          transition:
            'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
          touchAction: 'manipulation',
          outline: 'none',
          '&:focus-visible': {
            borderColor: 'primary.main',
            boxShadow: (theme) => `0 0 0 4px ${theme.palette.primary.main}1f`,
          },
          '&:active': loading
            ? undefined
            : {
                transform: 'scale(0.995)',
              },
        }}
        role="button"
        tabIndex={loading ? -1 : 0}
        aria-disabled={loading ? 'true' : undefined}
        aria-label="Upload submission JSON file"
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {loading ? (
          <CircularProgress />
        ) : (
          <>
            <CloudUploadIcon aria-hidden="true" sx={{ fontSize: 52, color: 'primary.main', mb: 1 }} />
            <Typography variant="h4" sx={{ fontSize: { xs: '1.75rem', md: '2.1rem' }, mb: 0.75 }}>
              Drop your JSON file here
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Click, press Enter, or drop a file to browse
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              JSON queue only, up to 50 MB.
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
