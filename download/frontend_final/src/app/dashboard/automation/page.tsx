'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchRules, saveRule, deleteRule, fetchDevices } from '@/lib/api';
import type {
  AutomationRule,
  RuleCondition,
  RuleAction,
  Device,
  CONDITION_SENSORS as CSensorsType,
  CONDITION_OPERATORS as COperatorsType,
} from '@/lib/types';
import { CONDITION_SENSORS, CONDITION_OPERATORS } from '@/lib/types';

// shadcn/ui
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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

// dnd-kit
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// lucide icons
import {
  Zap,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  X,
  AlertCircle,
  Power,
  PowerOff,
  ShieldAlert,
  Loader2,
  ArrowRight,
  Layers,
  Cpu,
} from 'lucide-react';

// sonner toast
import { toast } from 'sonner';

// ======== Types ========
interface ConditionRow {
  id: string;
  sensor: string;
  operator: string;
  value: string;
}

interface RuleFormState {
  id?: string;
  name: string;
  description: string;
  logic: 'AND' | 'OR';
  conditions: ConditionRow[];
  targetId: string;
  actionOn: boolean;
  priority: number;
  enabled: boolean;
}

const emptyForm = (): RuleFormState => ({
  name: '',
  description: '',
  logic: 'AND',
  conditions: [{ id: crypto.randomUUID(), sensor: 'soc_percent', operator: '<', value: '20' }],
  targetId: '',
  actionOn: true,
  priority: 5,
  enabled: true,
});

// ======== Helper functions ========
function parseConditions(raw: string[]): RuleCondition[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => parseSingleCondition(c));
}

function parseSingleCondition(str: string): RuleCondition {
  // Parse flat strings like "battery_voltage > 26"
  const match = str.match(/^(\w+)\s*(>|<|>=|<=|==|!=)\s*(-?\d+\.?\d*)$/);
  if (match) {
    return { sensor: match[1], operator: match[2] as RuleCondition['operator'], value: parseFloat(match[3]) };
  }
  return { sensor: str, operator: '>', value: 0 };
}

function getSensorLabel(sensorValue: string): { label: string; unit: string } {
  const found = CONDITION_SENSORS.find(s => s.value === sensorValue);
  return found ? { label: found.label, unit: found.unit } : { label: sensorValue, unit: '' };
}

function getOperatorLabel(op: string): string {
  const found = CONDITION_OPERATORS.find(o => o.value === op);
  return found ? found.label : op;
}

function getPriorityColor(priority: number): string {
  if (priority <= 3) return 'border-l-emerald-500';
  if (priority <= 6) return 'border-l-amber-500';
  return 'border-l-red-500';
}

function getPriorityBadgeColor(priority: number): string {
  if (priority <= 3) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (priority <= 6) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-red-500/10 text-red-400 border-red-500/20';
}

// ======== Sortable Condition Row ========
function SortableConditionRow({
  condition,
  index,
  logic,
  onUpdate,
  onRemove,
}: {
  condition: ConditionRow;
  index: number;
  logic: 'AND' | 'OR';
  onUpdate: (id: string, field: keyof ConditionRow, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: condition.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="relative">
      {/* Logic connector */}
      {index > 0 && (
        <div className="absolute -top-3 left-6 z-10">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 bg-background border-primary/30 text-primary"
          >
            {logic}
          </Badge>
        </div>
      )}
      <div
        ref={setNodeRef}
        style={style}
        className={`flex items-start gap-2 p-3 rounded-lg border border-border/50 bg-background/50 ${
          isDragging ? 'opacity-50 shadow-lg' : ''
        }`}
      >
        {/* Drag handle */}
        <button
          className="mt-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Sensor select */}
        <div className="flex-1 min-w-0 space-y-1">
          <Label className="text-[10px] text-muted-foreground uppercase">Sensor</Label>
          <Select
            value={condition.sensor}
            onValueChange={v => onUpdate(condition.id, 'sensor', v)}
          >
            <SelectTrigger className="w-full text-xs" size="sm">
              <SelectValue placeholder="Pilih sensor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="battery_voltage">Battery Voltage (V)</SelectItem>
              <SelectItem value="battery_current">Battery Current (A)</SelectItem>
              <SelectItem value="soc_percent">Battery SOC (%)</SelectItem>
              <SelectItem value="battery_power">Battery Power (W)</SelectItem>
              <SelectItem value="inverter_current">Inverter Current (A)</SelectItem>
              <SelectItem value="inverter_power">Inverter Power (W)</SelectItem>
              <SelectItem value="room_temp">Room Temp (&deg;C)</SelectItem>
              <SelectItem value="room_humidity">Room Humidity (%)</SelectItem>
              <SelectItem value="wifi_rssi">WiFi RSSI (dBm)</SelectItem>
              <SelectItem value="load_shedding_active">Load Shedding</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <SelectItem key={`cell${n}_v`} value={`cell${n}_v`}>
                  Cell {n} Voltage (V)
                </SelectItem>
              ))}
              {[1, 2, 3, 4].map(n => (
                <SelectItem key={`pir${n}`} value={`pir${n}`}>
                  PIR Zone {String.fromCharCode(64 + n)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Operator select */}
        <div className="w-20 shrink-0 space-y-1">
          <Label className="text-[10px] text-muted-foreground uppercase">Operator</Label>
          <Select
            value={condition.operator}
            onValueChange={v => onUpdate(condition.id, 'operator', v)}
          >
            <SelectTrigger className="w-full text-xs" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_OPERATORS.map(op => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Value input */}
        <div className="w-20 shrink-0 space-y-1">
          <Label className="text-[10px] text-muted-foreground uppercase">Nilai</Label>
          <Input
            type="number"
            step="any"
            value={condition.value}
            onChange={e => onUpdate(condition.id, 'value', e.target.value)}
            className="h-8 text-xs"
            placeholder="0"
          />
        </div>

        {/* Remove button */}
        <button
          onClick={() => onRemove(condition.id)}
          className="mt-5 w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ======== Main Page Component ========
export default function AutomationPage() {
  // Data state
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<RuleFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ======== Load data ========
  const loadRules = useCallback(async () => {
    try {
      const res = await fetchRules();
      if (res.success && res.rules) {
        setRules(res.rules);
        setError(null);
      } else {
        setError(res.error || 'Gagal memuat aturan');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await fetchDevices();
      if (res.success && res.devices) {
        setDevices(res.devices);
      }
    } catch {
      // Devices fetch failure is not critical for rule viewing
    }
  }, []);

  useEffect(() => {
    loadRules();
    loadDevices();
  }, [loadRules, loadDevices]);

  // ======== Form handlers ========
  const updateCondition = useCallback(
    (id: string, field: keyof ConditionRow, value: string) => {
      setForm(prev => ({
        ...prev,
        conditions: prev.conditions.map(c =>
          c.id === id ? { ...c, [field]: value } : c
        ),
      }));
    },
    []
  );

  const addCondition = useCallback(() => {
    setForm(prev => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        { id: crypto.randomUUID(), sensor: 'soc_percent', operator: '<', value: '20' },
      ],
    }));
  }, []);

  const removeCondition = useCallback((id: string) => {
    setForm(prev => ({
      ...prev,
      conditions: prev.conditions.filter(c => c.id !== id),
    }));
  }, []);

  const handleDragEnd = useCallback((event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setForm(prev => ({
      ...prev,
      conditions: arrayMove(
        prev.conditions,
        prev.conditions.findIndex(c => c.id === active.id),
        prev.conditions.findIndex(c => c.id === over.id)
      ),
    }));
  }, []);

  const openCreateDialog = () => {
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AutomationRule) => {
    const conditions = parseConditions(rule.conditions);

    setForm({
      id: rule.id,
      name: rule.name || '',
      description: rule.description || '',
      logic: rule.logic === 'OR' ? 'OR' : 'AND',
      conditions: conditions.length > 0
        ? conditions.map(c => ({
            id: crypto.randomUUID(),
            sensor: c.sensor,
            operator: c.operator,
            value: String(c.value),
          }))
        : [{ id: crypto.randomUUID(), sensor: 'soc_percent', operator: '<', value: '20' }],
      targetId: rule.target || '',
      actionOn: rule.action === 'ON',
      priority: rule.priority,
      enabled: rule.enabled,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    // Validation
    if (!form.name.trim()) {
      toast.error('Nama aturan wajib diisi');
      return;
    }
    if (!form.targetId) {
      toast.error('Pilih perangkat untuk aksi');
      return;
    }
    if (form.conditions.length === 0) {
      toast.error('Tambahkan minimal satu kondisi');
      return;
    }
    for (const c of form.conditions) {
      if (c.value === '' || isNaN(Number(c.value))) {
        toast.error('Nilai kondisi harus berupa angka');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        id: form.id,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        enabled: form.enabled,
        logic: form.logic,
        target: form.targetId,
        conditions: form.conditions.map(c => `${c.sensor} ${c.operator} ${c.value}`),
        action: form.actionOn ? 'ON' : 'OFF',
        priority: form.priority,
      };

      const res = await saveRule(payload);
      if (res.success) {
        toast.success(form.id ? 'Aturan berhasil diperbarui' : 'Aturan berhasil dibuat');
        setDialogOpen(false);
        loadRules();
      } else {
        toast.error(res.error || 'Gagal menyimpan aturan');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await deleteRule({ id: deleteTarget.id });
      if (res.success) {
        toast.success('Aturan berhasil dihapus');
        setDeleteTarget(null);
        loadRules();
      } else {
        toast.error(res.error || 'Gagal menghapus aturan');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleEnabled = async (rule: AutomationRule) => {
    try {
      const conditions = parseConditions(rule.conditions);
      const newEnabled = !rule.enabled;

      const res = await saveRule({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: newEnabled,
        logic: rule.logic,
        conditions: rule.conditions,
        target: rule.target,
        action: rule.action,
        priority: rule.priority,
      });

      if (res.success) {
        setRules(prev =>
          prev.map(r => (r.id === rule.id ? { ...r, enabled: newEnabled } : r))
        );
        toast.success(newEnabled ? 'Aturan diaktifkan' : 'Aturan dinonaktifkan');
      } else {
        toast.error(res.error || 'Gagal mengubah status');
      }
    } catch {
      toast.error('Koneksi gagal');
    }
  };

  // ======== Render ========
  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadRules} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Otomatisasi"
          subtitle="Bangun aturan otomatis untuk kontrol perangkat"
          icon={<Zap className="w-5 h-5 text-primary" />}
          actions={
            <Button
              onClick={openCreateDialog}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
            >
              <Plus className="w-4 h-4" />
              Buat Aturan Baru
            </Button>
          }
        />

        {/* Stats summary */}
        {!loading && rules.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-3 gap-3"
          >
            <div className="glass-card rounded-xl p-4 text-center">
              <div className="text-2xl font-bold gradient-text">{rules.length}</div>
              <div className="text-[10px] text-muted-foreground mt-1">Total Aturan</div>
            </div>
            <div className="glass-card rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-primary">
                {rules.filter(r => r.enabled).length}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Aktif</div>
            </div>
            <div className="glass-card rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-muted-foreground">
                {rules.filter(r => !r.enabled).length}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Nonaktif</div>
            </div>
          </motion.div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={loadRules} className="ml-auto text-primary hover:underline">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          /* Empty state */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <ShieldAlert className="w-10 h-10 text-primary/60" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Belum Ada Aturan</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Buat aturan otomatis pertama Anda untuk mengontrol perangkat berdasarkan kondisi sensor. Misalnya, matikan lampu saat baterai rendah.
            </p>
            <Button
              onClick={openCreateDialog}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
            >
              <Plus className="w-4 h-4" />
              Buat Aturan Pertama
            </Button>
          </motion.div>
        ) : (
          /* Rule cards list */
          <div className="space-y-3">
            <AnimatePresence>
              {rules.map((rule, i) => {
                const conditions = parseConditions(rule.conditions);
                const targetDevice = devices.find(d => d.id === rule.target);
                const logic = rule.logic;

                return (
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ delay: i * 0.05 }}
                    className={`glass-card rounded-xl border-l-4 ${getPriorityColor(rule.priority)} ${
                      rule.enabled === false ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="p-4 sm:p-5">
                      {/* Card header */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="text-sm font-semibold truncate">
                              {rule.name}
                            </h3>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${getPriorityBadgeColor(rule.priority)}`}
                            >
                              P{rule.priority}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-primary/5 text-primary border-primary/20"
                            >
                              {logic}
                            </Badge>
                          </div>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {rule.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={() => handleToggleEnabled(rule)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openEditDialog(rule)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                            onClick={() => setDeleteTarget(rule)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Conditions as readable badges */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-3">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium mr-1">
                          IF
                        </span>
                        {conditions.map((cond, ci) => {
                          const sensorInfo = getSensorLabel(cond.sensor);
                          return (
                            <span key={ci} className="flex items-center gap-1 flex-wrap">
                              {ci > 0 && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 bg-primary/5 text-primary border-primary/20"
                                >
                                  {logic}
                                </Badge>
                              )}
                              <Badge
                                variant="secondary"
                                className="text-[11px] px-2 py-0.5 font-normal bg-muted/80"
                              >
                                {sensorInfo.label}{' '}
                                <span className="text-primary font-medium">{getOperatorLabel(cond.operator)}</span>{' '}
                                {cond.value}{sensorInfo.unit}
                              </Badge>
                            </span>
                          );
                        })}
                      </div>

                      {/* Action */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">
                          THEN
                        </span>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge
                          variant="outline"
                          className={`text-[11px] px-2 py-0.5 ${
                            rule.action === 'ON'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          {rule.action === 'ON' ? (
                            <Power className="w-3 h-3 mr-1" />
                          ) : (
                            <PowerOff className="w-3 h-3 mr-1" />
                          )}
                          {targetDevice?.name || rule.target}{' '}
                          {rule.action === 'ON' ? 'ON' : 'OFF'}
                        </Badge>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

    {/* ======== Create / Edit Rule Dialog ======== */}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              {form.id ? 'Edit Aturan' : 'Buat Aturan Baru'}
            </DialogTitle>
            <DialogDescription>
              {form.id
                ? 'Ubah kondisi dan aksi dari aturan otomatis.'
                : 'Definisikan kondisi sensor dan aksi perangkat yang akan dijalankan.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Rule Name */}
            <div className="space-y-2">
              <Label htmlFor="rule-name">
                Nama Aturan <span className="text-red-400">*</span>
              </Label>
              <Input
                id="rule-name"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Contoh: Matikan Lampu Saat Baterai Rendah"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="rule-desc">Deskripsi (opsional)</Label>
              <Textarea
                id="rule-desc"
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Keterangan tambahan tentang aturan ini..."
                rows={2}
              />
            </div>

            {/* Logic selector */}
            <div className="space-y-2">
              <Label>Logika Kondisi</Label>
              <ToggleGroup
                type="single"
                value={form.logic}
                onValueChange={v => {
                  if (v) setForm(prev => ({ ...prev, logic: v as 'AND' | 'OR' }));
                }}
                className="border border-border/50 rounded-lg"
              >
                <ToggleGroupItem
                  value="AND"
                  className="flex-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  AND (Semua kondisi terpenuhi)
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="OR"
                  className="flex-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  OR (Salah satu kondisi)
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Conditions builder */}
            <div className="space-y-2">
              <Label>Kondisi (IF)</Label>
              <p className="text-[11px] text-muted-foreground">
                Seret untuk mengubah urutan prioritas pengecekan
              </p>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={form.conditions.map(c => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    {form.conditions.map((condition, index) => (
                      <SortableConditionRow
                        key={condition.id}
                        condition={condition}
                        index={index}
                        logic={form.logic}
                        onUpdate={updateCondition}
                        onRemove={removeCondition}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 border-dashed text-xs"
                onClick={addCondition}
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Kondisi
              </Button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 border-t border-border/50" />
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Then Aksi</span>
              <div className="flex-1 border-t border-border/50" />
            </div>

            {/* Action selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Perangkat (Device)</Label>
                <Select
                  value={form.targetId}
                  onValueChange={v => setForm(prev => ({ ...prev, targetId: v }))}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Pilih perangkat" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map(device => (
                      <SelectItem key={device.id} value={String(device.id)}>
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3 h-3 text-muted-foreground" />
                          {device.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Aksi</Label>
                <ToggleGroup
                  type="single"
                  value={form.actionOn ? 'on' : 'off'}
                  onValueChange={v => {
                    if (v) setForm(prev => ({ ...prev, actionOn: v === 'on' }));
                  }}
                  className="border border-border/50 rounded-lg"
                >
                  <ToggleGroupItem
                    value="on"
                    className="flex-1 text-xs gap-1.5 data-[state=on]:bg-emerald-500/20 data-[state=on]:text-emerald-400"
                  >
                    <Power className="w-3 h-3" />
                    ON (Nyala)
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="off"
                    className="flex-1 text-xs gap-1.5 data-[state=on]:bg-red-500/20 data-[state=on]:text-red-400"
                  >
                    <PowerOff className="w-3 h-3" />
                    OFF (Mati)
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label>Prioritas (1-10)</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={form.priority}
                  onChange={e => {
                    const val = Math.min(10, Math.max(1, Number(e.target.value) || 1));
                    setForm(prev => ({ ...prev, priority: val }));
                  }}
                  className="w-20 text-xs"
                />
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">1-3 Rendah</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm bg-amber-500" />
                  <span className="text-[10px] text-muted-foreground">4-6 Sedang</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm bg-red-500" />
                  <span className="text-[10px] text-muted-foreground">7-10 Tinggi</span>
                </div>
              </div>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
              <div>
                <Label className="text-sm">Aktifkan Aturan</Label>
                <p className="text-[11px] text-muted-foreground">
                  Aturan yang aktif akan langsung dieksekusi saat kondisi terpenuhi
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={v => setForm(prev => ({ ...prev, enabled: v }))}
              />
            </div>
          </div>

          {/* Dialog footer */}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
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
              {saving ? 'Menyimpan...' : form.id ? 'Perbarui Aturan' : 'Simpan Aturan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    {/* ======== Delete Confirmation Dialog ======== */}
    <AlertDialog
        open={!!deleteTarget}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Aturan?</AlertDialogTitle>
            <AlertDialogDescription>
              Anda yakin ingin menghapus aturan &quot;{deleteTarget?.name}&quot;? Tindakan ini tidak dapat
              dibatalkan dan aturan akan berhenti berjalan secara permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white gap-2"
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Hapus Permanen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  );
}
