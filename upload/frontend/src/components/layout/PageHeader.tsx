'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}

// ── Breadcrumb path map ──
const PATH_MAP: Record<string, string> = {
  '/dashboard': 'Live Overview',
  '/dashboard/devices': 'Perangkat',
  '/dashboard/devices/mapping': 'Device Mapping',
  '/dashboard/alarms': 'Alarm',
  '/dashboard/automation': 'Otomatisasi',
  '/dashboard/schedules': 'Jadwal',
  '/dashboard/load-shedding': 'Load Shedding',
  '/dashboard/analytics': 'Analitik',
  '/dashboard/history': 'Riwayat',
  '/dashboard/battery-health': 'Kesehatan Baterai',
  '/dashboard/logs': 'Log Event',
  '/dashboard/notifications': 'Notifikasi',
  '/dashboard/users': 'Pengguna',
  '/dashboard/settings': 'Pengaturan',
};

export function PageHeader({
  title,
  subtitle,
  icon,
  breadcrumbs: customBreadcrumbs,
  actions,
  badge,
}: PageHeaderProps) {
  const pathname = usePathname();

  // Auto-generate breadcrumbs from pathname if not provided
  const breadcrumbs: BreadcrumbItem[] = customBreadcrumbs || (() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length <= 1) return [];

    const items: BreadcrumbItem[] = [];
    let currentPath = '';
    for (let i = 0; i < segments.length - 1; i++) {
      currentPath += `/${segments[i]}`;
      const label = PATH_MAP[currentPath];
      if (label) {
        items.push({ label, href: currentPath });
      }
    }
    // Current page (no link)
    const currentPageLabel = PATH_MAP[pathname] || title;
    items.push({ label: currentPageLabel });

    return items;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 lg:mb-6"
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Icon */}
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5 flex-wrap">
              <Link
                href="/dashboard"
                className="hover:text-foreground transition-colors flex items-center gap-0.5"
              >
                <Home className="w-3 h-3" />
              </Link>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 opacity-50" />
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-foreground transition-colors truncate max-w-[120px]"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-foreground font-medium truncate">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
          {/* Title & Subtitle */}
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold truncate">{title}</h2>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </motion.div>
  );
}
