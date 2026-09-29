import "server-only";

import { AlertTriangle, ChevronRight, ClipboardList, FileClock, Package } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartPlaceholder } from "@/components/ui/chart-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { formatearFechaHora } from "@/lib/utils";
import type { CtxPanel } from "@/server/auth/permissions";
import {
  alertasStock,
  comprasDelPeriodo,
  describirPeriodo,
  kpis,
  miRendimiento,
  pendientes,
  rendimientoVendedores,
  serieComparativa,
  topProductos,
  topSabores,
  ventasPorDeposito,
  ventasPorMedioPago,
  ventasPorTipo,
  type Comparado,
  type Periodo,
  type RendimientoComparado,
  type RendimientoVendedor,
  type TopItem,
} from "@/server/services/analitica.service";

import { BarrasHorizontales } from "./barras";
import { DonutMedios } from "./donut-medios";
import { GraficoComparativo } from "./grafico-comparativo";
import { KpiCard } from "./kpi-card";

/**
 * Tarjetas del dashboard del panel. Cada una es un Server Component que
 * consulta lo suyo: la página las envuelve en <Suspense> (con su skeleton),
 * así una consulta lenta no frena al resto.
 */

export const ETIQUETA_ANTERIOR: Record<Periodo["modo"], string> = {
  DIARIO: "Ayer",
  SEMANAL: "Sem. pasada",
  MENSUAL: "Mes pasado",
  PERSONALIZADO: "Anterior",
};

const pesos = (c: Comparado<string>) => ({
  valor: formatearPesos(c.actual),
  anterior: formatearPesos(c.anterior),
  deltaPct: c.deltaPct,
});
const numero = (c: Comparado<number>) => ({
  valor: formatearNumero(c.actual),
  anterior: formatearNumero(c.anterior),
  deltaPct: c.deltaPct,
});

export function Tarjeta({
  titulo,
  subtitulo,
  accion,
  className,
  children,
  testId,
}: {
  titulo: string;
  subtitulo?: string;
  accion?: ReactNode;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card className={className} data-testid={testId}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="text-base">{titulo}</CardTitle>
          {subtitulo && <p className="text-muted text-sm">{subtitulo}</p>}
        </div>
        {accion}
      </CardHeader>
      <CardContent className="pt-3 md:pt-4">{children}</CardContent>
    </Card>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted flex min-h-24 items-center justify-center gap-2 text-center text-sm">
      <Package className="size-4" strokeWidth={1.75} aria-hidden />
      {children}
    </p>
  );
}

// --- Skeletons ----------------------------------------------------------------

export function SkeletonKpis({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-card" />
      ))}
    </div>
  );
}

export function SkeletonTarjeta({
  className,
  alto = "h-64",
}: {
  className?: string;
  alto?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-col gap-4 p-5 md:p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className={`${alto} w-full rounded-control`} />
      </div>
    </Card>
  );
}

// --- KPIs ---------------------------------------------------------------------

export async function SeccionKpis({ ctx, periodo }: { ctx: CtxPanel; periodo: Periodo }) {
  const k = await kpis(ctx, periodo);
  const ant = ETIQUETA_ANTERIOR[periodo.modo];
  const sinVentas = k.cantidadVentas.actual === 0;
  return (
    <>
      <section
        aria-label="Indicadores"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6"
      >
        <KpiCard label="Facturado" etiquetaAnterior={ant} {...pesos(k.facturado)} />
        {k.ganancia && (
          <KpiCard
            label="Ganancia"
            etiquetaAnterior={ant}
            {...pesos(k.ganancia)}
            extra={
              k.margenPct !== null
                ? `margen ${k.margenPct.toLocaleString("es-AR")} %`
                : "sin ventas"
            }
          />
        )}
        <KpiCard
          label={ctx.panel.etiquetaUnidades}
          etiquetaAnterior={ant}
          {...numero(k.unidadesVendidas)}
        />
        <KpiCard label="Clientes nuevos" etiquetaAnterior={ant} {...numero(k.clientesNuevos)} />
        <KpiCard label="Ventas" etiquetaAnterior={ant} {...numero(k.cantidadVentas)} />
        <KpiCard label="Ticket promedio" etiquetaAnterior={ant} {...pesos(k.ticketPromedio)} />
      </section>
      {sinVentas && (
        <p className="text-muted -mt-2 text-sm md:-mt-4" data-testid="sin-ventas-periodo">
          Todavía no hay ventas en este período.
        </p>
      )}
    </>
  );
}

// --- Gráficos -----------------------------------------------------------------

export async function SeccionGrafico({
  ctx,
  periodo,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  className?: string;
}) {
  const serie = await serieComparativa(ctx, periodo);
  const d = describirPeriodo(periodo);
  return (
    <Tarjeta
      titulo={d.tituloGrafico}
      subtitulo="Facturado"
      className={className}
      testId="tarjeta-grafico"
    >
      <GraficoComparativo datos={serie} />
    </Tarjeta>
  );
}

export async function SeccionMedios({
  ctx,
  periodo,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  className?: string;
}) {
  const medios = await ventasPorMedioPago(ctx, periodo);
  const hay = medios.some((m) => m.cantidad > 0);
  return (
    <Tarjeta titulo="Medios de pago" className={className}>
      {hay ? (
        <DonutMedios
          datos={medios.map((m) => ({
            etiqueta: m.etiqueta,
            cantidad: m.cantidad,
            total: Number(m.total),
          }))}
        />
      ) : (
        <ChartPlaceholder mensaje="Sin ventas en el período" className="h-40 md:h-44" />
      )}
    </Tarjeta>
  );
}

export async function SeccionTipo({
  ctx,
  periodo,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  className?: string;
}) {
  const tipos = await ventasPorTipo(ctx, periodo);
  return (
    <Tarjeta titulo="Unitaria vs. mayorista" className={className} testId="tarjeta-tipo">
      {tipos.some((t) => t.cantidad > 0) ? (
        <>
          <BarrasHorizontales
            datos={tipos.map((t) => ({
              etiqueta: t.etiqueta,
              valor: Number(t.total),
              detalle: `${t.cantidad} ${t.cantidad === 1 ? "venta" : "ventas"}`,
            }))}
          />
          <dl className="text-muted mt-2 grid grid-cols-2 gap-2 text-xs">
            {tipos.map((t) => (
              <div key={t.tipo}>
                <dt>{t.etiqueta}</dt>
                <dd className="text-foreground tabular-nums">
                  {formatearNumero(t.cantidad)} ventas · {formatearNumero(t.unidades)} u.
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <ChartPlaceholder mensaje="Sin ventas en el período" className="h-40 md:h-44" />
      )}
    </Tarjeta>
  );
}

export async function SeccionGalpones({
  ctx,
  periodo,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  className?: string;
}) {
  const deps = await ventasPorDeposito(ctx, periodo);
  return (
    <Tarjeta titulo="Por galpón" className={className}>
      {deps.some((d) => d.cantidad > 0) ? (
        <BarrasHorizontales
          datos={deps.map((d) => ({
            etiqueta: d.nombre,
            valor: Number(d.total),
            detalle: `${d.cantidad} ${d.cantidad === 1 ? "venta" : "ventas"}`,
          }))}
        />
      ) : (
        <ChartPlaceholder mensaje="Sin ventas en el período" className="h-40 md:h-44" />
      )}
    </Tarjeta>
  );
}

export async function SeccionComprasVentas({
  ctx,
  periodo,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  className?: string;
}) {
  const c = await comprasDelPeriodo(ctx, periodo);
  const ant = ETIQUETA_ANTERIOR[periodo.modo];
  const filas: { label: string; c: Comparado<string> }[] = [
    { label: "Ventas", c: c.ventas },
    { label: "Costo de lo vendido", c: c.costoVendido },
    { label: `Compras recibidas (${c.cantidadCompras.actual})`, c: c.compras },
  ];
  return (
    <Tarjeta titulo="Compras vs. ventas" className={className} testId="tarjeta-compras">
      <BarrasHorizontales
        datos={[
          { etiqueta: "Ventas", valor: Number(c.ventas.actual) },
          { etiqueta: "Compras", valor: Number(c.compras.actual) },
        ]}
      />
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {filas.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">{f.label}</dt>
            <dd className="text-right tabular-nums">
              <span className="font-medium">{formatearPesos(f.c.actual)}</span>{" "}
              <span className="text-muted text-xs">
                ({ant.toLowerCase()} {formatearPesos(f.c.anterior)})
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </Tarjeta>
  );
}

// --- Rankings -----------------------------------------------------------------

function ListaTop({ items, hrefDe }: { items: TopItem[]; hrefDe?: (i: TopItem) => string }) {
  if (items.length === 0) return <Vacio>Sin ventas en el período.</Vacio>;
  return (
    <ol className="divide-border flex flex-col divide-y">
      {items.map((p, i) => {
        const contenido = (
          <>
            <span className="bg-primary-soft text-primary-soft-foreground flex size-8 shrink-0 items-center justify-center rounded-control text-sm font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.nombre}</span>
              <span className="text-muted text-sm tabular-nums">
                {formatearNumero(p.unidades)} u.
                {p.ganancia !== null && ` · ganancia ${formatearPesos(p.ganancia)}`}
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatearPesos(p.facturado)}
            </span>
          </>
        );
        return (
          <li key={p.id}>
            {hrefDe ? (
              <Link
                href={hrefDe(p)}
                className="hover:bg-surface-2 -mx-2 flex min-h-14 items-center gap-3 rounded-control px-2 py-2.5 transition-colors"
              >
                {contenido}
              </Link>
            ) : (
              <div className="flex min-h-14 items-center gap-3 py-2.5">{contenido}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export async function SeccionTop({
  ctx,
  periodo,
  que,
  verProductos,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  que: "productos" | "sabores";
  verProductos: boolean;
  className?: string;
}) {
  const items =
    que === "productos" ? await topProductos(ctx, periodo, 5) : await topSabores(ctx, periodo, 5);
  return (
    <Tarjeta
      titulo={que === "productos" ? "Top 5 productos" : "Top 5 sabores"}
      className={className}
    >
      <ListaTop
        items={items}
        hrefDe={
          verProductos && que === "productos"
            ? (p) => rutaPanel(ctx.panel.slug, `/productos/${p.id}`)
            : undefined
        }
      />
    </Tarjeta>
  );
}

// --- Equipo -------------------------------------------------------------------

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-sm font-medium break-words tabular-nums">{children}</dd>
    </div>
  );
}

function DatosRendimiento({ r, ancho = false }: { r: RendimientoVendedor; ancho?: boolean }) {
  return (
    <dl
      className={
        ancho
          ? "grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4"
          : "grid grid-cols-2 gap-x-4 gap-y-3"
      }
    >
      <Dato label="Unitarias">
        {formatearNumero(r.unitarias.cantidad)} · {formatearPesos(r.unitarias.total)}
      </Dato>
      <Dato label="Mayoristas">
        {formatearNumero(r.mayoristas.cantidad)} · {formatearPesos(r.mayoristas.total)}
      </Dato>
      <Dato label="Unidades">{formatearNumero(r.unidades)}</Dato>
      <Dato label="Cotizaciones">
        {r.cotizaciones.convertidas}/{r.cotizaciones.creadas} convertidas
      </Dato>
      <Dato label="Clientes nuevos">{formatearNumero(r.clientesNuevos)}</Dato>
      <Dato label="Ticket promedio">{formatearPesos(r.ticketPromedio)}</Dato>
      {r.comision && (
        <Dato label="Comisión estimada">
          <span className="text-success">{formatearPesos(r.comision.estimada)}</span>
        </Dato>
      )}
    </dl>
  );
}

export async function SeccionEquipo({
  ctx,
  periodo,
  query,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  /** Query del período ("?modo=semanal") para conservarlo en "Ver detalle". */
  query: string;
  className?: string;
}) {
  const equipo = await rendimientoVendedores(ctx, periodo);
  const empleados = equipo.filter((r) => r.rol === "EMPLEADO");
  const duenos = equipo.filter((r) => r.rol === "OWNER");
  const detalle = (id: string) => rutaPanel(ctx.panel.slug, `/equipo/${id}${query}`);
  return (
    <Tarjeta
      titulo="Rendimiento del equipo"
      subtitulo="Comisión orientativa, según los porcentajes de cada usuario."
      className={className}
      testId="tarjeta-equipo"
    >
      {empleados.length === 0 ? (
        <Vacio>No hay empleados con acceso a este panel.</Vacio>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {empleados.map((r) => (
            <li
              key={r.usuarioId}
              className="border-border flex flex-col gap-4 rounded-card border p-4"
              data-testid={`vendedor-${r.nombre}`}
            >
              <div className="flex items-center gap-3">
                <Avatar nombre={r.nombre} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.nombre}</p>
                  <p className="text-muted text-sm tabular-nums">
                    {formatearNumero(r.cantidadVentas)} ventas · {formatearPesos(r.facturado)}
                  </p>
                </div>
              </div>
              <DatosRendimiento r={r} />
              <Link
                href={detalle(r.usuarioId)}
                className="text-primary -my-2 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium hover:underline"
              >
                Ver detalle
                <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {duenos.length > 0 && (
        <ul
          className="border-border mt-4 flex flex-col divide-y rounded-card border"
          aria-label="Dueños"
        >
          {duenos.map((r) => (
            <li
              key={r.usuarioId}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{r.nombre}</span>
              <Badge variant="neutral">Dueño</Badge>
              <span className="text-muted tabular-nums">
                {formatearNumero(r.unitarias.cantidad)} unit. ·{" "}
                {formatearNumero(r.mayoristas.cantidad)} may. · {formatearNumero(r.unidades)} u.
              </span>
              <span className="ml-auto font-medium tabular-nums">
                {formatearPesos(r.facturado)}
              </span>
              <Link
                href={detalle(r.usuarioId)}
                className="text-primary inline-flex min-h-11 items-center text-sm font-medium hover:underline"
              >
                Ver detalle
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

/** KPIs de un vendedor (su detalle, o "Mi rendimiento"). */
export function KpisVendedor({ r, periodo }: { r: RendimientoComparado; periodo: Periodo }) {
  const ant = ETIQUETA_ANTERIOR[periodo.modo];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
      <KpiCard label="Facturado" etiquetaAnterior={ant} {...pesos(r.facturado)} />
      <KpiCard label="Ventas" etiquetaAnterior={ant} {...numero(r.cantidadVentas)} />
      <KpiCard label="Unidades" etiquetaAnterior={ant} {...numero(r.unidades)} />
      <KpiCard label="Ticket promedio" etiquetaAnterior={ant} {...pesos(r.ticketPromedio)} />
      <KpiCard label="Clientes nuevos" etiquetaAnterior={ant} {...numero(r.clientesNuevos)} />
      {r.comision && (
        <KpiCard
          label="Comisión estimada"
          etiquetaAnterior={ant}
          {...pesos(r.comision)}
          extra="Orientativa"
        />
      )}
    </div>
  );
}

export async function SeccionMiRendimiento({
  ctx,
  periodo,
  className,
}: {
  ctx: CtxPanel;
  periodo: Periodo;
  className?: string;
}) {
  const r = await miRendimiento(ctx, periodo);
  return (
    <Tarjeta titulo="Mi rendimiento" className={className} testId="tarjeta-mi-rendimiento">
      <div className="flex flex-col gap-5">
        <KpisVendedor r={r} periodo={periodo} />
        <DatosRendimiento r={r.actual} ancho />
      </div>
    </Tarjeta>
  );
}

// --- Alertas y pendientes -----------------------------------------------------

export async function SeccionAlertas({
  ctx,
  verStock,
  className,
}: {
  ctx: CtxPanel;
  verStock: boolean;
  className?: string;
}) {
  const deps = await alertasStock(ctx);
  const total = deps.reduce((a, d) => a + d.sinStock + d.bajoMinimo, 0);
  return (
    <Tarjeta
      titulo="Stock bajo y sin stock"
      className={className}
      accion={
        verStock && total > 0 ? (
          <Link
            href={rutaPanel(ctx.panel.slug, "/stock?tab=global&soloBajoMinimo=1")}
            className="text-primary -my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium hover:underline"
          >
            Ver stock
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {total === 0 ? (
        <Vacio>Todo el stock está por encima del mínimo.</Vacio>
      ) : (
        <div className="flex flex-col gap-5">
          {deps
            .filter((d) => d.sinStock + d.bajoMinimo > 0)
            .map((d) => (
              <section key={d.depositoId} className="flex flex-col gap-2">
                <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {d.nombre}
                  {d.sinStock > 0 && <Badge variant="danger">{d.sinStock} sin stock</Badge>}
                  {d.bajoMinimo > 0 && <Badge variant="warning">{d.bajoMinimo} bajo mínimo</Badge>}
                </h4>
                <ul className="divide-border flex flex-col divide-y">
                  {d.items.map((a) => (
                    <li key={a.varianteId} className="flex min-h-12 items-center gap-3 py-2">
                      <AlertTriangle
                        className={
                          a.cantidad <= 0
                            ? "text-danger size-4 shrink-0"
                            : "text-warning-soft-foreground size-4 shrink-0"
                        }
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{a.nombre}</span>
                      <span className="text-right text-sm tabular-nums">
                        <span className="font-semibold">
                          {a.cantidad <= 0 ? "Sin stock" : `${formatearNumero(a.cantidad)} u.`}
                        </span>
                        {a.stockMinimo > 0 && (
                          <span className="text-muted">
                            {" "}
                            · mín. {formatearNumero(a.stockMinimo)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Tarjeta>
  );
}

export async function SeccionPendientes({
  ctx,
  verCompras,
  verCotizaciones,
  soloPropias,
  className,
}: {
  ctx: CtxPanel;
  verCompras: boolean;
  verCotizaciones: boolean;
  soloPropias: boolean;
  className?: string;
}) {
  const p = await pendientes(ctx, { verCompras, verCotizaciones, soloPropias });
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const nada =
    !p.comprasBorrador &&
    (p.cotizacionesPorVencer === null || p.cotizacionesPorVencer.length === 0);
  return (
    <Tarjeta titulo="Pendientes" className={className}>
      {nada ? (
        <Vacio>No hay pendientes.</Vacio>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {!!p.comprasBorrador && (
            <li>
              <Link
                href={ruta("/compras?estado=BORRADOR")}
                className="hover:bg-surface-2 -mx-2 flex min-h-14 items-center gap-3 rounded-control px-2 py-2.5"
              >
                <span className="bg-warning-soft text-warning-soft-foreground flex size-8 shrink-0 items-center justify-center rounded-control">
                  <ClipboardList className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex-1 font-medium">
                  {p.comprasBorrador} {p.comprasBorrador === 1 ? "compra" : "compras"} en borrador
                </span>
                <ChevronRight className="text-muted size-4" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          )}
          {p.cotizacionesPorVencer?.map((c) => (
            <li key={c.id}>
              <Link
                href={ruta(`/cotizador/${c.id}`)}
                className="hover:bg-surface-2 -mx-2 flex min-h-14 items-center gap-3 rounded-control px-2 py-2.5"
              >
                <span className="bg-surface-2 text-muted flex size-8 shrink-0 items-center justify-center rounded-control">
                  <FileClock className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium tabular-nums">{c.codigo}</span>
                  <span className="text-muted block truncate text-sm">
                    {c.cliente ?? "Sin cliente"} · vence {formatearFechaHora(c.validaHasta)}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatearPesos(c.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
