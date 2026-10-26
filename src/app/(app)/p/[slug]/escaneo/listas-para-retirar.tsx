"use client";

import { PackageCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatearFechaHora } from "@/lib/utils";
import type { VentaParaRetirar } from "@/server/services/retiro.service";

import { BotonRetirado } from "../ventas/_componentes/retiro";

const unidades = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;

/**
 * Ventas ya escaneadas que esperan que el cliente las retire: al entregarlas,
 * «Retirado» (el stock pasa de «Escaneado» a «Retirado»).
 */
export function ListasParaRetirar({ ventas }: { ventas: VentaParaRetirar[] }) {
  if (ventas.length === 0) return null;
  return (
    <section aria-labelledby="titulo-para-retirar" className="mt-6 flex flex-col gap-3">
      <h2 id="titulo-para-retirar" className="text-h3 font-semibold">
        Listas para retirar
      </h2>
      <p className="text-muted text-small -mt-2">
        Ya las escaneaste. Cuando el cliente se las lleve, tocá «Retirado».
      </p>
      <ul aria-label="Listas para retirar" className="flex flex-col gap-3">
        {ventas.map((v) => (
          <li
            key={v.id}
            className="bg-success-soft text-success-soft-foreground rounded-card flex flex-col gap-3 p-4"
            data-testid="venta-para-retirar"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-mono text-base font-semibold">
                <PackageCheck className="size-5" strokeWidth={1.75} aria-hidden />
                {v.codigo}
              </span>
              <Badge variant="success">{unidades(v.unidades)}</Badge>
            </div>
            <p className="text-small">
              {v.cliente} · {v.vendedor} · {v.deposito}
              {v.escaneadaAt && ` · escaneada ${formatearFechaHora(v.escaneadaAt)}`}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {v.items.map((i, n) => (
                <li key={n} className="flex items-baseline gap-2">
                  <span className="w-7 shrink-0 text-right font-semibold tabular-nums">
                    {i.cantidad}×
                  </span>
                  <span className="min-w-0">{i.titulo}</span>
                </li>
              ))}
            </ul>
            <BotonRetirado ventaId={v.id} codigo={v.codigo} className="w-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}
