"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { usePanel } from "@/components/layout/panel-context";
import { useUsuario } from "@/components/layout/usuario-context";
import {
  INTERVALO_CATALOGO_MS,
  infoCatalogo,
  sincronizarCatalogo,
} from "@/features/offline/catalogo";
import type { MetaCatalogo } from "@/features/offline/db";
import { EVENTO_CATALOGO_DESACTUALIZADO } from "@/features/scanner/resolver-codigo";
import { cn } from "@/lib/utils";

/**
 * Mantiene al día el catálogo offline DEL PANEL ACTUAL mientras la app está
 * abierta: al entrar al panel, cada 15 min con red y cuando algo cambió el
 * stock (si no cambió nada, el servidor responde 304). Es solo de lectura:
 * sin señal el escáner consulta; no se guardan operaciones para después.
 */
interface EstadoOffline {
  online: boolean;
  /** Catálogo guardado de este panel (null si todavía no se bajó). */
  catalogo: MetaCatalogo | null;
  actualizarCatalogo: () => Promise<void>;
}

const Contexto = createContext<EstadoOffline | null>(null);

export function useEstadoOffline(): EstadoOffline {
  const c = useContext(Contexto);
  if (!c) throw new Error("useEstadoOffline fuera de SincronizacionOffline");
  return c;
}

export function SincronizacionOffline({ children }: { children: ReactNode }) {
  const usuario = useUsuario();
  const panel = usePanel();
  const [online, setOnline] = useState(true);
  const [catalogo, setCatalogo] = useState<MetaCatalogo | null>(null);

  const actualizarCatalogo = useCallback(async () => {
    // Con el cambio de contraseña pendiente la API responde 403: se espera a que lo cambie.
    if (!navigator.onLine || usuario.debeCambiarPassword) return;
    await sincronizarCatalogo(
      { id: panel.id, slug: panel.slug, nombre: panel.nombre },
      { id: usuario.id, nombre: usuario.nombre },
    );
    setCatalogo(await infoCatalogo(panel.id));
  }, [panel.id, panel.slug, panel.nombre, usuario.id, usuario.nombre, usuario.debeCambiarPassword]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void infoCatalogo(panel.id).then(setCatalogo);
    // La descarga del catálogo (y su escritura en IndexedDB) espera a que la
    // página esté ociosa: no compite con la primera carga ni con la interacción.
    const inicial = () => void actualizarCatalogo();
    const hayIdle = "requestIdleCallback" in window; // Safari no lo tiene
    const idle = hayIdle ? window.requestIdleCallback(inicial, { timeout: 5000 }) : null;
    const espera = hayIdle ? null : setTimeout(inicial, 3000);
    const alVolver = () => {
      setOnline(true);
      void actualizarCatalogo();
    };
    const alIrse = () => setOnline(false);
    const desactualizado = () => void actualizarCatalogo();
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alIrse);
    window.addEventListener(EVENTO_CATALOGO_DESACTUALIZADO, desactualizado);
    const periodico = setInterval(() => void actualizarCatalogo(), INTERVALO_CATALOGO_MS);
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alIrse);
      window.removeEventListener(EVENTO_CATALOGO_DESACTUALIZADO, desactualizado);
      clearInterval(periodico);
      if (espera) clearTimeout(espera);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, [actualizarCatalogo, panel.id]);

  const valor = useMemo(
    () => ({ online, catalogo, actualizarCatalogo }),
    [online, catalogo, actualizarCatalogo],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Punto verde/gris de conexión (barra superior y sidebar). */
export function IndicadorRed({ className }: { className?: string }) {
  const { online } = useEstadoOffline();
  return (
    <span
      role="status"
      data-testid="indicador-red"
      data-online={online ? "1" : "0"}
      aria-label={online ? "Con conexión" : "Sin conexión"}
      title={online ? "Con conexión" : "Sin conexión: el escáner solo puede consultar"}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-control px-2 text-xs font-medium",
        className,
      )}
    >
      <span
        className={cn("size-2.5 rounded-circle", online ? "bg-success" : "bg-muted")}
        aria-hidden
      />
      {!online && <span className="text-muted">Sin red</span>}
    </span>
  );
}
