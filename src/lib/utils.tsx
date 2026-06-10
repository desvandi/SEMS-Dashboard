import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { AlertTriangle, Info, AlertCircle } from 'lucide-react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Downsample helper ──
// Reduces a TelemetryData array to at most maxPoints by taking every N-th sample.
// Always includes the last data point.
export function downsample<T>(data: T[], maxPoints = 500): T[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const result: T[] = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

// ── Severity config helper ──
// Returns styling configuration for alarm severity levels.
// Used by alarms, logs, and notifications pages.
export function getSeverityConfig(severity: string) {
  switch (severity) {
    case 'critical':
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
        badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        dot: 'bg-red-500',
      };
    case 'warning':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        dot: 'bg-amber-500',
      };
    default:
      return {
        icon: <Info className="w-4 h-4" />,
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
        badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        dot: 'bg-blue-500',
      };
  }
}
