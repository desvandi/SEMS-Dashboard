'use client';

import { motion } from 'framer-motion';
import { Battery, Zap, ArrowUp, ArrowDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TelemetryData } from '@/lib/types';

interface BatteryCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

function CircularProgress({ value, size = 120, strokeWidth = 8 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (progress / 100) * circumference;

  const getColor = (v: number) => {
    if (v > 50) return '#10b981';
    if (v > 20) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#334155"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={getColor(progress)}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-1000 ease-out"
      />
    </svg>
  );
}

export function BatteryCard({ data, loading }: BatteryCardProps) {
  if (loading) {
    return <BatteryCardSkeleton />;
  }

  const voltage = data?.battery_voltage ?? 0;
  const current = data?.battery_current ?? 0;
  const power = data?.battery_power ?? 0;
  const soc = data?.soc_percent ?? 0;
  const isCharging = current > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Battery className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Battery Status</h3>
        </div>
        <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${isCharging ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-400'}`}>
          {isCharging ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {isCharging ? 'Charging' : 'Discharging'}
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-6">
        {/* Circular SOC */}
        <div className="relative shrink-0">
          <CircularProgress value={soc} size={110} strokeWidth={8} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold">{Math.round(soc)}%</span>
            <span className="text-[10px] text-muted-foreground">SOC</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 grid grid-cols-1 gap-3 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Voltage</span>
            <span className="text-sm font-semibold font-mono">{voltage.toFixed(2)}V</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current</span>
            <span className={`text-sm font-semibold font-mono ${isCharging ? 'text-primary' : 'text-amber-400'}`}>
              {isCharging ? '+' : ''}{current.toFixed(2)}A
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Power</span>
            <span className="text-sm font-semibold font-mono flex items-center gap-1">
              <Zap className="w-3 h-3 text-primary" />
              {Math.abs(power).toFixed(1)}W
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function BatteryCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-28 h-4 rounded" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="w-[110px] h-[110px] rounded-full shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="w-full h-4 rounded" />
          <Skeleton className="w-full h-4 rounded" />
          <Skeleton className="w-full h-4 rounded" />
        </div>
      </div>
    </div>
  );
}
