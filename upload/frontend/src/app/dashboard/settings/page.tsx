'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useSemsAuth } from '@/hooks/useSemsAuth';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchConfig, updateConfig } from '@/lib/api';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Settings,
  Eye,
  EyeOff,
  Loader2,
  Shield,
  Database,
  Clock,
  Info,
  AlertTriangle,
  HardDrive,
  Bell,
  RefreshCw,
  Save,
  Sun,
  CheckCircle2,
  Cpu,
} from 'lucide-react';

interface ConfigSection {
  title: string;
  icon: React.ReactNode;
  adminOnly: boolean;
  fields: ConfigField[];
  saveKey?: string;
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'email' | 'number';
  placeholder?: string;
  unit?: string;
  masked?: boolean;
  adminOnly?: boolean;
}

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    title: 'Konfigurasi Sistem',
    icon: <Settings className="w-4 h-4" />,
    adminOnly: false,
    saveKey: 'system',
    fields: [
      { key: 'device_token', label: 'Device Token', type: 'password', placeholder: 'Token perangkat', masked: true, adminOnly: true },
      { key: 'notification_email', label: 'Email Notifikasi', type: 'email', placeholder: 'email@contoh.com', adminOnly: true },
      { key: 'telemetry_interval', label: 'Interval Telemetry', type: 'number', placeholder: '60', unit: 'detik' },
      { key: 'config_sync_interval', label: 'Interval Sync Konfigurasi', type: 'number', placeholder: '300', unit: 'detik' },
    ],
  },
  {
    title: 'Batas Alarm',
    icon: <AlertTriangle className="w-4 h-4" />,
    adminOnly: true,
    saveKey: 'thresholds',
    fields: [
      { key: 'low_battery_voltage', label: 'Tegangan Baterai Rendah', type: 'number', placeholder: '21', unit: 'V' },
      { key: 'overvoltage_threshold', label: 'Batas Tegangan Tinggi', type: 'number', placeholder: '29.2', unit: 'V' },
      { key: 'overload_current', label: 'Batas Arus Beban', type: 'number', placeholder: '30', unit: 'A' },
      { key: 'sensor_failure_timeout', label: 'Timeout Kegagalan Sensor', type: 'number', placeholder: '30', unit: 's' },
    ],
  },
  {
    title: 'Notifikasi Email',
    icon: <Bell className="w-4 h-4" />,
    adminOnly: true,
    saveKey: 'notifications',
    fields: [
      { key: 'email_notifications', label: 'Notifikasi Email', type: 'text', placeholder: '1 = Aktif, 0 = Nonaktif' },
      { key: 'notification_email', label: 'Email Tujuan', type: 'email', placeholder: 'email@contoh.com', adminOnly: true },
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  low_battery_voltage: '21',
  overvoltage_threshold: '29.2',
  overload_current: '80',
  sensor_failure_timeout: '30',
  telemetry_interval: '60',
  config_sync_interval: '300',
};

export default function SettingsPage() {
  const { user: session, status } = useSemsAuth();
  const userRole = session?.role;

  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [maskedFields, setMaskedFields] = useState<Record<string, boolean>>({ device_token: true });

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetchConfig();
      if (res.success && res.configs && Array.isArray(res.configs)) {
        // Backend returns configs as an array of {key, value, ...} objects.
        // Build a flat map: { key: value } for form binding.
        const map: Record<string, string> = {};
        for (const item of res.configs) {
          map[item.key] = item.value;
        }
        setConfig(map);
      }
    } catch {
      toast.error('Gagal memuat konfigurasi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'loading') {
      loadConfig();
    }
  }, [status, loadConfig]);

  // ---- Save section ----
  const saveSection = async (section: ConfigSection) => {
    setSaving(section.saveKey || 'system');
    try {
      // Backend expects { updates: [{ key, value }, ...] } format
      const updates: Array<{ key: string; value: string }> = [];
      section.fields.forEach(f => {
        const val = config[f.key];
        if (val !== undefined && val !== '') {
          updates.push({ key: f.key, value: val });
        }
      });
      const res = await updateConfig({ updates });
      if (res.success) {
        toast.success(`${section.title} berhasil disimpan`);
        loadConfig();
      } else {
        toast.error(res.error || 'Gagal menyimpan konfigurasi');
      }
    } catch {
      toast.error('Koneksi gagal');
    } finally {
      setSaving(null);
    }
  };

  const updateField = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const toggleMask = (key: string) => {
    setMaskedFields(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ---- Check if field visible for current user ----
  const isFieldVisible = (adminOnly?: boolean) => {
    return userRole === 'admin' || !adminOnly;
  };

  const isSectionVisible = (adminOnly: boolean) => {
    return userRole === 'admin' || !adminOnly;
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadConfig} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6 max-w-4xl">
        <PageHeader
          title="Pengaturan Sistem"
          subtitle="Konfigurasi sistem SEMS"
          icon={<Settings className="w-5 h-5 text-primary" />}
        />

        {/* System Info (read-only) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Sun className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Informasi Sistem</h3>
            <Badge variant="outline" className="text-[10px] px-2 py-0 ml-auto bg-primary/10 text-primary border-primary/30">
              Read Only
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase">Nama Sistem</span>
              <p className="text-sm font-medium">SEMS - Jambi Solar Panel</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase">Baterai</span>
              <p className="text-sm font-medium">8S LiFePO4 25.6V 100Ah</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase">Versi</span>
              <p className="text-sm font-medium">1.0.0</p>
            </div>
          </div>
        </motion.div>

        {/* Config Sections */}
        {CONFIG_SECTIONS.filter(s => isSectionVisible(s.adminOnly)).map((section, idx) => (
          <motion.div
            key={section.saveKey}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (idx + 1) * 0.1 }}
            className="glass-card rounded-xl p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <div className="text-primary">{section.icon}</div>
              <h3 className="text-sm font-semibold">{section.title}</h3>
              {section.adminOnly && userRole === 'admin' && (
                <Badge variant="outline" className="text-[10px] px-2 py-0 bg-amber-500/10 text-amber-400 border-amber-500/30">
                  <Shield className="w-2.5 h-2.5 mr-1" />
                  Admin
                </Badge>
              )}
            </div>

            <div className="space-y-4">
              {section.fields
                .filter(f => isFieldVisible(f.adminOnly))
                .map((field, fIdx) => (
                <div key={field.key}>
                  {fIdx > 0 && <Separator className="mb-4" />}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`field-${field.key}`} className="text-xs">
                        {field.label}
                      </Label>
                      {loading ? (
                        <Skeleton className="h-9 w-full" />
                      ) : field.masked ? (
                        <div className="relative">
                          <Input
                            id={`field-${field.key}`}
                            type={maskedFields[field.key] ? 'password' : 'text'}
                            value={config[field.key] || ''}
                            onChange={(e) => updateField(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => toggleMask(field.key)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {maskedFields[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Input
                            id={`field-${field.key}`}
                            type={field.type === 'number' ? 'number' : field.type}
                            value={config[field.key] || ''}
                            onChange={(e) => updateField(field.key, e.target.value)}
                            placeholder={field.placeholder || DEFAULTS[field.key]}
                            min={0}
                            step={field.type === 'number' && (field.key.includes('voltage') || field.key.includes('threshold')) ? '0.1' : '1'}
                          />
                          {field.unit && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              {field.unit}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-end">
                      <p className="text-[10px] text-muted-foreground pb-2">
                        Default: {DEFAULTS[field.key] || '-'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-6 pt-4 border-t border-border/30">
              <Button
                onClick={() => saveSection(section)}
                disabled={saving === section.saveKey}
                size="sm"
                className="gap-2"
              >
                {saving === section.saveKey ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Simpan
              </Button>
            </div>
          </motion.div>
        ))}

        {/* Data Retention (read-only info) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card rounded-xl p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold">Retensi Data</h3>
            <Badge variant="outline" className="text-[10px] px-2 py-0 ml-auto bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
              Read Only
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="text-[10px] text-muted-foreground uppercase block">Riwayat Telemetry</span>
                <span className="text-sm font-medium">30 hari</span>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="text-[10px] text-muted-foreground uppercase block">Riwayat Alarm</span>
                <span className="text-sm font-medium">90 hari</span>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="text-[10px] text-muted-foreground uppercase block">Auto-cleanup</span>
                <span className="text-sm font-medium">Setiap hari pukul 03:00 WIB</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </PageTransition>
  );
}
