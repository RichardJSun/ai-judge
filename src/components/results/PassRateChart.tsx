'use client';

import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
  const theme = useTheme();
  const varsPalette = theme.vars?.palette;
  const divider = varsPalette?.divider ?? theme.palette.divider;
  const textSecondary = varsPalette?.text.secondary ?? theme.palette.text.secondary;
  const paper = varsPalette?.background.paper ?? theme.palette.background.paper;
  const success = varsPalette?.success.main ?? theme.palette.success.main;
  const warning = varsPalette?.warning.main ?? theme.palette.warning.main;
  const error = varsPalette?.error.main ?? theme.palette.error.main;
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
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={divider} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: textSecondary }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
              tick={{ fontSize: 12, fill: textSecondary }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: `1px solid ${divider}`,
                backgroundColor: paper,
              }}
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
                  fill={
                    entry.passRate >= 70
                      ? success
                      : entry.passRate >= 40
                        ? warning
                        : error
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Box>
  );
}
