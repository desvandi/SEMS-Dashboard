'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[SEMS Route Error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="glass-card rounded-xl p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Terjadi Kesalahan</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Halaman mengalami error yang tidak terduga. Silakan coba lagi atau kembali ke dashboard.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-border/50"
            onClick={reset}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Coba Lagi
          </Button>
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="gap-2 border-border/50">
              <Home className="w-3.5 h-3.5" />
              Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
