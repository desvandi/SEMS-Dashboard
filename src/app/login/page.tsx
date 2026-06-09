'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sun, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

type LoginStep = 'login' | 'change-password' | 'success';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const router = useRouter();

  // Change password state
  const [step, setStep] = useState<LoginStep>('login');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSuccess, setChangePasswordSuccess] = useState('');

  // Store the original password for the change-password verification step
  const [currentPassword, setCurrentPassword] = useState('');

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

  // Validate password complexity (matching backend rules)
  const validatePasswordComplexity = (pwd: string): string | null => {
    if (pwd.length < 8) return 'Password minimal 8 karakter';
    if (!/[A-Z]/.test(pwd)) return 'Password harus mengandung huruf besar';
    if (!/[a-z]/.test(pwd)) return 'Password harus mengandung huruf kecil';
    if (!/[0-9]/.test(pwd)) return 'Password harus mengandung angka';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pwd)) return 'Password harus mengandung karakter spesial';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

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
        setError('Login gagal. Periksa username dan password Anda.');
        setFailedAttempts(prev => prev + 1);
        return;
      }

      const data = await res.json();

      // Handle must_change_password response
      if (data.mustChangePassword && !data.success) {
        setSuccessMsg('Password default berhasil diverifikasi. Silakan buat password baru (minimal 8 karakter).');
        setStep('change-password');
        setCurrentPassword(password);
        return;
      }

      if (data.success && data.token && data.user) {
        await completeLogin(data.token, data.user);
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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePasswordError('');
    setChangePasswordSuccess('');

    // Client-side validation
    const pwdError = validatePasswordComplexity(newPassword);
    if (pwdError) {
      setChangePasswordError(pwdError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('Konfirmasi password tidak cocok.');
      return;
    }

    setChangePasswordLoading(true);

    try {
      const csrfToken = getCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      // Call change-password API — this is a public endpoint on the GAS backend
      // that authenticates via current_password (not session token) for
      // must_change_password users
      const res = await fetch('/api/sems?path=api/users/change-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setChangePasswordSuccess('Password berhasil diubah! Mengalihkan ke login...');
        setStep('success');

        // Auto-login with new password after a brief delay
        setTimeout(async () => {
          try {
            const csrfToken2 = getCsrfToken();
            const headers2: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (csrfToken2) {
              headers2['X-CSRF-Token'] = csrfToken2;
            }

            const loginRes = await fetch('/api/sems?path=api/users/auth', {
              method: 'POST',
              headers: headers2,
              body: JSON.stringify({
                username: username.trim().toLowerCase(),
                password: newPassword,
              }),
            });

            if (loginRes.ok) {
              const loginData = await loginRes.json();
              if (loginData.success && loginData.token && loginData.user) {
                await completeLogin(loginData.token, loginData.user);
                return;
              }
            }
            // If auto-login fails, redirect to login page with clean state
            setStep('login');
            setPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setError('Password berhasil diubah. Silakan login dengan password baru.');
          } catch {
            setStep('login');
            setPassword('');
            setNewPassword('');
            setConfirmPassword('');
          }
        }, 1500);
      } else {
        setChangePasswordError(data.error || 'Gagal mengubah password. Silakan coba lagi.');
      }
    } catch (err) {
      setChangePasswordError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const completeLogin = async (token: string, user: { username: string }) => {
    // Store token with expiry timestamp in localStorage
    const authData = {
      token: token,
      user: user,
      storedAt: Date.now(),
    };
    localStorage.setItem('sems_token', token);
    localStorage.setItem('sems_user', JSON.stringify(user));
    localStorage.setItem('sems_auth_meta', JSON.stringify({ storedAt: authData.storedAt }));

    // Set signed cookie via API route
    try {
      const cookieRes = await fetch('/api/auth/set-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username }),
      });
      if (!cookieRes.ok) {
        document.cookie = 'sems-auth=present; path=/; max-age=86400; SameSite=Lax';
      }
    } catch {
      document.cookie = 'sems-auth=present; path=/; max-age=86400; SameSite=Lax';
    }

    router.push('/dashboard');
  };

  const handleBackToLogin = () => {
    setStep('login');
    setChangePasswordError('');
    setChangePasswordSuccess('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccessMsg('');
  };

  const isLoginButtonDisabled = loading || !username || !password || cooldownRemaining > 0;
  const isChangePasswordButtonDisabled =
    changePasswordLoading || !newPassword || !confirmPassword || changePasswordSuccess !== '';

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

        <AnimatePresence mode="wait">
          {/* ==================== LOGIN FORM ==================== */}
          {step === 'login' && (
            <motion.div
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
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
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-11"
                      disabled={isLoginButtonDisabled}
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
            </motion.div>
          )}

          {/* ==================== CHANGE PASSWORD FORM ==================== */}
          {step === 'change-password' && (
            <motion.div
              key="change-password"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="glass-card border-border/50">
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
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    {/* Success message from login verification */}
                    {successMsg && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        {successMsg}
                      </motion.div>
                    )}

                    {/* Error from change-password API */}
                    {changePasswordError && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        {changePasswordError}
                      </motion.div>
                    )}

                    {/* Password changed success */}
                    {changePasswordSuccess && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        {changePasswordSuccess}
                      </motion.div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="new-password">Password Baru</Label>
                      <div className="relative">
                        <Input
                          id="new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          placeholder="Minimal 8 karakter"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          disabled={changePasswordLoading || !!changePasswordSuccess}
                          className="bg-background/50 border-border/50 focus:border-primary h-11 pr-10"
                          autoComplete="new-password"
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {/* Password strength hints */}
                      {newPassword.length > 0 && newPassword.length < 8 && (
                        <p className="text-xs text-muted-foreground">Minimal 8 karakter</p>
                      )}
                      {newPassword.length >= 8 && (
                        <div className="flex gap-1 flex-wrap">
                          {[/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].map((regex, i) => (
                            <span
                              key={i}
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                regex.test(newPassword)
                                  ? 'bg-green-500/10 text-green-400'
                                  : 'bg-red-500/10 text-red-400'
                              }`}
                            >
                              {['A-Z', 'a-z', '0-9', '!@#'][i]}
                            </span>
                          ))}
                        </div>
                      )}
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
                          disabled={changePasswordLoading || !!changePasswordSuccess}
                          className={`bg-background/50 border-border/50 focus:border-primary h-11 pr-10 ${
                            confirmPassword && confirmPassword !== newPassword
                              ? 'border-red-500/50'
                              : confirmPassword && confirmPassword === newPassword
                              ? 'border-green-500/50'
                              : ''
                          }`}
                          autoComplete="new-password"
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {confirmPassword && confirmPassword !== newPassword && (
                        <p className="text-xs text-red-400">Password tidak cocok</p>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleBackToLogin}
                        disabled={changePasswordLoading}
                        className="flex-1"
                      >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Kembali
                      </Button>
                      <Button
                        type="submit"
                        className="flex-[2] bg-primary hover:bg-primary/90 text-primary-foreground h-11"
                        disabled={isChangePasswordButtonDisabled}
                      >
                        {changePasswordLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Menyimpan...
                          </>
                        ) : (
                          'Ganti Password & Login'
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} PT. Jaya Mandiri Smart Energy
        </p>
      </motion.div>
    </div>
  );
}
