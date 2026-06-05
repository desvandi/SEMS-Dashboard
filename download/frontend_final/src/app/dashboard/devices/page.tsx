'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchDevices, controlDevice, renameDevice } from '@/lib/api';
import type { Device } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Cpu, Power, RefreshCw, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingName, setSavingName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDevices = async () => {
    try {
      const res = await fetchDevices();
      if (res.success && res.devices) {
        setDevices(res.devices);
        setError(null);
      } else {
        setError(res.error || 'Failed to load devices');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleToggle = async (device: Device) => {
    setControlling(device.id);
    try {
      const newState = device.state === 1 ? 0 : 1;
      await controlDevice({ id: device.id, state: newState });
      setDevices(prev =>
        prev.map(d => d.id === device.id ? { ...d, state: newState } : d)
      );
    } catch {
      toast.error('Gagal mengubah status perangkat');
    } finally {
      setControlling(null);
    }
  };

  const startRename = (e: React.MouseEvent, device: Device) => {
    e.stopPropagation();
    setEditingId(device.id);
    setEditName(device.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveRename = async () => {
    if (!editingId || !editName.trim()) return;

    const trimmed = editName.trim();
    const current = devices.find(d => d.id === editingId);
    if (current && current.name === trimmed) {
      cancelRename();
      return;
    }

    setSavingName(editingId);
    try {
      const res = await renameDevice({ id: editingId, name: trimmed });
      if (res.success) {
        setDevices(prev =>
          prev.map(d => d.id === editingId ? { ...d, name: trimmed } : d)
        );
        setEditingId(null);
        setEditName('');
      } else {
        setError(res.error || 'Failed to rename device');
      }
    } catch {
      setError('Failed to rename device');
    } finally {
      setSavingName(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  };

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadDevices} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Kontrol Perangkat"
          subtitle="Kontrol manual perangkat relay dan MOSFET"
          icon={<Cpu className="w-5 h-5 text-primary" />}
        />
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button
              onClick={() => { setError(null); loadDevices(); }}
              className="ml-auto text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {devices.map((device, i) => (
              <motion.div
                key={device.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`
                  glass-card rounded-xl p-4 cursor-pointer transition-colors
                  ${controlling === device.id ? 'opacity-50' : ''}
                  ${device.state === 1 ? 'border-l-2 border-l-primary' : ''}
                `}
                onClick={() => handleToggle(device)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
                    {editingId === device.id ? (
                      /* Inline rename input */
                      <div
                        className="flex items-center gap-1 min-w-0 flex-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={inputRef}
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={handleKeyDown}
                          disabled={savingName === device.id}
                          className="text-sm font-medium bg-background border border-primary/50 rounded px-1.5 py-0.5 w-full min-w-0 focus:outline-none focus:ring-1 focus:ring-primary"
                          maxLength={50}
                        />
                        <button
                          type="button"
                          onClick={saveRename}
                          disabled={savingName === device.id || !editName.trim()}
                          className="shrink-0 p-0.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                          title="Simpan"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          disabled={savingName === device.id}
                          className="shrink-0 p-0.5 text-muted-foreground hover:bg-muted rounded transition-colors"
                          title="Batal"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      /* Display name + rename button */
                      <span className="text-sm font-medium truncate">{device.name}</span>
                    )}
                    {editingId !== device.id && (
                      <button
                        type="button"
                        onClick={(e) => startRename(e, device)}
                        className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors ml-1"
                        title="Rename perangkat"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className={`w-10 h-6 rounded-full flex items-center transition-colors p-0.5 shrink-0 ml-2 ${
                    device.state === 1 ? 'bg-primary' : 'bg-muted'
                  }`}>
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      device.state === 1 ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase">Type</span>
                    <span className="text-xs">{device.type}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase">Mode</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {device.mode}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase">Status</span>
                    <span className={`text-xs ${device.state === 1 ? 'text-primary' : 'text-muted-foreground'}`}>
                      {device.state === 1 ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
