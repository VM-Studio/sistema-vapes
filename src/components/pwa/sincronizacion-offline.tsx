"use client";

import { Modulo } from "@prisma/client";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { usePuede, useUsuario } from "@/components/layout/usuario-context";
import { useToast } from "@/components/ui/toast";
import {
  INTERVALO_CATALOGO_MS,
  infoCatalogo,
  sincronizarCatalogo,
} from "@/features/offline/catalogo";
import { contarCola, sincronizarCola, pedirBackgroundSync } from "@/features/offline/cola";
import { CANAL_COLA, type MetaCatalogo, type PermisosOffline } from "@/features/offline/db";
import { EVENTO_CATALOGO_DESACTUALIZADO } from "@/features/scanner/resolver-codigo";
import { cn } from "@/lib/utils";

/**
 * Mantiene el modo sin conexión al día mientras la app está abierta:
 *  - catálogo offline al iniciar sesión, cada 15 min con red y cuando algo
 *    cambió el stock (si no cambió nada, el servidor responde 304);
 *  - cola del escáner: se envía al volver la red (evento `online` +
 *    Background Sync) y con polling de respaldo cada 30 s mientras haya pendientes.
 */
interface EstadoOffline {
  online: boolean;
  pendientes: number;
  rechazadas: number;
  catalogo: MetaCatalogo | null;
  sincronizarAhora: () => Promise<void>;
  refrescar: () => Promise<void>;
}

const Contexto = createContext<EstadoOffline | null>(null);

export function useEstadoOffline(): EstadoOffline {
  const c = useContext(Contexto);
  if (!c) throw new Error("useEstadoOffline fuera de SincronizacionOffline");
  return c;
}

export function SincronizacionOffline({ children }: { children: ReactNode }) {
  const usuario = useUsuario();
  const toast = useToast();
  const permisos: PermisosOffline = {
    ingresar: usePuede(Modulo.MOVIMIENTOS, "crear"),
    contar: usePuede(Modulo.MOVIMIENTOS, "editar"),
    transferir: usePuede(Modulo.MOVIMIENTOS, "crear"),
    completar: usePuede(Modulo.MOVIMIENTOS, "editar"),
  };
  const permisosRef = useRef(permisos);
  permisosRef.current = permisos;
  const [online, setOnline] = useState(true);
  const [cola, setCola] = useState({ pendientes: 0, rechazadas: 0 });
  const [catalogo, setCatalogo] = useState<MetaCatalogo | null>(null);

  const refrescar = useCallback(async () => {
    setCola(await contarCola());
    setCatalogo(await infoCatalogo());
  }, []);

  const actualizarCatalogo = useCallback(async () => {
    // Con el cambio de contraseña pendiente la API responde 403: se espera a que lo cambie.
    if (!navigator.onLine || usuario.debeCambiarPassword) return;
    await sincronizarCatalogo({
      id: usuario.id,
      nombre: usuario.nombre,
      permisos: permisosRef.current,
    });
    setCatalogo(await infoCatalogo());
  }, [usuario.id, usuario.nombre, usuario.debeCambiarPassword]);

  const sincronizarAhora = useCallback(async () => {
    if (!navigator.onLine || usuario.debeCambiarPassword) return;
    const r = await sincronizarCola();
    await refrescar();
    if (r.aplicadas > 0) {
      toast.success(`Se sincronizaron ${r.aplicadas} operación(es) hechas sin conexión`);
      await actualizarCatalogo();
    }
    if (r.rechazadas > 0)
      toast.error(
        `${r.rechazadas} operación(es) rechazadas al sincronizar`,
        "Revisalas en Escanear → Pendientes.",
      );
  }, [actualizarCatalogo, refrescar, toast, usuario.debeCambiarPassword]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refrescar();
    // La descarga del catálogo (y su escritura en IndexedDB) espera a que la
    // página esté ociosa: no compite con la primera carga ni con la interacción.
    const inicial = () => void actualizarCatalogo().then(() => sincronizarAhora());
    const hayIdle = "requestIdleCallback" in window; // Safari no lo tiene
    const idle = hayIdle ? window.requestIdleCallback(inicial, { timeout: 5000 }) : null;
    const espera = hayIdle ? null : setTimeout(inicial, 3000);
    const alVolver = () => {
      setOnline(true);
      void pedirBackgroundSync();
      void sincronizarAhora().then(actualizarCatalogo);
    };
    const alIrse = () => setOnline(false);
    const desactualizado = () => void actualizarCatalogo();
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alIrse);
    window.addEventListener(EVENTO_CATALOGO_DESACTUALIZADO, desactualizado);
    const periodico = setInterval(() => void actualizarCatalogo(), INTERVALO_CATALOGO_MS);
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL_COLA);
      canal.onmessage = () => void refrescar();
    } catch {
      /* sin BroadcastChannel */
    }
    const deSw = (e: MessageEvent) => {
      if ((e.data as { tipo?: string })?.tipo === "cola-sincronizada") void refrescar();
    };
    navigator.serviceWorker?.addEventListener("message", deSw);
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alIrse);
      window.removeEventListener(EVENTO_CATALOGO_DESACTUALIZADO, desactualizado);
      clearInterval(periodico);
      if (espera) clearTimeout(espera);
      if (idle !== null) window.cancelIdleCallback(idle);
      canal?.close();
      navigator.serviceWorker?.removeEventListener("message", deSw);
    };
  }, [actualizarCatalogo, refrescar, sincronizarAhora]);

  // Polling de respaldo (Safari/iOS no tiene Background Sync).
  useEffect(() => {
    if (cola.pendientes === 0 || !online) return;
    const t = setInterval(() => void sincronizarAhora(), 30_000);
    return () => clearInterval(t);
  }, [cola.pendientes, online, sincronizarAhora]);

  const valor = useMemo(
    () => ({ online, ...cola, catalogo, sincronizarAhora, refrescar }),
    [online, cola, catalogo, sincronizarAhora, refrescar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Punto verde/gris + operaciones pendientes (barra superior y sidebar). */
export function IndicadorRed({ className }: { className?: string }) {
  const { online, pendientes, rechazadas } = useEstadoOffline();
  const total = pendientes + rechazadas;
  return (
    <Link
      href="/escanear#pendientes"
      data-testid="indicador-red"
      data-online={online ? "1" : "0"}
      aria-label={`${online ? "Con conexión" : "Sin conexión"}${total ? ` · ${total} operación(es) sin sincronizar` : ""}`}
      title={online ? "Con conexión" : "Sin conexión: el escáner sigue funcionando"}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-medium",
        className,
      )}
    >
      <span
        className={cn("size-2.5 rounded-full", online ? "bg-success" : "bg-muted")}
        aria-hidden
      />
      {!online && <span className="text-muted">Sin red</span>}
      {total > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 tabular-nums",
            rechazadas
              ? "bg-danger-soft text-danger-soft-foreground"
              : "bg-warning-soft text-warning-soft-foreground",
          )}
        >
          {total}
        </span>
      )}
    </Link>
  );
}
