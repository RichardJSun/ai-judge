'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import PassRateChart from '@/components/results/PassRateChart';
import ResultsFilters from '@/components/results/ResultsFilters';
import ResultsTable from '@/components/results/ResultsTable';
import type { Judge, QuestionTemplate, VerdictEnum } from '@/types/db';

export default function ResultsPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const router = useRouter();

  const [selectedJudges, setSelectedJudges] = useState<string[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [selectedVerdicts, setSelectedVerdicts] = useState<VerdictEnum[]>([]);
  const [page, setPage] = useState(1);

  const { data: judges } = useQuery<Judge[]>({
    queryKey: ['judges'],
    queryFn: () => fetch('/api/judges').then((r) => r.json()),
  });

  const { data: questions } = useQuery<QuestionTemplate[]>({
    queryKey: ['questions', queueId],
    queryFn: () => fetch(`/api/queues/${queueId}/questions`).then((r) => r.json()),
  });

  const filterParams = new URLSearchParams({ page: String(page) });
  for (const id of selectedJudges) filterParams.append('judgeId', id);
  for (const id of selectedQuestions) filterParams.append('questionId', id);
  for (const v of selectedVerdicts) filterParams.append('verdict', v);

  const { data: results, isLoading, error } = useQuery({
    queryKey: ['results', queueId, selectedJudges, selectedQuestions, selectedVerdicts, page],
    queryFn: () =>
      fetch(`/api/queues/${queueId}/results?${filterParams}`).then((r) => r.json()),
  });

  // Chart data from server aggregate (not current page subset)
  const chartData: { name: string; passRate: number; total: number }[] = results?.judgePassRates ?? [];

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(`/queues/${queueId}`)}>
          Back
        </Button>
        <Typography variant="h4" fontWeight={700}>
          Results
        </Typography>
      </Stack>

      {/* Aggregate stats */}
      {results && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" spacing={4} alignItems="center" flexWrap="wrap">
            <Box>
              <Typography variant="h3" fontWeight={800} color="primary.main">
                {results.passRate}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                pass rate ({results.total} evaluations)
              </Typography>
            </Box>
            <Divider orientation="vertical" flexItem />
            {chartData.length > 0 && <PassRateChart data={chartData} />}
          </Stack>
        </Paper>
      )}

      {/* Filters */}
      <Box mb={2}>
        <ResultsFilters
          judges={judges ?? []}
          questions={questions ?? []}
          selectedJudges={selectedJudges}
          selectedQuestions={selectedQuestions}
          selectedVerdicts={selectedVerdicts}
          onJudgesChange={(v) => { setSelectedJudges(v); setPage(1); }}
          onQuestionsChange={(v) => { setSelectedQuestions(v); setPage(1); }}
          onVerdictsChange={(v) => { setSelectedVerdicts(v); setPage(1); }}
        />
      </Box>

      {/* Table */}
      {isLoading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error">Failed to load results.</Alert>
      ) : (
        <>
          <ResultsTable evaluations={results?.evaluations ?? []} />
          {results?.total > results?.pageSize && (
            <Stack direction="row" spacing={1} justifyContent="center" mt={2}>
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Typography alignSelf="center">Page {page}</Typography>
              <Button
                disabled={page * (results?.pageSize ?? 25) >= results?.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </Stack>
          )}
        </>
      )}
    </>
  );
}
