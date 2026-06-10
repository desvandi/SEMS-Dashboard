'use client';

import { useEffect, useState, useCallback, useMemo, Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchTelemetryHistory } from '@/lib/api';
import type { TelemetryData } from '@/lib/types';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart3,
  Calendar,
  RefreshCw,
  AlertCircle,
  Zap,
  Battery,
  TrendingUp,
  Activity,
  Wifi,
  Clock,
  ChevronDown,
  Sun,
  ArrowDownCircle,
  ArrowUpCircle,
  Gauge,
} from 'lucide-react';
import { format, subDays, startOfDay } from 'date-fns';
import { downsample } from '@/lib/utils';

// Fix #8: Lazy-load chart components (heavy recharts bundle)
const RechartsSection = lazy(() =>
  import('./AnalyticsCharts').then(mod => ({ default: mod.AnalyticsChartsSection }))
);

// ── Chart Colors ──
const colors = {
  grid: '#334155',
  text: '#94a3b8',
  tooltip: '#1e293b',
  energyIn: '#10b981',
  energyOut: '#f59e0b',
  power: '#06b6d4',
  soc: '#8b5cf6',
};

// ── Presets ──
const presets = [
  { label: 'Hari Ini', days: 0 },
  { label: '7 Hari', days: 7 },
  { label: '14 Hari', days: 14 },
  { label: '30 Hari', days: 30 },
  { label: '90 Hari', days: 90 },
];

// T3-FE-009: Lookup map for dynamic Tailwind color classes
const colorBgMap: Record<string, string> = {
  'text-emerald-400': 'bg-emerald-400/10',
  'text-amber-400': 'bg-amber-400/10',
  'text-red-400': 'bg-red-400/10',
  'text-cyan-400': 'bg-cyan-400/10',
  'text-purple-400': 'bg-purple-400/10',
};

// ── Stat Card ──
function StatCard({
  icon,
  label,
  value,
  subValue,
  color,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card rounded-xl p-4"
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          {subValue && (
            <p className="text-[10px] text-muted-foreground">{subValue}</p>
          )}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorBgMap[color] || 'bg-primary/10'} ${color}`}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ── Helper: format energy ──
function formatEnergy(wh: number): string {
  if (Math.abs(wh) >= 1000) {
    return `${(wh / 1000).toFixed(2)} kWh`;
  }
  return `${wh.toFixed(1)} Wh`;
}

// ── Page Component ──
export default function AnalyticsPage() {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<number>(1); // 7 Hari default
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const loadHistory = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params: { from?: string; to?: string; limit?: number } = {};
      if (from) params.from = from;
      if (to) params.to = to;
      else params.limit = 5000;

      const res = await fetchTelemetryHistory(params);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error || 'Gagal memuat data analitik');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kesalahan koneksi');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: last 7 days
  useEffect(() => {
    const from = subDays(new Date(), 7).toISOString();
    loadHistory(from);
  }, [loadHistory]);

  const handlePreset = (index: number) => {
    setActivePreset(index);
    setShowCustom(false);
    const preset = presets[index];
    if (preset.days === 0) {
      const from = startOfDay(new Date()).toISOString();
      loadHistory(from);
    } else {
      const from = subDays(new Date(), preset.days).toISOString();
      loadHistory(from);
    }
  };

  const handleCustomRange = () => {
    if (!customFrom || !customTo) {
      toast.error('Pilih tanggal mulai dan akhir');
      return;
    }
    // T3-FE-016: Validate from < to
    if (new Date(customFrom) >= new Date(customTo)) {
      toast.error('Tanggal mulai harus sebelum tanggal akhir');
      return;
    }
    const from = new Date(customFrom).toISOString();
    const to = new Date(customTo + 'T23:59:59').toISOString();
    setActivePreset(-1);
    loadHistory(from, to);
  };

  // ── Calculations ──
  const analytics = useMemo(() => {
    if (data.length < 2) return null;

    let totalEnergyIn = 0;
    let totalEnergyOut = 0;
    let peakLoadPower = 0;
    let totalInverterPower = 0;
    let inverterCount = 0;
    let totalRssi = 0;
    let rssiCount = 0;
    let totalFreeHeap = 0;
    let heapCount = 0;

    for (let i = 1; i < data.length; i++) {
      const dt = (new Date(data[i].timestamp).getTime() - new Date(data[i - 1].timestamp).getTime()) / 3600000;
      if (dt <= 0 || dt > 1) continue;

      const power = data[i].battery_power;
      if (power > 0) {
        totalEnergyIn += power * dt;
      } else if (power < 0) {
        totalEnergyOut += Math.abs(power) * dt;
      }

      if (data[i].inverter_power > 0) {
        totalInverterPower += data[i].inverter_power;
        inverterCount++;
        if (data[i].inverter_power > peakLoadPower) {
          peakLoadPower = data[i].inverter_power;
        }
      }

      if (data[i].wifi_rssi && data[i].wifi_rssi > -100) {
        totalRssi += data[i].wifi_rssi;
        rssiCount++;
      }

      if (data[i].free_heap && data[i].free_heap > 0) {
        totalFreeHeap += data[i].free_heap;
        heapCount++;
      }
    }

    const netEnergy = totalEnergyIn - totalEnergyOut;
    const efficiency = totalEnergyIn > 0 ? (totalEnergyOut / totalEnergyIn) * 100 : 0;
    const avgConsumption = inverterCount > 0 ? totalInverterPower / inverterCount : 0;

    const timeSpanMs = new Date(data[data.length - 1].timestamp).getTime() - new Date(data[0].timestamp).getTime();
    const expectedPoints = Math.floor(timeSpanMs / 15000);
    const uptimePct = expectedPoints > 0 ? Math.min(100, (data.length / expectedPoints) * 100) : 100;

    const avgRssi = rssiCount > 0 ? totalRssi / rssiCount : -60;
    const avgHeap = heapCount > 0 ? totalFreeHeap / heapCount : 0;

    const dailyMap = new Map<string, { energyIn: number; energyOut: number; socMin: number; socMax: number; socSum: number; socCount: number }>();

    for (let i = 0; i < data.length; i++) {
      const dateKey = format(new Date(data[i].timestamp), 'yyyy-MM-dd');
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { energyIn: 0, energyOut: 0, socMin: 100, socMax: 0, socSum: 0, socCount: 0 });
      }
      const entry = dailyMap.get(dateKey)!;

      if (i > 0) {
        const dt = (new Date(data[i].timestamp).getTime() - new Date(data[i - 1].timestamp).getTime()) / 3600000;
        if (dt > 0 && dt <= 1) {
          const power = data[i].battery_power;
          if (power > 0) entry.energyIn += power * dt;
          else if (power < 0) entry.energyOut += Math.abs(power) * dt;
        }
      }

      if (data[i].soc_percent >= 0 && data[i].soc_percent <= 100) {
        entry.socMin = Math.min(entry.socMin, data[i].soc_percent);
        entry.socMax = Math.max(entry.socMax, data[i].soc_percent);
        entry.socSum += data[i].soc_percent;
        entry.socCount++;
      }
    }

    const dailyData = Array.from(dailyMap.entries())
      .map(([date, vals]) => ({
        date,
        label: format(new Date(date), 'MM/dd'),
        energyIn: Math.round(vals.energyIn * 10) / 10,
        energyOut: Math.round(vals.energyOut * 10) / 10,
        socMin: vals.socCount > 0 ? Math.round(vals.socMin) : 0,
        socMax: vals.socCount > 0 ? Math.round(vals.socMax) : 0,
        socAvg: vals.socCount > 0 ? Math.round(vals.socSum / vals.socCount) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const sampled = downsample(data, 400);
    const powerProfile = sampled.map(d => ({
      time: format(new Date(d.timestamp), 'MM/dd HH:mm'),
      power: d.battery_power,
      powerAbs: Math.abs(d.battery_power),
      timestamp: d.timestamp,
    }));

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const hourGroups = ['00-03', '04-07', '08-11', '12-15', '16-19', '20-23'];
    const heatmapGrid: number[][] = Array.from({ length: 6 }, () => Array(7).fill(0));
    const heatmapCount: number[][] = Array.from({ length: 6 }, () => Array(7).fill(0));

    data.forEach(d => {
      const date = new Date(d.timestamp);
      const dow = date.getDay();
      const hour = date.getHours();
      const groupIdx = Math.floor(hour / 4);
      if (groupIdx >= 0 && groupIdx < 6) {
        if (d.inverter_power >= 0) {
          heatmapGrid[groupIdx][dow] += d.inverter_power;
          heatmapCount[groupIdx][dow]++;
        }
      }
    });

    const heatmapData = hourGroups.map((hg, gi) => ({
      hour: hg,
      values: dayNames.map((_, di) =>
        heatmapCount[gi][di] > 0 ? Math.round(heatmapGrid[gi][di] / heatmapCount[gi][di]) : 0
      ),
    }));

    let heatmapMax = 0;
    heatmapData.forEach(row => row.values.forEach(v => { if (v > heatmapMax) heatmapMax = v; }));

    return {
      totalEnergyIn,
      totalEnergyOut,
      netEnergy,
      efficiency,
      peakLoadPower,
      avgConsumption,
      uptimePct,
      avgRssi,
      avgHeap,
      dailyData,
      powerProfile,
      heatmapData,
      heatmapMax,
      dayNames,
      hourGroups,
      dataPoints: data.length,
      timeSpan: timeSpanMs / 3600000,
    };
  }, [data]);

  // ── Skeleton Loading ──
  if (loading) {
    return (
      <PageTransition>
        <Header isConnected={true} lastUpdated={null} onRefresh={() => {}} />
        <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="glass-card rounded-xl p-4">
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[300px] rounded-xl" />
            <Skeleton className="h-[300px] rounded-xl" />
            <Skeleton className="h-[300px] rounded-xl" />
            <Skeleton className="h-[300px] rounded-xl" />
          </div>
          <Skeleton className="h-[350px] rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[200px] rounded-xl" />
            <Skeleton className="h-[200px] rounded-xl" />
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <Header
        isConnected={true}
        lastUpdated={null}
        onRefresh={() => {
          const preset = presets[activePreset] || presets[1];
          if (preset.days === 0) {
            loadHistory(startOfDay(new Date()).toISOString());
          } else {
            loadHistory(subDays(new Date(), preset.days).toISOString());
          }
        }}
      />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Analitik Energi"
          subtitle="Analisis performa dan konsumsi energi sistem"
          icon={<TrendingUp className="w-5 h-5 text-primary" />}
          badge={!loading && data.length > 0 ? (
            <Badge variant="outline" className="text-xs">
              {data.length.toLocaleString()} data poin
            </Badge>
          ) : undefined}
        />

        {/* Date Range Selector */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Rentang Waktu / Date Range</span>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset, i) => (
                <Button
                  key={i}
                  variant={activePreset === i ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-8 ${
                    activePreset === i ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''
                  }`}
                  onClick={() => handlePreset(i)}
                >
                  {preset.label}
                </Button>
              ))}
              <Button
                variant={activePreset === -1 ? 'default' : 'outline'}
                size="sm"
                className={`text-xs h-8 gap-1 ${
                  activePreset === -1 ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''
                }`}
                onClick={() => setShowCustom(!showCustom)}
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showCustom ? 'rotate-180' : ''}`} />
                Kustom
              </Button>
            </div>
            {showCustom && (
              <div className="flex items-end gap-2 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Dari</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs w-36"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Sampai</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs w-36"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={handleCustomRange}
                >
                  <RefreshCw className="w-3 h-3" />
                  Terapkan
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={() => loadHistory()} className="ml-auto text-primary hover:underline">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Empty state */}
        {data.length === 0 && !error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <BarChart3 className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Tidak Ada Data</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Data telemetri belum tersedia untuk rentang waktu yang dipilih
            </p>
          </motion.div>
        )}

        {analytics && data.length > 0 && (
          <>
            {/* ── Energy Overview Cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                icon={<ArrowDownCircle className="w-4 h-4" />}
                label="Energi Masuk"
                value={formatEnergy(analytics.totalEnergyIn)}
                subValue="Total charging"
                color="text-emerald-400"
                delay={0}
              />
              <StatCard
                icon={<ArrowUpCircle className="w-4 h-4" />}
                label="Energi Keluar"
                value={formatEnergy(analytics.totalEnergyOut)}
                subValue="Total discharging"
                color="text-amber-400"
                delay={0.05}
              />
              <StatCard
                icon={<TrendingUp className="w-4 h-4" />}
                label="Neraca Energi"
                value={formatEnergy(analytics.netEnergy)}
                subValue={analytics.netEnergy >= 0 ? 'Surplus' : 'Defisit'}
                color={analytics.netEnergy >= 0 ? 'text-emerald-400' : 'text-red-400'}
                delay={0.1}
              />
              <StatCard
                icon={<Gauge className="w-4 h-4" />}
                label="Efisiensi Rata-rata"
                value={`${analytics.efficiency.toFixed(1)}%`}
                subValue="Out / In"
                color="text-cyan-400"
                delay={0.15}
              />
              <StatCard
                icon={<Zap className="w-4 h-4" />}
                label="Beban Puncak"
                value={`${analytics.peakLoadPower.toFixed(0)} W`}
                subValue="Max inverter power"
                color="text-red-400"
                delay={0.2}
              />
              <StatCard
                icon={<Activity className="w-4 h-4" />}
                label="Konsumsi Rata-rata"
                value={`${analytics.avgConsumption.toFixed(1)} W`}
                subValue="Avg inverter power"
                color="text-purple-400"
                delay={0.25}
              />
            </div>

            {/* Fix #8: Lazy-loaded chart section with Suspense fallback */}
            <Suspense
              fallback={
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-[350px] rounded-xl" />
                  ))}
                </div>
              }
            >
              <RechartsSection
                analytics={analytics}
                colors={colors}
                data={data}
              />
            </Suspense>
          </>
        )}
      </div>
    </PageTransition>
  );
}
