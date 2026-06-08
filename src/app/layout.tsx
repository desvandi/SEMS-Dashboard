import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { PWARegister } from "@/components/PWARegister";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SEMS - Smart Energy Management System",
  description: "Real-time solar energy monitoring and management dashboard by PT. Jaya Mandiri Smart Energy",
  keywords: ["solar", "energy", "monitoring", "IoT", "smart energy", "Jambi", "SEMS"],
  authors: [{ name: "PT. Jaya Mandiri Smart Energy" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: "SEMS - Smart Energy Management System",
    description: "Smart Energy Management System for real-time solar monitoring",
    siteName: "SEMS",
    type: "website",
    images: [{ url: '/icon-512.png', width: 512, height: 512 }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SEMS",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "theme-color": "#0f172a",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          <ErrorBoundary>
            <PWARegister />
            {children}
          </ErrorBoundary>
          <SonnerToaster />
        </Providers>
      </body>
    </html>
  );
}
