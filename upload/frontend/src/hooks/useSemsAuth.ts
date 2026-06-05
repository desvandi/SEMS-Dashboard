'use client';

import { useState, useEffect } from 'react';

interface SemsUser {
  id: number | string;
  username: string;
  name?: string;
  role: string;
  token?: string;
}

/**
 * useSemsAuth — reads user info from localStorage.
 * This replaces useSession() from next-auth for dashboard components.
 * Login page stores user data in localStorage('sems_user') after successful auth.
 */
export function useSemsAuth() {
  const [user, setUser] = useState<SemsUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    try {
      const userJson = localStorage.getItem('sems_user');
      const token = localStorage.getItem('sems_token');

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

  // Listen for auth changes (login/logout in other tabs)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'sems_user' || e.key === 'sems_token') {
        const userJson = localStorage.getItem('sems_user');
        const token = localStorage.getItem('sems_token');
        if (userJson && token) {
          const parsed = JSON.parse(userJson) as SemsUser;
          if (!parsed.name && parsed.username) parsed.name = parsed.username;
          setUser(parsed);
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const logout = () => {
    localStorage.removeItem('sems_token');
    localStorage.removeItem('sems_user');
    document.cookie = 'sems-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  };

  return { user, status, logout };
}
