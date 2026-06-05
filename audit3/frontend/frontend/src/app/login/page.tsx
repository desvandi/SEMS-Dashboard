'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sun, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Fix #7: Client-side rate limiting
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

  // Read CSRF token from cookie for POST requests (Fix #5)
  const getCsrfToken = useCallback((): string | null => {
    const match = document.cookie.match(/(?:^|;\s*)sems-csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Fix #7: Rate limiting check
    if (cooldownRemaining > 0) return;
    if (failedAttempts >= 5) {
      setCooldownRemaining(5);
      setFailedAttempts(0);
      return;
    }

    setLoading(true);

    try {
      // Login through the /api/sems proxy — the SAME path used by device
      // control, automation rules, telemetry, etc. (all proven working).
      // No NextAuth involved — direct client → proxy → GAS → token.
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
        let detail = '';
        try {
          const errData = await res.json();
          detail = errData?.error || errData?.message || JSON.stringify(errData);
        } catch {
          detail = `HTTP ${res.status} ${res.statusText}`;
        }
        setError(`Login gagal. Periksa username dan password Anda.`);
        // Fix #7: Track failed attempt
        setFailedAttempts(prev => prev + 1);
        return;
      }

      const data = await res.json();

      if (data.success && data.token && data.user) {
        // Fix #2: Store token with expiry timestamp in localStorage
        const authData = {
          token: data.token,
          user: data.user,
          storedAt: Date.now(),
        };
        localStorage.setItem('sems_token', data.token);
        localStorage.setItem('sems_user', JSON.stringify(data.user));
        localStorage.setItem('sems_auth_meta', JSON.stringify({ storedAt: authData.storedAt }));

        // Fix #3: Set signed cookie via new API route (instead of forgeable sems-auth=1)
        try {
          const cookieRes = await fetch('/api/auth/set-cookie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: data.user.username }),
          });
          if (!cookieRes.ok) {
            // T3-FE-010: No fallback cookie — show error and stay on login page
            setError('Gagal membuat sesi. Silakan coba lagi.');
            setLoading(false);
            return;
          }
        } catch {
          // T3-FE-010: No fallback cookie — show error and stay on login page
          setError('Gagal membuat sesi. Silakan coba lagi.');
          setLoading(false);
          return;
        }

        router.push('/dashboard');
      } else {
        // P2-LEAK-01: Show generic error message instead of raw backend error
        setError('Login gagal. Periksa username dan password Anda.');
        // Fix #7: Track failed attempt
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

              {/* Fix #7: Cooldown warning */}
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
