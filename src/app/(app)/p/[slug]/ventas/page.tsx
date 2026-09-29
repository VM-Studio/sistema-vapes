import { Modulo } from "@prisma/client";
import { Plus, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { esFechaISO, fechasDeRango, RANGOS, type Rango } from "@/lib/fechas";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { listarVentasSchema } from "@/lib/validations/venta";
import { ESTADO_VENTA_UI, ETIQUETA_TIPO_VENTA, telefonoVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerClienteBasico } from "@/server/services/cliente.service";
import { prepararConversion } from "@/server/services/cotizacion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import {
  listarVentas,
  unidadesPorDeposito,
  vendedoresDelPanel,
  type VentaListada,
} from "@/server/services/venta.service";

import { MedioPagoBadge } from "./_componentes/medio-pago";
import { FiltrosVentas } from "./filtros-ventas";
import { GenerarVenta } from "./generar-venta";
import type { ConversionVenta } from "./modal-venta";

export const metadata: Metadata = { title: "Ventas" };

type SP = Record<string, string | string[] | undefined>;

export default async function VentasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.VENTAS, "ver");
  const { slug } = ctx.panel;
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  // Por defecto: las ventas de hoy (salvo que se busque un ID o un cliente).
  const sinFechas = !plano.rango && !plano.desde && !plano.hasta && !plano.q;
  const rango: Rango | null = RANGOS.includes(plano.rango as Rango)
    ? (plano.rango as Rango)
    : sinFechas
      ? "hoy"
      : null;
  const todo =
    plano.rango === "todo" || (!plano.rango && !plano.desde && !plano.hasta && !!plano.q);
  const fechas = todo
    ? { desde: "", hasta: "" }
    : rango
      ? fechasDeRango(rango)
      : { desde: plano.desde ?? "", hasta: plano.hasta ?? "" };
  const filtros = listarVentasSchema.parse({ ...plano, desde: fechas.desde, hasta: fechas.hasta });
  const verGanancia = esOwner(ctx.usuario);
  const puedeCrear = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear");
  const [r, depositos, vendedores, unidades] = await Promise.all([
    listarVentas(ctx, filtros, { verCostos: verGanancia }),
    listarDepositosActivos(ctx),
    vendedoresDelPanel(ctx),
    puedeCrear ? unidadesPorDeposito(ctx) : Promise.resolve({}),
  ]);

  // Links "vender a este cliente" / "vender desde este galpón" desde otros módulos.
  const abrirAlCargar =
    puedeCrear && plano.nueva === "1"
      ? {
          depositoId: plano.deposito ?? null,
          cliente: plano.cliente ? await obtenerClienteBasico(ctx, plano.cliente) : null,
        }
      : null;

  // "Convertir en venta" desde el cotizador: ítems y cliente llegan bloqueados.
  const conversion =
    puedeCrear && plano.nueva === "1" && plano.cotizacion
      ? await conversionDeCotizacion(ctx, plano.cotizacion, plano.recalcular === "1")
      : null;

  // Sin búsqueda ni filtros (la vista por defecto: las ventas de hoy).
  const conFiltros = Object.entries(plano).some(([k, v]) => k !== "page" && v !== "");
  const href = (v: VentaListada) => rutaPanel(slug, `/ventas/${v.id}`);
  const estado = (v: VentaListada) => (
    <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>{ESTADO_VENTA_UI[v.estado].label}</Badge>
  );

  return (
    <>
      <PageHeader
        title="Ventas"
        actions={
          puedeCrear && (
            <GenerarVenta
              depositos={depositos}
              unidades={unidades}
              puedeEditar={puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "editar")}
              abrirAlCargar={conversion ? null : abrirAlCargar}
              conversion={conversion}
            />
          )
        }
      />
      <section
        aria-label="Totales del período"
        className={cn(
          "mb-4 grid gap-4 max-md:gap-3",
          r.resumen.gananciaBruta !== null ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2",
        )}
      >
        <StatCard label="Ventas" value={formatearNumero(r.resumen.cantidad)} />
        <StatCard label="Total vendido" value={formatearPesos(r.resumen.total)} />
        {r.resumen.gananciaBruta !== null && (
          <StatCard
            label="Ganancia bruta"
            value={formatearPesos(r.resumen.gananciaBruta)}
            className="max-md:col-span-2"
          />
        )}
      </section>
      <FiltrosVentas
        params={plano}
        rango={todo ? "todo" : rango}
        fechas={{
          desde: esFechaISO(fechas.desde) ? fechas.desde : "",
          hasta: esFechaISO(fechas.hasta) ? fechas.hasta : "",
        }}
        depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre }))}
        vendedores={vendedores}
      />
      <DataTable
        caption="Ventas"
        rows={r.ventas}
        getRowKey={(v) => v.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={ShoppingCart}
              title="No hay ventas con esos filtros"
              action={
                <Link
                  href={rutaPanel(slug, "/ventas")}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Limpiar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={ShoppingCart}
              title="Todavía no hay ventas hoy"
              description="Las ventas del día aparecen acá, con su total y medio de pago. Para ver días anteriores, elegí otro período."
              action={
                puedeCrear ? (
                  <Link href={rutaPanel(slug, "/ventas?nueva=1")} className={buttonVariants()}>
                    <Plus strokeWidth={1.75} /> Generar una venta
                  </Link>
                ) : null
              }
            />
          )
        }
        columns={[
          {
            key: "codigo",
            header: "ID de venta",
            cell: (v) => (
              <Link
                href={href(v)}
                className="text-foreground font-mono font-semibold hover:underline"
              >
                {v.codigo}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha y hora",
            cell: (v) => (
              <span className="text-muted whitespace-nowrap">{formatearFechaHora(v.fecha)}</span>
            ),
          },
          {
            key: "cliente",
            header: "Cliente",
            cell: (v) => (
              <span className="flex flex-col">
                <span className="font-medium">{v.cliente.nombre}</span>
                <span className="text-muted text-xs tabular-nums">
                  {telefonoVisible(v.cliente.telefono)}
                </span>
              </span>
            ),
          },
          { key: "vendedor", header: "Vendedor", cell: (v) => v.vendedor },
          { key: "deposito", header: "Galpón", cell: (v) => v.deposito },
          {
            key: "items",
            header: "Ítems",
            className: "text-right tabular-nums",
            cell: (v) => `${v.unidades} u.`,
          },
          { key: "medio", header: "Pago", cell: (v) => <MedioPagoBadge medio={v.medioPago} /> },
          {
            key: "tipo",
            header: "Tipo",
            cell: (v) => (
              <Badge variant={v.tipo === "MAYORISTA" ? "primary" : "neutral"}>
                {ETIQUETA_TIPO_VENTA[v.tipo]}
              </Badge>
            ),
          },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums",
            cell: (v) => (
              <span
                className={cn(
                  "font-semibold whitespace-nowrap",
                  v.estado === "ANULADA" && "text-muted line-through",
                )}
              >
                {formatearPesos(v.total)}
              </span>
            ),
          },
          { key: "estado", header: "Estado", cell: estado },
        ]}
        renderMobile={(v) => (
          <Link
            href={href(v)}
            className={cn(cardVariants({ variant: "clickable" }), "flex flex-col gap-2 p-4")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{v.codigo}</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  v.estado === "ANULADA" && "text-muted line-through",
                )}
              >
                {formatearPesos(v.total)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {v.cliente.nombre}{" "}
                <span className="text-muted tabular-nums">
                  · {telefonoVisible(v.cliente.telefono)}
                </span>
              </span>
              <MedioPagoBadge medio={v.medioPago} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted text-small">
                {formatearFechaHora(v.fecha)} · {v.vendedor} · {v.deposito} · {v.unidades} u.
                {v.tipo === "MAYORISTA" && " · Mayorista"}
              </p>
              {estado(v)}
            </div>
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={rutaPanel(slug, "/ventas")}
        params={plano}
      />
      {puedeCrear && <div className="h-[4.5rem] md:hidden" aria-hidden />}
    </>
  );
}

/**
 * Datos de la cotización para el modal. Si está vencida y el vendedor
 * confirmó recalcular, los precios pasan a los de hoy. Sin permiso en el
 * cotizador o si ya no se puede convertir, el modal no se abre.
 */
async function conversionDeCotizacion(
  ctx: Awaited<ReturnType<typeof requirePaginaPanel>>,
  cotizacionId: string,
  recalcular: boolean,
): Promise<ConversionVenta | null> {
  if (!puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "ver")) return null;
  const p = await prepararConversion(ctx, cotizacionId).catch(() => null);
  if (!p) return null;
  const usarHoy = p.vencida && recalcular;
  const hoy = new Map(p.cambios.map((c) => [c.titulo, c.despues]));
  return {
    cotizacionId: p.cotizacion.id,
    codigo: p.cotizacion.codigo,
    recalcular: usarHoy,
    descuento: p.cotizacion.descuento,
    items: p.cotizacion.items.map((i) => ({
      varianteId: i.varianteId,
      productoId: "",
      titulo: i.titulo,
      cantidad: i.cantidad,
      precioLista: (usarHoy ? hoy.get(i.titulo) : undefined) ?? i.precioUnitario,
      precioEspecial: null,
    })),
    cliente: !p.cliente
      ? null
      : "id" in p.cliente
        ? { tipo: "existente", ...p.cliente }
        : { tipo: "nuevo", ...p.cliente },
  };
}
