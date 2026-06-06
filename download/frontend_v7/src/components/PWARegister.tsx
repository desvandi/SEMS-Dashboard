"use client";

import { useEffect } from "react";

export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let updateInterval: ReturnType<typeof setInterval> | null = null;

    const registerSW = async () => {
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.register("/sw.js", {
            scope: "/",
          });

          // T3-FE-003: Store interval ID and clear on unmount
          updateInterval = setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000); // Every hour

          console.log("[PWA] Service Worker registered:", registration.scope);
        }
      } catch (error) {
        console.warn("[PWA] Service Worker registration failed:", error);
      }
    };

    // Register after page load for better performance
    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW);
    }

    // T3-FE-003: Cleanup interval on unmount
    return () => {
      if (updateInterval) clearInterval(updateInterval);
    };
  }, []);

  return null;
}
