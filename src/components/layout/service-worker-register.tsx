"use client";

import { useEffect } from "react";

/** Registra /sw.js (solo en producción: en dev interferiría con el hot reload). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("No se pudo registrar el service worker", error);
    });
  }, []);
  return null;
}
