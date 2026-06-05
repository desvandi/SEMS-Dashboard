'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
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

// ── Chart Tooltip ──
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; unit?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-[#1e293b] px-3 py-2 shadow-lg">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground">
            {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
            {entry.unit || ''}
          </span>
        </div>
      ))}
    </div>
  );
}

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
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${color.replace('text-', '')}/10 ${color}`}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ── Downsample ──
function downsample(data: TelemetryData[], maxPoints = 500): TelemetryData[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const result: TelemetryData[] = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
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
      // Hari Ini: from start of today
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

    // Energy integration
    for (let i = 1; i < data.length; i++) {
      const dt = (new Date(data[i].timestamp).getTime() - new Date(data[i - 1].timestamp).getTime()) / 3600000;
      if (dt <= 0 || dt > 1) continue; // skip invalid intervals

      const power = data[i].battery_power;
      if (power > 0) {
        totalEnergyIn += power * dt; // charging
      } else if (power < 0) {
        totalEnergyOut += Math.abs(power) * dt; // discharging
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

    // Uptime estimate: expected data points at 15-second intervals
    const timeSpanMs = new Date(data[data.length - 1].timestamp).getTime() - new Date(data[0].timestamp).getTime();
    const expectedPoints = Math.floor(timeSpanMs / 15000);
    const uptimePct = expectedPoints > 0 ? Math.min(100, (data.length / expectedPoints) * 100) : 100;

    const avgRssi = rssiCount > 0 ? totalRssi / rssiCount : -60;
    const avgHeap = heapCount > 0 ? totalFreeHeap / heapCount : 0;

    // Daily energy aggregation
    const dailyMap = new Map<string, { energyIn: number; energyOut: number; socMin: number; socMax: number; socSum: number; socCount: number }>();

    for (let i = 0; i < data.length; i++) {
      const dateKey = format(new Date(data[i].timestamp), 'yyyy-MM-dd');
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { energyIn: 0, energyOut: 0, socMin: 100, socMax: 0, socSum: 0, socCount: 0 });
      }
      const entry = dailyMap.get(dateKey)!;

      // Energy from consecutive pairs
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

    // Power profile (downsampled for chart)
    const sampled = downsample(data, 400);
    const powerProfile = sampled.map(d => ({
      time: format(new Date(d.timestamp), 'MM/dd HH:mm'),
      power: d.battery_power,
      powerAbs: Math.abs(d.battery_power),
      timestamp: d.timestamp,
    }));

    // Heatmap data: hours grouped by 4-hour blocks x days of week
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const hourGroups = ['00-03', '04-07', '08-11', '12-15', '16-19', '20-23'];
    const heatmapGrid: number[][] = Array.from({ length: 6 }, () => Array(7).fill(0));
    const heatmapCount: number[][] = Array.from({ length: 6 }, () => Array(7).fill(0));

    data.forEach(d => {
      const date = new Date(d.timestamp);
      const dow = date.getDay(); // 0=Sun
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

    // Find max for heatmap normalization
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
      timeSpan: timeSpanMs / 3600000, // hours
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

            {/* ── Daily Energy Bar Chart ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Sun className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold">Energi Harian / Daily Energy</h3>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
                  Masuk
                </Badge>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  Keluar
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={analytics.dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                  />
                  <YAxis
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value: string) => (
                      <span style={{ color: value === 'Energi Masuk' ? colors.energyIn : colors.energyOut, fontSize: 11 }}>
                        {value}
                      </span>
                    )}
                  />
                  <Bar
                    dataKey="energyIn"
                    name="Energi Masuk"
                    fill={colors.energyIn}
                    fillOpacity={0.8}
                    radius={[3, 3, 0, 0]}
                    unit="Wh"
                  />
                  <Bar
                    dataKey="energyOut"
                    name="Energi Keluar"
                    fill={colors.energyOut}
                    fillOpacity={0.8}
                    radius={[3, 3, 0, 0]}
                    unit="Wh"
                  />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>

            {/* ── Power Profile Chart ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold">Profil Daya Baterai / Battery Power Profile</h3>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
                  Mengisi
                </Badge>
                <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">
                  Mengeluarkan
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={analytics.powerProfile} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="powerInGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.energyIn} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={colors.energyIn} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="powerOutGrad" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: colors.text, fontSize: 9 }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke={colors.text} strokeDasharray="3 3" />
                  {/* Charging area (positive power) */}
                  <Area
                    type="monotone"
                    dataKey={(entry: { power: number }) => Math.max(0, entry.power)}
                    name="Mengisi"
                    stroke={colors.energyIn}
                    strokeWidth={1.5}
                    fill="url(#powerInGrad)"
                    dot={false}
                    unit="W"
                  />
                  {/* Discharging area (negative power, shown as positive) */}
                  <Area
                    type="monotone"
                    dataKey={(entry: { power: number }) => Math.min(0, entry.power)}
                    name="Mengeluarkan"
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    fill="url(#powerOutGrad)"
                    dot={false}
                    unit="W"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            {/* ── Daily SOC Range Chart ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Battery className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold">Rentang SOC Harian / Daily SOC Range</h3>
                <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">
                  Min
                </Badge>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
                  Max
                </Badge>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  Rata-rata
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={analytics.dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="socRangeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.energyIn} stopOpacity={0.3} />
                      <stop offset="50%" stopColor={colors.energyOut} stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                  />
                  <YAxis
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value: string) => {
                      const c = value === 'SOC Maks' ? colors.energyIn : value === 'SOC Min' ? '#ef4444' : colors.energyOut;
                      return <span style={{ color: c, fontSize: 11 }}>{value}</span>;
                    }}
                  />
                  <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="6 4" strokeOpacity={0.4} />
                  <Area
                    type="monotone"
                    dataKey="socMax"
                    name="SOC Maks"
                    stroke={colors.energyIn}
                    strokeWidth={2}
                    fill="url(#socRangeGrad)"
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit="%"
                  />
                  <Line
                    type="monotone"
                    dataKey="socAvg"
                    name="SOC Rata-rata"
                    stroke={colors.energyOut}
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit="%"
                  />
                  <Line
                    type="monotone"
                    dataKey="socMin"
                    name="SOC Min"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit="%"
                  />
                </AreaChart>
              </ResponsiveContainer>
              {analytics.dailyData.some(d => d.socMin < 20) && (
                <div className="mt-2 text-[11px] text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Deep discharge terdeteksi: SOC turun di bawah 20%
                </div>
              )}
            </motion.div>

            {/* ── Consumption Heatmap ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-semibold">Peta Konsumsi Mingguan / Weekly Consumption Heatmap</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  Intensitas daya rata-rata (W)
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[480px]">
                  {/* Header row: Day names */}
                  <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
                    <div />
                    {analytics.dayNames.map((day, i) => (
                      <div key={i} className="text-center text-[10px] text-muted-foreground font-medium">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Heatmap rows */}
                  {analytics.heatmapData.map((row, ri) => (
                    <div key={ri} className="grid gap-1 mb-1" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
                      <div className="text-[10px] text-muted-foreground flex items-center font-mono">
                        {row.hour}
                      </div>
                      {row.values.map((val, ci) => {
                        const intensity = analytics.heatmapMax > 0 ? val / analytics.heatmapMax : 0;
                        return (
                          <div
                            key={ci}
                            className="rounded-md flex items-center justify-center text-[10px] font-medium min-h-[36px] transition-colors"
                            style={{
                              backgroundColor: intensity > 0
                                ? `rgba(239, 68, 68, ${Math.max(0.08, intensity * 0.7)})`
                                : 'rgba(51, 65, 85, 0.3)',
                              color: intensity > 0.5 ? '#fff' : colors.text,
                            }}
                            title={`${analytics.dayNames[ci]} ${row.hour}: ${val}W`}
                          >
                            {val > 0 ? val : '-'}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {/* Legend */}
                  <div className="flex items-center justify-end gap-2 mt-3">
                    <span className="text-[10px] text-muted-foreground">Rendah</span>
                    <div className="flex gap-0.5">
                      {[0.1, 0.25, 0.4, 0.55, 0.7].map((o, i) => (
                        <div
                          key={i}
                          className="w-5 h-3 rounded-sm"
                          style={{ backgroundColor: `rgba(239, 68, 68, ${o})` }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">Tinggi</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ── System Uptime Stats ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Status Sistem / System Uptime</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Uptime</span>
                    <span className="text-sm font-bold text-emerald-400">{analytics.uptimePct.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, analytics.uptimePct)}%`,
                        backgroundColor: analytics.uptimePct > 95 ? '#10b981' : analytics.uptimePct > 80 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {analytics.dataPoints.toLocaleString()} poin data dalam {analytics.timeSpan.toFixed(1)} jam
                  </p>
                </div>
                <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs text-muted-foreground">WiFi RSSI</span>
                  </div>
                  <p className={`text-lg font-bold ${analytics.avgRssi > -60 ? 'text-emerald-400' : analytics.avgRssi > -75 ? 'text-amber-400' : 'text-red-400'}`}>
                    {analytics.avgRssi.toFixed(0)} dBm
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {analytics.avgRssi > -60 ? 'Sinyal Kuat' : analytics.avgRssi > -75 ? 'Sinyal Cukup' : 'Sinyal Lemah'}
                  </p>
                </div>
                <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs text-muted-foreground">Free Heap</span>
                  </div>
                  <p className="text-lg font-bold text-purple-400">
                    {analytics.avgHeap > 1024 ? `${(analytics.avgHeap / 1024).toFixed(1)} KB` : `${analytics.avgHeap.toFixed(0)} B`}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Memori tersedia rata-rata</p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </div>
    </PageTransition>
  );
}
