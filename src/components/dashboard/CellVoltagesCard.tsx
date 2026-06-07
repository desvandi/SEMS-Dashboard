'use client';

import { motion } from 'framer-motion';
import { Thermometer } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TelemetryData, CellVoltage } from '@/lib/types';

interface CellVoltagesCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

function getCellStatus(voltage: number): CellVoltage['status'] {
  if (voltage > 3.0) return 'good';
  if (voltage >= 2.5) return 'warning';
  return 'danger';
}

function getCellColor(status: CellVoltage['status']) {
  switch (status) {
    case 'good': return '#10b981';
    case 'warning': return '#f59e0b';
    case 'danger': return '#ef4444';
  }
}

export function CellVoltagesCard({ data, loading }: CellVoltagesCardProps) {
  if (loading) return <CellVoltagesCardSkeleton />;

  const cells: CellVoltage[] = Array.from({ length: 8 }, (_, i) => {
    const v = data ? (data[`cell${i + 1}_v`] as number) || 0 : 0;
    return { cell: i + 1, voltage: v, status: getCellStatus(v) };
  });

  const minV = 0;
  const maxV = 3.5;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Thermometer className="w-5 h-5 text-cyan-500" />
        <h3 className="text-sm font-semibold">Cell Voltages</h3>
      </div>

      <div className="space-y-2">
        {cells.map((cell) => {
          const percentage = Math.min(Math.max(((cell.voltage - minV) / (maxV - minV)) * 100, 0), 100);
          const color = getCellColor(cell.status);

          return (
            <div key={cell.cell} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-5 text-right shrink-0">C{cell.cell}</span>
              <div className="flex-1 h-5 bg-muted/50 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                />
              </div>
              <span className="text-xs font-mono w-12 text-right shrink-0" style={{ color }}>
                {cell.voltage.toFixed(3)}V
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-muted-foreground">&gt; 3.0V</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-[10px] text-muted-foreground">2.5-3.0V</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-[10px] text-muted-foreground">&lt; 2.5V</span>
        </div>
      </div>
    </motion.div>
  );
}

function CellVoltagesCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-24 h-4 rounded" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="w-5 h-4 rounded" />
            <Skeleton className="flex-1 h-5 rounded-full" />
            <Skeleton className="w-12 h-4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
