'use client';

import { useEffect, useState, useCallback, useMemo, Suspense, lazy } from 'react';
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
import { downsample } from '@/lib/utils';

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

// ── Page Component ──
// FE-059 FIX: Lazy-load chart section to reduce initial bundle size
const BatteryHealthCharts = lazy(() => import('./BatteryHealthCharts'));

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
      // FE-055 FIX: Use reduce-based approach instead of Math.min(...arr) / Math.max(...arr)
      // to avoid stack overflow on large arrays
      const min = values.reduce((m, v) => (v < m ? v : m), values[0]);
      const max = values.reduce((m, v) => (v > m ? v : m), values[0]);
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
    // FE-055 FIX: Use reduce-based approach instead of Math.min(...arr) to avoid stack overflow
    const minSoc = socValues.length > 0 ? socValues.reduce((m, v) => (v < m ? v : m), socValues[0]) : 0;

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
          // FE-059 FIX: Wrap chart section in Suspense for lazy loading
          <Suspense fallback={<div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[300px] rounded-xl" />)}</div>}>
            <BatteryHealthCharts healthScore={healthScore} historyAnalytics={historyAnalytics} />
          </Suspense>
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
