import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronRight,
  Lock,
  Receipt,
  RotateCcw,
  Scale,
  ShoppingBag,
  Truck,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { cardVariants } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { tieneMercadoLibre } from "@/lib/medios-pago";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { REPORTES, reporteDisponible, type ClaveReporte } from "@/server/reportes/catalogo";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import {
  periodoDesdeParams,
  rendimientoVendedores,
  vendedoresDestacados,
  type RendimientoVendedor,
} from "@/server/services/analitica.service";

export const metadata: Metadata = { title: "Reportes" };

const ICONOS: Record<ClaveReporte, LucideIcon> = {
  comparador: Scale,
  empresa: BarChart3,
  vendedores: UsersRound,
  ventas: Receipt,
  stock: Boxes,
  movimientos: ArrowLeftRight,
  compras: Truck,
  clientes: Users,
  devoluciones: RotateCcw,
  "mercado-libre": ShoppingBag,
  "resumen-mensual": CalendarDays,
};

/** "12 ventas · 30 vapes vendidos · 2 clientes nuevos · $ 300.000" (lo del mes). */
function resumenMes(r: RendimientoVendedor | undefined, etiquetaUnidades: string): string {
  if (!r || r.cantidadVentas === 0) return "Todavía no vendió este mes.";
  return [
    `${formatearNumero(r.cantidadVentas)} ${r.cantidadVentas === 1 ? "venta" : "ventas"}`,
    `${formatearNumero(r.unidades)} ${etiquetaUnidades.toLowerCase()}`,
    `${formatearNumero(r.clientesNuevos)} ${r.clientesNuevos === 1 ? "cliente nuevo" : "clientes nuevos"}`,
    formatearPesos(r.facturado),
  ].join(" · ");
}

/**
 * Índice de reportes: los de dueños solo aparecen para dueños. Arriba, para
 * dueños, una tarjeta destacada "Ventas de {nombre}" por cada empleado que
 * vende en el panel (abre su pantalla en Equipo, con lo de este mes).
 */
export default async function ReportesPage() {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const owner = esOwner(ctx.usuario);
  const conMercadoLibre = tieneMercadoLibre(await obtenerConfigVentas(ctx));
  const visibles = REPORTES.filter(
    (r) => (owner || !r.owner) && reporteDisponible(r, { conMercadoLibre }),
  );
  const [vendedores, delMes] = owner
    ? await Promise.all([
        vendedoresDestacados(ctx),
        rendimientoVendedores(ctx, periodoDesdeParams({ modo: "mensual" })),
      ])
    : [[], []];
  return (
    <>
      <PageHeader title="Reportes" subtitle="Filtrá, mirá el gráfico y exportá a PDF o Excel." />
      {vendedores.length > 0 && (
        <ul className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Ventas por vendedor">
          {vendedores.map((v) => (
            <li key={v.id}>
              <Link
                href={rutaPanel(ctx.panel.slug, `/equipo/${v.id}?modo=mensual&origen=reportes`)}
                data-testid={`reporte-vendedor-${v.id}`}
                className={cn(
                  cardVariants({ variant: "clickable" }),
                  "group flex h-full items-center gap-4 p-5 md:p-6",
                )}
              >
                <span className="bg-tono-azul-suave text-tono-azul rounded-circle flex size-12 shrink-0 items-center justify-center">
                  <UserRound className="size-6" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-h3 flex items-center gap-2 font-semibold">
                    Ventas de {v.nombre}
                    <Lock
                      className="text-subtle size-3.5 shrink-0"
                      strokeWidth={1.75}
                      aria-label="Solo dueños"
                    />
                  </span>
                  <span className="text-muted text-small tabular-nums">
                    Este mes:{" "}
                    {resumenMes(
                      delMes.find((r) => r.usuarioId === v.id),
                      ctx.panel.etiquetaUnidades,
                    )}
                  </span>
                </span>
                <ChevronRight
                  className="text-subtle group-hover:text-foreground size-5 shrink-0 transition-colors"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibles.map((r) => {
          const Icono = ICONOS[r.clave];
          const principal = r.clave === "comparador";
          return (
            <li key={r.clave} className={principal ? "md:col-span-2" : undefined}>
              <Link
                href={rutaPanel(ctx.panel.slug, `/reportes/${r.clave}`)}
                data-testid={`reporte-${r.clave}`}
                className={cn(
                  cardVariants({ variant: "clickable" }),
                  "group flex h-full gap-4",
                  principal
                    ? "flex-col p-6 md:flex-row md:items-center md:p-8"
                    : "items-center p-5",
                )}
              >
                <span
                  className={cn(
                    "bg-surface text-foreground rounded-control flex shrink-0 items-center justify-center",
                    principal ? "size-14" : "size-11",
                  )}
                >
                  <Icono
                    className={principal ? "size-7" : "size-5"}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={cn(
                      "flex items-center gap-2 font-semibold",
                      principal ? "text-h2" : "text-h3",
                    )}
                  >
                    {r.titulo}
                    {r.owner && (
                      <Lock
                        className="text-subtle size-3.5 shrink-0"
                        strokeWidth={1.75}
                        aria-label="Solo dueños"
                      />
                    )}
                  </span>
                  <span className={cn("text-muted", principal ? "text-body" : "text-small")}>
                    {r.descripcion}
                  </span>
                </span>
                {principal ? (
                  <span className="text-foreground inline-flex items-center gap-1.5 text-sm font-medium md:shrink-0">
                    Comparar precios
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </span>
                ) : (
                  <ChevronRight
                    className="text-subtle group-hover:text-foreground size-5 shrink-0 transition-colors"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
