'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { useSemsAuth } from '@/hooks/useSemsAuth';
import {
  fetchLatestTelemetry,
  fetchDevices,
  fetchTelemetryHistory,
  fetchConfig,
  updateConfig,
  controlDevice,
} from '@/lib/api';
import type { TelemetryData, Device } from '@/lib/types';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import {
  Battery,
  ShieldAlert,
  Zap,
  ZapOff,
  Power,
  PowerOff,
  RefreshCw,
  AlertCircle,
  Activity,
  Clock,
  RotateCcw,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { format, subHours, subMinutes, differenceInMinutes } from 'date-fns';
import { downsample } from '@/lib/utils';

// ── Shedding Constants ──
const THRESHOLDS = {
  TIER3: 21.5,
  TIER2: 21.0,
  TIER1: 20.5,
  UNDERVOLT: 20.0,
  RECOVER: 23.0,
} as const;

const GAUGE_MIN = 18.5;
const GAUGE_MAX = 27.0;

const PRIORITY_LABELS: Record<number, { id: string; color: string; bgColor: string; borderColor: string; icon: string }> = {
  1: { id: 'Kritis', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', icon: '🛡️' },
  2: { id: 'Standar', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', icon: '💡' },
  3: { id: 'Kenyamanan', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30', icon: '🌬️' },
  4: { id: 'Non-esensial', color: 'text-muted-foreground', bgColor: 'bg-muted/50', borderColor: 'border-muted', icon: '✨' },
};

// ── Chart Colors ──
const chartColors = {
  grid: '#334155',
  text: '#94a3b8',
  voltage: '#10b981',
};

// ── Helper: Determine active tier ──
function getActiveTier(voltage: number): number {
  if (voltage < THRESHOLDS.UNDERVOLT) return 0; // Emergency
  if (voltage < THRESHOLDS.TIER1) return 1;
  if (voltage < THRESHOLDS.TIER2) return 2;
  if (voltage < THRESHOLDS.TIER3) return 3;
  return -1; // Normal
}

function getTierName(tier: number): string {
  switch (tier) {
    case 0: return 'Darurat';
    case 1: return 'Tier 1';
    case 2: return 'Tier 2';
    case 3: return 'Tier 3';
    default: return 'Normal';
  }
}

function getTierColor(tier: number): string {
  switch (tier) {
    case 0: return '#7f1d1d';
    case 1: return '#ef4444';
    case 2: return '#f97316';
    case 3: return '#eab308';
    default: return '#10b981';
  }
}

function getVoltageColor(voltage: number): string {
  if (voltage < THRESHOLDS.UNDERVOLT) return '#7f1d1d';
  if (voltage < THRESHOLDS.TIER1) return '#ef4444';
  if (voltage < THRESHOLDS.TIER2) return '#f97316';
  if (voltage < THRESHOLDS.TIER3) return '#eab308';
  return '#10b981';
}

// ── Chart Tooltip ──
function SheddingChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; unit?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value || 0;
  const tier = getActiveTier(v);
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
      {tier >= 0 && (
        <div className="flex items-center gap-2 text-xs mt-1 pt-1 border-t border-border/30">
          <span className="text-muted-foreground">Status:</span>
          <span className="font-medium" style={{ color: getTierColor(tier) }}>
            {getTierName(tier)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Gauge Component ──
function VoltageGauge({ voltage }: { voltage: number }) {
  const percentage = Math.max(0, Math.min(100, ((voltage - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100));

  const zones = [
    { label: 'Darurat', from: 0, to: ((THRESHOLDS.UNDERVOLT - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: '#7f1d1d' },
    { label: 'Tier 1', from: ((THRESHOLDS.UNDERVOLT - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, to: ((THRESHOLDS.TIER1 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: '#ef4444' },
    { label: 'Tier 2', from: ((THRESHOLDS.TIER1 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, to: ((THRESHOLDS.TIER2 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: '#f97316' },
    { label: 'Tier 3', from: ((THRESHOLDS.TIER2 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, to: ((THRESHOLDS.TIER3 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: '#eab308' },
    { label: 'Normal', from: ((THRESHOLDS.TIER3 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, to: ((THRESHOLDS.RECOVER - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: '#10b981' },
    { label: 'Penuh', from: ((THRESHOLDS.RECOVER - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, to: 100, color: '#10b981' },
  ];

  const activeTier = getActiveTier(voltage);
  const vColor = getVoltageColor(voltage);

  return (
    <div className="glass-card rounded-xl p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Battery className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Tegangan Baterai</h3>
      </div>

      {/* Voltage Display */}
      <div className="text-center mb-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="text-5xl sm:text-6xl font-bold tracking-tight"
          style={{ color: vColor }}
        >
          {voltage.toFixed(2)}
          <span className="text-lg sm:text-xl ml-1 text-muted-foreground font-normal">V</span>
        </motion.div>
        <div className="flex items-center justify-center gap-2 mt-2">
          <Badge
            variant="outline"
            className="text-[11px] px-2 py-0.5 animate-pulse"
            style={{ borderColor: vColor, color: vColor, backgroundColor: `${vColor}15` }}
          >
            {activeTier >= 0 ? (
              <ShieldAlert className="w-3 h-3 mr-1" />
            ) : (
              <CheckCircle2 className="w-3 h-3 mr-1" />
            )}
            {activeTier >= 0 ? getTierName(activeTier) : 'Normal'}
          </Badge>
        </div>
      </div>

      {/* Horizontal Gauge Bar */}
      <div className="relative w-full h-8 rounded-full overflow-hidden bg-muted/30 border border-border/30 mb-2">
        {/* Zone backgrounds */}
        {zones.map((zone, i) => (
          <div
            key={i}
            className="absolute top-0 h-full"
            style={{
              left: `${zone.from}%`,
              width: `${zone.to - zone.from}%`,
              backgroundColor: zone.color,
              opacity: 0.25,
            }}
          />
        ))}
        {/* Filled portion */}
        <motion.div
          className="absolute top-0 h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{
            background: `linear-gradient(90deg, ${vColor}80, ${vColor})`,
          }}
        />
        {/* Needle/Indicator */}
        <motion.div
          className="absolute top-0 h-full w-0.5 bg-white shadow-lg shadow-white/50"
          initial={{ left: '0%' }}
          animate={{ left: `${percentage}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ zIndex: 10 }}
        >
          <div
            className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full"
            style={{ backgroundColor: vColor, boxShadow: `0 0 10px ${vColor}` }}
          />
        </motion.div>
      </div>

      {/* Scale labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        <span>{GAUGE_MIN}V</span>
        <span className="text-red-400">{THRESHOLDS.UNDERVOLT}V</span>
        <span className="text-orange-400">{THRESHOLDS.TIER2}V</span>
        <span className="text-yellow-400">{THRESHOLDS.TIER3}V</span>
        <span className="text-emerald-400">{THRESHOLDS.RECOVER}V</span>
        <span>{GAUGE_MAX}V</span>
      </div>
    </div>
  );
}

// ── Threshold Reference Card ──
function ThresholdCard({ activeTier }: { activeTier: number }) {
  const tiers = [
    { tier: 3, voltage: THRESHOLDS.TIER3, label: '< 21.5V', desc: 'Shed Priority 4 (Beban non-esensial)', color: '#eab308', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30' },
    { tier: 2, voltage: THRESHOLDS.TIER2, label: '< 21.0V', desc: 'Shed Priority 3-4 (Beban kenyamanan)', color: '#f97316', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/30' },
    { tier: 1, voltage: THRESHOLDS.TIER1, label: '< 20.5V', desc: 'Shed Priority 2-4 (Beban standar)', color: '#ef4444', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
    { tier: 0, voltage: THRESHOLDS.UNDERVOLT, label: '< 20.0V', desc: 'Shed ALL (Darurat - hanya beban kritis)', color: '#7f1d1d', bgColor: 'bg-red-900/20', borderColor: 'border-red-900/50' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Referensi Ambang Batas</h3>
      </div>
      <div className="space-y-2">
        {tiers.map((t) => (
          <div
            key={t.tier}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
              activeTier === t.tier
                ? `${t.bgColor} ${t.borderColor} animate-pulse`
                : 'border-border/30 bg-background/30'
            }`}
          >
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: t.color, boxShadow: activeTier === t.tier ? `0 0 8px ${t.color}` : 'none' }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{t.label}</span>
                {activeTier === t.tier && (
                  <Badge className="text-[9px] px-1.5 py-0 h-4" style={{ backgroundColor: t.color, color: '#fff' }}>
                    AKTIF
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{t.desc}</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </div>
        ))}
        <Separator className="my-2" />
        <div className="flex items-center gap-3 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-emerald-400">&gt; 23.0V — Pemulihan</span>
            <p className="text-[10px] text-muted-foreground">Pulihkan semua beban (setelah cooldown 5 menit)</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Priority Matrix ──
function PriorityMatrix({
  devices,
  activeTier,
  loading,
}: {
  devices: Device[];
  activeTier: number;
  loading: boolean;
}) {
  const grouped = useMemo(() => {
    const groups: Record<number, Device[]> = { 1: [], 2: [], 3: [], 4: [] };
    devices.forEach(d => {
      const p = d.priority || 4;
      if (groups[p]) groups[p].push(d);
    });
    return groups;
  }, [devices]);

  const isShedAtTier = (priority: number, tier: number): boolean => {
    if (tier === 0) return priority >= 1; // Emergency: shed 1-4 (but priority 1 is "critical, kept on" in firmware... 
    // Actually firmware sheds >= priority level. Let's adjust:
    // Tier 3 sheds priority 4+
    // Tier 2 sheds priority 3+
    // Tier 1 sheds priority 2+
    // Emergency sheds priority 1+ (all)
    if (tier === 3) return priority >= 4;
    if (tier === 2) return priority >= 3;
    if (tier === 1) return priority >= 2;
    if (tier === 0) return priority >= 1;
    return false;
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card rounded-xl p-4 sm:p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Matriks Perangkat</h3>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {devices.length} perangkat
        </Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
        {[1, 2, 3, 4].map(priority => {
          const pinfo = PRIORITY_LABELS[priority];
          const pDevices = grouped[priority] || [];
          const isThisPriorityShed = activeTier >= 0 && isShedAtTier(priority, activeTier);

          return (
            <div
              key={priority}
              className={`rounded-lg border p-3 ${
                isThisPriorityShed
                  ? `${pinfo.bgColor} ${pinfo.borderColor} opacity-70`
                  : 'border-border/30 bg-background/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{pinfo.icon}</span>
                <span className={`text-xs font-semibold ${pinfo.color}`}>P{priority} — {pinfo.id}</span>
                {isThisPriorityShed && (
                  <Badge className="text-[9px] px-1.5 py-0 h-4 bg-red-500/20 text-red-400 border-0">
                    SHED
                  </Badge>
                )}
              </div>
              {pDevices.length === 0 ? (
                <p className="text-[10px] text-muted-foreground italic">Tidak ada perangkat</p>
              ) : (
                <div className="space-y-1.5">
                  {pDevices.map(device => {
                    const isShed = activeTier >= 0 && isShedAtTier(device.priority || 4, activeTier);
                    return (
                      <div key={device.id} className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] truncate ${isShed ? 'line-through text-muted-foreground' : ''}`}>
                          {device.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 shrink-0 ${
                            device.state === 1
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          {device.state === 1 ? 'ON' : 'OFF'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Status Summary Card ──
function StatusSummaryCard({
  telemetry,
  activeTier,
  devices,
  loading,
}: {
  telemetry: TelemetryData | null;
  activeTier: number;
  devices: Device[];
  loading: boolean;
}) {
  const sheddingActive = telemetry ? telemetry.load_shedding_active === 1 : false;

  const shedCount = useMemo(() => {
    if (activeTier < 0 || devices.length === 0) return 0;
    const isShedAtTier = (priority: number, tier: number): boolean => {
      if (tier === 0) return priority >= 1;
      if (tier === 3) return priority >= 4;
      if (tier === 2) return priority >= 3;
      if (tier === 1) return priority >= 2;
      return false;
    };
    return devices.filter(d => isShedAtTier(d.priority || 4, activeTier)).length;
  }, [devices, activeTier]);

  const recoveryStatus = useMemo(() => {
    if (!telemetry) return { status: '—', color: 'text-muted-foreground' };
    if (telemetry.battery_voltage >= THRESHOLDS.RECOVER) return { status: 'Siap Pulih', color: 'text-emerald-400' };
    if (activeTier < 0) return { status: 'Normal', color: 'text-emerald-400' };
    return { status: 'Menunggu Pulih', color: 'text-amber-400' };
  }, [telemetry, activeTier]);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card rounded-xl p-4 sm:p-5"
      >
        <Skeleton className="h-4 w-36 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Ringkasan Status</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* Shedding Status */}
        <div className="p-3 rounded-lg bg-background/50 border border-border/30">
          <span className="text-[10px] text-muted-foreground uppercase block">Status Shedding</span>
          <div className="flex items-center gap-2 mt-1">
            {sheddingActive ? (
              <>
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-semibold text-red-400">Aktif</span>
              </>
            ) : (
              <>
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-sm font-semibold text-emerald-400">Tidak Aktif</span>
              </>
            )}
          </div>
        </div>

        {/* Active Tier */}
        <div className="p-3 rounded-lg bg-background/50 border border-border/30">
          <span className="text-[10px] text-muted-foreground uppercase block">Tier Aktif</span>
          <span className={`text-sm font-semibold ${activeTier >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {activeTier >= 0 ? getTierName(activeTier) : 'Normal'}
          </span>
        </div>

        {/* Devices Shed */}
        <div className="p-3 rounded-lg bg-background/50 border border-border/30">
          <span className="text-[10px] text-muted-foreground uppercase block">Perangkat di-Shed</span>
          <div className="flex items-center gap-2 mt-1">
            {shedCount > 0 ? (
              <ZapOff className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className={`text-sm font-semibold ${shedCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {shedCount} / {devices.length}
            </span>
          </div>
        </div>

        {/* Recovery Status */}
        <div className="p-3 rounded-lg bg-background/50 border border-border/30">
          <span className="text-[10px] text-muted-foreground uppercase block">Status Pemulihan</span>
          <span className={`text-sm font-semibold ${recoveryStatus.color}`}>
            {recoveryStatus.status}
          </span>
        </div>

        {/* SOC */}
        {telemetry && (
          <div className="p-3 rounded-lg bg-background/50 border border-border/30 col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase block">SOC Baterai</span>
                <span className="text-sm font-semibold">
                  {(telemetry.soc_percent ?? 0).toFixed(1)}%
                </span>
              </div>
              {telemetry.uptime_seconds > 0 && (
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground uppercase block">Uptime</span>
                  <span className="text-xs text-muted-foreground">
                    {Math.floor(telemetry.uptime_seconds / 3600)}j {Math.floor((telemetry.uptime_seconds % 3600) / 60)}m
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Manual Override Card ──
function ManualOverrideCard({
  loading,
  isAdmin,
}: {
  loading: boolean;
  isAdmin: boolean;
}) {
  const [autoShedding, setAutoShedding] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const handleToggleAuto = async () => {
    setSaving('auto');
    try {
      const res = await updateConfig({ updates: [{ key: 'load_shedding_enabled', value: autoShedding ? '0' : '1' }] });
      if (res.success) {
        setAutoShedding(!autoShedding);
        toast.success(!autoShedding ? 'Auto Load Shedding diaktifkan' : 'Auto Load Shedding dinonaktifkan');
      } else {
        toast.error(res.error || 'Gagal mengubah konfigurasi');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setSaving(null);
    }
  };

  const handleForceRecovery = async () => {
    setSaving('recover');
    try {
      const res = await updateConfig({ updates: [{ key: 'force_recovery', value: '1' }] });
      if (res.success) {
        toast.success('Semua beban telah dipulihkan');
      } else {
        toast.error(res.error || 'Gagal memulihkan beban');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setSaving(null);
    }
  };

  const handleForceShed = async () => {
    setSaving('shed');
    try {
      const res = await updateConfig({ updates: [{ key: 'force_shed', value: '1' }] });
      if (res.success) {
        toast.success('Semua beban non-kritis dimatikan');
      } else {
        toast.error(res.error || 'Gagal mematikan beban');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card rounded-xl p-4 sm:p-5"
      >
        <Skeleton className="h-4 w-36 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="glass-card rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold">Kontrol Manual</h3>
        <Badge variant="outline" className="text-[10px] px-2 py-0 ml-auto bg-amber-500/10 text-amber-400 border-amber-500/30">
          Admin
        </Badge>
      </div>

      {isAdmin ? (
      <div className="space-y-3">
        {/* Auto toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
          <div>
            <Label className="text-xs font-medium">Auto Load Shedding</Label>
            <p className="text-[10px] text-muted-foreground">
              Kontrol otomatis berdasarkan tegangan
            </p>
          </div>
          <Switch
            checked={autoShedding}
            onCheckedChange={handleToggleAuto}
            disabled={saving === 'auto'}
          />
        </div>

        {/* Force buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs h-10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
            disabled={saving !== null}
            onClick={handleForceRecovery}
          >
            {saving === 'recover' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Force Recovery
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs h-10 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
            disabled={saving !== null}
            onClick={handleForceShed}
          >
            {saving === 'shed' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PowerOff className="w-3.5 h-3.5" />
            )}
            Force Shed All
          </Button>
        </div>
      </div>
      ) : (
        <div className="text-center py-6">
          <ShieldAlert className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Hanya admin dan teknisi yang dapat mengakses kontrol manual.</p>
        </div>
      )}
    </motion.div>
  );
}

// ════════════════════════════════════════════
// ── Main Page Component ──
// ════════════════════════════════════════════
export default function LoadSheddingPage() {
  const { user: session } = useSemsAuth();
  const isAdmin = session?.role === 'admin' || session?.role === 'technician';

  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [history, setHistory] = useState<TelemetryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [telRes, devRes] = await Promise.all([
        fetchLatestTelemetry(),
        fetchDevices(),
      ]);
      if (telRes.success && telRes.data) {
        setTelemetry(telRes.data);
      }
      if (devRes.success && devRes.devices) {
        setDevices(devRes.devices);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const from = subHours(new Date(), 24).toISOString();
      const res = await fetchTelemetryHistory({ from, limit: 1000 });
      if (res.success && res.data) {
        setHistory(res.data);
      }
    } catch {
      // History fetch is non-critical
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadHistory();
  }, [loadData, loadHistory]);

  const activeTier = telemetry ? getActiveTier(telemetry.battery_voltage) : -1;

  // Chart data
  const chartData = useMemo(() => {
    const sampled = downsample(history);
    return sampled.map(item => ({
      ...item,
      _time: new Date(item.timestamp).getTime(),
      _label: format(new Date(item.timestamp), 'HH:mm'),
    }));
  }, [history]);

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadData} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Load Shedding Dashboard"
          subtitle="Monitoring dan kontrol sistem load shedding baterai"
          icon={<ShieldAlert className="w-5 h-5 text-primary" />}
        />

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={loadData} className="ml-auto text-primary hover:underline">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Top section: Gauge + Threshold */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loading ? (
            <>
              <Skeleton className="h-[220px] rounded-xl" />
              <Skeleton className="h-[300px] rounded-xl" />
            </>
          ) : (
            <>
              <VoltageGauge voltage={telemetry?.battery_voltage || 0} />
              <ThresholdCard activeTier={activeTier} />
            </>
          )}
        </div>

        {/* Status + Override */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StatusSummaryCard
            telemetry={telemetry}
            activeTier={activeTier}
            devices={devices}
            loading={loading}
          />
          <ManualOverrideCard loading={loading} isAdmin={isAdmin} />
        </div>

        {/* Priority Matrix */}
        <PriorityMatrix devices={devices} activeTier={activeTier} loading={loading} />

        {/* Shedding Timeline Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card rounded-xl p-4 sm:p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Timeline Tegangan (24 Jam)</h3>
            <Badge variant="outline" className="text-[10px] ml-auto">
              {history.length} data poin
            </Badge>
          </div>

          {historyLoading ? (
            <Skeleton className="h-[300px] w-full rounded-lg" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="voltageGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.voltage} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartColors.voltage} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="_label"
                  tick={{ fill: chartColors.text, fontSize: 10 }}
                  axisLine={{ stroke: chartColors.grid }}
                  tickLine={{ stroke: chartColors.grid }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: chartColors.text, fontSize: 10 }}
                  axisLine={{ stroke: chartColors.grid }}
                  tickLine={{ stroke: chartColors.grid }}
                  domain={[18, 28]}
                  tickFormatter={(v: number) => `${v.toFixed(0)}V`}
                />
                <Tooltip content={<SheddingChartTooltip />} />

                {/* Reference Areas for zones */}
                <ReferenceArea y1={18} y2={THRESHOLDS.UNDERVOLT} fill="#7f1d1d" fillOpacity={0.15} />
                <ReferenceArea y1={THRESHOLDS.UNDERVOLT} y2={THRESHOLDS.TIER1} fill="#ef4444" fillOpacity={0.08} />
                <ReferenceArea y1={THRESHOLDS.TIER1} y2={THRESHOLDS.TIER2} fill="#f97316" fillOpacity={0.06} />
                <ReferenceArea y1={THRESHOLDS.TIER2} y2={THRESHOLDS.TIER3} fill="#eab308" fillOpacity={0.05} />

                {/* Reference Lines */}
                <ReferenceLine y={THRESHOLDS.UNDERVOLT} stroke="#7f1d1d" strokeDasharray="6 3" strokeWidth={1} label={{ value: '20.0V', fill: '#7f1d1d', fontSize: 9, position: 'insideTopRight' }} />
                <ReferenceLine y={THRESHOLDS.TIER1} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1} label={{ value: '20.5V', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }} />
                <ReferenceLine y={THRESHOLDS.TIER2} stroke="#f97316" strokeDasharray="6 3" strokeWidth={1} label={{ value: '21.0V', fill: '#f97316', fontSize: 9, position: 'insideTopRight' }} />
                <ReferenceLine y={THRESHOLDS.TIER3} stroke="#eab308" strokeDasharray="6 3" strokeWidth={1} label={{ value: '21.5V', fill: '#eab308', fontSize: 9, position: 'insideTopRight' }} />
                <ReferenceLine y={THRESHOLDS.RECOVER} stroke="#10b981" strokeDasharray="6 3" strokeWidth={1} label={{ value: '23.0V (Recover)', fill: '#10b981', fontSize: 9, position: 'insideTopLeft' }} />

                <Area
                  type="monotone"
                  dataKey="battery_voltage"
                  name="Tegangan"
                  stroke={chartColors.voltage}
                  strokeWidth={2}
                  fill="url(#voltageGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: chartColors.voltage }}
                  unit="V"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <TrendingUp className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">Data historis belum tersedia</p>
            </div>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
}
