'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sun, Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[150px]" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center relative z-10 max-w-md"
      >
        {/* Brand */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-6">
          <Sun className="w-8 h-8 text-primary" />
        </div>

        {/* 404 */}
        <div className="relative mb-6">
          <h1 className="text-8xl font-bold gradient-text">404</h1>
          <div className="absolute -inset-4 bg-primary/5 rounded-full blur-[60px]" />
        </div>

        <h2 className="text-2xl font-bold mb-2">Halaman Tidak Ditemukan</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Maaf, halaman yang Anda cari tidak ada atau telah dipindahkan.
          Kembali ke dashboard untuk melanjutkan.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/dashboard">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
              <Home className="w-4 h-4" />
              Ke Dashboard
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2 border-border/50 hover:bg-accent"
            onClick={() => typeof window !== 'undefined' && window.history.back()}
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          &copy; {new Date().getFullYear()} PT. Jaya Mandiri Smart Energy
        </p>
      </motion.div>
    </div>
  );
}
