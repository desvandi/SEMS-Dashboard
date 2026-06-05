'use client';

import { useTelemetry } from '@/hooks/useTelemetry';
import { Header } from '@/components/layout/Header';
import { PageTransition } from '@/components/layout/PageTransition';
import { BatteryCard } from '@/components/dashboard/BatteryCard';
import { CellVoltagesCard } from '@/components/dashboard/CellVoltagesCard';
import { InverterCard } from '@/components/dashboard/InverterCard';
import { EnvironmentCard } from '@/components/dashboard/EnvironmentCard';
import { ActiveLoadsCard } from '@/components/dashboard/ActiveLoadsCard';
import { MotionCard } from '@/components/dashboard/MotionCard';
import { SystemHealthCard } from '@/components/dashboard/SystemHealthCard';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function DashboardPage() {
  const { data, loading, error, isConnected, lastUpdated, refresh } = useTelemetry(10000);

  return (
    <PageTransition>
      <Header
        isConnected={isConnected}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
      />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        {/* Connection status banner */}
        {error && !loading && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error} — Retrying in 10 seconds...</span>
          </div>
        )}

        {/* Initial loading state */}
        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Connecting to SEMS...</p>
            </div>
          </div>
        )}

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
          {/* Row 1: Battery + Cell Voltages */}
          <BatteryCard data={data} loading={loading && !data} />
          <CellVoltagesCard data={data} loading={loading && !data} />
          <InverterCard data={data} loading={loading && !data} />

          {/* Row 2: Environment + Motion + System Health */}
          <EnvironmentCard data={data} loading={loading && !data} />
          <MotionCard data={data} loading={loading && !data} />
          <SystemHealthCard data={data} loading={loading && !data} />
        </div>

        {/* Full-width Active Loads */}
        <ActiveLoadsCard data={data} loading={loading && !data} />
      </div>
    </PageTransition>
  );
}
