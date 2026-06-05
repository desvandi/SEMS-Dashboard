'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Zap,
  Shield,
  BarChart3,
  Wifi,
  Battery,
  Sun,
  ChevronRight,
  Activity,
} from 'lucide-react';

const features = [
  {
    icon: <Activity className="w-8 h-8" />,
    title: 'Real-Time Monitoring',
    description: 'Live telemetry data with 10-second refresh. Monitor battery voltage, current, power, and cell health in real time.',
  },
  {
    icon: <Battery className="w-8 h-8" />,
    title: 'Battery Management',
    description: 'Individual cell voltage monitoring with color-coded health indicators. SOC tracking with precision accuracy.',
  },
  {
    icon: <Zap className="w-8 h-8" />,
    title: 'Smart Automation',
    description: 'Rule-based automation engine for load management. Automatic load shedding during low battery conditions.',
  },
  {
    icon: <Shield className="w-8 h-8" />,
    title: 'Safety First',
    description: 'Over-voltage, over-current, and low-battery protection with instant email alerts and alarm system.',
  },
  {
    icon: <Wifi className="w-8 h-8" />,
    title: 'IoT Connected',
    description: 'ESP32-based hardware with WiFi connectivity. Remote monitoring from anywhere via web dashboard.',
  },
  {
    icon: <BarChart3 className="w-8 h-8" />,
    title: 'Analytics & History',
    description: 'Historical data storage with 30-day telemetry history. Trend analysis and performance optimization.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Sun className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Jambi Solar Panel</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">PT. Jaya Mandiri Smart Energy</p>
              </div>
            </div>
            <Link href="/login">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Login Dashboard
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-cyan-500/5" />
        <div className="absolute top-20 right-10 w-72 h-72 bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px]" />

        <div className="max-w-7xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-8">
              <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
              Smart Energy Management System
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              <span className="gradient-text">Monitor Your Solar</span>
              <br />
              <span className="text-foreground">Energy in Real Time</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Advanced IoT-based solar energy monitoring with 8-cell battery management,
              intelligent load control, and automated safety protection for your home or business.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/login">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto text-base px-8 py-6">
                  <Zap className="w-5 h-5 mr-2" />
                  Open Dashboard
                </Button>
              </Link>
              <Link href="#features">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 py-6 border-border/50 hover:bg-accent">
                  Learn More
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 max-w-4xl mx-auto"
          >
            {[
              { label: 'Battery Cells', value: '8', unit: 'LiFePO4' },
              { label: 'Relay Channels', value: '8', unit: 'Controllable' },
              { label: 'Sensors', value: '4', unit: 'PIR Motion' },
              { label: 'Refresh Rate', value: '10s', unit: 'Live Data' },
            ].map((stat) => (
              <div key={stat.label} className="glass-card rounded-xl p-4 text-center">
                <div className="text-2xl sm:text-3xl font-bold gradient-text">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                <div className="text-xs text-primary">{stat.unit}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Complete Solar Energy <span className="gradient-text">Management</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Built with ESP32 microcontroller and Google Apps Script backend for reliable, always-on monitoring.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass-card rounded-xl p-6 hover:border-primary/30 transition-colors group"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary group-hover:bg-primary/20 transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard Preview Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Powerful <span className="gradient-text">Dashboard</span> Interface
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Monitor and control your entire solar energy system from one intuitive interface.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="relative"
          >
            {/* Glow effect behind dashboard mockup */}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/10 via-transparent to-transparent blur-3xl" />
            
            {/* Dashboard mockup frame */}
            <div className="relative glass-card rounded-2xl p-1 overflow-hidden border border-border/30">
              {/* Browser chrome bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-muted/20">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <div className="flex-1 mx-4">
                  <div className="bg-muted/50 rounded-md px-3 py-1 text-[11px] text-muted-foreground text-center">
                    sems.jambisolarpanel.com/dashboard
                  </div>
                </div>
              </div>
              
              {/* Dashboard content mockup */}
              <div className="p-4 sm:p-6 space-y-4">
                {/* Top bar mockup */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center">
                      <Sun className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="h-3 w-24 bg-muted/50 rounded" />
                  </div>
                  <div className="flex gap-2">
                    <div className="h-6 w-16 bg-muted/30 rounded-full" />
                    <div className="h-6 w-12 bg-primary/20 rounded" />
                  </div>
                </div>
                
                {/* Stat cards mockup */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Battery', value: '26.4V', color: 'text-primary' },
                    { label: 'SOC', value: '85%', color: 'text-emerald-400' },
                    { label: 'Current', value: '12.3A', color: 'text-cyan-400' },
                    { label: 'Power', value: '325W', color: 'text-amber-400' },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-muted/20 rounded-xl p-3 border border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-1">{stat.label}</div>
                      <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                    </div>
                  ))}
                </div>
                
                {/* Chart area mockup */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-muted/10 rounded-xl p-4 border border-border/20">
                    <div className="h-3 w-28 bg-muted/40 rounded mb-4" />
                    {/* Fake chart bars */}
                    <div className="flex items-end gap-1.5 h-24">
                      {[65, 45, 80, 55, 70, 40, 75, 60, 85, 50, 70, 90].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm bg-primary/30" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                  <div className="bg-muted/10 rounded-xl p-4 border border-border/20">
                    <div className="h-3 w-28 bg-muted/40 rounded mb-4" />
                    {/* Fake line chart */}
                    <div className="h-24 flex items-end">
                      <svg viewBox="0 0 200 100" className="w-full h-full" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        <path d="M0,60 Q25,30 50,45 T100,25 T150,50 T200,20 V100 H0 Z" fill="url(#lineGrad)" />
                        <path d="M0,60 Q25,30 50,45 T100,25 T150,50 T200,20" fill="none" stroke="#10b981" strokeWidth="2" />
                      </svg>
                    </div>
                  </div>
                </div>
                
                {/* Bottom row */}
                <div className="bg-muted/10 rounded-xl p-4 border border-border/20">
                  <div className="h-3 w-28 bg-muted/40 rounded mb-3" />
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="aspect-square rounded-lg bg-muted/30 border border-border/10 flex items-center justify-center">
                        <div className={`w-2 h-2 rounded-full ${i < 5 ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Call to action */}
            <div className="text-center mt-10">
              <Link href="/login">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                  <Zap className="w-5 h-5" />
                  Mulai Monitoring Sekarang
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sun className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">Jambi Solar Panel</span>
          </div>
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} PT. Jaya Mandiri Smart Energy. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
