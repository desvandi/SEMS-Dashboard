'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSemsAuth } from '@/hooks/useSemsAuth';
import { fetchLatestTelemetry } from '@/lib/api';
import type { TelemetryData } from '@/lib/types';

/** Default polling interval (ms) */
const DEFAULT_POLL_INTERVAL = 15000;

/** Max consecutive auth failures before forcing logout */
const MAX_AUTH_FAILURES = 3;

interface UseTelemetryReturn {
  data: TelemetryData | null;
  loading: boolean;
  error: string | null;
  isConnected: boolean;
  lastUpdated: Date | null;
  refresh: () => void;
  pollingInterval: number;
}

export function useTelemetry(intervalMs: number = 15000): UseTelemetryReturn {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user: session } = useSemsAuth();

  const abortRef = useRef<AbortController | null>(null);
  const authFailureCount = useRef(0);

  /** Check if an error message indicates authentication failure */
  const isAuthError = (msg: string) =>
    msg.includes('Authentication required') || msg.includes('authentication');

  const fetchData = useCallback(async () => {
    // FE-M-01: Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await fetchLatestTelemetry();
      if (controller.signal.aborted) return;
      if (result.success && result.data) {
        setData(result.data);
        setError(null);
        setIsConnected(true);
        setLastUpdated(new Date());
        authFailureCount.current = 0; // Reset on success
      } else {
        const errMsg = result.error || '';
        if (isAuthError(errMsg)) {
          authFailureCount.current += 1;
          if (authFailureCount.current >= MAX_AUTH_FAILURES) {
            // Genuine session expiry — force logout after N consecutive failures
            localStorage.removeItem('sems_token');
            localStorage.removeItem('sems_user');
            document.cookie = 'sems-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            window.location.href = '/login';
            return;
          }
        } else {
          authFailureCount.current = 0; // Not an auth error — reset counter
        }
        setError(errMsg);
        setIsConnected(false);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Connection error';
      if (isAuthError(message) || message.includes('401')) {
        authFailureCount.current += 1;
        if (authFailureCount.current >= MAX_AUTH_FAILURES) {
          localStorage.removeItem('sems_token');
          localStorage.removeItem('sems_user');
          document.cookie = 'sems-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          window.location.href = '/login';
          return;
        }
      } else {
        authFailureCount.current = 0;
      }
      setError(message);
      setIsConnected(false);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!session) return;

    fetchData();
    intervalRef.current = setInterval(fetchData, intervalMs);

    // FE-M-10: Pause polling when page is hidden (Page Visibility API)
    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        fetchData();
        intervalRef.current = setInterval(fetchData, intervalMs);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (abortRef.current) abortRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [session, fetchData, intervalMs]);

  return {
    data,
    loading,
    error,
    isConnected,
    lastUpdated,
    refresh,
    pollingInterval: intervalMs ?? DEFAULT_POLL_INTERVAL,
  };
}
