'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchLatestTelemetry, fetchTelemetryHistory } from '@/lib/api';
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
  Cell,
} from 'recharts';
import {
  HeartPulse,
  Calendar,
  RefreshCw,
  AlertCircle,
  Battery,
  Activity,
  ChevronDown,
  Zap,
  Shield,
  TrendingUp,
  Clock,
  Lightbulb,
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

const cellColors = ['#10b981', '#06b6d4', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ── Presets ──
const presets = [
  { label: 'Hari Ini', days: 0 },
  { label: '7 Hari', days: 7 },
  { label: '14 Hari', days: 14 },
  { label: '30 Hari', days: 30 },
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

// ── SVG Health Gauge ──
function HealthGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = clamped >= 80 ? '#10b981' : clamped >= 60 ? '#f59e0b' : '#ef4444';
  const statusText = clamped >= 80 ? 'Sehat / Healthy' : clamped >= 60 ? 'Perlu Perhatian / Needs Attention' : 'Tidak Sehat / Unhealthy';
  const statusColor = clamped >= 80 ? 'text-emerald-400' : clamped >= 60 ? 'text-amber-400' : 'text-red-400';

  // SVG arc
  const radius = 70;
  const strokeWidth = 10;
  const cx = 80;
  const cy = 80;
  const circumference = 2 * Math.PI * radius;
  const progress = (clamped / 100) * circumference;
  const dashOffset = circumference - progress;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="160" height="160" viewBox="0 0 160 160" className="transform -rotate-90">
          {/* Background circle */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#334155"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>{clamped.toFixed(0)}</span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <p className={`text-sm font-semibold mt-2 ${statusColor}`}>{statusText}</p>
    </div>
  );
}

// ── Cell Status Badge ──
function CellStatusBadge({ status }: { status: 'good' | 'warning' | 'danger' }) {
  const config = {
    good: { label: 'Sehat', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    warning: { label: 'Cukup', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    danger: { label: 'Buruk', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  };
  const c = config[status];
  return (
    <Badge variant="outline" className={`text-[10px] ${c.className}`}>
      {c.label}
    </Badge>
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

// ── Page Component ──
export default function BatteryHealthPage() {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [latestData, setLatestData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<number>(1); // 7 Hari
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
        setError(res.error || 'Gagal memuat data baterai');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kesalahan koneksi');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const res = await fetchLatestTelemetry();
      if (res.success && res.data) {
        setLatestData(res.data);
      }
    } catch {
      // silently fail for latest data
    }
  }, []);

  useEffect(() => {
    const from = subDays(new Date(), 7).toISOString();
    loadHistory(from);
    loadLatest();
  }, [loadHistory, loadLatest]);

  const handlePreset = (index: number) => {
    setActivePreset(index);
    setShowCustom(false);
    const preset = presets[index];
    if (preset.days === 0) {
      loadHistory(startOfDay(new Date()).toISOString());
    } else {
      loadHistory(subDays(new Date(), preset.days).toISOString());
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

  const handleRefresh = () => {
    loadLatest();
    const preset = presets[activePreset] || presets[1];
    if (preset.days === 0) {
      loadHistory(startOfDay(new Date()).toISOString());
    } else {
      loadHistory(subDays(new Date(), preset.days).toISOString());
    }
  };

  // ── Health Score Calculation ──
  const healthScore = useMemo(() => {
    // Use latest data for real-time score, fall back to last in history
    const d = latestData || (data.length > 0 ? data[data.length - 1] : null);
    if (!d) return null;

    // Get cell voltages
    const cellVoltages = [1, 2, 3, 4, 5, 6, 7, 8].map(i => (d[`cell${i}_v`] as number) ?? 0).filter(v => v > 0);
    if (cellVoltages.length < 4) return null;

    const mean = cellVoltages.reduce((a, b) => a + b, 0) / cellVoltages.length;
    const stdDev = Math.sqrt(cellVoltages.reduce((sum, v) => sum + (v - mean) ** 2, 0) / cellVoltages.length);

    // Component 1: Cell balance (0-40 points) — stdDev should be < 50mV for full score
    const balanceScore = Math.max(0, 40 - (stdDev * 1000 / 50) * 40);

    // Component 2: Voltage range / nominal (0-30 points) — nominal is 3.2V
    const avgDevFromNominal = Math.abs(mean - 3.2);
    const voltageScore = Math.max(0, 30 - (avgDevFromNominal / 0.5) * 30);

    // Component 3: SOC level (0-30 points) — penalize very low SOC
    const soc = d.soc_percent ?? 0;
    let socScore = 30;
    if (soc < 20) socScore = Math.max(0, soc * 1.5);
    else if (soc < 50) socScore = 30 - ((50 - soc) / 30) * 10;

    return {
      score: balanceScore + voltageScore + socScore,
      balanceScore,
      voltageScore,
      socScore,
      cellVoltages,
      mean,
      stdDev,
      soc,
      packVoltage: d.battery_voltage ?? 0,
    };
  }, [latestData, data]);

  // ── History Analytics ──
  const historyAnalytics = useMemo(() => {
    if (data.length < 2) return null;

    // Cell statistics
    const cellStats = [1, 2, 3, 4, 5, 6, 7, 8].map(cellIdx => {
      const values = data.map(d => d[`cell${cellIdx}_v`] as number).filter(v => v > 0);
      if (values.length === 0) return null;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length);
      const status: 'good' | 'warning' | 'danger' = avg >= 3.0 ? 'good' : avg >= 2.5 ? 'warning' : 'danger';
      return { cell: cellIdx, avg, min, max, stdDev: sd * 1000, status };
    }).filter(Boolean) as Array<{ cell: number; avg: number; min: number; max: number; stdDev: number; status: 'good' | 'warning' | 'danger' }>;

    // Find worst cell
    const worstCell = cellStats.reduce((worst, c) => {
      if (!worst) return c;
      return c.stdDev > worst.stdDev ? c : c.avg < worst.avg ? c : worst;
    }, null as typeof cellStats[0] | null);

    // Cell deviation over time
    const sampled = downsample(data, 300);
    const deviationData = sampled.map(d => {
      const voltages = [1, 2, 3, 4, 5, 6, 7, 8].map(i => d[`cell${i}_v`] as number).filter(v => v > 0);
      const mean = voltages.length > 0 ? voltages.reduce((a, b) => a + b, 0) / voltages.length : 0;
      const entry: Record<string, unknown> = {
        time: format(new Date(d.timestamp), 'MM/dd HH:mm'),
      };
      [1, 2, 3, 4, 5, 6, 7, 8].forEach(i => {
        const v = d[`cell${i}_v`] as number;
        entry[`cell${i}`] = v > 0 ? Math.round((v - mean) * 1000) : 0; // mV deviation
      });
      return entry;
    });

    // Cell voltage balance chart data (current/latest)
    const latest = data[data.length - 1];
    const cellVoltageNow = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({
      cell: `Sel ${i}`,
      voltage: latest[`cell${i}_v`] as number,
      cellIdx: i,
    }));
    const avgVoltage = cellVoltageNow.reduce((a, b) => a + b.voltage, 0) / cellVoltageNow.length;

    // Pack voltage trend
    const packVoltageData = sampled.map(d => ({
      time: format(new Date(d.timestamp), 'MM/dd HH:mm'),
      packVoltage: d.battery_voltage,
    }));

    // Charging cycle detection
    const cycles: { startTime: string; endTime: string; duration: number; maxCurrent: number }[] = [];
    let inCharge = false;
    let chargeStart = 0;
    let chargeMaxCurrent = 0;

    // Also track discharge cycles
    const dischargeCycles: { startTime: string; endTime: string; duration: number; maxPower: number }[] = [];
    let inDischarge = false;
    let dischargeStart = 0;
    let dischargeMaxPower = 0;

    for (let i = 0; i < data.length; i++) {
      const current = data[i].battery_current;

      if (current > 0.5 && !inCharge) {
        inCharge = true;
        chargeStart = new Date(data[i].timestamp).getTime();
        chargeMaxCurrent = current;
      } else if (current > 0.5 && inCharge) {
        chargeMaxCurrent = Math.max(chargeMaxCurrent, current);
      } else if (current <= 0.5 && inCharge) {
        inCharge = false;
        const duration = (new Date(data[i].timestamp).getTime() - chargeStart) / 3600000;
        if (duration > 0.05) { // at least 3 minutes
          cycles.push({
            startTime: new Date(chargeStart).toISOString(),
            endTime: data[i].timestamp,
            duration,
            maxCurrent: chargeMaxCurrent,
          });
        }
        chargeMaxCurrent = 0;
      }

      const power = data[i].battery_power;
      if (power < -5 && !inDischarge) {
        inDischarge = true;
        dischargeStart = new Date(data[i].timestamp).getTime();
        dischargeMaxPower = Math.abs(power);
      } else if (power < -5 && inDischarge) {
        dischargeMaxPower = Math.max(dischargeMaxPower, Math.abs(power));
      } else if (power >= -5 && inDischarge) {
        inDischarge = false;
        const duration = (new Date(data[i].timestamp).getTime() - dischargeStart) / 3600000;
        if (duration > 0.05) {
          dischargeCycles.push({
            startTime: new Date(dischargeStart).toISOString(),
            endTime: data[i].timestamp,
            duration,
            maxPower: dischargeMaxPower,
          });
        }
        dischargeMaxPower = 0;
      }
    }

    const avgChargeDuration = cycles.length > 0 ? cycles.reduce((a, c) => a + c.duration, 0) / cycles.length : 0;
    const avgDischargeDuration = dischargeCycles.length > 0 ? dischargeCycles.reduce((a, c) => a + c.duration, 0) / dischargeCycles.length : 0;

    // SOC low events
    const socValues = data.map(d => d.soc_percent).filter(s => s >= 0);
    const lowSocEvents = socValues.filter(s => s < 20).length;
    const minSoc = socValues.length > 0 ? Math.min(...socValues) : 0;

    // Recommendations
    const recommendations: string[] = [];

    // Check cell balance
    if (worstCell && worstCell.stdDev > 30) {
      recommendations.push(`Sel ${worstCell.cell} memiliki deviasi ${worstCell.stdDev.toFixed(0)}mV dari rata-rata. Pertimbangkan penyeimbangan sel (cell balancing).`);
    }

    // Check low SOC
    if (lowSocEvents > 0) {
      recommendations.push(`SOC sering turun di bawah 20% (${lowSocEvents} kejadian). Pertimbangkan kapasitas panel surya yang lebih besar.`);
    }

    // Check cell voltage
    const lowCells = cellStats.filter(c => c.avg < 2.8);
    if (lowCells.length > 0) {
      recommendations.push(`Sel ${lowCells.map(c => c.cell).join(', ')} memiliki tegangan rata-rata rendah (< 2.8V). Periksa kondisi sel tersebut.`);
    }

    // Check charging cycles
    if (cycles.length === 0 && data.length > 100) {
      recommendations.push('Tidak ada siklus pengisian terdeteksi dalam periode ini. Periksa koneksi panel surya.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Tidak ada masalah yang terdeteksi. Baterai dalam kondisi baik.');
    }

    return {
      cellStats,
      worstCell,
      deviationData,
      cellVoltageNow,
      avgVoltage,
      packVoltageData,
      cycles: cycles.length,
      dischargeCycles: dischargeCycles.length,
      avgChargeDuration,
      avgDischargeDuration,
      lowSocEvents,
      minSoc,
      recommendations,
      dataPoints: data.length,
    };
  }, [data]);

  // ── Loading state ──
  if (loading) {
    return (
      <PageTransition>
        <Header isConnected={true} lastUpdated={null} onRefresh={() => {}} />
        <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="glass-card rounded-xl p-4">
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="glass-card rounded-xl p-6">
            <div className="flex flex-col items-center">
              <Skeleton className="w-40 h-40 rounded-full" />
              <Skeleton className="h-5 w-32 mt-4" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[300px] rounded-xl" />
            <Skeleton className="h-[300px] rounded-xl" />
          </div>
          <Skeleton className="h-[300px] rounded-xl" />
          <Skeleton className="h-[250px] rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[200px] rounded-xl" />
            <Skeleton className="h-[200px] rounded-xl" />
          </div>
          <Skeleton className="h-[150px] rounded-xl" />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <Header
        isConnected={true}
        lastUpdated={null}
        onRefresh={handleRefresh}
      />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Kesehatan Baterai"
          subtitle="Monitoring kesehatan paket baterai 8 sel LiFePO4"
          icon={<HeartPulse className="w-5 h-5 text-primary" />}
        />

        {/* Date Range Selector */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Rentang Waktu / Period</span>
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
                <Button size="sm" className="h-8 text-xs gap-1" onClick={handleCustomRange}>
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
            <button onClick={handleRefresh} className="ml-auto text-primary hover:underline">
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
              <HeartPulse className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Tidak Ada Data</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Data telemetri belum tersedia untuk analisis kesehatan baterai
            </p>
          </motion.div>
        )}

        {data.length > 0 && (
          <>
            {/* ── 1. Battery Health Score ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0 }}
              className="glass-card rounded-xl p-5 sm:p-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Skor Kesehatan Baterai / Battery Health Score</h3>
              </div>
              {healthScore ? (
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <HealthGauge score={healthScore.score} />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1 w-full">
                    <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Keseimbangan Sel</p>
                      <p className="text-lg font-bold text-cyan-400">{healthScore.balanceScore.toFixed(0)}/40</p>
                      <p className="text-[10px] text-muted-foreground">Deviasi: {(healthScore.stdDev * 1000).toFixed(1)}mV</p>
                    </div>
                    <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tegangan Nominal</p>
                      <p className="text-lg font-bold text-amber-400">{healthScore.voltageScore.toFixed(0)}/30</p>
                      <p className="text-[10px] text-muted-foreground">Rata-rata: {healthScore.mean.toFixed(3)}V/sel</p>
                    </div>
                    <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Level SOC</p>
                      <p className="text-lg font-bold text-purple-400">{healthScore.socScore.toFixed(0)}/30</p>
                      <p className="text-[10px] text-muted-foreground">SOC saat ini: {healthScore.soc.toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground text-sm py-8">
                  Data tidak cukup untuk menghitung skor kesehatan
                </div>
              )}
            </motion.div>

            {/* ── 2. Cell Voltage Balance Chart ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Battery className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Keseimbangan Tegangan Sel / Cell Voltage Balance</h3>
                {historyAnalytics && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground ml-auto">
                    Rata-rata: {historyAnalytics.avgVoltage.toFixed(3)}V
                  </Badge>
                )}
              </div>
              {historyAnalytics && (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={historyAnalytics.cellVoltageNow} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                    <XAxis
                      dataKey="cell"
                      tick={{ fill: colors.text, fontSize: 10 }}
                      axisLine={{ stroke: colors.grid }}
                      tickLine={{ stroke: colors.grid }}
                    />
                    <YAxis
                      tick={{ fill: colors.text, fontSize: 10 }}
                      axisLine={{ stroke: colors.grid }}
                      tickLine={{ stroke: colors.grid }}
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `${v.toFixed(2)}`}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine
                      y={historyAnalytics.avgVoltage}
                      stroke="#f59e0b"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                    />
                    <Bar dataKey="voltage" name="Tegangan" radius={[4, 4, 0, 0]} unit="V">
                      {historyAnalytics.cellVoltageNow.map((entry, index) => {
                        const color = entry.voltage >= 3.0 ? '#10b981' : entry.voltage >= 2.5 ? '#f59e0b' : '#ef4444';
                        return <Cell key={index} fill={color} fillOpacity={0.8} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              {/* Color legend */}
              <div className="flex items-center gap-4 mt-3 justify-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">&ge;3.0V Sehat</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-amber-500" />
                  <span className="text-[10px] text-muted-foreground">2.5-3.0V Cukup</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-red-500" />
                  <span className="text-[10px] text-muted-foreground">&lt;2.5V Buruk</span>
                </div>
              </div>
            </motion.div>

            {/* ── 3. Cell Voltage Deviation Over Time ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold">Deviasi Tegangan Sel / Cell Voltage Deviation</h3>
                <Badge variant="outline" className="text-[10px] text-muted-foreground ml-auto">
                  mV dari rata-rata
                </Badge>
              </div>
              {historyAnalytics && historyAnalytics.deviationData.length > 0 && (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={historyAnalytics.deviationData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => (
                      <Line
                        key={cell}
                        type="monotone"
                        dataKey={`cell${cell}`}
                        name={`Sel ${cell}`}
                        stroke={cellColors[cell - 1]}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 2 }}
                        unit="mV"
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* ── 4. Cell Statistics Table ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold">Statistik Sel / Cell Statistics</h3>
              </div>
              {historyAnalytics && (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#1e293b] z-10">
                      <tr className="border-b border-border/50">
                        <th className="text-left py-2 px-3 text-muted-foreground font-medium">Sel</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-medium">Rata-rata (V)</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-medium">Min (V)</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-medium">Max (V)</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-medium">Std Dev (mV)</th>
                        <th className="text-center py-2 px-3 text-muted-foreground font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyAnalytics.cellStats.map(cell => {
                        const isWorst = historyAnalytics.worstCell && cell.cell === historyAnalytics.worstCell.cell;
                        return (
                          <tr
                            key={cell.cell}
                            className={`border-b border-border/20 ${isWorst ? 'bg-red-500/5' : ''}`}
                          >
                            <td className="py-2 px-3 font-medium flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cellColors[cell.cell - 1] }} />
                              Sel {cell.cell}
                              {isWorst && (
                                <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">
                                  Terburuk
                                </Badge>
                              )}
                            </td>
                            <td className="text-right py-2 px-3 font-mono">{cell.avg.toFixed(3)}</td>
                            <td className="text-right py-2 px-3 font-mono text-red-400">{cell.min.toFixed(3)}</td>
                            <td className="text-right py-2 px-3 font-mono text-emerald-400">{cell.max.toFixed(3)}</td>
                            <td className="text-right py-2 px-3 font-mono">{cell.stdDev.toFixed(1)}</td>
                            <td className="text-center py-2 px-3">
                              <CellStatusBadge status={cell.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>

            {/* ── 5. Pack Voltage Trend ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Tren Tegangan Pack / Pack Voltage Trend</h3>
                <div className="flex items-center gap-2 ml-auto">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-emerald-500 border-dashed" />
                    <span className="text-[9px] text-muted-foreground">Penuh 29.2V</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-amber-500 border-dashed" />
                    <span className="text-[9px] text-muted-foreground">Normal 25.6V</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-red-500 border-dashed" />
                    <span className="text-[9px] text-muted-foreground">Kosong 20.0V</span>
                  </div>
                </div>
              </div>
              {historyAnalytics && historyAnalytics.packVoltageData.length > 0 && (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={historyAnalytics.packVoltageData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="packGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colors.energyIn} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={colors.energyIn} stopOpacity={0.02} />
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
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `${v.toFixed(1)}V`}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={29.2} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} label={undefined} />
                    <ReferenceLine y={25.6} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5} />
                    <ReferenceLine y={20.0} stroke="#ef4444" strokeDasharray="6 4" strokeWidth={1.5} />
                    <Area
                      type="monotone"
                      dataKey="packVoltage"
                      name="Tegangan Pack"
                      stroke={colors.energyIn}
                      strokeWidth={2}
                      fill="url(#packGrad)"
                      dot={false}
                      activeDot={{ r: 3, fill: colors.energyIn }}
                      unit="V"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* ── 6. Charging Cycle Detection ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold">Deteksi Siklus / Cycle Detection</h3>
              </div>
              {historyAnalytics && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Siklus Pengisian</p>
                    </div>
                    <p className="text-xl font-bold text-emerald-400">{historyAnalytics.cycles}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Durasi rata-rata: {formatDuration(historyAnalytics.avgChargeDuration)}
                    </p>
                  </div>
                  <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-amber-400" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Siklus Pengeluaran</p>
                    </div>
                    <p className="text-xl font-bold text-amber-400">{historyAnalytics.dischargeCycles}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Durasi rata-rata: {formatDuration(historyAnalytics.avgDischargeDuration)}
                    </p>
                  </div>
                  <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">SOC Min</p>
                    </div>
                    <p className="text-xl font-bold text-red-400">{historyAnalytics.minSoc.toFixed(0)}%</p>
                    <p className="text-[10px] text-muted-foreground">
                      Low SOC events: {historyAnalytics.lowSocEvents}
                    </p>
                  </div>
                  <div className="space-y-1 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Data Points</p>
                    </div>
                    <p className="text-xl font-bold text-cyan-400">{historyAnalytics.dataPoints.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">Titik data dianalisis</p>
                  </div>
                </div>
              )}
            </motion.div>

            {/* ── 7. Recommendations ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold">Rekomendasi / Recommendations</h3>
              </div>
              {historyAnalytics && (
                <div className="space-y-2">
                  {historyAnalytics.recommendations.map((rec, i) => {
                    const isPositive = rec.includes('Tidak ada masalah');
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 p-3 rounded-lg text-sm ${
                          isPositive
                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                        }`}
                      >
                        {isPositive ? (
                          <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        )}
                        <span>{rec}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </div>
    </PageTransition>
  );
}

// ── Helper: format duration ──
function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} menit`;
  return `${hours.toFixed(1)} jam`;
}
