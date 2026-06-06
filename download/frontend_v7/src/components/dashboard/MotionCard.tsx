'use client';

import { motion } from 'framer-motion';
import { Eye, Radar } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TelemetryData } from '@/lib/types';

interface MotionCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

const pirLocations: Record<number, string> = {
  1: 'Zone A',
  2: 'Zone B',
  3: 'Zone C',
  4: 'Zone D',
};

export function MotionCard({ data, loading }: MotionCardProps) {
  if (loading) return <MotionCardSkeleton />;

  const pirs = Array.from({ length: 4 }, (_, i) => ({
    sensor: i + 1,
    location: pirLocations[i + 1],
    motion: data ? (data[`pir${i + 1}`] as number) === 1 : false,
  }));

  const motionCount = pirs.filter(p => p.motion).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radar className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-semibold">Motion Detection</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {motionCount} active
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {pirs.map((pir) => (
          <div
            key={pir.sensor}
            className={`
              relative p-3 rounded-lg border transition-colors
              ${pir.motion
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-background/30 border-border/30'
              }
            `}
          >
            {pir.motion && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-2 right-2"
              >
                <div className="w-2 h-2 rounded-full bg-red-500 pulse-dot" />
              </motion.div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <Eye className={`w-4 h-4 ${pir.motion ? 'text-red-400' : 'text-muted-foreground'}`} />
              <span className="text-xs font-medium">{pir.location}</span>
            </div>
            <div className={`text-lg font-bold font-mono ${pir.motion ? 'text-red-400' : 'text-muted-foreground'}`}>
              PIR-{pir.sensor}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {pir.motion ? 'Motion Detected' : 'Clear'}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function MotionCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-28 h-4 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
