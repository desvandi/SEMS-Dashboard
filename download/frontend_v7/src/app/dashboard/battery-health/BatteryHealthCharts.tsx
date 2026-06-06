'use client';

// FE-059 FIX: Chart section extracted from battery-health/page.tsx for lazy loading.
// This isolates the heavy recharts dependency so it loads asynchronously.

import { motion } from 'framer-motion';
import type { TelemetryData } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
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
  Battery,
  Activity,
  Zap,
  Shield,
  TrendingUp,
  Clock,
  AlertCircle,
  Lightbulb,
} from 'lucide-react';

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
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#334155" strokeWidth={strokeWidth} />
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

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}j`;
  return `${(hours / 24).toFixed(1)}h`;
}

interface HistoryAnalytics {
  cellStats: Array<{ cell: number; avg: number; min: number; max: number; stdDev: number; status: 'good' | 'warning' | 'danger' }>;
  worstCell: { cell: number; avg: number; stdDev: number } | null;
  deviationData: Record<string, unknown>[];
  cellVoltageNow: Array<{ cell: string; voltage: number; cellIdx: number }>;
  avgVoltage: number;
  packVoltageData: Array<{ time: string; packVoltage: number }>;
  cycles: number;
  dischargeCycles: number;
  avgChargeDuration: number;
  avgDischargeDuration: number;
  lowSocEvents: number;
  minSoc: number;
  recommendations: string[];
  dataPoints: number;
}

interface HealthScoreData {
  score: number;
  balanceScore: number;
  voltageScore: number;
  socScore: number;
  mean: number;
  stdDev: number;
  soc: number;
}

interface BatteryHealthChartsProps {
  healthScore: HealthScoreData | null;
  historyAnalytics: HistoryAnalytics | null;
}

export default function BatteryHealthCharts({ healthScore, historyAnalytics }: BatteryHealthChartsProps) {
  return (
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
              <XAxis dataKey="cell" tick={{ fill: colors.text, fontSize: 10 }} axisLine={{ stroke: colors.grid }} tickLine={{ stroke: colors.grid }} />
              <YAxis tick={{ fill: colors.text, fontSize: 10 }} axisLine={{ stroke: colors.grid }} tickLine={{ stroke: colors.grid }} domain={['auto', 'auto']} tickFormatter={(v: number) => `${v.toFixed(2)}`} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={historyAnalytics.avgVoltage} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5} />
              <Bar dataKey="voltage" name="Tegangan" radius={[4, 4, 0, 0]} unit="V">
                {historyAnalytics.cellVoltageNow.map((entry, index) => {
                  const color = entry.voltage >= 3.0 ? '#10b981' : entry.voltage >= 2.5 ? '#f59e0b' : '#ef4444';
                  return <Cell key={index} fill={color} fillOpacity={0.8} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
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
          <Badge variant="outline" className="text-[10px] text-muted-foreground ml-auto">mV dari rata-rata</Badge>
        </div>
        {historyAnalytics && historyAnalytics.deviationData.length > 0 && (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={historyAnalytics.deviationData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" tick={{ fill: colors.text, fontSize: 9 }} axisLine={{ stroke: colors.grid }} tickLine={{ stroke: colors.grid }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: colors.text, fontSize: 10 }} axisLine={{ stroke: colors.grid }} tickLine={{ stroke: colors.grid }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke={colors.text} strokeDasharray="3 3" />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
              {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => (
                <Line key={cell} type="monotone" dataKey={`cell${cell}`} name={`Sel ${cell}`} stroke={cellColors[cell - 1]} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} unit="mV" />
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
                    <tr key={cell.cell} className={`border-b border-border/20 ${isWorst ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2 px-3 font-medium flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cellColors[cell.cell - 1] }} />
                        Sel {cell.cell}
                        {isWorst && (
                          <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">Terburuk</Badge>
                        )}
                      </td>
                      <td className="text-right py-2 px-3 font-mono">{cell.avg.toFixed(3)}</td>
                      <td className="text-right py-2 px-3 font-mono text-red-400">{cell.min.toFixed(3)}</td>
                      <td className="text-right py-2 px-3 font-mono text-emerald-400">{cell.max.toFixed(3)}</td>
                      <td className="text-right py-2 px-3 font-mono">{cell.stdDev.toFixed(1)}</td>
                      <td className="text-center py-2 px-3"><CellStatusBadge status={cell.status} /></td>
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
              <XAxis dataKey="time" tick={{ fill: colors.text, fontSize: 9 }} axisLine={{ stroke: colors.grid }} tickLine={{ stroke: colors.grid }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: colors.text, fontSize: 10 }} axisLine={{ stroke: colors.grid }} tickLine={{ stroke: colors.grid }} domain={['auto', 'auto']} tickFormatter={(v: number) => `${v.toFixed(1)}V`} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={29.2} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} />
              <ReferenceLine y={25.6} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5} />
              <ReferenceLine y={20.0} stroke="#ef4444" strokeDasharray="6 4" strokeWidth={1.5} />
              <Area type="monotone" dataKey="packVoltage" name="Tegangan Pack" stroke={colors.energyIn} strokeWidth={2} fill="url(#packGrad)" dot={false} activeDot={{ r: 3, fill: colors.energyIn }} unit="V" />
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
              <p className="text-[10px] text-muted-foreground">Durasi rata-rata: {formatDuration(historyAnalytics.avgChargeDuration)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-muted/30">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Siklus Pengeluaran</p>
              </div>
              <p className="text-xl font-bold text-amber-400">{historyAnalytics.dischargeCycles}</p>
              <p className="text-[10px] text-muted-foreground">Durasi rata-rata: {formatDuration(historyAnalytics.avgDischargeDuration)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-muted/30">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">SOC Min</p>
              </div>
              <p className="text-xl font-bold text-red-400">{historyAnalytics.minSoc.toFixed(0)}%</p>
              <p className="text-[10px] text-muted-foreground">Low SOC events: {historyAnalytics.lowSocEvents}</p>
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
      {historyAnalytics && historyAnalytics.recommendations.length > 0 && (
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
          <ul className="space-y-2">
            {historyAnalytics.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="text-primary mt-0.5">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </>
  );
}
