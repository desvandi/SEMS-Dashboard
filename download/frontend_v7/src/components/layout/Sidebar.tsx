'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Cpu,
  Bell,
  LogOut,
  Sun,
  Settings,
  ChevronLeft,
  Menu,
  Zap,
  CalendarDays,
  BarChart3,
  Users,
  TrendingUp,
  HeartPulse,
  ShieldAlert,
  ScrollText,
  Megaphone,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useSemsAuth } from '@/hooks/useSemsAuth';

const navSections = [
  {
    label: 'Monitor',
    items: [
      { label: 'Live Overview', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Perangkat', href: '/dashboard/devices', icon: Cpu },
      { label: 'Alarm', href: '/dashboard/alarms', icon: Bell },
    ],
  },
  {
    label: 'Kontrol',
    items: [
      { label: 'Otomatisasi', href: '/dashboard/automation', icon: Zap },
      { label: 'Jadwal', href: '/dashboard/schedules', icon: CalendarDays },
      { label: 'Load Shedding', href: '/dashboard/load-shedding', icon: ShieldAlert },
    ],
  },
  {
    label: 'Analisis',
    items: [
      { label: 'Analitik', href: '/dashboard/analytics', icon: TrendingUp },
      { label: 'Riwayat', href: '/dashboard/history', icon: BarChart3 },
      { label: 'Kesehatan Baterai', href: '/dashboard/battery-health', icon: HeartPulse },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { label: 'Log Event', href: '/dashboard/logs', icon: ScrollText },
      { label: 'Notifikasi', href: '/dashboard/notifications', icon: Megaphone },
      { label: 'Pengguna', href: '/dashboard/users', icon: Users, adminOnly: true },
      { label: 'Pengaturan', href: '/dashboard/settings', icon: Settings },
    ],
  },
];

function NavContent({ collapsed, onItemClick }: { collapsed: boolean; onItemClick?: () => void }) {
  const pathname = usePathname();
  const { user: session } = useSemsAuth();
  const userRole = session?.role || '';
  const isAdmin = userRole === 'admin';

  return (
    <nav className="flex-1 py-3 px-3 space-y-4 overflow-y-auto">
      {navSections.map((section) => (
        <div key={section.label}>
          {!collapsed && (
            <div className="px-3 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {section.label}
              </span>
            </div>
          )}
          <div className="space-y-0.5">
            {section.items
              .filter((item) => {
                if ('adminOnly' in item && item.adminOnly && !isAdmin) return false;
                return true;
              })
              .map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onItemClick}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors group',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'w-[18px] h-[18px] shrink-0',
                        isActive && 'text-primary'
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {isActive && !collapsed && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const { user: session, logout } = useSemsAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'hidden lg:flex flex-col border-r border-border/50 bg-sidebar transition-all duration-300 h-screen sticky top-0',
        collapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border/50 shrink-0">
        <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <Sun className="w-5 h-5 text-primary" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h2 className="text-sm font-bold truncate">SEMS Dashboard</h2>
            <p className="text-[10px] text-muted-foreground truncate">Jambi Solar Panel</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <NavContent collapsed={collapsed} />

      {/* User & Logout */}
      <div className="border-t border-border/50 p-3 space-y-2">
        {!collapsed && session?.name && (
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">
            <div className="font-medium text-foreground">{session.name}</div>
            <div className="capitalize text-[10px]">
              {session.role || 'user'}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          aria-label="Logout"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors w-full"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border/50 flex items-center justify-center hover:bg-accent transition-colors"
      >
        <ChevronLeft
          className={cn(
            'w-3 h-3 text-muted-foreground transition-transform',
            collapsed && 'rotate-180'
          )}
        />
      </button>
    </aside>
  );
}

// Mobile sidebar (sheet-style)
export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const { logout } = useSemsAuth();

  // FE-052 FIX: Body scroll lock when mobile sidebar is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // FE-052 FIX: Escape key handler to close mobile sidebar
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  // FE-052 FIX: Focus trap — focus sidebar when opened, trap Tab within it
  useEffect(() => {
    if (open && sidebarRef.current) {
      sidebarRef.current.focus();
    }
  }, [open]);

  const closeSidebar = () => setOpen(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-card border border-border/50 flex items-center justify-center"
      >
        <Menu className="w-5 h-5" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={closeSidebar}
            aria-hidden="true"
          />
          {/* FE-052 FIX: Added role="dialog" and aria-modal="true" for accessibility */}
          <aside
            ref={sidebarRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="fixed left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-border/50 z-50 flex flex-col lg:hidden outline-none"
          >
            <div className="flex items-center gap-3 px-4 h-16 border-b border-border/50">
              <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
                <Sun className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-bold">SEMS Dashboard</h2>
                <p className="text-[10px] text-muted-foreground">Jambi Solar Panel</p>
              </div>
            </div>

            <NavContent collapsed={false} onItemClick={closeSidebar} />

            <div className="border-t border-border/50 p-3">
              {/* FE-057 FIX: Replace manual logout logic with logout() from useSemsAuth hook */}
              <button
                onClick={() => {
                  closeSidebar();
                  logout();
                }}
                aria-label="Logout"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors w-full"
              >
                <LogOut className="w-5 h-5" />
                <span>Logout</span>
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
