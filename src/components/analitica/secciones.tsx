import "server-only";

import { AlertTriangle, ChevronRight, ClipboardList, FileClock, Package } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ChartPlaceholder } from "@/components/ui/chart-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { cn, formatearFechaHora } from "@/lib/utils";
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

/** Tarjeta de sección del dashboard (mismo aspecto que SectionCard, con test id). */
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
    <section
      className={cn("bg-card rounded-card flex min-w-0 flex-col", className)}
      data-testid={testId}
    >
      <header className="flex min-h-11 items-start justify-between gap-3 px-5 pt-5 md:px-6 md:pt-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-h3 font-semibold">{titulo}</h2>
          {subtitulo && <p className="text-muted text-small">{subtitulo}</p>}
        </div>
        {accion && <div className="-my-1.5 shrink-0">{accion}</div>}
      </header>
      <div className="flex-1 p-5 pt-4 md:p-6 md:pt-5">{children}</div>
    </section>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted text-small flex min-h-24 items-center justify-center gap-2 text-center">
      <Package className="text-subtle size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      {children}
    </p>
  );
}

/** Grilla de KPIs: 2 columnas en mobile, 3 en lg y todas en una fila en xl.
 * Con cantidad impar, en mobile la última ocupa el ancho completo. */
function claseGrillaKpis(n: number) {
  return cn(
    "grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3",
    n >= 6 ? "xl:grid-cols-6" : n === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
    "[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1",
  );
}

// --- Skeletons ----------------------------------------------------------------

export function SkeletonKpis({ n = 6 }: { n?: number }) {
  return (
    <div className={claseGrillaKpis(n)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="bg-card rounded-card flex flex-col gap-2.5 p-4 md:p-5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
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
    <div className={cn("bg-card rounded-card", className)}>
      <div className="flex flex-col gap-5 p-5 md:p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className={cn(alto, "w-full")} />
      </div>
    </div>
  );
}

// --- KPIs ---------------------------------------------------------------------

export async function SeccionKpis({ ctx, periodo }: { ctx: CtxPanel; periodo: Periodo }) {
  const k = await kpis(ctx, periodo);
  const ant = ETIQUETA_ANTERIOR[periodo.modo];
  const sinVentas = k.cantidadVentas.actual === 0;
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Indicadores" className={claseGrillaKpis(k.ganancia ? 6 : 5)}>
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
        <p className="text-muted text-small" data-testid="sin-ventas-periodo">
          Todavía no hay ventas en este período.
        </p>
      )}
    </div>
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
            colores={tipos.map((_, i) => (i === 0 ? "azul" : "naranja"))}
            datos={tipos.map((t) => ({
              etiqueta: t.etiqueta,
              valor: Number(t.total),
              detalle: `${t.cantidad} ${t.cantidad === 1 ? "venta" : "ventas"}`,
            }))}
          />
          <dl className="border-border text-small mt-5 grid grid-cols-2 gap-3 border-t pt-4">
            {tipos.map((t) => (
              <div key={t.tipo} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted">{t.etiqueta}</dt>
                <dd className="font-medium tabular-nums">
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
  // Proporción de lo vendido: cuánto fue costo (azul) y cuánto ganancia bruta (naranja).
  const ventas = Number(c.ventas.actual);
  const costo = Math.min(Math.max(Number(c.costoVendido.actual), 0), ventas);
  const pctCosto = ventas > 0 ? (costo / ventas) * 100 : 0;
  const pctGanancia = ventas > 0 ? 100 - pctCosto : 0;
  return (
    <Tarjeta titulo="Compras vs. ventas" className={className} testId="tarjeta-compras">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div
            className="bg-surface-3 flex h-3 w-full overflow-hidden"
            role="img"
            aria-label={
              ventas > 0
                ? `Costo ${Math.round(pctCosto)} % y ganancia ${Math.round(pctGanancia)} % de lo vendido`
                : "Sin ventas en el período"
            }
          >
            <div className="bg-dato-actual h-full" style={{ width: `${pctCosto}%` }} />
            <div className="bg-dato-anterior h-full" style={{ width: `${pctGanancia}%` }} />
          </div>
          <ul className="text-muted text-small flex flex-wrap gap-x-4 gap-y-1" aria-hidden>
            <li className="flex items-center gap-1.5">
              <span className="bg-dato-actual inline-block h-2.5 w-3.5" />
              Costo {ventas > 0 && <span className="tabular-nums">{Math.round(pctCosto)} %</span>}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="bg-dato-anterior inline-block h-2.5 w-3.5" />
              Ganancia{" "}
              {ventas > 0 && <span className="tabular-nums">{Math.round(pctGanancia)} %</span>}
            </li>
          </ul>
        </div>
        <dl className="divide-border flex flex-col divide-y">
          {filas.map((f) => (
            <div
              key={f.label}
              className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <dt className="text-muted text-small pt-0.5">{f.label}</dt>
              <dd className="flex flex-col items-end tabular-nums">
                <span className="font-semibold">{formatearPesos(f.c.actual)}</span>
                <span className="text-subtle text-small">
                  {ant}: {formatearPesos(f.c.anterior)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Tarjeta>
  );
}

// --- Rankings -----------------------------------------------------------------

function ListaTop({ items, hrefDe }: { items: TopItem[]; hrefDe?: (i: TopItem) => string }) {
  if (items.length === 0) return <Vacio>Sin ventas en el período.</Vacio>;
  const max = Math.max(...items.map((p) => Number(p.facturado)), 0);
  return (
    <ol className="flex flex-col gap-1">
      {items.map((p, i) => {
        const pct = max > 0 ? Math.max((Number(p.facturado) / max) * 100, 1.5) : 0;
        const contenido = (
          <>
            <span className="text-subtle w-4 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{p.nombre}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatearPesos(p.facturado)}
                </span>
              </span>
              <span className="bg-surface-3 block h-2 w-full" aria-hidden>
                <span className="bg-dato-actual block h-full" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-subtle text-small tabular-nums">
                {formatearNumero(p.unidades)} u.
                {p.ganancia !== null && ` · ganancia ${formatearPesos(p.ganancia)}`}
              </span>
            </span>
          </>
        );
        return (
          <li key={p.id}>
            {hrefDe ? (
              <Link
                href={hrefDe(p)}
                className="hover:bg-surface-3/60 rounded-control -mx-2 flex min-h-14 items-start gap-3 px-2 py-2 transition-colors"
              >
                {contenido}
              </Link>
            ) : (
              <div className="flex min-h-14 items-start gap-3 py-2">{contenido}</div>
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
      subtitulo="Por facturado"
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

/** Celda blanca de la grilla de rendimiento (dt y dd pegados: "Unitarias1 · $ 20.000"). */
function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface rounded-inner flex min-w-0 flex-col gap-0.5 p-3">
      <dt className="text-muted text-small">{label}</dt>
      <dd className="text-sm font-semibold break-words tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Rendimiento de un vendedor: grilla Unitarias / Mayoristas / Total / Unidades,
 * línea de cotizaciones y clientes nuevos, y la comisión estimada.
 */
function DatosRendimiento({ r, ancho = false }: { r: RendimientoVendedor; ancho?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className={cn("grid grid-cols-2 gap-2", ancho && "md:grid-cols-4")}>
        <Dato label="Unitarias">
          {formatearNumero(r.unitarias.cantidad)} · {formatearPesos(r.unitarias.total)}
        </Dato>
        <Dato label="Mayoristas">
          {formatearNumero(r.mayoristas.cantidad)} · {formatearPesos(r.mayoristas.total)}
        </Dato>
        <Dato label="Total">{formatearPesos(r.facturado)}</Dato>
        <Dato label="Unidades">{formatearNumero(r.unidades)}</Dato>
      </dl>
      <p className="text-muted text-small tabular-nums">
        {r.cotizaciones.convertidas}/{r.cotizaciones.creadas} cotizaciones convertidas ·{" "}
        {formatearNumero(r.clientesNuevos)}{" "}
        {r.clientesNuevos === 1 ? "cliente nuevo" : "clientes nuevos"} · ticket{" "}
        {formatearPesos(r.ticketPromedio)}
      </p>
      {r.comision && (
        <dl className="border-border flex items-baseline justify-between gap-3 border-t pt-3">
          <dt className="text-muted text-small">Comisión estimada</dt>
          <dd className="font-semibold tabular-nums">{formatearPesos(r.comision.estimada)}</dd>
        </dl>
      )}
    </div>
  );
}

/** Encabezado de una sección sin tarjeta propia (sus tarjetas van adentro). */
function EncabezadoSeccion({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-h3 font-semibold">{titulo}</h2>
      {subtitulo && <p className="text-muted text-small">{subtitulo}</p>}
    </div>
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
    <section
      className={cn("flex min-w-0 flex-col gap-4 pt-2", className)}
      data-testid="tarjeta-equipo"
    >
      <EncabezadoSeccion
        titulo="Rendimiento del equipo"
        subtitulo="Comisión orientativa, según los porcentajes de cada usuario."
      />
      {empleados.length === 0 ? (
        <div className="bg-card rounded-card px-5">
          <Vacio>No hay empleados con acceso a este panel.</Vacio>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {empleados.map((r) => (
            <li
              key={r.usuarioId}
              className="bg-card rounded-card flex flex-col gap-4 p-5"
              data-testid={`vendedor-${r.nombre}`}
            >
              <div className="flex items-center gap-3">
                <Avatar nombre={r.nombre} className="size-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.nombre}</p>
                  <p className="text-muted text-small tabular-nums">
                    {formatearNumero(r.cantidadVentas)} ventas · {formatearPesos(r.facturado)}
                  </p>
                </div>
              </div>
              <DatosRendimiento r={r} />
              <Link
                href={detalle(r.usuarioId)}
                className={cn(buttonVariants({ variant: "secondary", fullWidth: true }), "mt-auto")}
              >
                Ver detalle
              </Link>
            </li>
          ))}
        </ul>
      )}
      {duenos.length > 0 && (
        <ul
          className="bg-card divide-border rounded-card flex flex-col divide-y"
          aria-label="Dueños"
        >
          {duenos.map((r) => (
            <li
              key={r.usuarioId}
              className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar nombre={r.nombre} />
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.nombre}</span>
                    <Badge variant="neutral">Dueño</Badge>
                  </p>
                  <p className="text-muted text-small tabular-nums">
                    {formatearNumero(r.unitarias.cantidad)} unit. ·{" "}
                    {formatearNumero(r.mayoristas.cantidad)} may. · {formatearNumero(r.unidades)} u.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 pl-12 sm:justify-end sm:pl-0">
                <span className="font-semibold tabular-nums">{formatearPesos(r.facturado)}</span>
                <Link
                  href={detalle(r.usuarioId)}
                  className={cn(buttonVariants({ variant: "ghost", size: "md" }), "-mr-2")}
                >
                  Ver detalle
                  <ChevronRight strokeWidth={1.75} aria-hidden />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** KPIs de un vendedor (su detalle, o "Mi rendimiento"). */
export function KpisVendedor({
  r,
  periodo,
  sinComision = false,
}: {
  r: RendimientoComparado;
  periodo: Periodo;
  /** El detalle del vendedor muestra la comisión en una tarjeta aparte. */
  sinComision?: boolean;
}) {
  const ant = ETIQUETA_ANTERIOR[periodo.modo];
  const conComision = !!r.comision && !sinComision;
  return (
    <div className={claseGrillaKpis(conComision ? 6 : 5)}>
      <KpiCard label="Facturado" etiquetaAnterior={ant} {...pesos(r.facturado)} />
      <KpiCard label="Ventas" etiquetaAnterior={ant} {...numero(r.cantidadVentas)} />
      <KpiCard label="Unidades" etiquetaAnterior={ant} {...numero(r.unidades)} />
      <KpiCard label="Ticket promedio" etiquetaAnterior={ant} {...pesos(r.ticketPromedio)} />
      <KpiCard label="Clientes nuevos" etiquetaAnterior={ant} {...numero(r.clientesNuevos)} />
      {conComision && r.comision && (
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
    <section
      className={cn("flex min-w-0 flex-col gap-4 pt-2", className)}
      data-testid="tarjeta-mi-rendimiento"
    >
      <EncabezadoSeccion titulo="Mi rendimiento" />
      <KpisVendedor r={r} periodo={periodo} />
      <div className="bg-card rounded-card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <Avatar nombre={r.usuario.nombre} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{r.usuario.nombre}</p>
            <p className="text-muted text-small tabular-nums">
              {formatearNumero(r.actual.cantidadVentas)} ventas ·{" "}
              {formatearPesos(r.actual.facturado)}
            </p>
          </div>
        </div>
        <DatosRendimiento r={r.actual} ancho />
      </div>
    </section>
  );
}

// --- Alertas y pendientes -----------------------------------------------------

const linkAccion = cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-2 h-11 md:h-9");

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
            className={linkAccion}
          >
            Ver stock
            <ChevronRight strokeWidth={1.75} aria-hidden />
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
              <section key={d.depositoId} className="flex flex-col gap-1">
                <h3 className="text-small flex flex-wrap items-center gap-2 font-semibold">
                  {d.nombre}
                  {d.sinStock > 0 && <Badge variant="danger">{d.sinStock} sin stock</Badge>}
                  {d.bajoMinimo > 0 && <Badge variant="warning">{d.bajoMinimo} bajo mínimo</Badge>}
                </h3>
                <ul className="divide-border flex flex-col divide-y">
                  {d.items.map((a) => (
                    <li key={a.varianteId} className="flex min-h-12 items-center gap-3 py-2">
                      <AlertTriangle
                        className="text-subtle size-5 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{a.nombre}</span>
                      <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
                        {a.stockMinimo > 0 && (
                          <span className="text-subtle text-small hidden sm:inline">
                            mín. {formatearNumero(a.stockMinimo)}
                          </span>
                        )}
                        {a.cantidad <= 0 ? (
                          <Badge variant="danger">Sin stock</Badge>
                        ) : (
                          <Badge variant="warning">{formatearNumero(a.cantidad)} u.</Badge>
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
  const fila =
    "hover:bg-surface-3/60 -mx-2 flex min-h-14 items-center gap-3 rounded-control px-2 py-2.5 transition-colors";
  const icono =
    "bg-surface text-muted flex size-9 shrink-0 items-center justify-center rounded-control";
  return (
    <Tarjeta titulo="Pendientes" className={className}>
      {nada ? (
        <Vacio>No hay pendientes.</Vacio>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {!!p.comprasBorrador && (
            <li>
              <Link href={ruta("/compras?estado=BORRADOR")} className={fila}>
                <span className={icono}>
                  <ClipboardList className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {p.comprasBorrador} {p.comprasBorrador === 1 ? "compra" : "compras"} en borrador
                </span>
                <Badge variant="warning">Borrador</Badge>
                <ChevronRight className="text-subtle size-5" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          )}
          {p.cotizacionesPorVencer?.map((c) => (
            <li key={c.id}>
              <Link href={ruta(`/cotizador/${c.id}`)} className={fila}>
                <span className={icono}>
                  <FileClock className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-semibold">{c.codigo}</span>
                  <span className="text-muted text-small block truncate">
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
