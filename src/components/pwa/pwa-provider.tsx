"use client";

import { SerwistProvider, useSerwist } from "@serwist/turbopack/react";
import { useEffect, type ReactNode } from "react";

/**
 * Service worker /serwist/sw.js (solo en producción: en dev interferiría con
 * el hot reload). Se registra DESPUÉS de que la página cargó y en un momento
 * ocioso: el precache del shell (varios MB) no compite con la primera carga.
 * No recarga sola al volver online: la app decide.
 */
function RegistrarCuandoCargue() {
  const { serwist } = useSerwist();
  useEffect(() => {
    if (!serwist) return;
    const registrar = () => {
      if ("requestIdleCallback" in window)
        window.requestIdleCallback(() => void serwist.register(), { timeout: 5000 });
      else setTimeout(() => void serwist.register(), 2000);
    };
    if (document.readyState === "complete") registrar();
    else window.addEventListener("load", registrar, { once: true });
    return () => window.removeEventListener("load", registrar);
  }, [serwist]);
  return null;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      register={false}
      reloadOnOnline={false}
      cacheOnNavigation={false}
      options={{ scope: "/" }}
    >
      <RegistrarCuandoCargue />
      {children}
    </SerwistProvider>
  );
}
