'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchDevices, controlDevice, fetchLatestTelemetry } from '@/lib/api';
import type { Device, TelemetryData } from '@/lib/types';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Cpu,
  Power,
  PowerOff,
  RefreshCw,
  AlertCircle,
  Plus,
  Pencil,
  Zap,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plug,
  Unplug,
  CircuitBoard,
  TestTube,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  XCircle,
  Info,
  Gauge,
  Layers,
} from 'lucide-react';

// ── Constants ──
const TOTAL_RELAYS = 13;
const TOTAL_MOSFETS = 4;

const DEVICE_TYPES = [
  { value: 'Lampu', label: 'Lampu (Light)', icon: '💡' },
  { value: 'Kipas', label: 'Kipas (Fan)', icon: '🌬️' },
  { value: 'Pompa', label: 'Pompa (Pump)', icon: '💧' },
  { value: 'Socket', label: 'Socket', icon: '🔌' },
  { value: 'Lainnya', label: 'Lainnya (Other)', icon: '⚙️' },
] as const;

const DEVICE_MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'manual', label: 'Manual' },
  { value: 'scheduled', label: 'Terjadwal' },
] as const;

const PRIORITIES = [
  { value: 1, label: '1 — Kritis', color: 'text-red-400' },
  { value: 2, label: '2 — Standar', color: 'text-amber-400' },
  { value: 3, label: '3 — Kenyamanan', color: 'text-yellow-400' },
  { value: 4, label: '4 — Non-esensial', color: 'text-muted-foreground' },
] as const;

const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-red-400',
  2: 'text-amber-400',
  3: 'text-yellow-400',
  4: 'text-muted-foreground',
};

// ── Types ──
interface EditFormData {
  deviceName: string;
  deviceType: string;
  deviceMode: string;
  priority: string;
  defaultState: string;
}

const emptyForm = (): EditFormData => ({
  deviceName: '',
  deviceType: 'Lampu',
  deviceMode: 'auto',
  priority: '2',
  defaultState: 'on',
});

interface RelaySlot {
  type: 'relay' | 'mosfet';
  number: number;
  label: string;
}

// ── Build relay/mosfet slots ──
const RELAY_SLOTS: RelaySlot[] = Array.from({ length: TOTAL_RELAYS }, (_, i) => ({
  type: 'relay',
  number: i + 1,
  label: `R${i + 1}`,
}));

const MOSFET_SLOTS: RelaySlot[] = Array.from({ length: TOTAL_MOSFETS }, (_, i) => ({
  type: 'mosfet',
  number: i + 1,
  label: `M${i + 1}`,
}));

// ── Get relay state from telemetry ──
function getRelayState(telemetry: TelemetryData | null, relayNumber: number): number {
  if (!telemetry) return 0;
  const key = `relay_${relayNumber}` as keyof TelemetryData;
  return (telemetry[key] as number) || 0;
}

// ── Get priority color ──
function getPriorityBadgeStyle(priority: number): string {
  switch (priority) {
    case 1: return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 2: return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 3: return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    default: return 'bg-muted/50 text-muted-foreground border-muted';
  }
}

function getDeviceTypeIcon(type: string): string {
  const found = DEVICE_TYPES.find(t => t.value === type);
  return found?.icon || '⚙️';
}

// ════════════════════════════════════════════
// ── Main Page Component ──
// ════════════════════════════════════════════
export default function DeviceMappingPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState<number | null>(null);
  const [testingRelay, setTestingRelay] = useState<number | null>(null);

  // Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSlot, setEditSlot] = useState<RelaySlot | null>(null);
  const [editExistingDevice, setEditExistingDevice] = useState<Device | null>(null);
  const [form, setForm] = useState<EditFormData>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'test' | 'all-on' | 'all-off';
    relayNumber?: number;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Wiring reference collapsible
  const [wiringOpen, setWiringOpen] = useState(false);

  // ── Load data ──
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [devRes, telRes] = await Promise.all([
        fetchDevices(),
        fetchLatestTelemetry(),
      ]);
      if (devRes.success && devRes.devices) {
        setDevices(devRes.devices);
      }
      if (telRes.success && telRes.data) {
        setTelemetry(telRes.data);
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

  // ── Device lookup helpers ──
  const deviceByRelay = useMemo(() => {
    const map = new Map<number, Device>();
    devices.forEach(d => {
      if (d.channel) map.set(d.channel, d);
    });
    return map;
  }, [devices]);

  const assignedRelays = useMemo(
    () => new Set(devices.map(d => d.channel)),
    [devices]
  );

  const unassignedRelays = useMemo(
    () => RELAY_SLOTS.filter(s => !assignedRelays.has(s.number)),
    [assignedRelays]
  );

  // ── Stats ──
  const stats = useMemo(() => {
    const activeCount = devices.filter(d => d.state === 1).length;
    const inactiveCount = devices.filter(d => d.state !== 1).length;
    return {
      total: TOTAL_RELAYS,
      active: activeCount,
      inactive: inactiveCount,
      assigned: devices.length,
      unassigned: TOTAL_RELAYS - devices.length,
    };
  }, [devices]);

  // ── Open edit dialog ──
  const openEditDialog = (slot: RelaySlot) => {
    const existing = deviceByRelay.get(slot.number);
    if (existing) {
      setEditExistingDevice(existing);
      setForm({
        deviceName: existing.name,
        deviceType: existing.type,
        deviceMode: existing.mode,
        priority: String(existing.priority),
        defaultState: existing.status,
      });
    } else {
      setEditExistingDevice(null);
      setForm(emptyForm());
    }
    setEditSlot(slot);
    setEditDialogOpen(true);
  };

  // ── Save device mapping ──
  const handleSave = async () => {
    if (!form.deviceName.trim()) {
      toast.error('Nama perangkat wajib diisi');
      return;
    }
    if (!editSlot) return;

    setSaving(true);
    try {
      // Mock save - in real system this would call an API
      // For now, simulate success
      await new Promise(resolve => setTimeout(resolve, 600));

      // Optimistic update
      if (editExistingDevice) {
        setDevices(prev =>
          prev.map(d =>
            d.id === editExistingDevice.id
              ? {
                  ...d,
                  name: form.deviceName.trim(),
                  type: form.deviceType,
                  mode: form.deviceMode,
                  priority: Number(form.priority),
                }
              : d
          )
        );
        toast.success(`Perangkat "${form.deviceName.trim()}" berhasil diperbarui`);
      } else {
        const newDevice: Device = {
          id: Date.now(),
          name: form.deviceName.trim(),
          type: form.deviceType,
          mode: form.deviceMode,
          channel: editSlot.number,
          status: form.defaultState,
          priority: Number(form.priority),
          last_changed: new Date().toISOString(),
        };
        setDevices(prev => [...prev, newDevice]);
        toast.success(`Perangkat "${form.deviceName.trim()}" ditambahkan ke ${editSlot.label}`);
      }
      setEditDialogOpen(false);
    } catch {
      toast.error('Gagal menyimpan perangkat');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle device ──
  const handleToggle = async (device: Device) => {
    setControlling(device.id);
    try {
      const action = device.state === 1 ? 'off' : 'on';
      await controlDevice({ device_id: device.id, action });
      setDevices(prev =>
        prev.map(d => d.id === device.id ? { ...d, state: d.state === 1 ? 0 : 1 } : d)
      );
      toast.success(`${device.name} ${action.toUpperCase()}`);
    } catch {
      toast.error('Gagal mengontrol perangkat');
    } finally {
      setControlling(null);
    }
  };

  // ── Test relay ──
  const handleTestRelay = async (relayNumber: number) => {
    setConfirmLoading(true);
    try {
      await controlDevice({ device_id: relayNumber, action: 'on' });
      toast.success(`Relay ${relayNumber} ON (testing)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await controlDevice({ device_id: relayNumber, action: 'off' });
      toast.success(`Relay ${relayNumber} OFF (testing selesai)`);
    } catch {
      toast.error('Gagal mengetes relay');
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  // ── Turn all ON/OFF ──
  const handleTurnAll = async (action: 'on' | 'off') => {
    setConfirmLoading(true);
    try {
      await Promise.all(
        devices.map(d => controlDevice({ device_id: d.id, action }))
      );
      setDevices(prev => prev.map(d => ({ ...d, status: action })));
      toast.success(`Semua perangkat ${action.toUpperCase()}`);
    } catch {
      toast.error('Gagal mengontrol semua perangkat');
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  // ── Confirm action handler ──
  const handleConfirmAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'test' && confirmAction.relayNumber) {
      handleTestRelay(confirmAction.relayNumber);
    } else if (confirmAction.type === 'all-on') {
      handleTurnAll('on');
    } else if (confirmAction.type === 'all-off') {
      handleTurnAll('off');
    }
  };

  // ════════════════════════════════════════
  // ── Render ──
  // ════════════════════════════════════════
  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadData} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Device Mapping"
          subtitle="Pemetaan dan konfigurasi relay perangkat"
          icon={<Cpu className="w-5 h-5 text-primary" />}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
                disabled={devices.length === 0}
                onClick={() => setConfirmAction({ type: 'all-on' })}
              >
                <ToggleRight className="w-3.5 h-3.5" />
                Nyalakan Semua
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                disabled={devices.length === 0}
                onClick={() => setConfirmAction({ type: 'all-off' })}
              >
                <ToggleLeft className="w-3.5 h-3.5" />
                Matikan Semua
              </Button>
            </div>
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

        {/* Status Overview */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
          >
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <CircuitBoard className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] text-muted-foreground uppercase">Total Relay</span>
              </div>
              <div className="text-xl font-bold gradient-text">{stats.total}</div>
            </div>
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Power className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Aktif (ON)</span>
              </div>
              <div className="text-xl font-bold text-emerald-400">{stats.active}</div>
            </div>
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <PowerOff className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Nonaktif (OFF)</span>
              </div>
              <div className="text-xl font-bold text-red-400">{stats.inactive}</div>
            </div>
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Plug className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Terpasang</span>
              </div>
              <div className="text-xl font-bold text-cyan-400">{stats.assigned}</div>
            </div>
            <div className="glass-card rounded-xl p-3 text-center col-span-2 sm:col-span-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Unplug className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase">Tidak Terpakai</span>
              </div>
              <div className="text-xl font-bold text-muted-foreground">{stats.unassigned}</div>
            </div>
          </motion.div>
        )}

        {/* Relay Mapping Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card rounded-xl p-4 sm:p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Pemetaan Relay</h3>
            <Badge variant="outline" className="text-[10px] ml-auto">
              R1–R13 • M1–M4
            </Badge>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 17 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              {/* Relays Section */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Relay Outputs (R1–R13)
                  </span>
                  <div className="flex-1 border-t border-border/20" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {RELAY_SLOTS.map((slot, i) => {
                    const device = deviceByRelay.get(slot.number);
                    const relayState = getRelayState(telemetry, slot.number);
                    const isOn = relayState === 1;

                    return (
                      <motion.div
                        key={slot.label}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className={`relative rounded-lg border p-3 cursor-pointer transition-all hover:border-primary/50 hover:bg-primary/5 group ${
                          device
                            ? isOn
                              ? 'border-emerald-500/30 bg-emerald-500/5'
                              : 'border-border/50 bg-background/50'
                            : 'border-dashed border-muted/50 bg-muted/10'
                        }`}
                        onClick={() => openEditDialog(slot)}
                      >
                        {/* Slot label & status dot */}
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                            {slot.label}
                          </Badge>
                          <div className="flex items-center gap-1">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                isOn ? 'bg-emerald-500 pulse-dot' : 'bg-muted-foreground/40'
                              }`}
                            />
                          </div>
                        </div>

                        {device ? (
                          <>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-sm">{getDeviceTypeIcon(device.type)}</span>
                              <span className="text-xs font-medium truncate">{device.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 border-border/30"
                              >
                                {device.type}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 ${getPriorityBadgeStyle(device.priority)}`}
                              >
                                P{device.priority}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 border-border/30"
                              >
                                {device.mode}
                              </Badge>
                            </div>
                            {/* Hover actions */}
                            <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
                              <button
                                className="w-6 h-6 rounded flex items-center justify-center bg-background/80 border border-border/50 text-muted-foreground hover:text-primary transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggle(device);
                                }}
                                disabled={controlling === device.id}
                              >
                                {controlling === device.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isOn ? (
                                  <PowerOff className="w-3 h-3" />
                                ) : (
                                  <Power className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-2">
                            <Unplug className="w-4 h-4 text-muted-foreground/40 mb-1" />
                            <span className="text-[10px] text-muted-foreground">Tidak Terpakai</span>
                            <span className="text-[9px] text-primary opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                              + Pasang Perangkat
                            </span>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* MOSFETs Section */}
              <div className="mb-2">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    MOSFET Outputs (M1–M4)
                  </span>
                  <div className="flex-1 border-t border-border/20" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {MOSFET_SLOTS.map((slot, i) => {
                    // MOSFETs are mapped to relay 14-17 conceptually, but for now show them as unassigned
                    // In firmware: SR#2 Bits 5-8 → MOSFET 1-4
                    return (
                      <motion.div
                        key={slot.label}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: (i + 13) * 0.03 }}
                        className="rounded-lg border border-dashed border-amber-500/20 bg-amber-500/5 p-3 cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/10 transition-all group"
                        onClick={() => openEditDialog(slot)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 font-mono border-amber-500/30 text-amber-400"
                          >
                            {slot.label}
                          </Badge>
                          <Gauge className="w-3 h-3 text-amber-400/50" />
                        </div>
                        <div className="flex flex-col items-center justify-center py-1">
                          <Zap className="w-4 h-4 text-amber-400/40 mb-1" />
                          <span className="text-[10px] text-muted-foreground">MOSFET {slot.number}</span>
                          <span className="text-[9px] text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                            + Pasang Perangkat
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </motion.div>

        {/* Unassigned Relays Quick Section */}
        {!loading && unassignedRelays.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card rounded-xl p-4 sm:p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Unplug className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Relay Tidak Terpakai</h3>
              <Badge variant="outline" className="text-[10px] ml-auto">
                {unassignedRelays.length} relay
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {unassignedRelays.map(slot => (
                <Button
                  key={slot.label}
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs border-dashed"
                  onClick={() => openEditDialog(slot)}
                >
                  <Plus className="w-3 h-3" />
                  {slot.label} — Pasang Perangkat
                </Button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Wiring Reference */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="glass-card rounded-xl overflow-hidden"
        >
          <Collapsible open={wiringOpen} onOpenChange={setWiringOpen}>
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/20 transition-colors">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold">Referensi Wiring & Pin Mapping</span>
              </div>
              {wiringOpen ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3">
                <Separator className="-mx-4 sm:-mx-5 -mt-2 mb-3" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-emerald-400">SR1</span>
                      </div>
                      <span className="text-xs font-medium">Shift Register #1</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Bit 0–7 → Relay 1–8 (Output relay elektromekanik)
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded bg-cyan-500/10 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-cyan-400">SR2</span>
                      </div>
                      <span className="text-xs font-medium">Shift Register #2</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Bit 0–4 → Relay 9–13 &nbsp;|&nbsp; Bit 5–8 → MOSFET 1–4
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded bg-muted/50 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-muted-foreground">SR3</span>
                      </div>
                      <span className="text-xs font-medium">Shift Register #3</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Reserved — Ekspansi masa depan
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded bg-muted/50 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-muted-foreground">SR4</span>
                      </div>
                      <span className="text-xs font-medium">Shift Register #4</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Reserved — Ekspansi masa depan
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </motion.div>
      </div>

      {/* ═══ Edit Device Dialog ═══ */}
      {/* Dialogs are placed outside the padded content area but inside PageTransition */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" />
              {editExistingDevice ? 'Edit Perangkat' : 'Pasang Perangkat Baru'}
            </DialogTitle>
            <DialogDescription>
              {editExistingDevice
                ? `Konfigurasi perangkat pada ${editSlot?.label || `Relay ${editExistingDevice.channel}`}`
                : `Pasang perangkat baru pada ${editSlot?.label || 'slot relay'}`
              }
            </DialogDescription>
          </DialogHeader>

          {editSlot && (
            <div className="space-y-4 py-2">
              <Badge variant="outline" className="text-xs mb-2">
                {editSlot.type === 'mosfet' ? 'MOSFET' : 'Relay'} {editSlot.number}
              </Badge>

              {/* Device Name */}
              <div className="space-y-2">
                <Label className="text-xs">
                  Nama Perangkat <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={form.deviceName}
                  onChange={e => setForm(prev => ({ ...prev, deviceName: e.target.value }))}
                  placeholder="Contoh: Lampu Teras Utama"
                  className="text-xs"
                />
              </div>

              {/* Device Type */}
              <div className="space-y-2">
                <Label className="text-xs">Jenis Perangkat</Label>
                <Select
                  value={form.deviceType}
                  onValueChange={v => setForm(prev => ({ ...prev, deviceType: v }))}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Pilih jenis" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        <span className="flex items-center gap-2">
                          <span>{type.icon}</span>
                          {type.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Device Mode */}
              <div className="space-y-2">
                <Label className="text-xs">Mode Operasi</Label>
                <Select
                  value={form.deviceMode}
                  onValueChange={v => setForm(prev => ({ ...prev, deviceMode: v }))}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Pilih mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_MODES.map(mode => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label className="text-xs">Prioritas Load Shedding</Label>
                <Select
                  value={form.priority}
                  onValueChange={v => setForm(prev => ({ ...prev, priority: v }))}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Pilih prioritas" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p.value} value={String(p.value)}>
                        <span className={p.color}>{p.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Default State */}
              <div className="space-y-2">
                <Label className="text-xs">Status Default</Label>
                <Select
                  value={form.defaultState}
                  onValueChange={v => setForm(prev => ({ ...prev, defaultState: v }))}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">
                      <span className="flex items-center gap-1.5">
                        <Power className="w-3 h-3 text-emerald-400" />
                        ON (Nyala)
                      </span>
                    </SelectItem>
                    <SelectItem value="off">
                      <span className="flex items-center gap-1.5">
                        <PowerOff className="w-3 h-3 text-red-400" />
                        OFF (Mati)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={saving}
              className="text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 text-xs"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Menyimpan...' : editExistingDevice ? 'Perbarui' : 'Pasang'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Confirm Action Dialog ═══ */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={open => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'test' && 'Tes Relay?'}
              {confirmAction?.type === 'all-on' && 'Nyalakan Semua Perangkat?'}
              {confirmAction?.type === 'all-off' && 'Matikan Semua Perangkat?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'test' &&
                `Relay ${confirmAction.relayNumber} akan dinyalakan selama 1 detik lalu dimatikan kembali. Pastikan wiring sudah benar.`}
              {confirmAction?.type === 'all-on' &&
                'Semua perangkat yang terpasang akan dinyalakan. Lanjutkan?'}
              {confirmAction?.type === 'all-off' &&
                'Semua perangkat yang terpasang akan dimatikan. Lanjutkan?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmLoading}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAction}
              disabled={confirmLoading}
              className={`gap-2 ${
                confirmAction?.type === 'all-off'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : confirmAction?.type === 'test'
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}
            >
              {confirmLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmAction?.type === 'test' && 'Tes Sekarang'}
              {confirmAction?.type === 'all-on' && 'Nyalakan Semua'}
              {confirmAction?.type === 'all-off' && 'Matikan Semua'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  );
}
