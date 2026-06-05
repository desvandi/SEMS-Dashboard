'use client';

import { Wifi, WifiOff, RefreshCw, Bell } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useState, useEffect, useRef } from 'react';
import { fetchAlarms } from '@/lib/api';
import { useSemsAuth } from '@/hooks/useSemsAuth';
import { usePathname } from 'next/navigation';

interface HeaderProps {
  isConnected: boolean;
  lastUpdated: Date | null;
  onRefresh?: () => void;
}

export function Header({ isConnected, lastUpdated, onRefresh }: HeaderProps) {
  const { user: session } = useSemsAuth();
  const [unackCount, setUnackCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pathname = usePathname();

  // T3-FE-018: useRef for timeout cleanup
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix #6: Avoid fetching alarm count when dashboard isn't active.
  // Only poll when the user is on a dashboard page (where alarms are relevant).
  const isDashboardActive = pathname?.startsWith('/dashboard');

  useEffect(() => {
    if (!isDashboardActive) return;

    let active = true;
    const tick = async () => {
      if (!active || document.hidden) return;
      try {
        const res = await fetchAlarms({ status: 'unacknowledged', limit: '1' });
        if (res.success && active) {
          setUnackCount(res.unacknowledged || 0);
        }
      } catch { /* Non-critical */ }
    };
    tick();
    const interval = setInterval(tick, 30000);
    const handleVisibility = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isDashboardActive]);

  const handleRefresh = () => {
    setRefreshing(true);
    onRefresh?.();
    refreshTimeoutRef.current = setTimeout(() => setRefreshing(false), 1000);
  };

  // T3-FE-018: Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, []);

  const userRole = session?.role || '';
  const roleColor = userRole === 'admin' ? 'text-primary' : userRole === 'technician' ? 'text-cyan-400' : 'text-muted-foreground';

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-lg h-14 shrink-0">
      <div className="flex items-center justify-between h-full px-4 lg:px-6">
        {/* Left spacer for mobile menu */}
        <div className="flex items-center gap-3 ml-12 lg:ml-0">
          {/* User Role Badge (desktop only) */}
          {session?.name && (
            <Badge
              variant="outline"
              className={cn(
                'hidden lg:flex items-center gap-1 text-[10px] px-2 py-0 font-medium capitalize',
                userRole === 'admin'
                  ? 'border-primary/30 text-primary bg-primary/5'
                  : userRole === 'technician'
                    ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5'
                    : 'border-border/50 text-muted-foreground'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', roleColor, userRole === 'admin' ? 'bg-primary' : userRole === 'technician' ? 'bg-cyan-400' : 'bg-muted-foreground')} />
              {userRole}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Alarm Badge */}
          <Link
            href="/dashboard/alarms"
            className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Alarm"
          >
            <Bell className="w-4 h-4" />
            {unackCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center px-1">
                {unackCount > 9 ? '9+' : unackCount}
              </span>
            )}
          </Link>

          {/* Connection Status */}
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 px-3 py-1 text-xs font-normal',
              isConnected
                ? 'border-primary/30 text-primary bg-primary/5'
                : 'border-red-500/30 text-red-400 bg-red-500/5'
            )}
          >
            {isConnected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">{isConnected ? 'Tersambung' : 'Terputus'}</span>
          </Badge>

          {/* Last Updated */}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden md:block">
              Update {lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Refresh data"
            title="Refresh data"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>

          {/* User */}
          {session?.name && (
            <div className="flex items-center gap-2 pl-2 border-l border-border/50">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-xs font-medium text-primary">
                  {session.name?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <span className="text-sm hidden sm:inline max-w-[120px] truncate">{session.name}</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
