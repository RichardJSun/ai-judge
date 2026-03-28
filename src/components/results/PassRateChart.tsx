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
}

export default function PassRateChart({ data }: PassRateChartProps) {
  if (!data.length) return null;

  return (
    <Box>
      <Typography variant="subtitle2" mb={1} color="text.secondary">
        Pass Rate by Judge
      </Typography>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value, name, item, index, payload) => [`${value}%`, 'Pass Rate']}
            labelFormatter={(label) => `Judge: ${label}`}
          />
          <Bar dataKey="passRate" radius={[4, 4, 0, 0]} isAnimationActive>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.passRate >= 70 ? '#4caf50' : entry.passRate >= 40 ? '#ff9800' : '#f44336'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
