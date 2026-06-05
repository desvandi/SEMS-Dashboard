'use client';

import { useSession, signOut } from 'next-auth/react';
import { useEffect, useRef } from 'react';

/**
 * TokenSync bridges auth session to localStorage for API calls.
 * Supports two auth methods:
 *   1. Custom login (direct GAS token) — reads from localStorage directly
 *   2. NextAuth (legacy) — syncs NextAuth session token to localStorage
 *
 * api.ts reads localStorage('sems_token') for X-Auth-Token header.
 */
export function TokenSync() {
  const { data: session, status } = useSession();
  const prevTokenRef = useRef<string | null>(null);

  // Sync NextAuth session token to localStorage (legacy support)
  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      const token = (session.user as Record<string, unknown>).token as string | undefined;
      if (token && token !== prevTokenRef.current) {
        try {
          localStorage.setItem('sems_token', token);
          prevTokenRef.current = token;
        } catch {
          // localStorage unavailable (SSR, privacy mode)
        }
      }
    } else if (status === 'unauthenticated') {
      // Only clear if there's no custom auth token in localStorage
      try {
        const hasCustomToken = localStorage.getItem('sems_token');
        if (!hasCustomToken && prevTokenRef.current) {
          localStorage.removeItem('sems_token');
          prevTokenRef.current = null;
        }
      } catch {
        // ignore
      }
    }
  }, [session, status]);

  // Listen for storage events from other tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'sems_token' && !e.newValue && status === 'authenticated') {
        signOut({ callbackUrl: '/login' });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [status, signOut]);

  return null;
}
