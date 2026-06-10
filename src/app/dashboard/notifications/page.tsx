'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useSemsAuth } from '@/hooks/useSemsAuth';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchAlarms, acknowledgeAlarm, fetchConfig, updateConfig } from '@/lib/api';
import type { Alarm } from '@/lib/types';
import { toast } from 'sonner';
import { getSeverityConfig } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Bell,
  BellOff,
  Loader2,
  Mail,
  MailCheck,
  MailX,
  MailMinus,
  Shield,
  Clock,
  Settings,
  Send,
  Moon,
  Sun,
  BarChart3,
  TrendingUp,
  Zap,
  Volume2,
  VolumeX,
  Megaphone,
} from 'lucide-react';

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

type NotifFilter = 'all' | 'sent' | 'failed' | 'unhandled';

function getDayName(dayIndex: number) {
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  return days[dayIndex];
}

// Determine email notification status for an alarm.
// The API does not return per-alarm email delivery status,
// so we show 'none' for info-level and 'none' for critical/warning
// (email was likely sent but cannot be confirmed from frontend data).
function getSimulatedEmailStatus(alarm: Alarm): 'sent' | 'failed' | 'none' {
  // We can only know for sure if the alarm triggered an email by checking
  // backend-side data. Since the API doesn't return email status per alarm,
  // we show 'none' for info-level and 'unknown' pattern for critical/warning.
  if (alarm.severity === 'info') return 'none';
  // For critical/warning, email was likely sent but we can't confirm
  return 'none';
}

export default function NotificationsPage() {
  const { user: session } = useSemsAuth();
  const userRole = session?.role;
  const isAdmin = userRole === 'admin';

  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config form
  const [emailNotif, setEmailNotif] = useState(true);
  const [lowBatThreshold, setLowBatThreshold] = useState('21');
  const [overvoltThreshold, setOvervoltThreshold] = useState('29.2');
  const [overloadThreshold, setOverloadThreshold] = useState('30');
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState('22');
  const [quietEnd, setQuietEnd] = useState('06');

  const [savingNotif, setSavingNotif] = useState(false);
  const [savingQuiet, setSavingQuiet] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  // Notification filter
  const [notifFilter, setNotifFilter] = useState<NotifFilter>('all');

  const loadData = useCallback(async () => {
    try {
      const [alarmsRes, configRes] = await Promise.all([
        fetchAlarms({ limit: '200' }),
        fetchConfig(),
      ]);

      if (alarmsRes.success && alarmsRes.alarms) {
        setAlarms(alarmsRes.alarms);
      } else {
        setError(alarmsRes.error || 'Gagal memuat data');
      }

      if (configRes.success && configRes.configs && Array.isArray(configRes.configs)) {
        const cfgMap: Record<string, string> = {};
        configRes.configs.forEach(c => { cfgMap[c.key] = c.value; });
        setConfig(cfgMap);
        setEmailNotif(cfgMap.email_notifications !== '0');
        setLowBatThreshold(cfgMap.low_battery_voltage || '21');
        setOvervoltThreshold(cfgMap.overvoltage_threshold || '29.2');
        setOverloadThreshold(cfgMap.overload_current || '30');
        setQuietHoursEnabled(cfgMap.quiet_hours_enabled === '1');
        setQuietStart(cfgMap.quiet_hours_start || '22');
        setQuietEnd(cfgMap.quiet_hours_end || '06');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---- Recent critical/warning alarms as notifications ----
  const recentAlarms = useMemo(() => {
    return alarms
      .filter(a => a.severity === 'critical' || a.severity === 'warning')
      .slice(0, 50);
  }, [alarms]);

  const filteredNotifs = useMemo(() => {
    return recentAlarms.filter(a => {
      const emailStatus = getSimulatedEmailStatus(a);
      if (notifFilter === 'sent') return emailStatus === 'sent';
      if (notifFilter === 'failed') return emailStatus === 'failed';
      if (notifFilter === 'unhandled') return !a.acknowledged;
      return true;
    });
  }, [recentAlarms, notifFilter]);

  // ---- Email stats ----
  const emailStats = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const criticalAndWarning = alarms.filter(a => a.severity === 'critical' || a.severity === 'warning');

    const sentToday = criticalAndWarning.filter(a => {
      try { return a.timestamp.startsWith(todayStr); } catch { return false; }
    }).length;

    const sentThisWeek = criticalAndWarning.filter(a => {
      try { return a.timestamp >= weekStartStr; } catch { return false; }
    }).length;

    // Most frequent alarm type
    const typeCount: Record<string, number> = {};
    criticalAndWarning.forEach(a => {
      if (a.type) typeCount[a.type] = (typeCount[a.type] || 0) + 1;
    });
    const mostFrequentType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

    // Last email sent
    const lastAlarm = criticalAndWarning[0];
    const lastSentTs = lastAlarm?.timestamp || null;

    return { sentToday, sentThisWeek, mostFrequentType, lastSentTs };
  }, [alarms]);

  // ---- Daily usage chart data (last 7 days) ----
  const dailyUsage = useMemo(() => {
    const days: { day: string; count: number; date: string }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = getDayName(d.getDay());
      const count = alarms.filter(a => {
        if (a.severity !== 'critical' && a.severity !== 'warning') return false;
        try { return a.timestamp.startsWith(dateStr); } catch { return false; }
      }).length;
      days.push({ day: dayName, count, date: dateStr });
    }
    return days;
  }, [alarms]);

  const maxDailyLimit = 20;

  // ---- Save notification preferences ----
  const handleSaveNotifPrefs = async () => {
    setSavingNotif(true);
    try {
      const res = await updateConfig({
        updates: [
          { key: 'email_notifications', value: emailNotif ? '1' : '0' },
          { key: 'low_battery_voltage', value: lowBatThreshold },
          { key: 'overvoltage_threshold', value: overvoltThreshold },
          { key: 'overload_current', value: overloadThreshold },
        ]
      });
      if (res.success) {
        toast.success('Preferensi notifikasi berhasil disimpan');
        loadData();
      } else {
        toast.error(res.error || 'Gagal menyimpan preferensi');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setSavingNotif(false);
    }
  };

  // ---- Save quiet hours ----
  const handleSaveQuietHours = async () => {
    setSavingQuiet(true);
    try {
      const res = await updateConfig({
        updates: [
          { key: 'quiet_hours_enabled', value: quietHoursEnabled ? '1' : '0' },
          { key: 'quiet_hours_start', value: quietStart },
          { key: 'quiet_hours_end', value: quietEnd },
        ]
      });
      if (res.success) {
        toast.success('Jam tenang berhasil disimpan');
        loadData();
      } else {
        toast.error(res.error || 'Gagal menyimpan jam tenang');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setSavingQuiet(false);
    }
  };

  // ---- Send test notification ----
  const handleTestNotif = async () => {
    setSendingTest(true);
    try {
      const res = await updateConfig({ updates: [{ key: 'send_test_email', value: '1' }] });
      if (res.success) {
        toast.success(res.message || 'Notifikasi test berhasil dikirim');
      } else {
        toast.error(res.error || res.message || 'Gagal mengirim notifikasi test');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setSendingTest(false);
    }
  };

  // ---- Acknowledge single ----
  const handleAck = async (alarm: Alarm) => {
    try {
      const res = await acknowledgeAlarm({ id: alarm.id ? String(alarm.id) : alarm.timestamp });
      if (res.success) {
        toast.success('Notifikasi berhasil ditangani');
        setAlarms(prev =>
          prev.map(a =>
            (a.id && a.id === alarm.id) || a.timestamp === alarm.timestamp
              ? { ...a, acknowledged: true, acknowledged_at: new Date().toISOString() }
              : a
          )
        );
      } else {
        toast.error(res.error || 'Gagal menangani');
      }
    } catch {
      toast.error('Koneksi gagal');
    }
  };

  const getNotifFilterBtnClass = (filter: NotifFilter) => {
    const base = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all';
    return notifFilter === filter
      ? `${base} bg-primary/15 text-primary border border-primary/30`
      : `${base} bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent`;
  };

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <PageTransition>
        <Header isConnected={true} lastUpdated={null} onRefresh={() => {}} />
        <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[160px] rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-[300px] rounded-xl" />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadData} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Pusat Notifikasi"
          subtitle="Konfigurasi dan riwayat notifikasi sistem"
          icon={<Megaphone className="w-5 h-5 text-primary" />}
        />

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={loadData} className="ml-auto text-primary hover:underline">Coba Lagi</button>
          </div>
        )}

        {/* ===== Notification Preferences Card ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-4 sm:p-6"
        >
          <div className="flex items-center gap-2 mb-5">
            <Mail className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Preferensi Notifikasi</h3>
            {isAdmin ? (
              <Badge variant="outline" className="text-[10px] px-2 py-0 ml-auto bg-amber-500/10 text-amber-400 border-amber-500/30">
                <Shield className="w-2.5 h-2.5 mr-1" />
                Admin
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-2 py-0 ml-auto bg-muted/50 text-muted-foreground border-border">
                <VolumeX className="w-2.5 h-2.5 mr-1" />
                Akses Terbatas
              </Badge>
            )}
          </div>

          {isAdmin ? (
            <div className="space-y-5">
              {/* Email Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${emailNotif ? 'bg-primary/15' : 'bg-muted/50'}`}>
                    {emailNotif ? (
                      <Volume2 className="w-4 h-4 text-primary" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Notifikasi Email</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Kirim email untuk alarm kritis dan peringatan
                    </p>
                  </div>
                </div>
                <Switch
                  checked={emailNotif}
                  onCheckedChange={setEmailNotif}
                />
              </div>

              <Separator />

              {/* Thresholds */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">
                    <Zap className="w-3 h-3 inline mr-1 text-amber-400" />
                    Threshold Baterai Rendah
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={lowBatThreshold}
                      onChange={(e) => setLowBatThreshold(e.target.value)}
                      step="0.1"
                      min="0"
                      className="h-9 pr-8 text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">V</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">
                    <AlertTriangle className="w-3 h-3 inline mr-1 text-red-400" />
                    Threshold Tegangan Tinggi
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={overvoltThreshold}
                      onChange={(e) => setOvervoltThreshold(e.target.value)}
                      step="0.1"
                      min="0"
                      className="h-9 pr-8 text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">V</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">
                    <Zap className="w-3 h-3 inline mr-1 text-orange-400" />
                    Threshold Arus Beban
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={overloadThreshold}
                      onChange={(e) => setOverloadThreshold(e.target.value)}
                      step="0.1"
                      min="0"
                      className="h-9 pr-8 text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">A</span>
                  </div>
                </div>
              </div>

              {/* Rate limit info */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  Maks. 1 email/tipe/30 menit, 20/hari. Email tidak terkirim saat melewati batas.
                </span>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSaveNotifPrefs}
                  disabled={savingNotif}
                  size="sm"
                  className="gap-2"
                >
                  {savingNotif ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Settings className="w-4 h-4" />
                  )}
                  Simpan Preferensi
                </Button>
              </div>
            </div>
          ) : (
            /* Non-admin: limited access message */
            <div className="text-center py-8">
              <VolumeX className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Akses Terbatas</p>
              <p className="text-xs text-muted-foreground">
                Hanya admin yang dapat mengubah preferensi notifikasi.
              </p>
            </div>
          )}
        </motion.div>

        {/* ===== Quiet Hours ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-xl p-4 sm:p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Moon className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold">Jam Tenang</h3>
            <span className="text-[10px] text-muted-foreground ml-1">(Quiet Hours)</span>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Aktifkan Jam Tenang</Label>
                <p className="text-[10px] text-muted-foreground">
                  Tidak mengirim notifikasi email pada jam tertentu
                </p>
              </div>
              <Switch
                checked={quietHoursEnabled}
                onCheckedChange={setQuietHoursEnabled}
                disabled={!isAdmin}
              />
            </div>

            {quietHoursEnabled && (
              <div className="flex items-center gap-4">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">Mulai</Label>
                  <Select value={quietStart} onValueChange={setQuietStart} disabled={!isAdmin}>
                    <SelectTrigger className="h-9 text-sm bg-muted/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={String(i).padStart(2, '0')} value={String(i).padStart(2, '0')}>
                          {String(i).padStart(2, '0')}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <span className="text-muted-foreground mt-5">—</span>

                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">Selesai</Label>
                  <Select value={quietEnd} onValueChange={setQuietEnd} disabled={!isAdmin}>
                    <SelectTrigger className="h-9 text-sm bg-muted/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={String(i).padStart(2, '0')} value={String(i).padStart(2, '0')}>
                          {String(i).padStart(2, '0')}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end pb-0.5">
                  <Button
                    onClick={handleSaveQuietHours}
                    disabled={savingQuiet || !isAdmin}
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                  >
                    {savingQuiet ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sun className="w-3.5 h-3.5" />
                    )}
                    Simpan
                  </Button>
                </div>
              </div>
            )}

            {!isAdmin && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Hanya admin yang dapat mengubah pengaturan jam tenang.
              </p>
            )}
          </div>
        </motion.div>

        {/* ===== Email History Summary ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <MailCheck className="w-4 h-4 text-primary" />
              <span className="text-[10px] text-muted-foreground uppercase">Email Hari Ini</span>
            </div>
            <span className="text-2xl font-bold">{emailStats.sentToday}</span>
            <span className="text-[10px] text-muted-foreground"> / {maxDailyLimit}</span>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Email Minggu Ini</span>
            </div>
            <span className="text-2xl font-bold">{emailStats.sentThisWeek}</span>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Tipe Terbanyak</span>
            </div>
            <span className="text-sm font-bold">{emailStats.mostFrequentType}</span>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase">Email Terakhir</span>
            </div>
            <span className="text-xs font-medium">
              {emailStats.lastSentTs ? formatTimestamp(emailStats.lastSentTs) : '-'}
            </span>
          </div>
        </motion.div>

        {/* ===== Daily Email Usage Chart (CSS bars) ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card rounded-xl p-4 sm:p-6"
        >
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Penggunaan Email Harian</h3>
            <Badge variant="outline" className="text-[10px] px-2 py-0 ml-auto bg-muted/50 text-muted-foreground border-border">
              7 hari terakhir
            </Badge>
          </div>

          <div className="flex items-end gap-2 sm:gap-3 h-40">
            {dailyUsage.map((day) => {
              const percentage = maxDailyLimit > 0 ? (day.count / maxDailyLimit) * 100 : 0;
              const barColor = day.count >= maxDailyLimit
                ? 'bg-red-500'
                : day.count > 15
                  ? 'bg-amber-500'
                  : 'bg-primary';

              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-[10px] font-medium">{day.count}</span>
                  <div className="w-full bg-muted/30 rounded-md relative flex-1 flex items-end">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(percentage, 2)}%` }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      className={`w-full rounded-md ${barColor} transition-colors`}
                      style={{ minHeight: day.count > 0 ? '4px' : '2px' }}
                    />
                    {/* Limit line */}
                    <div className="absolute top-0 left-0 right-0 border-t border-dashed border-border/50" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{day.day}</span>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-primary" />
              <span className="text-[10px] text-muted-foreground">Normal</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
              <span className="text-[10px] text-muted-foreground">Mendekati batas (&gt;15)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-500" />
              <span className="text-[10px] text-muted-foreground">Batas hariannya ({maxDailyLimit})</span>
            </div>
          </div>
        </motion.div>

        {/* ===== Test Notification Button (admin only) ===== */}
        {isAdmin && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex justify-end"
          >
            <Button
              onClick={handleTestNotif}
              disabled={sendingTest}
              variant="outline"
              className="gap-2 text-xs"
            >
              {sendingTest ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Kirim Notifikasi Test
            </Button>
          </motion.div>
        )}

        {/* ===== Recent Notifications ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
            <button onClick={() => setNotifFilter('all')} className={getNotifFilterBtnClass('all')}>
              Semua
            </button>
            <button onClick={() => setNotifFilter('sent')} className={getNotifFilterBtnClass('sent')}>
              <MailCheck className="w-3 h-3 inline mr-1" />
              Terkirim
            </button>
            <button onClick={() => setNotifFilter('failed')} className={getNotifFilterBtnClass('failed')}>
              <MailX className="w-3 h-3 inline mr-1" />
              Gagal
            </button>
            <button onClick={() => setNotifFilter('unhandled')} className={getNotifFilterBtnClass('unhandled')}>
              <AlertCircle className="w-3 h-3 inline mr-1" />
              Belum Ditangani
            </button>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {filteredNotifs.length} notifikasi
            </span>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              {filteredNotifs.length === 0 ? (
                <div className="text-center py-16">
                  <BellOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {notifFilter !== 'all'
                      ? 'Tidak ada notifikasi dengan filter ini'
                      : 'Belum ada notifikasi'}
                  </p>
                </div>
              ) : (
                filteredNotifs.map((alarm, i) => {
                  const cfg = getSeverityConfig(alarm.severity);
                  const emailStatus = getSimulatedEmailStatus(alarm);

                  return (
                    <motion.div
                      key={alarm.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.4) }}
                      className={`border-b border-border/30 last:border-0 ${cfg.bg} transition-colors hover:bg-opacity-80`}
                    >
                      <div className="flex items-start gap-3 p-3 sm:p-4">
                        {/* Icon */}
                        <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                          {cfg.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.badge}`}>
                              {alarm.severity?.toUpperCase()}
                            </Badge>
                            {alarm.type && (
                              <span className="text-[10px] text-muted-foreground font-medium uppercase">
                                {alarm.type}
                              </span>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed">{alarm.message}</p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimestamp(alarm.timestamp)}
                            </span>

                            {/* Email status */}
                            <span className="text-[10px] flex items-center gap-1">
                              {emailStatus === 'sent' && (
                                <span className="text-primary"><MailCheck className="w-3 h-3 inline mr-0.5" />Terkirim</span>
                              )}
                              {emailStatus === 'failed' && (
                                <span className="text-red-400"><MailX className="w-3 h-3 inline mr-0.5" />Gagal</span>
                              )}
                              {emailStatus === 'none' && (
                                <span className="text-muted-foreground"><MailMinus className="w-3 h-3 inline mr-0.5" />Tidak terkirim</span>
                              )}
                            </span>

                            {/* Acknowledged status */}
                            {alarm.acknowledged ? (
                              <span className="text-[10px] text-muted-foreground">
                                <CheckCircle className="w-3 h-3 inline mr-0.5 text-primary" />
                                Ditangani
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-400">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 pulse-dot inline mr-1" />
                                Belum ditangani
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Ack button */}
                        {!alarm.acknowledged && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10 shrink-0"
                            onClick={() => handleAck(alarm)}
                            title="Tandai sudah ditangani"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </PageTransition>
  );
}
