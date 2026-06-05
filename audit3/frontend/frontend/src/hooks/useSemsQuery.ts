'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchLatestTelemetry, fetchTelemetryHistory } from '@/lib/api';
import type { TelemetryData } from '@/lib/types';

/**
 * Fix #9: useSemsQuery — lightweight wrapper around React Query's useQuery.
 * Standardizes query key prefix and error handling.
 */
export function useSemsQuery<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    select?: (data: T) => T;
  }
) {
  return useQuery({
    queryKey: ['sems', ...queryKey],
    queryFn,
    ...options,
  });
}

/**
 * Convenience hook: fetch latest telemetry with React Query.
 * Replaces the manual useTelemetry polling hook on the dashboard page.
 */
export function useLatestTelemetryQuery(refetchInterval = 10000) {
  return useQuery({
    queryKey: ['sems', 'telemetry', 'latest'],
    queryFn: async () => {
      const res = await fetchLatestTelemetry();
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to fetch telemetry');
      }
      return res.data as TelemetryData;
    },
    refetchInterval,
    retry: 3,
    refetchOnWindowFocus: true,
  });
}

/**
 * Convenience hook: fetch telemetry history with React Query.
 */
export function useTelemetryHistoryQuery(params: {
  from?: string;
  to?: string;
  limit?: number;
}, enabled = true) {
  return useQuery({
    queryKey: ['sems', 'telemetry', 'history', params],
    queryFn: async () => {
      const res = await fetchTelemetryHistory(params);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to fetch telemetry history');
      }
      return res.data as TelemetryData[];
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
