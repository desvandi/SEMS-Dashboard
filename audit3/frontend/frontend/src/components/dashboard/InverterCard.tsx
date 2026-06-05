'use client';

import { motion } from 'framer-motion';
import { Zap, Power } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TelemetryData } from '@/lib/types';

interface InverterCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

export function InverterCard({ data, loading }: InverterCardProps) {
  if (loading) return <InverterCardSkeleton />;

  const inverterCurrent = data?.inverter_current ?? 0;
  const inverterPower = data?.inverter_power ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-amber-400" />
        <h3 className="text-sm font-semibold">Solar / Inverter</h3>
      </div>

      <div className="space-y-4">
        {/* Inverter Current */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Inverter Current</span>
            <span className="text-sm font-semibold font-mono">{inverterCurrent.toFixed(2)}A</span>
          </div>
          <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((inverterCurrent / 35) * 100, 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full bg-amber-400 rounded-full"
            />
          </div>
        </div>

        {/* Estimated AC Power */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Estimated AC Power</span>
            <span className="text-sm font-semibold font-mono flex items-center gap-1">
              <Power className="w-3 h-3 text-primary" />
              {inverterPower.toFixed(0)}W
            </span>
          </div>
          <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((inverterPower / 1000) * 100, 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full bg-primary rounded-full"
            />
          </div>
        </div>
      </div>

      {/* Inverter Status */}
      <div className="mt-4 pt-3 border-t border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Status</span>
          <div className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${inverterCurrent > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${inverterCurrent > 0 ? 'bg-primary pulse-dot' : 'bg-muted-foreground'}`} />
            {inverterCurrent > 0 ? 'Active' : 'Standby'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function InverterCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-28 h-4 rounded" />
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="w-full h-4 rounded" />
          <Skeleton className="w-full h-2 rounded-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="w-full h-4 rounded" />
          <Skeleton className="w-full h-2 rounded-full" />
        </div>
      </div>
    </div>
  );
}
