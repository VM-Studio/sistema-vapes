"use client";

import { useSerwist } from "@serwist/turbopack/react";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * "Hay una versión nueva": el service worker nuevo queda esperando y el
 * usuario elige cuándo actualizar. NUNCA en medio de una venta o de una
 * sesión de escaneo con productos cargados: ahí se pospone hasta que el
 * carrito quede vacío.
 */
const CARRITOS = ["pos.carrito", "escanear.sesion"];

export function hayOperacionEnCurso(): boolean {
  try {
    return CARRITOS.some((k) => {
      const v = localStorage.getItem(k);
      if (!v) return false;
      const d = JSON.parse(v) as { items?: unknown[] };
      return Array.isArray(d.items) && d.items.length > 0;
    });
  } catch {
    return false;
  }
}

export function AvisoActualizacion() {
  const { serwist } = useSerwist();
  const [esperando, setEsperando] = useState(false);
  const [enCurso, setEnCurso] = useState(false);
  // Solo se recarga si el usuario tocó "Actualizar": la primera instalación del
  // service worker también dispara "controlling" (clients.claim) y ahí no hay que recargar nada.
  const pedida = useRef(false);

  useEffect(() => {
    if (!serwist) return;
    const alEsperar = () => setEsperando(true);
    const alControlar = () => {
      if (pedida.current) window.location.reload();
    };
    serwist.addEventListener("waiting", alEsperar);
    serwist.addEventListener("controlling", alControlar);
    return () => {
      serwist.removeEventListener("waiting", alEsperar);
      serwist.removeEventListener("controlling", alControlar);
    };
  }, [serwist]);

  // Mientras hay una venta en curso, se revisa cada 5 s para habilitar el botón al terminar.
  useEffect(() => {
    if (!esperando) return;
    const revisar = () => setEnCurso(hayOperacionEnCurso());
    revisar();
    const t = setInterval(revisar, 5000);
    window.addEventListener("storage", revisar);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", revisar);
    };
  }, [esperando]);

  const actualizar = useCallback(() => {
    if (hayOperacionEnCurso()) return setEnCurso(true);
    pedida.current = true;
    serwist?.messageSkipWaiting(); // → "controlling" → recarga
  }, [serwist]);

  if (!esperando) return null;
  return (
    <div
      role="status"
      className="border-border bg-surface fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-3 rounded-xl border p-3 shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:max-w-sm"
    >
      <RefreshCw className="text-primary size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <strong className="block">Hay una versión nueva</strong>
        <span className="text-muted">
          {enCurso ? "Terminá la venta en curso y actualizá." : "Actualizá para usar lo último."}
        </span>
      </p>
      <Button size="sm" onClick={actualizar} disabled={enCurso}>
        Actualizar
      </Button>
    </div>
  );
}
