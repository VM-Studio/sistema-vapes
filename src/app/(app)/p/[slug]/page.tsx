import { Modulo } from "@prisma/client";
import { AlertTriangle, ChevronRight, Package, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { navegacionPermitida, type ItemNavegacion } from "@/config/navigation";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { formatearIdVenta, rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import { obtenerDashboard, type KpiVentas } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Inicio" };

/** "lunes 28 de septiembre" a partir del día ISO (ya en la zona del negocio). */
function fechaLarga(dia: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dia}T12:00:00Z`));
}

const ventas = (n: number) => `${formatearNumero(n)} ${n === 1 ? "venta" : "ventas"}`;

/**
 * Inicio del panel. Con DASHBOARD: ventas de hoy / 7 días / mes, top 5 del
 * mes, stock bajo y últimas ventas (costo y ganancia bruta solo para
 * dueños). Siempre: accesos rápidos a los módulos que el usuario puede ver.
 */
export default async function InicioPanelPage() {
  const ctx = await requirePaginaPanelUsuario();
  const { usuario, panel, panelId } = ctx;
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  const owner = esOwner(usuario);
  const verDashboard = puede(usuario, panelId, Modulo.DASHBOARD, "ver");
  const accesos = navegacionPermitida(usuario, panel).filter((i) => i.modulo !== null);
  const d = verDashboard ? await obtenerDashboard(ctx, { conCostos: owner }) : null;

  const verVentas = puede(usuario, panelId, Modulo.VENTAS, "ver");
  const verStock = puede(usuario, panelId, Modulo.STOCK, "ver");
  const verProductos = puede(usuario, panelId, Modulo.PRODUCTOS, "ver");

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
          {panel.nombre}
        </h1>
        <p className="text-muted text-sm first-letter:uppercase md:text-base">
          {d ? `Resumen del ${fechaLarga(d.hoy)}` : "Elegí por dónde empezar."}
        </p>
      </header>

      {d && (
        <>
          <section aria-label="Ventas" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label="Hoy" k={d.kpis.hoy} />
            <Kpi label="Últimos 7 días" k={d.kpis.semana} />
            <Kpi label="Este mes" k={d.kpis.mes} />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Seccion
              titulo="Más vendidos del mes"
              className="lg:col-span-1"
              vacio={d.topProductos.length === 0 ? "Todavía no hay ventas este mes." : null}
            >
              <ol className="divide-border flex flex-col divide-y">
                {d.topProductos.map((p, i) => {
                  const contenido = (
                    <>
                      <span className="bg-primary-soft text-primary-soft-foreground flex size-8 shrink-0 items-center justify-center rounded-xl text-sm font-semibold tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.nombre}</span>
                        <span className="text-muted text-sm tabular-nums">
                          {formatearNumero(p.unidades)} u.
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatearPesos(p.total)}
                      </span>
                    </>
                  );
                  return (
                    <li key={p.productoId}>
                      {verProductos ? (
                        <Link
                          href={ruta(`/productos/${p.productoId}`)}
                          className="hover:bg-surface-2 -mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors"
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
            </Seccion>

            <Seccion
              titulo="Últimas ventas"
              className="lg:col-span-1"
              accion={verVentas ? { href: ruta("/ventas"), label: "Ver ventas" } : undefined}
              vacio={d.ultimasVentas.length === 0 ? "Todavía no hay ventas." : null}
            >
              <ul className="divide-border flex flex-col divide-y">
                {d.ultimasVentas.map((v) => {
                  const contenido = (
                    <>
                      <span className="bg-surface-2 text-muted flex size-8 shrink-0 items-center justify-center rounded-xl">
                        <Receipt className="size-4" strokeWidth={1.75} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium tabular-nums">
                          {formatearIdVenta(panel.slug, v.numero)}
                        </span>
                        <span className="text-muted block truncate text-sm">
                          {formatearFechaHora(v.fecha)} · {v.cliente ?? "Consumidor final"}
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatearPesos(v.total)}
                      </span>
                    </>
                  );
                  return (
                    <li key={v.id}>
                      {verVentas ? (
                        <Link
                          href={ruta(`/ventas/${v.id}`)}
                          className="hover:bg-surface-2 -mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors"
                        >
                          {contenido}
                        </Link>
                      ) : (
                        <div className="flex min-h-14 items-center gap-3 py-2.5">{contenido}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Seccion>

            <Seccion
              titulo="Stock bajo"
              className="lg:col-span-1"
              extra={
                d.alertasTotal > 0 ? <Badge variant="warning">{d.alertasTotal}</Badge> : undefined
              }
              accion={
                verStock && d.alertasTotal > 0
                  ? { href: ruta("/stock?soloBajoMinimo=1"), label: "Ver stock" }
                  : undefined
              }
              vacio={d.alertas.length === 0 ? "Todo el stock está por encima del mínimo." : null}
            >
              <ul className="divide-border flex flex-col divide-y">
                {d.alertas.map((a) => (
                  <li key={a.varianteId} className="flex min-h-14 items-center gap-3 py-2.5">
                    <span
                      className={
                        a.stockTotal <= 0
                          ? "bg-danger-soft text-danger-soft-foreground flex size-8 shrink-0 items-center justify-center rounded-xl"
                          : "bg-warning-soft text-warning-soft-foreground flex size-8 shrink-0 items-center justify-center rounded-xl"
                      }
                    >
                      <AlertTriangle className="size-4" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.nombre}</span>
                      <span className="text-muted text-sm">{a.sku}</span>
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      <span className="block font-semibold">
                        {a.stockTotal <= 0 ? "Sin stock" : `${formatearNumero(a.stockTotal)} u.`}
                      </span>
                      <span className="text-muted">mín. {formatearNumero(a.stockMinimo)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Seccion>
          </div>
        </>
      )}

      {accesos.length > 0 && <AccesosRapidos items={accesos} />}
    </div>
  );
}

function Kpi({ label, k }: { label: string; k: KpiVentas }) {
  return (
    <StatCard label={label} value={formatearPesos(k.total)} hint={ventas(k.cantidad)}>
      {k.costo !== null && k.ganancia !== null && (
        <dl className="border-border mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
          <div>
            <dt className="text-muted">Costo</dt>
            <dd className="font-medium tabular-nums">{formatearPesos(k.costo)}</dd>
          </div>
          <div>
            <dt className="text-muted">Ganancia bruta</dt>
            <dd className="text-success font-semibold tabular-nums">
              {formatearPesos(k.ganancia)}
            </dd>
          </div>
        </dl>
      )}
    </StatCard>
  );
}

function Seccion({
  titulo,
  extra,
  accion,
  vacio,
  className,
  children,
}: {
  titulo: string;
  extra?: ReactNode;
  accion?: { href: string; label: string };
  /** Texto a mostrar en lugar del contenido si no hay datos. */
  vacio: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {titulo}
          {extra}
        </CardTitle>
        {accion && (
          <Link
            href={accion.href}
            className="text-primary -my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium hover:underline"
          >
            {accion.label}
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          </Link>
        )}
      </CardHeader>
      <CardContent className="pt-3 md:pt-4">
        {vacio ? (
          <p className="text-muted flex min-h-24 items-center justify-center gap-2 text-center text-sm">
            <Package className="size-4" strokeWidth={1.75} aria-hidden />
            {vacio}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function AccesosRapidos({ items }: { items: ItemNavegacion[] }) {
  return (
    <section aria-labelledby="accesos" className="flex flex-col gap-4">
      <h2 id="accesos" className="text-lg font-semibold tracking-tight">
        Accesos rápidos
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icono = item.icon;
          return (
            <li key={`${item.global ? "g" : "p"}${item.href}`}>
              <Link
                href={item.href}
                className="group border-border bg-surface shadow-card hover:border-input hover:shadow-card-hover flex h-full min-h-16 items-center gap-4 rounded-2xl border p-4 transition-[border-color,box-shadow]"
              >
                <span className="bg-primary-soft text-primary-soft-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <Icono className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.label}</span>
                  <span className="text-muted block truncate text-sm">{item.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-muted size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
