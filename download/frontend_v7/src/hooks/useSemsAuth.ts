'use client';

import { useState, useEffect, useCallback } from 'react';

interface SemsUser {
  id: number | string;
  username: string;
  name?: string;
  role: string;
  token?: string;
}

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// FE-003 FIX: XSS RISK — This hook reads auth token from localStorage, which is
// accessible to any JavaScript running on the page (including injected scripts).
// TODO: Migrate to HttpOnly-only cookie flow where the token is never stored in
// client-accessible storage. The middleware already verifies the signed cookie.
/**
 * useSemsAuth — reads user info from localStorage.
 * This replaces useSession() from next-auth for dashboard components.
 * Login page stores user data in localStorage('sems_user') after successful auth.
 *
 * Fix #2: Checks token expiry. If storedAt + 24h has passed, clears storage
 * and redirects to /login.
 */
export function useSemsAuth() {
  const [user, setUser] = useState<SemsUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  // T3-FE-012: Wrap checkAuth with useCallback to prevent stale closure
  const checkAuth = useCallback(() => {
    try {
      const userJson = localStorage.getItem('sems_user');
      const token = localStorage.getItem('sems_token');
      const metaJson = localStorage.getItem('sems_auth_meta');

      // Fix #2: Check token expiry
      if (metaJson) {
        const meta = JSON.parse(metaJson) as { storedAt: number };
        const age = Date.now() - meta.storedAt;
        if (age > TOKEN_MAX_AGE_MS) {
          // Token expired — clear everything and redirect
          localStorage.removeItem('sems_token');
          localStorage.removeItem('sems_user');
          localStorage.removeItem('sems_auth_meta');
          document.cookie = 'sems-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          window.location.href = '/login';
          return;
        }
      }

      if (userJson && token) {
        const parsed = JSON.parse(userJson) as SemsUser;
        // Ensure name field exists (login stores 'username', UI expects 'name')
        if (!parsed.name && parsed.username) {
          parsed.name = parsed.username;
        }
        setUser(parsed);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // P2-TOKEN-02: Periodic 5-minute token validity check
  useEffect(() => {
    const intervalId = setInterval(checkAuth, 300000); // 5 minutes
    return () => clearInterval(intervalId);
  }, [checkAuth]);

  // Listen for auth changes (login/logout in other tabs)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'sems_user' || e.key === 'sems_token' || e.key === 'sems_auth_meta') {
        checkAuth();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [checkAuth]);

  const logout = () => {
    localStorage.removeItem('sems_token');
    localStorage.removeItem('sems_user');
    localStorage.removeItem('sems_auth_meta');
    document.cookie = 'sems-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  };

  return { user, status, logout };
}

// P2-TOKEN-01: Export getAuthHeaders helper for API calls
export function getAuthHeaders(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sems_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['X-Auth-Token'] = token;
  }
  return headers;
}
