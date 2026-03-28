'use client';

import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import ModelSelector from './ModelSelector';
import type { Judge } from '@/types/db';

interface JudgeFormProps {
  initial?: Partial<Judge>;
  onSave: (data: { name: string; system_prompt: string; model: string; active: boolean }) => Promise<void>;
  onCancel?: () => void;
}

export default function JudgeForm({ initial, onSave, onCancel }: JudgeFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? '');
  const [model, setModel] = useState(initial?.model ?? 'openai/gpt-4o-mini');
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ name, system_prompt: systemPrompt, model, active });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <TextField
          label="System Prompt / Rubric"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          multiline
          minRows={4}
          required
          helperText="Describe how the judge should evaluate answers and when to pass/fail/mark inconclusive."
        />
        <ModelSelector value={model} onChange={setModel} />
        <FormControlLabel
          control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
          label="Active"
        />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : 'Save Judge'}
          </Button>
          {onCancel && (
            <Button variant="outlined" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
