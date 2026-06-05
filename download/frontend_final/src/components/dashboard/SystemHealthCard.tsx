'use client';

import { motion } from 'framer-motion';
import { Activity, Wifi, Clock, Cpu, ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TelemetryData } from '@/lib/types';

interface SystemHealthCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getWifiSignal(rssi: number): { label: string; color: string; bars: number } {
  if (rssi >= -50) return { label: 'Excellent', color: '#10b981', bars: 4 };
  if (rssi >= -60) return { label: 'Good', color: '#10b981', bars: 3 };
  if (rssi >= -70) return { label: 'Fair', color: '#f59e0b', bars: 2 };
  return { label: 'Weak', color: '#ef4444', bars: 1 };
}

export function SystemHealthCard({ data, loading }: SystemHealthCardProps) {
  if (loading) return <SystemHealthCardSkeleton />;

  const rssi = data?.wifi_rssi ?? 0;
  const uptime = data?.uptime_seconds ?? 0;
  const freeHeap = data?.free_heap ?? 0;
  const loadShedding = data?.load_shedding_active ?? 0;

  const wifi = getWifiSignal(rssi);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-emerald-400" />
        <h3 className="text-sm font-semibold">System Health</h3>
      </div>

      <div className="space-y-3">
        {/* WiFi RSSI */}
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-background/30">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4" style={{ color: wifi.color }} />
            <span className="text-xs text-muted-foreground">WiFi Signal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-end gap-0.5 h-3">
              {[1, 2, 3, 4].map((bar) => (
                <div
                  key={bar}
                  className="w-1 rounded-sm"
                  style={{
                    height: `${bar * 25}%`,
                    backgroundColor: bar <= wifi.bars ? wifi.color : '#334155',
                  }}
                />
              ))}
            </div>
            <span className="text-xs font-mono" style={{ color: wifi.color }}>
              {rssi}dBm
            </span>
          </div>
        </div>

        {/* Uptime */}
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-background/30">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-500" />
            <span className="text-xs text-muted-foreground">Uptime</span>
          </div>
          <span className="text-xs font-mono">{formatUptime(uptime)}</span>
        </div>

        {/* Free Heap */}
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-background/30">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-muted-foreground">Free Heap</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-400 rounded-full transition-all"
                style={{ width: `${Math.min((freeHeap / 320000) * 100, 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono">{(freeHeap / 1024).toFixed(0)}KB</span>
          </div>
        </div>

        {/* Load Shedding */}
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-background/30">
          <div className="flex items-center gap-2">
            <ShieldAlert className={`w-4 h-4 ${loadShedding ? 'text-red-400' : 'text-emerald-400'}`} />
            <span className="text-xs text-muted-foreground">Load Shedding</span>
          </div>
          <div className={`flex items-center gap-1 text-xs ${loadShedding ? 'text-red-400' : 'text-emerald-400'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${loadShedding ? 'bg-red-400 pulse-dot' : 'bg-emerald-400'}`} />
            {loadShedding ? 'ACTIVE' : 'Normal'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SystemHealthCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-28 h-4 rounded" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
