'use client';

import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import ModelSelector from './ModelSelector';
import type { Judge } from '@/types/db';

interface JudgeFormProps {
  initial?: Partial<Judge>;
  onSave: (data: { name: string; system_prompt: string; model: string; active: boolean }) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function JudgeForm({ initial, onSave, onCancel, submitLabel }: JudgeFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? '');
  const [model, setModel] = useState(initial?.model ?? 'openai/gpt-4o-mini');
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initial?.name ?? '');
    setSystemPrompt(initial?.system_prompt ?? '');
    setModel(initial?.model ?? 'openai/gpt-4o-mini');
    setActive(initial?.active ?? true);
    setError(null);
  }, [
    initial?.id,
    initial?.updated_at,
    initial?.name,
    initial?.system_prompt,
    initial?.model,
    initial?.active,
  ]);

  const trimmedName = useMemo(() => name.trim(), [name]);
  const trimmedPrompt = useMemo(() => systemPrompt.trim(), [systemPrompt]);
  const trimmedModel = useMemo(() => model.trim(), [model]);
  const submitDisabled = saving || !trimmedName || !trimmedPrompt || !trimmedModel;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: trimmedName,
        system_prompt: trimmedPrompt,
        model: trimmedModel,
        active,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Alert severity={active ? 'info' : 'warning'}>
          {active
            ? 'Active judges remain available for assignments and runs.'
            : 'Inactive judges stay persisted for history and can be reactivated later.'}
        </Alert>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          error={!trimmedName && name.length > 0}
          helperText={!trimmedName && name.length > 0 ? 'Name cannot be blank.' : undefined}
        />
        <TextField
          label="System Prompt / Rubric"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          multiline
          minRows={4}
          required
          error={!trimmedPrompt && systemPrompt.length > 0}
          helperText={
            !trimmedPrompt && systemPrompt.length > 0
              ? 'System prompt cannot be blank.'
              : 'Describe how the judge should evaluate answers and when to pass/fail/mark inconclusive.'
          }
        />
        <Box>
          <ModelSelector value={model} onChange={setModel} />
          {!trimmedModel && model.length > 0 ? (
            <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
              Model cannot be blank.
            </Typography>
          ) : null}
        </Box>
        <FormControlLabel
          control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
          label={active ? 'Judge is active' : 'Judge is inactive'}
        />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={submitDisabled}>
            {saving ? 'Saving…' : submitLabel ?? (initial?.id ? 'Save Changes' : 'Save Judge')}
          </Button>
          {onCancel ? (
            <Button variant="outlined" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  );
}
