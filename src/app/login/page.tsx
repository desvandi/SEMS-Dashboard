'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sun, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, KeyRound, ArrowLeft } from 'lucide-react';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  // Change password state
  const [mode, setMode] = useState<'login' | 'change-password'>('login');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Client-side rate limiting
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer for cooldown
  useEffect(() => {
    if (cooldownRemaining > 0) {
      cooldownTimerRef.current = setInterval(() => {
        setCooldownRemaining(prev => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [cooldownRemaining]);

  // Read CSRF token from cookie for POST requests
  const getCsrfToken = useCallback((): string | null => {
    const match = document.cookie.match(/(?:^|;\s*)sems-csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password baru minimal 6 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi password tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      const csrfToken = getCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch('/api/sems?path=api/users/change-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, old_password: password, new_password: newPassword }),
      });

      let data: any;
      try { data = await res.json(); } catch {
        data = { error: `HTTP ${res.status}` };
      }

      if (!res.ok || !data.success) {
        setError(data?.error || 'Gagal mengubah password.');
        setLoading(false);
        return;
      }

      // Password changed successfully — auto-login with new password
      setPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setMode('login');
      setError('');
      // Auto submit login with new credentials after a brief delay
      setTimeout(() => {
        const form = document.querySelector('form') as HTMLFormElement;
        if (form) form.requestSubmit();
      }, 300);
    } catch (err) {
      setError('Gagal mengubah password. Periksa koneksi internet.');
    } finally {
      if (mode === 'change-password') setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'change-password') {
      await handleChangePassword(e);
      return;
    }

    if (cooldownRemaining > 0) return;
    if (failedAttempts >= 5) {
      setCooldownRemaining(5);
      setFailedAttempts(0);
      return;
    }

    setLoading(true);

    try {
      // Step 1: Authenticate via /api/sems proxy → GAS backend
      const csrfToken = getCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch('/api/sems?path=api/users/auth', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password }),
      });

      let data: any;
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          data = await res.json();
          detail = data?.error || data?.message || JSON.stringify(data);
        } catch { /* ignore */ }

        // Detect "change password required" response
        const lowerDetail = (detail || '').toLowerCase();
        if (lowerDetail.includes('password must be changed') || lowerDetail.includes('change-password') || lowerDetail.includes('change password')) {
          setLoading(false);
          setMode('change-password');
          return;
        }

        if (res.status === 500) setError('Backend belum dikonfigurasi. Hubungi administrator.');
        else if (res.status === 504) setError('Timeout. Server backend terlalu lambat merespon.');
        else if (res.status === 502) setError('Tidak dapat terhubung ke backend. Coba lagi nanti.');
        else setError(`Login gagal: ${detail}`);
        setFailedAttempts(prev => prev + 1);
        return;
      }

      try { data = await res.json(); } catch {
        setError('Backend mengembalikan respons tidak valid.');
        setLoading(false);
        return;
      }

      // Check if backend says password must be changed (with 200 status)
      if (data.success === false || data.change_password) {
        const msg = data?.error || data?.message || '';
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes('password must be changed') || lowerMsg.includes('change-password') || lowerMsg.includes('change password') || data.change_password) {
          setLoading(false);
          setMode('change-password');
          return;
        }
        setError(`Login gagal: ${msg || 'Data respons tidak valid'}`);
        setFailedAttempts(prev => prev + 1);
        return;
      }

      if (data.success && data.token && data.user) {
        // Store auth data in localStorage
        localStorage.setItem('sems_token', data.token);
        localStorage.setItem('sems_user', JSON.stringify(data.user));
        localStorage.setItem('sems_auth_meta', JSON.stringify({ storedAt: Date.now() }));

        // Step 2: Set signed auth cookie
        try {
          const cookieRes = await fetch('/api/auth/set-cookie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: data.user.username, token: data.token }),
          });
          if (!cookieRes.ok) {
            let cookieErr = `HTTP ${cookieRes.status}`;
            try {
              const errData = await cookieRes.json();
              cookieErr = errData?.error || errData?.message || JSON.stringify(errData);
            } catch { /* ignore */ }
            setError(`Gagal membuat sesi: ${cookieErr}`);
            setLoading(false);
            return;
          }
        } catch (err) {
          setError('Gagal membuat sesi. Periksa koneksi internet.');
          setLoading(false);
          return;
        }

        router.push(callbackUrl);
      } else {
        const reason = data?.error || data?.message || 'Data respons tidak valid';
        setError(`Login gagal: ${reason}`);
        setFailedAttempts(prev => prev + 1);
      }
    } catch (err) {
      const msg = err instanceof TypeError && err.message.includes('fetch')
        ? 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.'
        : 'Terjadi kesalahan. Silakan coba lagi.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isLoginDisabled = loading || !username || !password || cooldownRemaining > 0;
  const isChangePwDisabled = loading || !newPassword || !confirmPassword;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[150px]" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-4">
            <Sun className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Jambi Solar Panel</h1>
          <p className="text-muted-foreground text-sm mt-1">Smart Energy Management System</p>
        </div>

        <Card className="glass-card border-border/50">
          <AnimatePresence mode="wait">
            {mode === 'login' ? (
              <motion.div
                key="login"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <CardHeader className="space-y-1 pb-4">
                  <CardTitle className="text-xl">Sign In</CardTitle>
                  <CardDescription>Masukkan kredensial untuk mengakses dashboard</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm break-all"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        {error}
                      </motion.div>
                    )}

                    {cooldownRemaining > 0 && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 text-sm">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        Terlalu banyak percobaan gagal. Tunggu {cooldownRemaining} detik.
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        type="text"
                        placeholder="Masukkan username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        disabled={loading}
                        className="bg-background/50 border-border/50 focus:border-primary h-11"
                        autoComplete="username"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Masukkan password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          disabled={loading}
                          className="bg-background/50 border-border/50 focus:border-primary h-11 pr-10"
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={0}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-11"
                      disabled={isLoginDisabled}
                    >
                      {loading ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Memverifikasi...</>
                      ) : cooldownRemaining > 0 ? (
                        <>Tunggu {cooldownRemaining} detik...</>
                      ) : (
                        'Sign In'
                      )}
                    </Button>
                  </form>
                </CardContent>
              </motion.div>
            ) : (
              <motion.div
                key="change-password"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <CardHeader className="space-y-1 pb-4">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-primary" />
                    <CardTitle className="text-xl">Ganti Password</CardTitle>
                  </div>
                  <CardDescription>
                    Password default harus diubah sebelum login. Buat password baru untuk akun <strong>{username}</strong>.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm break-all"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        {error}
                      </motion.div>
                    )}

                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-primary">
                      Password default berhasil diverifikasi. Silakan buat password baru (minimal 6 karakter).
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-password">Password Baru</Label>
                      <div className="relative">
                        <Input
                          id="new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          placeholder="Minimal 6 karakter"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          disabled={loading}
                          minLength={6}
                          className="bg-background/50 border-border/50 focus:border-primary h-11 pr-10"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={0}
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Konfirmasi Password Baru</Label>
                      <div className="relative">
                        <Input
                          id="confirm-password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="Ulangi password baru"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          disabled={loading}
                          minLength={6}
                          className="bg-background/50 border-border/50 focus:border-primary h-11 pr-10"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={0}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 h-11 border-border/50"
                        disabled={loading}
                        onClick={() => { setMode('login'); setError(''); }}
                      >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Kembali
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground h-11"
                        disabled={isChangePwDisabled}
                      >
                        {loading ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengubah...</>
                        ) : (
                          'Ganti Password & Login'
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} PT. Jaya Mandiri Smart Energy
          <span className="ml-2 opacity-50">v4.0</span>
        </p>
      </motion.div>
    </div>
  );
}
