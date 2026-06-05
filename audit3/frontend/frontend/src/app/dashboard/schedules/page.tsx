'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchSchedules, saveSchedule, deleteSchedule, fetchDevices } from '@/lib/api';
import type { Schedule, Device } from '@/lib/types';
import { DAYS_OF_WEEK } from '@/lib/types';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Clock,
  Power,
  PowerOff,
  CalendarDays,
  Calendar,
  Repeat,
  Zap,
  AlertCircle,
} from 'lucide-react';

// ── Schedule Form State ──
interface ScheduleForm {
  id?: number;
  name: string;
  description: string;
  device_id: string;
  action: string;
  hours: string;
  minutes: string;
  type: 'recurring' | 'once';
  days: string[];
  date: string;
  enabled: boolean;
}

const emptyForm: ScheduleForm = {
  name: '',
  description: '',
  device_id: '',
  action: 'on',
  hours: '08',
  minutes: '00',
  type: 'recurring',
  days: ['1', '2', '3', '4', '5'],
  date: '',
  enabled: true,
};

function buildTime(hours: string, minutes: string): string {
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function parseTime(time: string): { hours: string; minutes: string } {
  const parts = time.split(':');
  return { hours: parts[0] || '00', minutes: parts[1] || '00' };
}

/** Normalize `days` field from GAS to string array */
function parseDaysField(daysRaw: any): string[] {
  if (typeof daysRaw === 'string') {
    return daysRaw === '*' ? ['*'] : daysRaw.split(',').map((d: string) => d.trim());
  }
  if (Array.isArray(daysRaw)) {
    return daysRaw.map((d: any) => String(d).trim());
  }
  // boolean true or other unexpected values → treat as all days
  return ['*'];
}

function getDayLabels(daysStr: string) {
  const parsed = parseDaysField(daysStr);
  if (parsed.includes('*')) return DAYS_OF_WEEK;
  return DAYS_OF_WEEK.filter(d => parsed.includes(d.value));
}

// ── Countdown Helper ──
function getNextExecution(schedule: Schedule): string | null {
  if (!schedule.enabled) return null;
  const now = new Date();
  const [h, m] = schedule.time.split(':').map(Number);

  if (schedule.type === 'once' && schedule.date) {
    const target = new Date(schedule.date + 'T' + schedule.time);
    if (target > now) {
      const diff = target.getTime() - now.getTime();
      if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        return `${hours}j ${mins}m`;
      }
      return target.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    }
    return null;
  }

  const parsedDays = parseDaysField(schedule.days);
  const daysOfWeek = parsedDays.includes('*')
    ? [0, 1, 2, 3, 4, 5, 6]
    : parsedDays.map(Number);

  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + i);
    checkDate.setHours(h, m, 0, 0);
    if (checkDate > now && daysOfWeek.includes(checkDate.getDay())) {
      const diff = checkDate.getTime() - now.getTime();
      if (i === 0) {
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        return `${hours}j ${mins}m`;
      }
      const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      return dayNames[checkDate.getDay()];
    }
  }
  return null;
}

// ── Page Component ──
export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ScheduleForm>(emptyForm);
  const [isEditing, setIsEditing] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [schedulesRes, devicesRes] = await Promise.all([
        fetchSchedules(),
        fetchDevices(),
      ]);
      if (schedulesRes.success && schedulesRes.schedules) {
        setSchedules(schedulesRes.schedules);
        setError(null);
      } else {
        setError(schedulesRes.error || 'Gagal memuat jadwal');
      }
      if (devicesRes.success && devicesRes.devices) {
        setDevices(devicesRes.devices);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kesalahan koneksi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Form Handlers ──
  const openCreateDialog = () => {
    setForm(emptyForm);
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEditDialog = (schedule: Schedule) => {
    const { hours, minutes } = parseTime(schedule.time);
    const parsedDays = parseDaysField(schedule.days);
    const daysArr = parsedDays.includes('*')
      ? DAYS_OF_WEEK.map(d => d.value)
      : parsedDays;

    // Defensive: backend Schedule may lack name/description/device_id
    // (spreadsheet only has: id, enabled, target, action, time, days, type, date, created_at)
    const schedAny = schedule as any;
    setForm({
      id: schedule.id,
      name: schedAny.name ?? '',
      description: schedAny.description ?? '',
      device_id: String(schedAny.device_id || schedule.target || ''),
      action: (schedule.action || 'on').toLowerCase(),
      hours: hours || '00',
      minutes: minutes || '00',
      type: schedule.type || 'recurring',
      days: daysArr.length > 0 ? daysArr : ['1','2','3','4','5'],
      date: schedule.date || '',
      enabled: !!schedule.enabled,
    });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Nama jadwal wajib diisi');
      return;
    }
    if (!form.device_id) {
      toast.error('Pilih perangkat terlebih dahulu');
      return;
    }
    if (form.type === 'once' && !form.date) {
      toast.error('Tanggal wajib diisi untuk jadwal sekali jalan');
      return;
    }
    if (form.type === 'recurring' && form.days.length === 0) {
      toast.error('Pilih minimal satu hari');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...(form.id ? { id: form.id } : {}),
        target: form.device_id,
        action: form.action.toUpperCase(),
        time: buildTime(form.hours, form.minutes),
        days: form.type === 'once' ? [] : form.days.map(Number),
        type: form.type,
        date: form.type === 'once' ? form.date : undefined,
        enabled: form.enabled,
      };

      const res = await saveSchedule(payload);
      if (res.success) {
        toast.success(isEditing ? 'Jadwal berhasil diperbarui' : 'Jadwal berhasil dibuat');
        setDialogOpen(false);
        loadData();
      } else {
        toast.error(res.error || 'Gagal menyimpan jadwal');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kesalahan koneksi');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (schedule: Schedule) => {
    try {
      const schedAny = schedule as any;
      const res = await saveSchedule({
        id: schedule.id,
        target: schedAny.device_id || schedule.target || '',
        action: schedule.action,
        time: schedule.time,
        days: schedule.days,
        type: schedule.type,
        date: schedule.date,
        enabled: !schedule.enabled,
      });
      if (res.success) {
        setSchedules(prev =>
          prev.map(s => s.id === schedule.id ? { ...s, enabled: s.enabled ? 0 : 1 } : s)
        );
        toast.success(schedule.enabled ? 'Jadwal dinonaktifkan' : 'Jadwal diaktifkan');
      } else {
        toast.error(res.error || 'Gagal mengubah status');
      }
    } catch {
      toast.error('Kesalahan koneksi');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await deleteSchedule({ id: deleteTarget.id });
      if (res.success) {
        toast.success('Jadwal berhasil dihapus');
        setSchedules(prev => prev.filter(s => s.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        toast.error(res.error || 'Gagal menghapus jadwal');
      }
    } catch {
      toast.error('Kesalahan koneksi');
    }
  };

  const toggleDay = (dayValue: string) => {
    setForm(prev => ({
      ...prev,
      days: prev.days.includes(dayValue)
        ? prev.days.filter(d => d !== dayValue)
        : [...prev.days, dayValue],
    }));
  };

  const selectAllDays = () => {
    setForm(prev => ({
      ...prev,
      days: DAYS_OF_WEEK.map(d => d.value),
    }));
  };

  const deviceMap = new Map(devices.map(d => [d.id, d.name]));

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadData} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Jadwal Perangkat"
          subtitle="Konfigurasi jadwal ON/OFF otomatis"
          icon={<CalendarDays className="w-5 h-5 text-primary" />}
          badge={
            !loading && schedules.length > 0 ? (
              <Badge variant="outline" className="text-xs">
                {schedules.filter(s => s.enabled).length}/{schedules.length} aktif
              </Badge>
            ) : undefined
          }
          actions={
            <Button onClick={openCreateDialog} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Buat Jadwal</span>
            </Button>
          }
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

        {/* Loading */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <CalendarClock className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Belum Ada Jadwal</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Buat jadwal otomatis untuk mengontrol perangkat pada waktu tertentu
            </p>
            <Button onClick={openCreateDialog} className="gap-2">
              <Plus className="w-4 h-4" />
              Buat Jadwal Pertama
            </Button>
          </motion.div>
        ) : (
          /* Schedule List */
          <div className="space-y-3">
            <AnimatePresence>
              {schedules.map((schedule, i) => {
                const countdown = getNextExecution(schedule);
                const dayLabels = getDayLabels(schedule.days);
                const deviceName = deviceMap.get(schedule.device_id) || `Perangkat #${schedule.device_id}`;

                return (
                  <motion.div
                    key={schedule.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`glass-card rounded-xl p-4 sm:p-5 transition-colors ${
                      !schedule.enabled ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      {/* Left: Time + Icon */}
                      <div className="flex items-center gap-3 sm:min-w-[140px]">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                          schedule.action === 'on'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-red-500/15 text-red-400'
                        }`}>
                          {schedule.action === 'on'
                            ? <Power className="w-5 h-5" />
                            : <PowerOff className="w-5 h-5" />
                          }
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xl font-bold tracking-tight">
                              {schedule.time}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {schedule.type === 'recurring' ? (
                              <Repeat className="w-3 h-3 text-primary" />
                            ) : (
                              <Calendar className="w-3 h-3 text-amber-400" />
                            )}
                            <span className={`text-[11px] font-medium ${
                              schedule.type === 'recurring' ? 'text-primary' : 'text-amber-400'
                            }`}>
                              {schedule.type === 'recurring' ? 'Berulang' : 'Sekali'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Center: Details */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-sm">{(schedule as any).name || schedule.target || 'Tanpa Nama'}</h3>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              schedule.action === 'on'
                                ? 'border-primary/30 text-primary bg-primary/5'
                                : 'border-red-500/30 text-red-400 bg-red-500/5'
                            }`}
                          >
                            {schedule.action.toUpperCase()}
                          </Badge>
                          {(schedule as any).description && (
                            <span className="text-[11px] text-muted-foreground hidden sm:inline">
                              — {(schedule as any).description}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Day Badges */}
                          {schedule.type === 'recurring' ? (
                            <div className="flex gap-1">
                              {dayLabels.map(day => (
                                <span
                                  key={day.value}
                                  className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-medium flex items-center justify-center"
                                >
                                  {day.labelShort}
                                </span>
                              ))}
                            </div>
                          ) : (
                            schedule.date && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                                <CalendarDays className="w-3 h-3" />
                                {new Date(schedule.date).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </Badge>
                            )
                          )}

                          <Separator orientation="vertical" className="h-4 bg-border/50" />

                          {/* Device */}
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {deviceName}
                          </span>
                        </div>

                        {/* Description on mobile */}
                        {(schedule as any).description && (
                          <p className="text-[11px] text-muted-foreground sm:hidden">
                            {(schedule as any).description}
                          </p>
                        )}
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
                        {/* Countdown */}
                        {countdown && schedule.enabled && (
                          <span className="text-[10px] text-muted-foreground hidden sm:block">
                            Dalam {countdown}
                          </span>
                        )}

                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!!schedule.enabled}
                            onCheckedChange={() => handleToggleEnabled(schedule)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openEditDialog(schedule)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                            onClick={() => setDeleteTarget(schedule)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* ── Create/Edit Dialog ── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-primary" />
                {isEditing ? 'Edit Jadwal' : 'Buat Jadwal Baru'}
              </DialogTitle>
              <DialogDescription>
                {isEditing
                  ? 'Ubah pengaturan jadwal otomatis'
                  : 'Atur jadwal otomatis untuk kontrol perangkat'
                }
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="schedule-name">Nama Jadwal *</Label>
                <Input
                  id="schedule-name"
                  placeholder="cth: Nyalakan Lampu Pagar"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="schedule-desc">Deskripsi</Label>
                <Textarea
                  id="schedule-desc"
                  placeholder="Deskripsi opsional..."
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                />
              </div>

              {/* Device */}
              <div className="space-y-2">
                <Label>Perangkat Target *</Label>
                <Select
                  value={form.device_id}
                  onValueChange={val => setForm(prev => ({ ...prev, device_id: val }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih perangkat" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.length === 0 && (
                      <SelectItem value="_none" disabled>
                        Tidak ada perangkat
                      </SelectItem>
                    )}
                    {devices.map(device => (
                      <SelectItem key={device.id} value={String(device.id)}>
                        {device.name} ({device.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Action */}
              <div className="space-y-2">
                <Label>Aksi</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={form.action === 'on' ? 'default' : 'outline'}
                    size="sm"
                    className={`flex-1 gap-1.5 ${form.action === 'on' ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''}`}
                    onClick={() => setForm(prev => ({ ...prev, action: 'on' }))}
                  >
                    <Power className="w-3.5 h-3.5" />
                    Nyalakan (ON)
                  </Button>
                  <Button
                    type="button"
                    variant={form.action === 'off' ? 'destructive' : 'outline'}
                    size="sm"
                    className={`flex-1 gap-1.5 ${form.action === 'off' ? '' : 'border-red-500/30 text-red-400 hover:bg-red-500/10'}`}
                    onClick={() => setForm(prev => ({ ...prev, action: 'off' }))}
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    Matikan (OFF)
                  </Button>
                </div>
              </div>

              {/* Time */}
              <div className="space-y-2">
                <Label>Waktu Eksekusi</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={form.hours}
                    onValueChange={val => setForm(prev => ({ ...prev, hours: val }))}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i).padStart(2, '0')}>
                          {String(i).padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-lg font-bold text-muted-foreground">:</span>
                  <Select
                    value={form.minutes}
                    onValueChange={val => setForm(prev => ({ ...prev, minutes: val }))}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {Array.from({ length: 60 }, (_, i) => (
                        <SelectItem key={i} value={String(i).padStart(2, '0')}>
                          {String(i).padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Schedule Type */}
              <div className="space-y-2">
                <Label>Tipe Jadwal</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={form.type === 'recurring' ? 'default' : 'outline'}
                    size="sm"
                    className={`flex-1 gap-1.5 ${form.type === 'recurring' ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''}`}
                    onClick={() => setForm(prev => ({ ...prev, type: 'recurring' }))}
                  >
                    <Repeat className="w-3.5 h-3.5" />
                    Berulang
                  </Button>
                  <Button
                    type="button"
                    variant={form.type === 'once' ? 'default' : 'outline'}
                    size="sm"
                    className={`flex-1 gap-1.5 ${form.type === 'once' ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''}`}
                    onClick={() => setForm(prev => ({ ...prev, type: 'once' }))}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Sekali
                  </Button>
                </div>
              </div>

              {/* Days Selector (Recurring) */}
              {form.type === 'recurring' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Hari</Label>
                    <button
                      type="button"
                      onClick={selectAllDays}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Pilih Semua
                    </button>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS_OF_WEEK.map(day => {
                      const isSelected = form.days.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleDay(day.value)}
                          className={`w-10 h-10 rounded-lg text-xs font-medium transition-all ${
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Date Picker (Once) */}
              {form.type === 'once' && (
                <div className="space-y-2">
                  <Label htmlFor="schedule-date">Tanggal</Label>
                  <Input
                    id="schedule-date"
                    type="date"
                    value={form.date}
                    onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}

              {/* Enabled */}
              <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                <div>
                  <Label className="text-sm font-medium">Aktifkan Jadwal</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Jadwal akan berjalan sesuai pengaturan
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={val => setForm(prev => ({ ...prev, enabled: val }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Batal
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="gap-1.5 min-w-[120px]"
              >
                {saving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <CalendarClock className="w-3.5 h-3.5" />
                    {isEditing ? 'Simpan Perubahan' : 'Buat Jadwal'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete Confirmation Dialog ── */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Jadwal?</AlertDialogTitle>
              <AlertDialogDescription>
                Jadwal <strong>&quot;{deleteTarget?.name}&quot;</strong> akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                Hapus Jadwal
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PageTransition>
  );
}
