'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSemsAuth } from '@/hooks/useSemsAuth';
import { Header } from '@/components/layout/Header';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageTransition } from '@/components/layout/PageTransition';
import { fetchUsers, createUser, updateUser } from '@/lib/api';
import type { User } from '@/lib/types';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Users,
  UserPlus,
  Pencil,
  Trash2,
  ShieldCheck,
  Eye,
  EyeOff,
  AlertTriangle,
  Shield,
  UserCog,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';

// ---- Helpers ----
function getRoleBadge(role: string) {
  switch (role) {
    case 'admin':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'technician':
      return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
    default:
      return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

function getRoleLabel(role: string) {
  switch (role) {
    case 'admin': return 'Admin';
    case 'technician': return 'Teknisi';
    default: return 'Viewer';
  }
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ---- Component ----
export default function UsersPage() {
  const { user: session, status } = useSemsAuth();
  const userRole = session?.role;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    role: 'viewer' as 'admin' | 'technician' | 'viewer',
  });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [showCreatePwd, setShowCreatePwd] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    role: 'viewer' as 'admin' | 'technician' | 'viewer',
    password: '',
    active: true,
  });
  const [showEditPwd, setShowEditPwd] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetchUsers();
      if (res.success && res.users) {
        setUsers(res.users);
      } else {
        toast.error(res.error || 'Gagal memuat pengguna');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'loading') {
      loadUsers();
    }
  }, [status, loadUsers]);

  // ---- Auth guard ----
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (userRole !== 'admin') {
    return (
      <div className="min-h-screen">
        <Header isConnected={true} lastUpdated={null} onRefresh={() => {}} />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-2xl p-8 text-center max-w-sm"
          >
            <ShieldCheck className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Akses Ditolak</h2>
            <p className="text-muted-foreground text-sm">
              Halaman ini hanya tersedia untuk administrator. Hubungi admin untuk mendapatkan akses.
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  // ---- Stats ----
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.active).length;
  const adminCount = users.filter(u => u.role === 'admin').length;
  const currentUserId = Number(session?.id);
  const currentAdminCount = users.filter(u => u.role === 'admin' && u.active).length;

  // ---- Create validation ----
  const validateCreate = () => {
    const errors: Record<string, string> = {};
    if (!createForm.username.trim()) errors.username = 'Username wajib diisi';
    else if (createForm.username.trim().length < 3) errors.username = 'Username minimal 3 karakter';
    else if (createForm.username.trim().length > 30) errors.username = 'Username maksimal 30 karakter';
    if (!createForm.password) errors.password = 'Password wajib diisi';
    else if (createForm.password.length < 6) errors.password = 'Password minimal 6 karakter';
    setCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreate = async () => {
    if (!validateCreate()) return;
    setSaving(true);
    try {
      const res = await createUser(createForm);
      if (res.success) {
        toast.success('Pengguna berhasil ditambahkan');
        setCreateOpen(false);
        setCreateForm({ username: '', password: '', role: 'viewer' });
        setCreateErrors({});
        loadUsers();
      } else {
        toast.error(res.error || 'Gagal menambahkan pengguna');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setSaving(false);
    }
  };

  // ---- Edit ----
  const openEdit = (user: User) => {
    setEditUser(user);
    setEditForm({
      role: user.role,
      password: '',
      active: user.active,
    });
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        id: editUser.id,
        role: editForm.role,
        active: editForm.active,
      };
      if (editForm.password.trim()) {
        payload.password = editForm.password;
      }
      const res = await updateUser(payload as Parameters<typeof updateUser>[0]);
      if (res.success) {
        toast.success('Pengguna berhasil diperbarui');
        setEditOpen(false);
        loadUsers();
      } else {
        toast.error(res.error || 'Gagal memperbarui pengguna');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setSaving(false);
    }
  };

  // ---- Delete ----
  const openDelete = (user: User) => {
    setDeleteUser(user);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    if (deleteUser.role === 'admin' && currentAdminCount <= 1) {
      toast.error('Tidak dapat menghapus admin terakhir');
      setDeleteOpen(false);
      return;
    }
    setDeleting(true);
    try {
      const res = await updateUser({
        id: deleteUser.id,
        active: false,
      });
      if (res.success) {
        toast.success('Pengguna berhasil dinonaktifkan');
        setDeleteOpen(false);
        loadUsers();
      } else {
        toast.error(res.error || 'Gagal menonaktifkan pengguna');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Koneksi gagal');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageTransition>
      <Header isConnected={true} lastUpdated={null} onRefresh={loadUsers} />

      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <PageHeader
          title="Manajemen Pengguna"
          subtitle="Kelola akun dan akses pengguna sistem"
          icon={<Users className="w-5 h-5 text-primary" />}
          actions={
            <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-2">
              <UserPlus className="w-4 h-4" />
              Tambah Pengguna
            </Button>
          }
        />
        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-3"
        >
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-[10px] text-muted-foreground uppercase">Total Pengguna</span>
            </div>
            <div className="text-2xl font-bold">{totalUsers}</div>
          </div>
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Aktif</span>
            </div>
            <div className="text-2xl font-bold text-emerald-400">{activeUsers}</div>
          </div>
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Admin</span>
            </div>
            <div className="text-2xl font-bold text-amber-400">{adminCount}</div>
          </div>
        </motion.div>

        {/* Users Table */}
        {loading ? (
          <div className="glass-card rounded-xl p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Belum ada pengguna</p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card rounded-xl overflow-hidden"
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/30 hover:bg-transparent">
                    <TableHead className="text-[11px] uppercase text-muted-foreground">Username</TableHead>
                    <TableHead className="text-[11px] uppercase text-muted-foreground">Role</TableHead>
                    <TableHead className="text-[11px] uppercase text-muted-foreground">Status</TableHead>
                    <TableHead className="text-[11px] uppercase text-muted-foreground hidden md:table-cell">Login Terakhir</TableHead>
                    <TableHead className="text-[11px] uppercase text-muted-foreground text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user, i) => (
                    <motion.tr
                      key={user.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <TableCell className="font-medium text-sm">{user.username}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${getRoleBadge(user.role)}`}>
                          {getRoleLabel(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.active ? (
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                            Aktif
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-red-500/15 text-red-400 border-red-500/30">
                            Nonaktif
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                        {formatDate(user.last_login)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(user)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {user.id !== currentUserId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => openDelete(user)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          </motion.div>
        )}
      </div>

      {/* ====== CREATE USER DIALOG ====== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Tambah Pengguna Baru
            </DialogTitle>
            <DialogDescription>
              Buat akun pengguna baru untuk mengakses sistem SEMS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="create-username">Username</Label>
              <Input
                id="create-username"
                placeholder="Minimal 3 karakter"
                value={createForm.username}
                onChange={(e) => setCreateForm(prev => ({ ...prev, username: e.target.value }))}
              />
              {createErrors.username && (
                <p className="text-xs text-red-400">{createErrors.username}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="create-password">Password</Label>
              <div className="relative">
                <Input
                  id="create-password"
                  type={showCreatePwd ? 'text' : 'password'}
                  placeholder="Minimal 6 karakter"
                  value={createForm.password}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePwd(!showCreatePwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showCreatePwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {createErrors.password && (
                <p className="text-xs text-red-400">{createErrors.password}</p>
              )}
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={createForm.role}
                onValueChange={(val) => setCreateForm(prev => ({ ...prev, role: val as 'admin' | 'technician' | 'viewer' }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="technician">Teknisi</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== EDIT USER DIALOG ====== */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5 text-primary" />
              Edit Pengguna
            </DialogTitle>
            <DialogDescription>
              {editUser ? `Mengedit: ${editUser.username}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Role */}
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(val) => setEditForm(prev => ({ ...prev, role: val as 'admin' | 'technician' | 'viewer' }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="technician">Teknisi</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="edit-password">Password Baru <span className="text-muted-foreground font-normal">(opsional)</span></Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={showEditPwd ? 'text' : 'password'}
                  placeholder="Kosongkan untuk tidak mengubah"
                  value={editForm.password}
                  onChange={(e) => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPwd(!showEditPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showEditPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {editForm.password && editForm.password.length > 0 && editForm.password.length < 6 && (
                <p className="text-xs text-red-400">Password minimal 6 karakter</p>
              )}
            </div>

            {/* Active Toggle */}
            {editUser && editUser.id !== currentUserId && (
              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5">
                  <Label>Status Aktif</Label>
                  <p className="text-[10px] text-muted-foreground">Nonaktif akan mencegah login</p>
                </div>
                <Switch
                  checked={editForm.active}
                  onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, active: checked }))}
                />
              </div>
            )}
            {editUser && editUser.id === currentUserId && (
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <div className="space-y-0.5">
                  <Label>Status Aktif</Label>
                  <p className="text-[10px] text-muted-foreground">Anda tidak dapat menonaktifkan akun sendiri</p>
                </div>
                <Switch checked={true} disabled />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleUpdate} disabled={saving || (editForm.password.length > 0 && editForm.password.length < 6)} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== DELETE CONFIRMATION DIALOG ====== */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Nonaktifkan Pengguna
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUser && deleteUser.role === 'admin' && currentAdminCount <= 1 ? (
                <span className="text-red-400 font-medium">
                  Tidak dapat menonaktifkan admin terakhir. Sistem harus memiliki minimal satu admin aktif.
                </span>
              ) : deleteUser ? (
                <>
                  Apakah Anda yakin ingin menonaktifkan pengguna{' '}
                  <span className="font-semibold text-foreground">{deleteUser.username}</span>?
                  Pengguna yang dinonaktifkan tidak akan bisa login ke sistem.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting || (deleteUser?.role === 'admin' && currentAdminCount <= 1)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Nonaktifkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  );
}
