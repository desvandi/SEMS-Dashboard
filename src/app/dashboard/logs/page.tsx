'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchAlarms, acknowledgeAlarm } from '@/lib/api';
import type { Alarm } from '@/lib/types';
import { toast } from 'sonner';
import { getSeverityConfig } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
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
  Search,
  X,
  FileDown,
  Clock,
  ShieldAlert,
  CalendarDays,
  ListFilter,
  ScrollText,
} from 'lucide-react';

// ---- Event type labels ----
const eventTypes: Record<string, { label: string; color: string }> = {
  'low_battery': { label: 'Baterai Rendah', color: '#f59e0b' },
  'overvoltage': { label: 'Tegangan Berlebih', color: '#ef4444' },
  'undervoltage': { label: 'Tegangan Kurang', color: '#ef4444' },
  'overload': { label: 'Beban Berlebih', color: '#f97316' },
  'sensor_failure': { label: 'Sensor Gagal', color: '#8b5cf6' },
  'cell_imbalance': { label: 'Ketidakseimbangan Sel', color: '#ec4899' },
  'load_shedding': { label: 'Load Shedding', color: '#f59e0b' },
  'system': { label: 'Sistem', color: '#06b6d4' },
  'wifi': { label: 'WiFi', color: '#3b82f6' },
  'ota': { label: 'OTA Update', color: '#14b8a6' },
  'config_sync': { label: 'Sinkronisasi Konfigurasi', color: '#94a3b8' },
};

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type StatusFilter = 'all' | 'unacknowledged' | 'acknowledged';

function formatLogTimestamp(ts: string) {
  if (!ts) return '';
  try {
    const date = new Date(ts);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
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

function toLocalDateString(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function LogsPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unackCount, setUnackCount] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Expanded
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Acknowledging
  const [acking, setAcking] = useState<number | null>(null);
  const [ackAllLoading, setAckAllLoading] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Load More
  const [displayCount, setDisplayCount] = useState(20);
  const BATCH_SIZE = 20;

  const loadAlarms = useCallback(async () => {
    try {
      const res = await fetchAlarms({ limit: '500' });
      if (res.success && res.alarms) {
        setAlarms(res.alarms);
        setUnackCount(res.unacknowledged ?? res.alarms.filter(a => !a.acknowledged).length);
        setError(null);
      } else {
        setError(res.error || 'Gagal memuat log event');
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

  // ---- Unique types for dropdown ----
  const uniqueTypes = useMemo(() => {
    const types = new Set(alarms.map(a => a.type).filter(Boolean));
    return Array.from(types).sort();
  }, [alarms]);

  // ---- Filtered alarms ----
  const filteredAlarms = useMemo(() => {
    return alarms.filter(a => {
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (statusFilter === 'unacknowledged' && a.acknowledged) return false;
      if (statusFilter === 'acknowledged' && !a.acknowledged) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!a.message.toLowerCase().includes(q) && !a.type.toLowerCase().includes(q)) return false;
      }
      if (dateFrom) {
        try {
          const alarmDate = new Date(a.timestamp);
          const fromDate = new Date(dateFrom + 'T00:00:00');
          if (alarmDate < fromDate) return false;
        } catch { /* skip */ }
      }
      if (dateTo) {
        try {
          const alarmDate = new Date(a.timestamp);
          const toDate = new Date(dateTo + 'T23:59:59');
          if (alarmDate > toDate) return false;
        } catch { /* skip */ }
      }
      return true;
    });
  }, [alarms, severityFilter, typeFilter, statusFilter, searchQuery, dateFrom, dateTo]);

  const displayedAlarms = filteredAlarms.slice(0, displayCount);
  const hasMore = filteredAlarms.length > displayCount;

  // ---- Stats ----
  const totalCount = alarms.length;
  const criticalCount = alarms.filter(a => a.severity === 'critical').length;
  const unacknowledgedCount = alarms.filter(a => !a.acknowledged).length;
  const todayStr = toLocalDateString(new Date());
  const eventsToday = alarms.filter(a => {
    try {
      return a.timestamp.startsWith(todayStr);
    } catch {
      return false;
    }
  }).length;

  // ---- Active filters count ----
  const activeFilterCount = [
    severityFilter !== 'all',
    typeFilter !== 'all',
    statusFilter !== 'all',
    searchQuery !== '',
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSearchQuery('');
    setSeverityFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setSelectedIds(new Set());
  };

  // ---- Acknowledge single ----
  const handleAck = async (alarmId: number) => {
    setAcking(alarmId);
    try {
      const res = await acknowledgeAlarm({ id: alarmId });
      if (res.success) {
        toast.success('Event berhasil ditangani');
        setAlarms(prev =>
          prev.map(a =>
            a.id === alarmId
              ? { ...a, acknowledged: 1, acknowledged_at: new Date().toISOString() }
              : a
          )
        );
        setUnackCount(prev => Math.max(0, prev - 1));
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(alarmId);
          return next;
        });
      } else {
        toast.error(res.error || 'Gagal menangani event');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setAcking(null);
    }
  };

  // ---- Acknowledge all shown ----
  const handleAckAllShown = async () => {
    const unackShownIds = displayedAlarms.filter(a => !a.acknowledged).map(a => a.id);
    if (unackShownIds.length === 0) {
      toast.info('Tidak ada event yang belum ditangani');
      return;
    }

    setAckAllLoading(true);
    try {
      const res = await acknowledgeAlarm({ ids: unackShownIds });
      if (res.success) {
        toast.success(`${unackShownIds.length} event berhasil ditangani`);
        setAlarms(prev =>
          prev.map(a =>
            unackShownIds.includes(a.id)
              ? { ...a, acknowledged: 1, acknowledged_at: new Date().toISOString() }
              : a
          )
        );
        setUnackCount(prev => Math.max(0, prev - unackShownIds.length));
        setSelectedIds(new Set());
      } else {
        toast.error(res.error || 'Gagal menangani event');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setAckAllLoading(false);
    }
  };

  // ---- Acknowledge selected ----
  const handleAckSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setAckAllLoading(true);
    try {
      const res = await acknowledgeAlarm({ ids: ids });
      if (res.success) {
        toast.success(`${ids.length} event terpilih berhasil ditangani`);
        setAlarms(prev =>
          prev.map(a =>
            ids.includes(a.id)
              ? { ...a, acknowledged: 1, acknowledged_at: new Date().toISOString() }
              : a
          )
        );
        setUnackCount(prev => Math.max(0, prev - ids.length));
        setSelectedIds(new Set());
      } else {
        toast.error(res.error || 'Gagal menangani event');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setAckAllLoading(false);
    }
  };

  // ---- Toggle select ----
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedAlarms.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedAlarms.map(a => a.id)));
    }
  };

  // ---- Export CSV ----
  const handleExportCSV = () => {
    if (displayedAlarms.length === 0) {
      toast.info('Tidak ada data untuk diekspor');
      return;
    }

    const headers = ['ID', 'Timestamp', 'Severity', 'Type', 'Message', 'Acknowledged', 'Acknowledged At', 'Acknowledged By'];
    const rows = displayedAlarms.map(a => [
      a.id,
      a.timestamp,
      a.severity,
      a.type,
      `"${a.message.replace(/"/g, '""')}"`,
      a.acknowledged ? 'Ya' : 'Tidak',
      a.acknowledged_at || '',
      a.acknowledged_by || '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = toLocalDateString(new Date());
    link.href = url;
    link.download = `sems_logs_${dateStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('File CSV berhasil diekspor');
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

  const isFiltering = severityFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all' || searchQuery !== '' || dateFrom !== '' || dateTo !== '';
  const isEmpty = !loading && !error && alarms.length === 0;
  const isFilterEmpty = !loading && !error && alarms.length > 0 && filteredAlarms.length === 0;

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadAlarms} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Log Event Sistem"
          subtitle="Riwayat event dan aktivitas sistem"
          icon={<ScrollText className="w-5 h-5 text-primary" />}
        />

        {/* Log Summary Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ListFilter className="w-4 h-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Total Events</span>
            </div>
            <span className="text-2xl font-bold">{totalCount}</span>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Critical</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-red-400">{criticalCount}</span>
              {criticalCount > 0 && (
                <Badge variant="outline" className="text-[9px] bg-red-500/15 text-red-400 border-red-500/30 px-1.5 py-0">
                  !
                </Badge>
              )}
            </div>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Belum Dibaca</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-amber-400">{unacknowledgedCount}</span>
              {unacknowledgedCount > 0 && (
                <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/30 px-1.5 py-0">
                  baru
                </Badge>
              )}
            </div>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays className="w-4 h-4 text-primary" />
              <span className="text-[10px] text-muted-foreground uppercase">Hari Ini</span>
            </div>
            <span className="text-2xl font-bold text-primary">{eventsToday}</span>
          </div>
        </motion.div>

        {/* Filter Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-xl p-3 sm:p-4"
        >
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari pesan event..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted/30 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {/* Severity & Status filters */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
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

              <div className="flex items-center gap-1.5 flex-wrap">
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
            </div>

            {/* Type, Date, Actions row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={(val) => setTypeFilter(val === 'all' ? 'all' : val)}>
                <SelectTrigger className="w-full sm:w-[200px] h-8 text-xs bg-muted/30">
                  <SelectValue placeholder="Semua Tipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Tipe</SelectItem>
                  {uniqueTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: eventTypes[type]?.color || '#94a3b8' }} />
                        {eventTypes[type]?.label || type}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date Range */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:flex-none">
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-8 text-xs bg-muted/30 w-full sm:w-[140px]"
                    max={dateTo || undefined}
                  />
                </div>
                <span className="text-xs text-muted-foreground">—</span>
                <div className="relative flex-1 sm:flex-none">
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-8 text-xs bg-muted/30 w-full sm:w-[140px]"
                    min={dateFrom || undefined}
                  />
                </div>
              </div>

              {/* Clear & Actions */}
              <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
                {isFiltering && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                    Hapus Filter
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 ml-1">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                )}

                <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5 text-xs">
                  <FileDown className="w-3.5 h-3.5" />
                  Export CSV
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAckAllShown}
                  disabled={ackAllLoading}
                  className="gap-1.5 text-xs"
                >
                  {ackAllLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5" />
                  )}
                  Tandai Semua Tampil
                </Button>

                {selectedIds.size > 0 && (
                  <Button variant="outline" size="sm" onClick={handleAckSelected} disabled={ackAllLoading} className="gap-1.5 text-xs bg-primary/10 text-primary border-primary/30 hover:bg-primary/20">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Tandai Terpilih ({selectedIds.size})
                  </Button>
                )}
              </div>
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
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : isEmpty ? (
          /* No logs at all */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <BellOff className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Tidak ada log event</p>
          </motion.div>
        ) : isFilterEmpty ? (
          /* No results for filter */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <Search className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">Tidak ada event yang cocok dengan filter</p>
            <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
              <X className="w-3.5 h-3.5" />
              Hapus Semua Filter
            </Button>
          </motion.div>
        ) : (
          <>
            {/* Select All + count */}
            {filteredAlarms.length > 0 && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedIds.size === displayedAlarms.length && displayedAlarms.length > 0}
                    onCheckedChange={toggleSelectAll}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} event terpilih`
                      : 'Pilih semua'
                    }
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Menampilkan {displayedAlarms.length} dari {filteredAlarms.length} event
                </p>
              </div>
            )}

            {/* Event Timeline */}
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="max-h-[700px] overflow-y-auto">
                <AnimatePresence>
                  {displayedAlarms.map((alarm, i) => {
                    const config = getSeverityConfig(alarm.severity);
                    const isExpanded = expandedId === alarm.id;
                    const typeInfo = eventTypes[alarm.type];
                    const isSelected = selectedIds.has(alarm.id);

                    return (
                      <motion.div
                        key={alarm.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ delay: Math.min(i * 0.03, 0.5) }}
                        className={`border-b border-border/30 last:border-0 ${config.bg} transition-colors hover:bg-opacity-80 ${isSelected ? 'ring-1 ring-primary/30' : ''}`}
                      >
                        {/* Main row */}
                        <div className="flex items-start gap-3 p-3 sm:p-4">
                          {/* Timeline dot + select */}
                          <div className="flex flex-col items-center gap-2 pt-1 shrink-0">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(alarm.id)}
                              className="w-4 h-4"
                            />
                            <div className={`w-2.5 h-2.5 rounded-full ${config.dot} shrink-0`} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : alarm.id)}>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.badge}`}>
                                {alarm.severity?.toUpperCase()}
                              </Badge>
                              {alarm.type && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0"
                                  style={{
                                    backgroundColor: `${typeInfo?.color}15`,
                                    color: typeInfo?.color || '#94a3b8',
                                    borderColor: `${typeInfo?.color}30`,
                                  }}
                                >
                                  {alarm.type}
                                </Badge>
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
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-muted-foreground">
                                <Clock className="w-3 h-3 inline mr-0.5" />
                                {formatLogTimestamp(alarm.timestamp)}
                              </span>
                              {typeInfo && (
                                <span className="text-[10px] text-muted-foreground">
                                  {typeInfo.label}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0 pt-0.5">
                            {!alarm.acknowledged && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                                onClick={() => handleAck(alarm.id)}
                                disabled={acking === alarm.id}
                                title="Tandai sudah dibaca"
                              >
                                {acking === alarm.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                )}
                              </Button>
                            )}
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : alarm.id)}
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
                              <div className="px-4 pb-4 pl-14 sm:pl-16 space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Waktu Lengkap</span>
                                    <p className="font-medium">{formatFullTimestamp(alarm.timestamp)}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Tipe Event</span>
                                    <p className="font-medium">{typeInfo?.label || alarm.type || '-'}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">ID Event</span>
                                    <p className="font-medium">#{alarm.id}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Severity</span>
                                    <p className="font-medium">
                                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.badge}`}>
                                        {alarm.severity?.toUpperCase()}
                                      </Badge>
                                    </p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-muted-foreground text-[10px] uppercase">Ditangani Oleh</span>
                                    <p className="font-medium">{alarm.acknowledged_by || '-'}</p>
                                  </div>
                                  {alarm.acknowledged_at && (
                                    <div className="space-y-0.5">
                                      <span className="text-muted-foreground text-[10px] uppercase">Waktu Ditangani</span>
                                      <p className="font-medium">{formatFullTimestamp(alarm.acknowledged_at)}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Raw JSON-like metadata */}
                                <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border/30">
                                  <span className="text-[10px] text-muted-foreground uppercase block mb-2">Metadata</span>
                                  <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all">
                                    {JSON.stringify({
                                      id: alarm.id,
                                      timestamp: alarm.timestamp,
                                      type: alarm.type,
                                      severity: alarm.severity,
                                      message: alarm.message,
                                      acknowledged: Boolean(alarm.acknowledged),
                                      acknowledged_at: alarm.acknowledged_at || null,
                                      acknowledged_by: alarm.acknowledged_by || null,
                                    }, null, 2)}
                                  </pre>
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
                Menampilkan {displayedAlarms.length} dari {filteredAlarms.length} event
                {isFiltering && ' (filter aktif)'}
              </p>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
