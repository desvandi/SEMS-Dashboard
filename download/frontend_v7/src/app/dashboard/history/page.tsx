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
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  BarChart3,
  Calendar,
  RefreshCw,
  AlertCircle,
  Battery,
  Zap,
  Thermometer,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronDown,
} from 'lucide-react';
import { format, subDays, subHours } from 'date-fns';

// ── Chart Colors ──
const chartColors = {
  grid: '#334155',
  text: '#94a3b8',
  tooltip: '#1e293b',
  voltage: '#10b981',
  current: '#06b6d4',
  soc: '#f59e0b',
  temperature: '#ef4444',
  humidity: '#3b82f6',
};

const cellColors = [
  '#10b981', '#06b6d4', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
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
// FE-053 FIX: Lookup map for dynamic Tailwind classes (Tailwind cannot purge dynamically constructed class names)
const colorBgMap: Record<string, { bg: string; text: string }> = {
  'text-emerald-400': { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  'text-cyan-400': { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  'text-amber-400': { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  'text-red-400': { bg: 'bg-red-500/10', text: 'text-red-400' },
  'text-primary': { bg: 'bg-primary/10', text: 'text-primary' },
};

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
  // FE-053 FIX: Use lookup map instead of dynamic template string for Tailwind classes
  const colorClasses = colorBgMap[color] || { bg: 'bg-primary/10', text: 'text-primary' };
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
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClasses.bg} ${colorClasses.text}`}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ── Downsample data if > 500 points ──
function downsample(data: TelemetryData[], maxPoints = 500): TelemetryData[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const result: TelemetryData[] = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

// ── Presets ──
const presets = [
  { label: '24 Jam', hours: 24 },
  { label: '7 Hari', days: 7 },
  { label: '14 Hari', days: 14 },
  { label: '30 Hari', days: 30 },
];

// ── Page Component ──
export default function HistoryPage() {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<number>(0);
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
      else params.limit = 1000;

      const res = await fetchTelemetryHistory(params);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error || 'Gagal memuat data historis');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kesalahan koneksi');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: last 24 hours
  useEffect(() => {
    const from = subHours(new Date(), 24).toISOString();
    loadHistory(from);
  }, [loadHistory]);

  const handlePreset = (index: number) => {
    setActivePreset(index);
    setShowCustom(false);
    const preset = presets[index];
    let from: Date;
    if (preset.hours) {
      from = subHours(new Date(), preset.hours);
    } else {
      from = subDays(new Date(), preset.days!);
    }
    loadHistory(from.toISOString());
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

  // Process data
  const chartData = useMemo(() => {
    const sampled = downsample(data);
    return sampled.map(item => ({
      ...item,
      _time: new Date(item.timestamp).getTime(),
      _label: (() => {
        const range = data.length > 0
          ? new Date(data[data.length - 1].timestamp).getTime() - new Date(data[0].timestamp).getTime()
          : 0;
        if (range <= 86400000) {
          return format(new Date(item.timestamp), 'HH:mm');
        }
        return format(new Date(item.timestamp), 'MM/dd HH:mm');
      })(),
    }));
  }, [data]);

  // Statistics
  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const voltages = data.map(d => d.battery_voltage).filter(v => v > 0);
    const currents = data.map(d => d.battery_current);
    const socs = data.map(d => d.soc_percent).filter(s => s >= 0);
    const temps = data.map(d => d.room_temp).filter(t => t > 0);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    // FE-055 FIX: Use reduce-based approach instead of Math.min(...arr) / Math.max(...arr)
    // to avoid stack overflow on large arrays
    const min = (arr: number[]) => arr.reduce((m, v) => (v < m ? v : m), arr[0]);
    const max = (arr: number[]) => arr.reduce((m, v) => (v > m ? v : m), arr[0]);

    return {
      avgVoltage: voltages.length ? avg(voltages) : 0,
      minVoltage: voltages.length ? min(voltages) : 0,
      maxVoltage: voltages.length ? max(voltages) : 0,
      avgCurrent: currents.length ? avg(currents) : 0,
      peakCurrent: currents.length ? max(currents.map(Math.abs)) : 0,
      minSoc: socs.length ? min(socs) : 0,
      maxSoc: socs.length ? max(socs) : 0,
      avgTemp: temps.length ? avg(temps) : 0,
      maxTemp: temps.length ? max(temps) : 0,
    };
  }, [data]);

  const rangeLabel = useMemo(() => {
    if (activePreset >= 0) return presets[activePreset].label;
    return 'Kustom';
  }, [activePreset]);

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={() => loadHistory()} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Riwayat Data"
          subtitle="Data telemetri historis dengan grafik interaktif"
          icon={<BarChart3 className="w-5 h-5 text-primary" />}
          badge={
            !loading && data.length > 0 ? (
              <Badge variant="outline" className="text-xs">
                {data.length} data poin
              </Badge>
            ) : undefined
          }
        />

        {/* Date Range Selector */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Rentang Waktu</span>
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

        {/* Statistics Summary */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : stats && data.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              icon={<Battery className="w-4 h-4" />}
              label="Rata-rata Tegangan"
              value={`${stats.avgVoltage.toFixed(1)}V`}
              subValue={`Min: ${stats.minVoltage.toFixed(1)}V · Max: ${stats.maxVoltage.toFixed(1)}V`}
              color="text-emerald-400"
              delay={0}
            />
            <StatCard
              icon={<Zap className="w-4 h-4" />}
              label="Arus Baterai"
              value={`${stats.avgCurrent.toFixed(2)}A`}
              subValue={`Puncak: ${stats.peakCurrent.toFixed(2)}A`}
              color="text-cyan-400"
              delay={0.05}
            />
            <StatCard
              icon={<Activity className="w-4 h-4" />}
              label="SOC Baterai"
              value={`${stats.minSoc.toFixed(0)}%`}
              subValue={`Max: ${stats.maxSoc.toFixed(0)}%`}
              color="text-amber-400"
              delay={0.1}
            />
            <StatCard
              icon={<Thermometer className="w-4 h-4" />}
              label="Suhu Ruangan"
              value={`${stats.avgTemp.toFixed(1)}°C`}
              subValue={`Max: ${stats.maxTemp.toFixed(1)}°C`}
              color="text-red-400"
              delay={0.15}
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="Rentang Data"
              value={rangeLabel}
              subValue={`${data.length} poin`}
              color="text-primary"
              delay={0.2}
            />
          </div>
        ) : null}

        {/* Charts */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[300px] rounded-xl" />
            ))}
          </div>
        ) : data.length === 0 && !error ? (
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
        ) : chartData.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
            {/* Battery Voltage Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0 }}
              className="glass-card rounded-xl p-4 lg:col-span-2"
            >
              <div className="flex items-center gap-2 mb-4">
                <Battery className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Tegangan Baterai</h3>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
                  {chartColors.voltage}
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(1)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="battery_voltage"
                    name="Tegangan"
                    stroke={chartColors.voltage}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: chartColors.voltage }}
                    unit="V"
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Battery Current Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card rounded-xl p-4 lg:col-span-2"
            >
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold">Arus Baterai</h3>
                <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/30">
                  {chartColors.current}
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="currentGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.current} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={chartColors.current} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(1)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="battery_current"
                    name="Arus"
                    stroke={chartColors.current}
                    strokeWidth={2}
                    fill="url(#currentGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: chartColors.current }}
                    unit="A"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Battery SOC Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card rounded-xl p-4 lg:col-span-2"
            >
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold">State of Charge (SOC)</h3>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  {chartColors.soc}
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.soc} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={chartColors.soc} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="soc_percent"
                    name="SOC"
                    stroke={chartColors.soc}
                    strokeWidth={2}
                    fill="url(#socGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: chartColors.soc }}
                    unit="%"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Environment Chart - Temperature & Humidity */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <Thermometer className="w-4 h-4 text-red-400" />
                <h3 className="text-sm font-semibold">Suhu & Kelembaban</h3>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    yAxisId="temp"
                    orientation="left"
                    tick={{ fill: chartColors.temperature, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.temperature }}
                    tickLine={{ stroke: chartColors.temperature }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(0)}°`}
                  />
                  <YAxis
                    yAxisId="humidity"
                    orientation="right"
                    tick={{ fill: chartColors.humidity, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.humidity }}
                    tickLine={{ stroke: chartColors.humidity }}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value: string) => (
                      <span style={{ color: value === 'Suhu' ? chartColors.temperature : chartColors.humidity, fontSize: 11 }}>
                        {value}
                      </span>
                    )}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="room_temp"
                    name="Suhu"
                    stroke={chartColors.temperature}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit="°C"
                  />
                  <Line
                    yAxisId="humidity"
                    type="monotone"
                    dataKey="room_humidity"
                    name="Kelembaban"
                    stroke={chartColors.humidity}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit="%"
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Cell Voltages Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <Battery className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Tegangan Sel Individual</h3>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(2)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  />
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
                    <Line
                      key={cell}
                      type="monotone"
                      dataKey={`cell${cell}_v`}
                      name={`Sel ${cell}`}
                      stroke={cellColors[cell - 1]}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 2 }}
                      unit="V"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Inverter Power Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold">Daya Inverter</h3>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="inverterGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                    domain={[0, 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="inverter_power"
                    name="Daya"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fill="url(#inverterGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#8b5cf6' }}
                    unit="W"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Inverter Current Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <TrendingDown className="w-4 h-4 text-pink-400" />
                <h3 className="text-sm font-semibold">Arus Inverter</h3>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="_label"
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tick={{ fill: chartColors.text, fontSize: 10 }}
                    axisLine={{ stroke: chartColors.grid }}
                    tickLine={{ stroke: chartColors.grid }}
                    domain={[0, 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(1)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="inverter_current"
                    name="Arus"
                    stroke="#ec4899"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: '#ec4899' }}
                    unit="A"
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
