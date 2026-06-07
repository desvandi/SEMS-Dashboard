'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * FE-060 FIX: exit animation requires AnimatePresence wrapper around this
 * component's parent. Without AnimatePresence, the exit prop has no effect.
 * Wrap usage with <AnimatePresence mode="wait"> in layout.tsx or page files
 * that need exit animations.
 */
export function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}
