/**
 * Chart primitives (Recharts) following the project's data-viz rules:
 * one y-axis, thin marks (2px lines, ≥8px markers, 4px rounded bar ends),
 * solid hairline grid, legend whenever there are ≥2 series, hover tooltips,
 * and colour that follows the entity (world / country), never its rank.
 */
import type { ReactNode } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const CHART = {
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  ink: '#0b0b0b',
  ink2: '#52514e',
  series1: '#2a78d6',
  series2: '#eb6834',
  series3: '#1baf7a',
};

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  type?: 'line' | 'bar' | 'area';
  /** dashed lines are reserved for references; keep false for data */
  dot?: boolean;
}

type Row = Record<string, number | string | null | undefined>;

function TooltipBox({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  label?: string | number;
  labelFormatter?: (l: string | number) => ReactNode;
  valueFormatter: (v: number, key: string) => ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-navy-900">{labelFormatter ? labelFormatter(label ?? '') : label}</div>
      <div className="flex flex-col gap-0.5">
        {payload
          .filter((p) => p.value != null)
          .map((p) => (
            <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-[#52514e]">
                <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
                {p.name}
              </span>
              <span className="font-semibold tabular text-[#0b0b0b]">{valueFormatter(Number(p.value), String(p.dataKey))}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function SeriesChart({
  data,
  xKey,
  series,
  height = 220,
  yFormatter = (v) => String(v),
  valueFormatter,
  xFormatter,
  tooltipLabel,
  yDomain,
  referenceY,
}: {
  data: Row[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  yFormatter?: (v: number) => string;
  valueFormatter?: (v: number, key: string) => ReactNode;
  xFormatter?: (v: string | number) => string;
  tooltipLabel?: (l: string | number) => ReactNode;
  yDomain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax'];
  referenceY?: { y: number; label: string };
}) {
  const showLegend = series.length >= 2;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeWidth={1} />
          <XAxis
            dataKey={xKey}
            tickFormatter={xFormatter}
            tick={{ fill: CHART.muted, fontSize: 11 }}
            axisLine={{ stroke: CHART.axis }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={yFormatter}
            tick={{ fill: CHART.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            domain={yDomain ?? ['auto', 'auto']}
          />
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeWidth: 1, fill: 'rgba(11,31,58,0.04)' }}
            content={
              <TooltipBox
                labelFormatter={tooltipLabel ?? xFormatter}
                valueFormatter={valueFormatter ?? ((v) => yFormatter(v))}
              />
            }
          />
          {showLegend && (
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: CHART.ink2 }}
            />
          )}
          {referenceY && (
            <ReferenceLine
              y={referenceY.y}
              stroke={CHART.muted}
              strokeDasharray="4 4"
              label={{ value: referenceY.label, position: 'insideTopRight', fill: CHART.muted, fontSize: 10 }}
            />
          )}
          {series.map((s) => {
            if (s.type === 'bar') {
              return <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />;
            }
            if (s.type === 'area') {
              return (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.12}
                  type="monotone"
                  dot={false}
                  activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              );
            }
            return (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                type="linear"
                dot={s.dot === false ? false : { r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartCard({
  title,
  description,
  children,
  className,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <Card className={cn('gap-2 py-4', className)}>
      <CardHeader className="flex-row items-start justify-between gap-2 px-4">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="px-2 sm:px-3">{children}</CardContent>
    </Card>
  );
}

export function EmptyChart({ text }: { text: string }) {
  return <div className="grid h-40 place-items-center rounded-lg bg-muted/50 text-sm text-muted-foreground">{text}</div>;
}
