'use client';

import { motion } from 'framer-motion';
import { Thermometer, Droplets } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TelemetryData } from '@/lib/types';

interface EnvironmentCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

export function EnvironmentCard({ data, loading }: EnvironmentCardProps) {
  if (loading) return <EnvironmentCardSkeleton />;

  const temp = data?.room_temp ?? 0;
  const humidity = data?.room_humidity ?? 0;

  const tempColor = temp > 40 ? '#ef4444' : temp > 30 ? '#f59e0b' : '#10b981';
  const humidityColor = humidity > 80 ? '#ef4444' : humidity > 60 ? '#f59e0b' : '#06b6d4';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Thermometer className="w-5 h-5 text-cyan-500" />
        <h3 className="text-sm font-semibold">Environment</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Temperature */}
        <div className="text-center p-3 rounded-lg bg-background/30">
          <Thermometer className="w-6 h-6 mx-auto mb-2" style={{ color: tempColor }} />
          <div className="text-2xl font-bold font-mono" style={{ color: tempColor }}>
            {temp.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">&deg;C Temperature</div>
        </div>

        {/* Humidity */}
        <div className="text-center p-3 rounded-lg bg-background/30">
          <Droplets className="w-6 h-6 mx-auto mb-2" style={{ color: humidityColor }} />
          <div className="text-2xl font-bold font-mono" style={{ color: humidityColor }}>
            {humidity.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">% Humidity</div>
        </div>
      </div>

      {/* Comfort indicator */}
      <div className="mt-3 pt-3 border-t border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Comfort Level</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            temp >= 20 && temp <= 30 && humidity >= 30 && humidity <= 60
              ? 'bg-primary/10 text-primary'
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {temp >= 20 && temp <= 30 && humidity >= 30 && humidity <= 60
              ? 'Comfortable'
              : 'Adjust HVAC'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function EnvironmentCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-24 h-4 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    </div>
  );
}
