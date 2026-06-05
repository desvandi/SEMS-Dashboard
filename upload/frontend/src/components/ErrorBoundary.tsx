'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SEMS ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="glass-card rounded-xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Terjadi Kesalahan</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Komponen mengalami error yang tidak terduga.
            </p>
            {/* P2-XSS-02: Show generic message instead of raw error.message */}
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 mb-4 font-mono break-all text-left">
              Terjadi kesalahan internal. Silakan coba lagi atau hubungi administrator.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-border/50"
                onClick={this.handleReset}
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

    return this.props.children;
  }
}
