'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Power, ToggleLeft, ToggleRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { controlDevice } from '@/lib/api';
import type { TelemetryData } from '@/lib/types';

interface ActiveLoadsCardProps {
  data: TelemetryData | null;
  loading: boolean;
}

const relayNames: Record<number, string> = {
  1: 'Light 1',
  2: 'Light 2',
  3: 'Light 3',
  4: 'Light 4',
  5: 'Fan',
  6: 'Socket A',
  7: 'Socket B',
  8: 'Main',
};

function parseRelayStates(data: TelemetryData | null): number[] {
  if (!data) return Array(8).fill(0);
  try {
    const parsed = JSON.parse(data.relay_states);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  // Fallback: try old individual fields
  return Array.from({ length: 8 }, (_, i) => {
    const v = (data as Record<string, unknown>)[`relay_${i + 1}`];
    return typeof v === 'number' ? v : 0;
  });
}

export function ActiveLoadsCard({ data, loading }: ActiveLoadsCardProps) {
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggle = async (relayIndex: number, currentState: boolean) => {
    const deviceId = `relay_${relayIndex + 1}`;
    setToggling(deviceId);
    try {
      await controlDevice({
        id: deviceId,
        state: currentState ? 0 : 1,
      });
    } catch {
      // Error handled silently - data will refresh on next poll
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <ActiveLoadsCardSkeleton />;

  const relayStateArray = parseRelayStates(data);
  const relays = Array.from({ length: 8 }, (_, i) => ({
    relay: i + 1,
    name: relayNames[i + 1],
    state: relayStateArray[i] === 1,
    deviceId: `relay_${i + 1}`,
  }));

  const activeCount = relays.filter(r => r.state).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Power className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Active Loads</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {activeCount}/8 active
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {relays.map((relay) => (
          <button
            key={relay.relay}
            onClick={() => handleToggle(relay.relay, relay.state)}
            disabled={toggling === relay.deviceId}
            className={`
              relative p-3 rounded-lg border transition-all duration-300 text-center
              ${relay.state
                ? 'bg-primary/10 border-primary/30 text-primary glow-green'
                : 'bg-background/30 border-border/30 text-muted-foreground hover:border-border/60'
              }
              ${toggling === relay.deviceId ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
            `}
          >
            <div className="flex justify-center mb-1.5">
              {relay.state ? (
                <ToggleRight className="w-7 h-7 text-primary" />
              ) : (
                <ToggleLeft className="w-7 h-7" />
              )}
            </div>
            <div className="text-xs font-medium">{relay.name}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {relay.state ? 'ON' : 'OFF'}
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function ActiveLoadsCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-24 h-4 rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
