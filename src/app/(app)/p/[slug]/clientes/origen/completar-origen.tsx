"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Avatar } from "@/components/ui/avatar";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatearNumero } from "@/lib/format";
import { cn, formatearFecha } from "@/lib/utils";
import { mostrarTelefono } from "@/lib/validations/cliente";
import type { ClienteSinOrigen, OrigenCliente } from "@/server/services/cliente.service";

import { asignarOrigenesAction } from "../actions";

/**
 * Una fila por cliente con un botón por cada opción (dueños y vendedores).
 * Nada viene elegido: cada respuesta es explícita. «Guardar» manda solo las
 * respondidas; las que quedan siguen en la lista para después.
 */
export function CompletarOrigen({
  clientes,
  origenes,
}: {
  clientes: ClienteSinOrigen[];
  origenes: OrigenCliente[];
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const respondidas = useMemo(() => Object.entries(respuestas).filter(([, o]) => o), [respuestas]);

  if (clientes.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Todos los clientes tienen «¿De quién viene?»"
        description="Los clientes nuevos lo piden al darlos de alta."
        action={
          <Link href={ruta("/clientes")} className={buttonVariants({ variant: "secondary" })}>
            Volver a Clientes
          </Link>
        }
      />
    );
  }

  async function guardar() {
    setEnviando(true);
    const r = await asignarOrigenesAction({
      asignaciones: respondidas.map(([clienteId, origenId]) => ({ clienteId, origenId })),
    });
    setEnviando(false);
    if (!r.ok) return toast.error("No se pudo guardar", r.error.message);
    toast.success(
      r.data.cambiados === 1
        ? "1 cliente actualizado"
        : `${r.data.cambiados} clientes actualizados`,
    );
    setRespuestas({});
    router.refresh();
  }

  const faltan = clientes.length - respondidas.length;

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      <p className="text-muted text-sm" data-testid="conteo-sin-origen">
        {formatearNumero(clientes.length)}{" "}
        {clientes.length === 1 ? "cliente sin responder" : "clientes sin responder"}
        {respondidas.length > 0 &&
          ` · ${formatearNumero(respondidas.length)} elegidos, falta guardar`}
      </p>
      <ul
        aria-label="Clientes sin «de quién viene»"
        className="border-border bg-surface divide-border rounded-card flex flex-col divide-y border"
      >
        {clientes.map((c) => {
          const elegido = respuestas[c.id] ?? "";
          const pistas = [
            c.creadoPor && `lo cargó ${c.creadoPor}`,
            c.cartera && `en la cartera de ${c.cartera}`,
            c.compras > 0
              ? `${formatearNumero(c.compras)} ${c.compras === 1 ? "compra" : "compras"}`
              : "sin compras",
            `desde ${formatearFecha(c.createdAt)}`,
          ].filter(Boolean);
          return (
            <li
              key={c.id}
              className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
              data-testid="fila-sin-origen"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar nombre={c.nombre} />
                <div className="min-w-0">
                  <Link
                    href={ruta(`/clientes/${c.id}`)}
                    className="block truncate font-medium hover:underline"
                  >
                    {c.nombre}
                    {!c.activo && <span className="text-muted font-normal"> · desactivado</span>}
                  </Link>
                  <p className="text-muted truncate text-xs tabular-nums">
                    {mostrarTelefono(c.telefono)} · {pistas.join(" · ")}
                  </p>
                </div>
              </div>
              <div
                role="radiogroup"
                aria-label={`¿De quién viene ${c.nombre}?`}
                className="flex flex-wrap gap-2"
              >
                {origenes.map((o) => {
                  const activo = elegido === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={activo}
                      onClick={() => setRespuestas((r) => ({ ...r, [c.id]: activo ? "" : o.id }))}
                      className={cn(
                        buttonVariants({ variant: activo ? "primary" : "secondary", size: "sm" }),
                        "min-w-24",
                      )}
                    >
                      {o.nombre}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {/* En desktop queda fija abajo de la pantalla: la lista puede ser larga. */}
      <div className="max-md:contents md:sticky md:bottom-4 md:z-10 md:flex md:justify-end max-md:[&>[aria-hidden]]:hidden">
        <BarraAccion>
          <Button
            onClick={() => void guardar()}
            loading={enviando}
            disabled={respondidas.length === 0}
            data-testid="guardar-origenes"
          >
            {respondidas.length === 0
              ? "Elegí de quién viene cada cliente"
              : `Guardar ${formatearNumero(respondidas.length)}${faltan > 0 ? ` (quedan ${formatearNumero(faltan)})` : ""}`}
          </Button>
        </BarraAccion>
      </div>
    </div>
  );
}
