'use client';

import { Autocomplete, TextField } from '@mui/material';
import { SUPPORTED_MODELS } from '@/types/submission';

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  helperText?: string;
}

export default function ModelSelector({ value, onChange, error, helperText }: ModelSelectorProps) {
  return (
    <Autocomplete
      freeSolo
      options={[...SUPPORTED_MODELS]}
      fullWidth
      value={value}
      onInputChange={(_, newValue) => onChange(newValue)}
      onChange={(_, newValue) => onChange(newValue ?? '')}
      renderInput={(inputParams) => (
        <TextField
          {...inputParams}
          label="Model"
          error={error}
          helperText={helperText ?? 'Choose a supported model or type any gateway model ID'}
          required
        />
      )}
    />
  );
}
