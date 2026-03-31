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
import { FilterToolbar } from '@/components/ui/editorial';
import type { ResultsFilterJudge, ResultsFilterQuestion } from '@/types/api';
import type { VerdictEnum } from '@/types/db';

interface ResultsFiltersProps {
  judges: ResultsFilterJudge[];
  questions: ResultsFilterQuestion[];
  availableVerdicts: VerdictEnum[];
  selectedJudges: string[];
  selectedQuestions: string[];
  selectedVerdicts: VerdictEnum[];
  onJudgesChange: (v: string[]) => void;
  onQuestionsChange: (v: string[]) => void;
  onVerdictsChange: (v: VerdictEnum[]) => void;
}

function formatVerdictLabel(verdict: VerdictEnum) {
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

export default function ResultsFilters({
  judges,
  questions,
  availableVerdicts,
  selectedJudges,
  selectedQuestions,
  selectedVerdicts,
  onJudgesChange,
  onQuestionsChange,
  onVerdictsChange,
}: ResultsFiltersProps) {
  return (
    <FilterToolbar label="Refine results">
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 180, flex: { xs: '1 1 auto', lg: '0 0 auto' } }}>
          <InputLabel>Judge</InputLabel>
          <Select
            multiple
            value={selectedJudges}
            onChange={(event) => onJudgesChange(event.target.value as string[])}
            input={<OutlinedInput label="Judge" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {selected.map((id) => (
                  <Chip key={id} label={judges.find((judge) => judge.id === id)?.name ?? id} size="small" />
                ))}
              </Box>
            )}
          >
            {judges.map((judge) => (
              <MenuItem key={judge.id} value={judge.id}>
                {judge.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 200, flex: { xs: '1 1 auto', lg: '0 0 auto' } }}>
          <InputLabel>Question</InputLabel>
          <Select
            multiple
            value={selectedQuestions}
            onChange={(event) => onQuestionsChange(event.target.value as string[])}
            input={<OutlinedInput label="Question" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {selected.map((id) => {
                  const question = questions.find((candidate) => candidate.id === id);
                  return <Chip key={id} label={question?.external_id ?? id} size="small" />;
                })}
              </Box>
            )}
          >
            {questions.map((question) => (
              <MenuItem key={question.id} value={question.id}>
                {question.external_id ?? question.id} — {question.question_text.slice(0, 50)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 160, flex: { xs: '1 1 auto', lg: '0 0 auto' } }}>
          <InputLabel>Verdict</InputLabel>
          <Select
            multiple
            value={selectedVerdicts}
            onChange={(event) => onVerdictsChange(event.target.value as VerdictEnum[])}
            input={<OutlinedInput label="Verdict" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {selected.map((verdict) => (
                  <Chip key={verdict} label={verdict} size="small" />
                ))}
              </Box>
            )}
          >
            {availableVerdicts.map((verdict) => (
              <MenuItem key={verdict} value={verdict}>
                {formatVerdictLabel(verdict)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
    </FilterToolbar>
  );
}
