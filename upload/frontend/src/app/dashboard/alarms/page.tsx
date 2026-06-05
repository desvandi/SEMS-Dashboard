'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchAlarms, acknowledgeAlarm } from '@/lib/api';
import type { Alarm } from '@/lib/types';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  Filter,
} from 'lucide-react';

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type StatusFilter = 'all' | 'unacknowledged' | 'acknowledged';

// ---- Helpers ----
function getSeverityConfig(severity: string) {
  switch (severity) {
    case 'critical':
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
        badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        dot: 'bg-red-500',
      };
    case 'warning':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        dot: 'bg-amber-500',
      };
    default:
      return {
        icon: <Info className="w-4 h-4" />,
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
        badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        dot: 'bg-blue-500',
      };
  }
}

function formatTimestamp(ts: string) {
  if (!ts) return '';
  try {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return `${diffMin} menit lalu`;
    if (diffHour < 24) return `${diffHour} jam lalu`;
    if (diffDay < 7) return `${diffDay} hari lalu`;

    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function formatFullTimestamp(ts: string) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('id-ID', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

export default function AlarmsPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unackCount, setUnackCount] = useState(0);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Expanded
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Acknowledging
  const [ackingIdx, setAckingIdx] = useState<number | null>(null);
  const [ackAllLoading, setAckAllLoading] = useState(false);

  // Load More
  const [displayCount, setDisplayCount] = useState(20);
  const BATCH_SIZE = 20;

  const loadAlarms = useCallback(async () => {
    try {
      const res = await fetchAlarms({ limit: '200' });
      if (res.success && res.alarms) {
        setAlarms(res.alarms);
        setUnackCount(res.unacknowledged ?? res.alarms.filter(a => !a.acknowledged).length);
        setError(null);
      } else {
        setError(res.error || 'Gagal memuat alarm');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  // ---- Filtered alarms ----
  const filteredAlarms = alarms.filter(a => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    if (statusFilter === 'unacknowledged' && a.acknowledged) return false;
    if (statusFilter === 'acknowledged' && !a.acknowledged) return false;
    return true;
  });

  const displayedAlarms = filteredAlarms.slice(0, displayCount);
  const hasMore = filteredAlarms.length > displayCount;

  // ---- Stats ----
  const infoCount = alarms.filter(a => a.severity === 'info').length;
  const warningCount = alarms.filter(a => a.severity === 'warning').length;
  const criticalCount = alarms.filter(a => a.severity === 'critical').length;

  // ---- Acknowledge single ----
  const handleAck = async (idx: number) => {
    setAckingIdx(idx);
    try {
      const alarm = alarms[idx];
      if (!alarm) return;
      const res = await acknowledgeAlarm({ id: alarm.id ? String(alarm.id) : alarm.timestamp });
      if (res.success) {
        toast.success('Alarm berhasil ditangani');
        setAlarms(prev =>
          prev.map((a, i) =>
            i === idx
              ? { ...a, acknowledged: true, acknowledged_at: new Date().toISOString() }
              : a
          )
        );
        setUnackCount(prev => Math.max(0, prev - 1));
      } else {
        toast.error(res.error || 'Gagal menangani alarm');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setAckingIdx(null);
    }
  };

  // ---- Acknowledge all ----
  const handleAckAll = async () => {
    const hasUnack = alarms.some(a => !a.acknowledged);
    if (!hasUnack) return;

    setAckAllLoading(true);
    try {
      const res = await acknowledgeAlarm({ acknowledge_all: true });
      if (res.success) {
        toast.success('Semua alarm berhasil ditangani');
        setAlarms(prev =>
          prev.map(a =>
            !a.acknowledged
              ? { ...a, acknowledged: true, acknowledged_at: new Date().toISOString() }
              : a
          )
        );
        setUnackCount(0);
      } else {
        toast.error(res.error || 'Gagal menangani semua alarm');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setAckAllLoading(false);
    }
  };

  // ---- Severity button class ----
  const getSevFilterBtnClass = (sev: SeverityFilter) => {
    const base = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all';
    if (sev === 'all') {
      return severityFilter === 'all'
        ? `${base} bg-primary/15 text-primary border border-primary/30`
        : `${base} bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent`;
    }
    const cfg = getSeverityConfig(sev);
    return severityFilter === sev
      ? `${base} ${cfg.bg} ${cfg.color} border ${cfg.border}`
      : `${base} bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent`;
  };

  const getStatusFilterBtnClass = (status: StatusFilter) => {
    const base = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all';
    return statusFilter === status
      ? `${base} bg-primary/15 text-primary border border-primary/30`
      : `${base} bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent`;
  };

  // ---- Empty state ----
  const isEmpty = !loading && !error && filteredAlarms.length === 0;

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadAlarms} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Alarm & Peringatan"
          subtitle="Monitoring dan manajemen alarm sistem"
          icon={<Bell className="w-5 h-5 text-primary" />}
        />
        {/* Severity Summary Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-3"
        >
          <button
            onClick={() => setSeverityFilter(severityFilter === 'critical' ? 'all' : 'critical')}
            className="glass-card rounded-xl p-4 text-center cursor-pointer transition-all hover:scale-[1.02] hover:glow-red"
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-2xl font-bold text-red-400">{criticalCount}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">Critical</div>
            {severityFilter === 'critical' && (
              <Badge variant="outline" className="text-[9px] mt-1 bg-red-500/10 text-red-400 border-red-500/30">Aktif</Badge>
            )}
          </button>

          <button
            onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')}
            className="glass-card rounded-xl p-4 text-center cursor-pointer transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-2xl font-bold text-amber-400">{warningCount}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">Warning</div>
            {severityFilter === 'warning' && (
              <Badge variant="outline" className="text-[9px] mt-1 bg-amber-500/10 text-amber-400 border-amber-500/30">Aktif</Badge>
            )}
          </button>

          <button
            onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')}
            className="glass-card rounded-xl p-4 text-center cursor-pointer transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <Info className="w-4 h-4 text-blue-400" />
              <span className="text-2xl font-bold text-blue-400">{infoCount}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">Info</div>
            {severityFilter === 'info' && (
              <Badge variant="outline" className="text-[9px] mt-1 bg-blue-500/10 text-blue-400 border-blue-500/30">Aktif</Badge>
            )}
          </button>
        </motion.div>

        {/* Filter Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-xl p-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Severity filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <button onClick={() => setSeverityFilter('all')} className={getSevFilterBtnClass('all')}>
                Semua
              </button>
              <button onClick={() => setSeverityFilter('info')} className={getSevFilterBtnClass('info')}>
                Info
              </button>
              <button onClick={() => setSeverityFilter('warning')} className={getSevFilterBtnClass('warning')}>
                Warning
              </button>
              <button onClick={() => setSeverityFilter('critical')} className={getSevFilterBtnClass('critical')}>
                Critical
              </button>
            </div>

            <div className="hidden sm:block w-px h-6 bg-border/50" />

            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <button onClick={() => setStatusFilter('all')} className={getStatusFilterBtnClass('all')}>
                Semua
              </button>
              <button onClick={() => setStatusFilter('unacknowledged')} className={getStatusFilterBtnClass('unacknowledged')}>
                <Bell className="w-3 h-3 inline mr-1" />
                Belum Dibaca
              </button>
              <button onClick={() => setStatusFilter('acknowledged')} className={getStatusFilterBtnClass('acknowledged')}>
                <CheckCheck className="w-3 h-3 inline mr-1" />
                Sudah Dibaca
              </button>
            </div>

            <div className="sm:ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAckAll}
                disabled={ackAllLoading || unackCount === 0}
                className="gap-2 text-xs"
              >
                {ackAllLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="w-3.5 h-3.5" />
                )}
                Tandai Semua
                {unackCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                    {unackCount}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={loadAlarms} className="ml-auto text-primary hover:underline">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : isEmpty ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            {statusFilter === 'unacknowledged' ? (
              <>
                <BellOff className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Semua alarm sudah ditangani</p>
              </>
            ) : (
              <>
                <CheckCircle className="w-12 h-12 text-primary mx-auto mb-3" />
                <p className="text-muted-foreground">Tidak ada alarm</p>
              </>
            )}
          </motion.div>
        ) : (
          <>
            {/* Alarm List */}
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                <AnimatePresence>
                  {displayedAlarms.map((alarm, i) => {
                    const config = getSeverityConfig(alarm.severity);
                    const isExpanded = expandedIdx === i;

                    return (
                      <motion.div
                        key={alarm.timestamp}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ delay: i * 0.02 }}
                        className={`border-b border-border/30 last:border-0 ${config.bg} transition-colors hover:bg-opacity-80`}
                      >
                        {/* Main row */}
                        <div
                          className="flex items-start gap-3 p-4 cursor-pointer"
                          onClick={() => setExpandedIdx(isExpanded ? null : i)}
                        >
                          {/* Severity icon */}
                          <div className={`mt-0.5 shrink-0 ${config.color}`}>
                            {config.icon}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.badge}`}>
                                {alarm.severity?.toUpperCase()}
                              </Badge>
                              {alarm.type && (
                                <span className="text-[10px] text-muted-foreground font-medium uppercase">{alarm.type}</span>
                              )}
                              {!alarm.acknowledged && (
                                <div className="flex items-center gap-1.5">
                                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 pulse-dot" />
                                  <span className="text-[10px] text-red-400">Baru</span>
                                </div>
                              )}
                              {alarm.acknowledged && (
                                <span className="text-[10px] text-muted-foreground">
                                  <CheckCheck className="w-3 h-3 inline mr-0.5" />
                                  Ditangani
                                </span>
                              )}
                            </div>
                            <p className="text-sm leading-relaxed">{alarm.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {formatTimestamp(alarm.timestamp)}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {!alarm.acknowledged && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                                onClick={() => handleAck(i)}
                                disabled={ackingIdx === i}
                                title="Tandai sudah dibaca"
                              >
                                {ackingIdx === i ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                )}
                              </Button>
                            )}
                            <button
                              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Expanded details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 pl-10 space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Waktu Lengkap</span>
                                    <p className="font-medium">{formatFullTimestamp(alarm.timestamp)}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Tipe</span>
                                    <p className="font-medium">{alarm.type || '-'}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Timestamp</span>
                                    <p className="font-medium font-mono">{formatFullTimestamp(alarm.timestamp)}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Ditangani Oleh</span>
                                    <p className="font-medium">
                                      {alarm.acknowledged_by || '-'}
                                    </p>
                                  </div>
                                  {alarm.acknowledged_at && (
                                    <div className="space-y-0.5 sm:col-span-2">
                                      <span className="text-muted-foreground text-[10px] uppercase">Waktu Ditangani</span>
                                      <p className="font-medium">{formatFullTimestamp(alarm.acknowledged_at)}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setDisplayCount(prev => prev + BATCH_SIZE)}
                  className="gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Muat Lebih Banyak
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                    {filteredAlarms.length - displayCount} tersisa
                  </Badge>
                </Button>
              </div>
            )}

            {/* Result count */}
            {filteredAlarms.length > 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Menampilkan {displayedAlarms.length} dari {filteredAlarms.length} alarm
                {severityFilter !== 'all' && ` (${severityFilter})`}
                {statusFilter !== 'all' && ` · ${statusFilter === 'unacknowledged' ? 'belum dibaca' : 'sudah dibaca'}`}
              </p>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
