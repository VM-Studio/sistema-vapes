"use client";

import { useSerwist } from "@serwist/turbopack/react";
import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Actualización a la última versión desplegada. Una pestaña (o la app
 * instalada) puede quedar abierta días con el código viejo: Next navega sin
 * recargar y el navegador solo busca service worker nuevo al cargar la página.
 * Por eso:
 *  - Se compara la versión propia (NEXT_PUBLIC_APP_VERSION) con /api/version
 *    al volver a la app, al recuperar la red y cada 5 minutos; de paso se le
 *    pide al navegador que busque un service worker nuevo.
 *  - Con versión nueva, se aplica SOLA en el próximo cambio de pantalla (ahí no
 *    hay nada a medio escribir) y además se muestra el aviso con "Actualizar".
 *  - NUNCA en medio de una venta o de una sesión de escaneo con productos
 *    cargados: ahí se pospone hasta que el carrito quede vacío.
 */
/** Prefijos de lo que queda guardado mientras hay una operación a medio hacer (por panel y usuario). */
const EN_CURSO = ["ventas.enCurso.", "carga-stock.lista."];

const VERSION_PROPIA = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const CADA_MS = 5 * 60_000;
/** Para no recargar en bucle si el servidor sigue informando otra versión. */
const CLAVE_INTENTO = "app.actualizacion.intento";

export function hayOperacionEnCurso(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !EN_CURSO.some((p) => k.startsWith(p))) continue;
      const d = JSON.parse(localStorage.getItem(k) ?? "null") as { items?: unknown[] } | null;
      if (Array.isArray(d?.items) && d.items.length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function AvisoActualizacion() {
  const { serwist } = useSerwist();
  const pathname = usePathname();
  /** SW nuevo esperando o deploy nuevo detectado por /api/version. */
  const [swEsperando, setSwEsperando] = useState(false);
  const [versionNueva, setVersionNueva] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const hayNueva = swEsperando || versionNueva !== null;
  // Solo se recarga por "controlling" si la actualización la pedimos nosotros: la
  // primera instalación del service worker también lo dispara (clients.claim).
  const pedida = useRef(false);
  const pathPrevio = useRef(pathname);

  useEffect(() => {
    if (!serwist) return;
    const alEsperar = () => setSwEsperando(true);
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

  // Chequeo de versión: al volver a la app, al recuperar la red y cada 5 min.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || VERSION_PROPIA === "dev") return;
    let ultimo = 0;
    const revisar = async () => {
      if (document.visibilityState !== "visible" || Date.now() - ultimo < 30_000) return;
      ultimo = Date.now();
      void serwist?.update().catch(() => {});
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (version && version !== "dev" && version !== VERSION_PROPIA) setVersionNueva(version);
      } catch {
        /* sin red: se vuelve a intentar más tarde */
      }
    };
    const alVolver = () => void revisar();
    const t = setInterval(alVolver, CADA_MS);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener("online", alVolver);
    void revisar();
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("online", alVolver);
    };
  }, [serwist]);

  // Mientras hay una venta en curso, se revisa cada 5 s para habilitar el botón al terminar.
  useEffect(() => {
    if (!hayNueva) return;
    const revisar = () => setEnCurso(hayOperacionEnCurso());
    revisar();
    const t = setInterval(revisar, 5000);
    window.addEventListener("storage", revisar);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", revisar);
    };
  }, [hayNueva]);

  const actualizar = useCallback(() => {
    if (hayOperacionEnCurso()) return setEnCurso(true);
    pedida.current = true;
    if (swEsperando && serwist) {
      serwist.messageSkipWaiting(); // → "controlling" → recarga
      // Por si el SW no llega a tomar el control: recargar igual.
      setTimeout(() => window.location.reload(), 3000);
    } else {
      window.location.reload();
    }
  }, [serwist, swEsperando]);

  // Automática: en el próximo cambio de pantalla, si no hay nada en curso.
  // Una sola vez por versión destino (si el servidor sigue informando otra, queda el aviso).
  useEffect(() => {
    const navego = pathname !== pathPrevio.current;
    pathPrevio.current = pathname;
    if (!hayNueva || !navego || hayOperacionEnCurso()) return;
    const destino = versionNueva ?? "sw";
    try {
      if (sessionStorage.getItem(CLAVE_INTENTO) === destino) return;
      sessionStorage.setItem(CLAVE_INTENTO, destino);
    } catch {
      /* sin sessionStorage: se actualiza igual */
    }
    actualizar();
  }, [pathname, hayNueva, versionNueva, actualizar]);

  if (!hayNueva) return null;
  return (
    <div
      role="status"
      className="border-border bg-surface rounded-card shadow-pop fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-3 border p-3 md:inset-x-auto md:right-6 md:bottom-6 md:max-w-sm"
    >
      <RefreshCw className="text-foreground size-5 shrink-0" strokeWidth={1.75} aria-hidden />
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
