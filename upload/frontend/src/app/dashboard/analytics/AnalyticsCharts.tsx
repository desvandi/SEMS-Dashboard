'use client';

import { motion } from 'framer-motion';
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
import { AlertCircle, Sun, Zap, Battery, Activity, Wifi, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface AnalyticsData {
  totalEnergyIn: number;
  totalEnergyOut: number;
  netEnergy: number;
  efficiency: number;
  peakLoadPower: number;
  avgConsumption: number;
  uptimePct: number;
  avgRssi: number;
  avgHeap: number;
  dailyData: Array<{
    date: string;
    label: string;
    energyIn: number;
    energyOut: number;
    socMin: number;
    socMax: number;
    socAvg: number;
  }>;
  powerProfile: Array<{
    time: string;
    power: number;
    powerAbs: number;
    timestamp: string;
  }>;
  heatmapData: Array<{
    hour: string;
    values: number[];
  }>;
  heatmapMax: number;
  dayNames: string[];
  hourGroups: string[];
  dataPoints: number;
  timeSpan: number;
}

interface TelemetryData {
  timestamp: string;
  battery_power: number;
  inverter_power: number;
  wifi_rssi: number;
  free_heap: number;
  soc_percent: number;
  [key: string]: unknown;
}

interface ChartColors {
  grid: string;
  text: string;
  tooltip: string;
  energyIn: string;
  energyOut: string;
  power: string;
  soc: string;
}

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

interface Props {
  analytics: AnalyticsData;
  colors: ChartColors;
  data: TelemetryData[];
}

export function AnalyticsChartsSection({ analytics, colors }: Props) {
  return (
    <>
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
            <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
              <div />
              {analytics.dayNames.map((day, i) => (
                <div key={i} className="text-center text-[10px] text-muted-foreground font-medium">
                  {day}
                </div>
              ))}
            </div>

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
  );
}
