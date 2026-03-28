'use client';

import { Box, Typography } from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface PassRateData {
  name: string;
  passRate: number;
  total: number;
}

interface PassRateChartProps {
  data: PassRateData[];
  matchingTotal: number;
  completedTotal: number;
}

export default function PassRateChart({ data, matchingTotal, completedTotal }: PassRateChartProps) {
  const emptyStateCopy =
    matchingTotal === 0
      ? 'No evaluations match the current filters.'
      : completedTotal === 0
        ? 'Matching evaluations exist, but none have completed yet.'
        : 'Completed evaluation data is unavailable for the current filters.';

  return (
    <Box>
      <Typography variant="subtitle2" mb={0.5} color="text.secondary">
        Per-judge pass rate for the current filter set
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        Each bar uses completed evaluations only.
      </Typography>

      {data.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyStateCopy}
        </Typography>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, _name, item) => {
                const total = item.payload?.total;
                return [`${value}%${typeof total === 'number' ? ` (${total} completed)` : ''}`, 'Pass rate'];
              }}
              labelFormatter={(label) => `Judge: ${label}`}
            />
            <Bar dataKey="passRate" radius={[4, 4, 0, 0]} isAnimationActive>
              {data.map((entry, index) => (
                <Cell
                  key={`${entry.name}-${index}`}
                  fill={entry.passRate >= 70 ? '#4caf50' : entry.passRate >= 40 ? '#ff9800' : '#f44336'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Box>
  );
}
