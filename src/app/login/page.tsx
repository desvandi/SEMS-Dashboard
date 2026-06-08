'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sun, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const res = await fetch('/api/sems?path=api/users/auth', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          detail = errData?.error || errData?.message || JSON.stringify(errData);
          console.error('[Login] Auth failed:', res.status, detail);
        } catch { /* ignore */ }
        // Show specific error for debugging
        if (res.status === 500) {
          setError('Backend belum dikonfigurasi. Hubungi administrator.');
        } else if (res.status === 504) {
          setError('Timeout. Server backend terlalu lambat merespon.');
        } else if (res.status === 502) {
          setError('Tidak dapat terhubung ke backend. Coba lagi nanti.');
        } else {
          setError('Login gagal. Periksa username dan password Anda.');
        }
        setFailedAttempts(prev => prev + 1);
        return;
      }

      const data = await res.json();

      if (data.success && data.token && data.user) {
        // Store auth data in localStorage
        localStorage.setItem('sems_token', data.token);
        localStorage.setItem('sems_user', JSON.stringify(data.user));
        localStorage.setItem('sems_auth_meta', JSON.stringify({ storedAt: Date.now() }));

        // Step 2: Set signed auth cookie via /api/auth/set-cookie
        // Re-read CSRF token AFTER step 1 response set/rotated the cookie
        try {
          const csrfAfterLogin = getCsrfToken();
          const cookieHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (csrfAfterLogin) {
            cookieHeaders['X-CSRF-Token'] = csrfAfterLogin;
          }
          const cookieRes = await fetch('/api/auth/set-cookie', {
            method: 'POST',
            headers: cookieHeaders,
            body: JSON.stringify({ username: data.user.username, token: data.token }),
          });
          if (!cookieRes.ok) {
            try {
              const errData = await cookieRes.json();
              console.error('[Login] set-cookie error:', errData);
            } catch { /* ignore */ }
            setError('Gagal membuat sesi. Silakan coba lagi.');
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error('[Login] set-cookie exception:', err);
          setError('Gagal membuat sesi. Silakan coba lagi.');
          setLoading(false);
          return;
        }

        router.push(callbackUrl);
      } else {
        setError('Login gagal. Periksa username dan password Anda.');
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

  const isButtonDisabled = loading || !username || !password || cooldownRemaining > 0;

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
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Sign In</CardTitle>
            <CardDescription>
              Enter your credentials to access the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}

              {cooldownRemaining > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm"
                >
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  Too many failed attempts. Please wait {cooldownRemaining}s.
                </motion.div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
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
                    placeholder="Enter your password"
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
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-11"
                disabled={isButtonDisabled}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Authenticating...
                  </>
                ) : cooldownRemaining > 0 ? (
                  <>Wait {cooldownRemaining}s...</>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} PT. Jaya Mandiri Smart Energy
        </p>
      </motion.div>
    </div>
  );
}
