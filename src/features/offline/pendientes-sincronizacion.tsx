"use client";

import { AlertTriangle, CloudOff, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatearFechaHora } from "@/lib/utils";

import { descartar, listarCola, reintentar, sincronizarCola } from "./cola";
import { CANAL_COLA, type OperacionCola } from "./db";

/**
 * "Pendientes de sincronización": lo hecho sin señal que todavía no llegó al
 * servidor, y lo que el servidor RECHAZÓ (con el motivo). Nada se descarta
 * solo: una rechazada queda acá hasta que alguien la reintenta o la descarta.
 */
export function PendientesSincronizacion({ onCambio }: { onCambio?: () => void }) {
  const [ops, setOps] = useState<OperacionCola[]>([]);
  const [sincronizando, setSincronizando] = useState(false);

  const cargar = useCallback(async () => {
    setOps(await listarCola());
    onCambio?.();
  }, [onCambio]);

  useEffect(() => {
    void cargar();
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL_COLA);
      canal.onmessage = () => void cargar();
    } catch {
      /* sin BroadcastChannel */
    }
    const t = setInterval(() => void cargar(), 5000);
    return () => {
      canal?.close();
      clearInterval(t);
    };
  }, [cargar]);

  async function sincronizar() {
    setSincronizando(true);
    await sincronizarCola();
    setSincronizando(false);
    await cargar();
  }

  if (ops.length === 0) return null;
  const pendientes = ops.filter((o) => o.estado !== "RECHAZADA").length;
  return (
    <section
      id="pendientes"
      aria-label="Pendientes de sincronización"
      className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <CloudOff className="text-muted size-5" aria-hidden /> Pendientes de sincronización
        </h2>
        {pendientes > 0 && (
          <Button size="sm" variant="secondary" onClick={sincronizar} loading={sincronizando}>
            <RefreshCw /> Sincronizar ahora
          </Button>
        )}
      </header>
      <ul className="flex flex-col gap-2">
        {ops.map((o) => (
          <li
            key={o.idOperacion}
            data-estado={o.estado}
            className={`rounded-xl border p-3 text-sm ${o.estado === "RECHAZADA" ? "border-danger/40 bg-danger-soft/40" : "border-border"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{o.resumen}</p>
                <p className="text-muted text-xs">
                  {formatearFechaHora(o.creadaEn)} ·{" "}
                  <span className="font-mono">{o.idOperacion.slice(0, 8)}</span> ·{" "}
                  {o.estado === "RECHAZADA"
                    ? "Rechazada"
                    : o.estado === "ENVIANDO"
                      ? "Enviando…"
                      : "Esperando señal"}
                </p>
              </div>
              {o.estado === "RECHAZADA" && (
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void reintentar(o.idOperacion).then(cargar)}
                    title="Reintentar como operación nueva"
                  >
                    <RotateCcw /> Reintentar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => void descartar(o.idOperacion).then(cargar)}
                    aria-label="Descartar"
                  >
                    <Trash2 />
                  </Button>
                </span>
              )}
            </div>
            {o.motivo && (
              <p
                className="text-danger mt-2 flex items-start gap-1.5 text-xs"
                data-testid="motivo-rechazo"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {o.motivo}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
