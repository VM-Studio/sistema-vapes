import { ChevronRight, HandCoins, PenLine } from "lucide-react";
import Link from "next/link";

import { formatearNumero, formatearPesos } from "@/lib/format";
import { ETIQUETA_CATEGORIA, nombreMes, sumarMeses } from "@/lib/ganancia-vendedor";
import { rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import type { CtxPanel } from "@/server/auth/permissions";
import {
  gananciaDelMes,
  liquidacionesDe,
  liquidacionesPendientes,
  mesActual,
} from "@/server/services/ganancia-vendedor.service";
import { remitosParaFirmar } from "@/server/services/remito-liquidacion.service";

import { AvisoLiquidaciones } from "./aviso-liquidaciones";

/** Inicio de un dueño: aviso de los meses cerrados sin pagar. */
export async function AvisoLiquidacionesInicio({
  ctx,
  className,
}: {
  ctx: CtxPanel;
  className?: string;
}) {
  const pendientes = await liquidacionesPendientes(ctx);
  return <AvisoLiquidaciones pendientes={pendientes} slug={ctx.panel.slug} className={className} />;
}

/**
 * Inicio del vendedor con ganancia por vape: lo ganado en el mes a hoy, por
 * categoría, y cómo quedó la liquidación del mes anterior. Abre "Mi ganancia".
 */
export async function TarjetaMiGanancia({ ctx, className }: { ctx: CtxPanel; className?: string }) {
  const mes = mesActual();
  const [g, historial] = await Promise.all([
    gananciaDelMes(ctx, ctx.usuarioId, mes),
    liquidacionesDe(ctx, ctx.usuarioId),
  ]);
  if (!g) return null;
  const paraFirmar = await remitosParaFirmar(ctx);
  const anterior = historial.find((l) => l.mes === sumarMeses(mes, -1));
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {paraFirmar.map((r) => (
        <Link
          key={r.id}
          href={rutaPanel(ctx.panel.slug, `/ganancia?mes=${r.mes}#ganancia`)}
          className="bg-warning-soft text-warning-soft-foreground rounded-card flex min-h-14 items-center gap-3 p-4"
          data-testid="aviso-remito-firmar"
        >
          <PenLine className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Tenés un remito para firmar:</span> el pago de{" "}
            {nombreMes(r.mes)} ({formatearPesos(r.monto)}), firmado por {r.pagadoPor}.
          </span>
          <ChevronRight className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        </Link>
      ))}
      <Link
        href={rutaPanel(ctx.panel.slug, "/ganancia")}
        className={cn(
          "bg-card rounded-card group hover:shadow-card-hover flex flex-col gap-4 p-5 transition-[box-shadow] md:p-6",
          className,
        )}
        data-testid="tarjeta-mi-ganancia"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="rounded-circle bg-tono-oliva-suave text-tono-oliva flex size-11 shrink-0 items-center justify-center"
          >
            <HandCoins className="size-5" strokeWidth={2} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-muted text-small font-medium">Mi ganancia de {nombreMes(mes)}</p>
            <p className="text-2xl leading-tight font-bold tabular-nums">
              {formatearPesos(g.calculo.total)}
            </p>
            <p className="text-subtle text-small tabular-nums">
              A hoy · {formatearNumero(g.calculo.cantidadVentas)}{" "}
              {g.calculo.cantidadVentas === 1 ? "venta" : "ventas"} ·{" "}
              {formatearNumero(g.calculo.unidades)} vapes
            </p>
          </div>
          <ChevronRight
            className="text-subtle size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {g.calculo.categorias.map((c) => (
            <div key={c.categoria} className="bg-surface rounded-inner flex min-w-0 flex-col p-3">
              <dt className="text-muted text-small truncate">{ETIQUETA_CATEGORIA[c.categoria]}</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {formatearNumero(c.unidades - c.unidadesDevueltas)} · {formatearPesos(c.monto)}
              </dd>
            </div>
          ))}
        </dl>
        {anterior && (
          <p className="text-muted text-small">
            {nombreMes(anterior.mes).replace(/^./, (x) => x.toUpperCase())}:{" "}
            {formatearPesos(anterior.total)} ·{" "}
            {anterior.estado === "PENDIENTE" ? "pendiente de pago" : "pagada"}
          </p>
        )}
      </Link>
    </div>
  );
}
