"use client";

import type { TipoNotificacion } from "@prisma/client";
import {
  AlertTriangle,
  CheckCheck,
  DatabaseBackup,
  PackageX,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn, formatearFechaHora } from "@/lib/utils";

import { marcarLeidaAction, marcarTodasLeidasAction } from "./actions";

const ICONO: Record<TipoNotificacion, typeof Truck> = {
  STOCK_BAJO: AlertTriangle,
  SIN_STOCK: PackageX,
  CAJA_DIFERENCIA: Wallet,
  TRANSFERENCIA_PENDIENTE: Truck,
  DEUDA_CLIENTE: Users,
  BACKUP_FALLIDO: DatabaseBackup,
};

interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  leida: boolean;
  fecha: Date;
  href: string | null;
}

export function ListaNotificaciones({ notificaciones }: { notificaciones: Notificacion[] }) {
  const router = useRouter();
  const toast = useToast();
  const [marcando, setMarcando] = useState(false);
  const sinLeer = notificaciones.filter((n) => !n.leida).length;

  async function abrir(n: Notificacion) {
    if (!n.leida) await marcarLeidaAction({ id: n.id });
    if (n.href) router.push(n.href);
    else router.refresh();
  }

  async function todas() {
    setMarcando(true);
    const r = await marcarTodasLeidasAction();
    setMarcando(false);
    if (!r.ok) return toast.error("No se pudo", r.error.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted text-sm">{sinLeer ? `${sinLeer} sin leer` : "Todo leído"}</p>
        {sinLeer > 0 && (
          <Button variant="secondary" size="sm" onClick={todas} loading={marcando}>
            <CheckCheck /> Marcar todas como leídas
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {notificaciones.map((n) => {
          const Icono = ICONO[n.tipo];
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => abrir(n)}
                className={cn(
                  "border-border hover:border-primary/40 flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                  n.leida ? "bg-surface" : "bg-primary-soft/40",
                )}
              >
                <Icono
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    n.tipo === "SIN_STOCK" ||
                      n.tipo === "CAJA_DIFERENCIA" ||
                      n.tipo === "BACKUP_FALLIDO"
                      ? "text-danger"
                      : "text-muted",
                  )}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-sm", !n.leida && "font-semibold")}>{n.titulo}</span>
                  <span className="text-muted text-sm">{n.mensaje}</span>
                  <span className="text-muted text-xs">{formatearFechaHora(n.fecha)}</span>
                </span>
                {!n.leida && (
                  <span
                    className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                    aria-label="Sin leer"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
