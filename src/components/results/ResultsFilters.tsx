'use client';

import {
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
} from '@mui/material';
import type { Judge, VerdictEnum } from '@/types/db';

interface ResultsFilterQuestionOption {
  id: string;
  external_id: string | null;
  question_text: string;
}

interface ResultsFiltersProps {
  judges: Judge[];
  questions: ResultsFilterQuestionOption[];
  selectedJudges: string[];
  selectedQuestions: string[];
  selectedVerdicts: VerdictEnum[];
  onJudgesChange: (v: string[]) => void;
  onQuestionsChange: (v: string[]) => void;
  onVerdictsChange: (v: VerdictEnum[]) => void;
}

const VERDICTS: VerdictEnum[] = ['pass', 'fail', 'inconclusive'];

export default function ResultsFilters({
  judges,
  questions,
  selectedJudges,
  selectedQuestions,
  selectedVerdicts,
  onJudgesChange,
  onQuestionsChange,
  onVerdictsChange,
}: ResultsFiltersProps) {
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap">
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel>Judge</InputLabel>
        <Select
          multiple
          value={selectedJudges}
          onChange={(e) => onJudgesChange(e.target.value as string[])}
          input={<OutlinedInput label="Judge" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {selected.map((id) => (
                <Chip
                  key={id}
                  label={judges.find((j) => j.id === id)?.name ?? id}
                  size="small"
                />
              ))}
            </Box>
          )}
        >
          {judges.map((j) => (
            <MenuItem key={j.id} value={j.id}>{j.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Question</InputLabel>
        <Select
          multiple
          value={selectedQuestions}
          onChange={(e) => onQuestionsChange(e.target.value as string[])}
          input={<OutlinedInput label="Question" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {selected.map((id) => {
                const q = questions.find((qt) => qt.id === id);
                return (
                  <Chip
                    key={id}
                    label={q?.external_id ?? id}
                    size="small"
                  />
                );
              })}
            </Box>
          )}
        >
          {questions.map((q) => (
            <MenuItem key={q.id} value={q.id}>
              {q.external_id} — {q.question_text.slice(0, 50)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel>Verdict</InputLabel>
        <Select
          multiple
          value={selectedVerdicts}
          onChange={(e) => onVerdictsChange(e.target.value as VerdictEnum[])}
          input={<OutlinedInput label="Verdict" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {selected.map((v) => <Chip key={v} label={v} size="small" />)}
            </Box>
          )}
        >
          {VERDICTS.map((v) => (
            <MenuItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}
