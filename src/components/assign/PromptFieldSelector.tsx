'use client';

import { Box, Chip, FormHelperText, FormLabel, Stack } from '@mui/material';

const AVAILABLE_FIELDS = [
  { key: 'questionText', label: 'Question Text' },
  { key: 'answer', label: 'Answer' },
  { key: 'questionType', label: 'Question Type' },
];

interface PromptFieldSelectorProps {
  value: string[];
  onChange: (fields: string[]) => void;
}

export default function PromptFieldSelector({ value, onChange }: PromptFieldSelectorProps) {
  function toggle(key: string) {
    if (value.includes(key)) {
      onChange(value.filter((f) => f !== key));
    } else {
      onChange([...value, key]);
    }
  }

  return (
    <Box>
      <FormLabel sx={{ display: 'block', mb: 1, fontSize: 13 }}>
        Prompt Fields
      </FormLabel>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {AVAILABLE_FIELDS.map(({ key, label }) => (
          <Chip
            key={key}
            label={label}
            onClick={() => toggle(key)}
            color={value.includes(key) ? 'primary' : 'default'}
            variant={value.includes(key) ? 'filled' : 'outlined'}
            size="small"
            clickable
          />
        ))}
      </Stack>
      <FormHelperText>Choose which fields are sent to the judge in the prompt.</FormHelperText>
    </Box>
  );
}
