import { Modulo } from "@prisma/client";
import { ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditarComisionPasista } from "@/components/compras/comision-pasista";
import { CostoFinalPorUnidad } from "@/components/compras/costo-final-por-unidad";
import { BotonGastosCompra } from "@/components/compras/gastos-compra-sheet";
import { EnUsdt, pesosAUsdt, ResumenCompraCard } from "@/components/compras/resumen-compra-card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { calcularCostosFinales } from "@/lib/costos-compra";
import { formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import {
  cotizacionResumenCompra,
  obtenerCompra,
  preciosQueCambian,
} from "@/server/services/compra.service";
import { obtenerConfigCompras } from "@/server/services/configuracion.service";
import { comisionesDeCompra } from "@/server/services/pasista.service";
import { veCostosCompras } from "@/server/services/proveedor.service";

import { AccionesCompra } from "./acciones-compra";

export const metadata: Metadata = { title: "Compra" };

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "ver");
  const { usuario, panelId, panel } = ctx;
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  const { id } = await params;
  const c = await obtenerCompra(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const idVisible = formatearIdCompra(panel.slug, c.numero);
  const verCostos = veCostosCompras(ctx);
  const puedeEditar = puede(usuario, panelId, Modulo.COMPRAS, "editar");
  const cambios = c.estado === "BORRADOR" && puedeEditar ? await preciosQueCambian(ctx, c.id) : [];
  const verMovimientos = c.movimientos > 0 && puede(usuario, panelId, Modulo.STOCK, "ver");

  const verProveedor = c.proveedorId && puede(usuario, panelId, Modulo.PROVEEDORES, "ver");
  const barraMobile = c.estado === "BORRADOR" && puedeEditar;
  const editaCostos = verCostos && puedeEditar && c.estado !== "ANULADA";
  const configCompras = editaCostos ? await obtenerConfigCompras(ctx) : null;
  const gastosVigentes = c.gastos.filter((g) => !g.anulado);
  // Enlace a Pasista (la comisión de esta compra y su estado de pago).
  const verPasista = puede(usuario, panelId, Modulo.PASISTA, "ver");
  const comisiones = verPasista ? await comisionesDeCompra(ctx, c.id) : [];
  const comisionPagada = comisiones.length > 0 && comisiones.every((x) => x.estado === "PAGADA");
  // Costo final por modelo (misma función que el servidor) y equivalentes en USDT:
  // con la cotización guardada en la compra; si no tiene, con la vigente.
  const costos = calcularCostosFinales({
    items: c.items.map((i) => ({ cantidad: i.cantidad, costoUnitario: i.costoUnitario })),
    descuento: c.descuento,
    comisionPorcentaje: c.comisionPasistaPorcentaje,
    gastos: gastosVigentes.map((g) => g.monto),
  });
  const cotizacion = verCostos ? await cotizacionResumenCompra(c.tipoCambioUSDT) : null;
  const pendiente = c.estado === "BORRADOR";
  /** " (≈ 1,20 USDT)" para los textos de la vista mobile. */
  const textoUsdt = (pesos: string) => {
    const u = pesosAUsdt(Number(pesos), cotizacion);
    return u === null ? "" : ` (≈ ${formatearUsdt(u)})`;
  };

  return (
    <>
      <PageHeader
        title={`Compra ${idVisible}`}
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Compras", href: ruta("/compras") }, { label: idVisible }]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.proveedor ?? "Sin proveedor"}
            <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
              {ESTADO_COMPRA_UI[c.estado].label}
            </Badge>
          </span>
        }
        actions={
          <AccionesCompra
            id={c.id}
            idVisible={idVisible}
            estado={c.estado}
            unidades={c.unidades}
            deposito={c.deposito}
            proveedor={c.proveedorNombre ?? "el proveedor"}
            cambios={cambios}
            puedeEditar={puedeEditar}
            puedeAnular={puede(usuario, panelId, Modulo.COMPRAS, "eliminar")}
          />
        }
      />
      {pendiente && (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-card text-small mb-4 px-4 py-3">
          Compra confirmada, <strong>pendiente de recibir</strong>: todavía no sumó stock. Cuando
          llegue la mercadería tocá «Recibido» y ahí ingresa a {c.deposito}.
        </p>
      )}
      {verCostos && (
        <ResumenCompraCard
          className="mb-4"
          costos={costos}
          sabores={c.items.length}
          modelos={new Set(c.items.map((i) => i.productoId)).size}
          cotizacion={cotizacion}
        />
      )}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <SectionCard
          title="Productos"
          description={`${c.items.length} ${c.items.length === 1 ? "producto" : "productos"} · ${formatearNumero(c.unidades)} unidades`}
          className="lg:col-span-2"
          contentClassName="flex flex-col gap-4"
        >
          <DataTable
            caption="Ítems"
            rows={c.items}
            getRowKey={(i) => i.varianteId}
            columns={[
              {
                key: "producto",
                header: "Producto",
                cell: (i) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{i.nombreCompleto}</span>
                    <span className="text-subtle text-xs">
                      {i.sabor ? `${i.sabor} · ` : ""}
                      {i.sku}
                    </span>
                  </span>
                ),
              },
              {
                key: "cantidad",
                header: "Cantidad",
                className: "text-right",
                cell: (i) => formatearNumero(i.cantidad),
              },
              ...(verCostos
                ? [
                    {
                      key: "costo",
                      header: "Costo unitario",
                      className: "text-right",
                      cell: (i: (typeof c.items)[number]) => (
                        <span className="flex flex-col items-end">
                          <span className="text-muted">{formatearPesos(i.costoUnitario)}</span>
                          {i.costoUnitarioUSDT ? (
                            <span className="text-subtle text-xs">
                              {formatearUsdt(i.costoUnitarioUSDT)}
                            </span>
                          ) : (
                            <EnUsdt pesos={i.costoUnitario} cotizacion={cotizacion} />
                          )}
                        </span>
                      ),
                    },
                    {
                      key: "costoFinal",
                      header: "Costo final",
                      className: "text-right",
                      cell: (i: (typeof c.items)[number]) => (
                        <span className="flex flex-col items-end">
                          <span
                            className={cn(
                              "tabular-nums",
                              i.costoUnitarioFinal !== i.costoUnitario && "font-medium",
                            )}
                          >
                            {formatearPesos(i.costoUnitarioFinal)}
                          </span>
                          <EnUsdt pesos={i.costoUnitarioFinal} cotizacion={cotizacion} />
                        </span>
                      ),
                    },
                    {
                      key: "subtotal",
                      header: "Subtotal",
                      className: "text-right font-medium",
                      cell: (i: (typeof c.items)[number]) => (
                        <span className="flex flex-col items-end">
                          {formatearPesos(i.subtotal)}
                          <EnUsdt pesos={i.subtotal} cotizacion={cotizacion} />
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
            renderMobile={(i) => (
              <div className="border-border bg-surface rounded-card flex items-start justify-between gap-3 border p-4">
                <div className="min-w-0">
                  <p className="font-medium">{i.nombreCompleto}</p>
                  <p className="text-muted text-small">
                    {i.sabor ? `${i.sabor} · ` : ""}
                    {i.sku} · {i.cantidad} u.
                    {verCostos && ` × ${formatearPesos(i.costoUnitario)}`}
                    {verCostos &&
                      (i.costoUnitarioUSDT
                        ? ` (${formatearUsdt(i.costoUnitarioUSDT)})`
                        : textoUsdt(i.costoUnitario))}
                  </p>
                  {verCostos && i.costoUnitarioFinal !== i.costoUnitario && (
                    <p className="text-small">
                      Costo final <strong>{formatearPesos(i.costoUnitarioFinal)}</strong>
                      <span className="text-subtle text-xs">{textoUsdt(i.costoUnitarioFinal)}</span>
                    </p>
                  )}
                </div>
                {verCostos && (
                  <p className="flex shrink-0 flex-col items-end font-semibold tabular-nums">
                    {formatearPesos(i.subtotal)}
                    <EnUsdt pesos={i.subtotal} cotizacion={cotizacion} />
                  </p>
                )}
              </div>
            )}
          />
          <div className="border-border flex items-baseline justify-between gap-3 border-t pt-4">
            <span className="text-h3 font-semibold">
              Total{" "}
              <span className="text-muted text-small font-normal">({c.unidades} unidades)</span>
            </span>
            {verCostos && (
              <span className="flex flex-col items-end">
                <span className="text-h2 font-semibold tabular-nums">
                  {formatearPesos(c.total)}
                </span>
                <EnUsdt pesos={c.total} cotizacion={cotizacion} className="text-small" />
              </span>
            )}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          {verCostos && (comisiones[0] || (editaCostos && configCompras)) && (
            <SectionCard
              title="Comisión y gastos"
              description="Cambiarlos recalcula el costo final de cada modelo."
              contentClassName="flex flex-col gap-4"
            >
              {gastosVigentes.length > 0 && (
                <ul className="text-muted flex flex-col gap-1 text-sm">
                  {gastosVigentes.map((g) => (
                    <li key={g.id} className="flex justify-between gap-3">
                      <span className="truncate">{g.motivo}</span>
                      <span className="flex flex-col items-end tabular-nums">
                        {formatearPesos(g.monto)}
                        <EnUsdt pesos={g.monto} cotizacion={cotizacion} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {comisiones[0] && (
                <Link
                  href={ruta(`/pasista/${comisiones[0].id}`)}
                  className="text-small flex items-center justify-end gap-1 self-end underline-offset-4 hover:underline"
                >
                  <Badge variant={comisionPagada ? "success" : "warning"}>
                    {comisionPagada ? "Pagada" : "Pendiente"}
                  </Badge>
                  Ver comisión en Pasista
                  <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
                </Link>
              )}
              {editaCostos && configCompras && (
                <div className="border-border flex flex-col gap-3 border-t pt-4">
                  <EditarComisionPasista
                    compraId={c.id}
                    porcentajeActual={c.comisionPasistaPorcentaje}
                    porcentajeDefault={configCompras.comisionPasistaPorcentajeDefault}
                  />
                  <BotonGastosCompra
                    compraId={c.id}
                    idVisible={idVisible}
                    puedeAnular={esOwner(usuario)}
                    size="md"
                  />
                </div>
              )}
            </SectionCard>
          )}
          <SectionCard title="Datos de la compra">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-1">
              <Dato label="Fecha">{formatearFechaHora(c.fecha)}</Dato>
              <Dato label="Galpón">{c.deposito}</Dato>
              <Dato label="Proveedor">
                {verProveedor ? (
                  <Link
                    href={ruta(`/proveedores/${c.proveedorId}`)}
                    className="font-medium underline underline-offset-4"
                  >
                    {c.proveedor}
                  </Link>
                ) : (
                  (c.proveedor ?? "—")
                )}
              </Dato>
              <Dato label="Cargada por">{c.usuario}</Dato>
              {verCostos && c.tipoCambioUSDT && (
                <Dato label="Cotización USDT usada">
                  <span className="tabular-nums">{formatearPesos(c.tipoCambioUSDT)} por USDT</span>
                </Dato>
              )}
              {c.notas && (
                <Dato label="Notas" className="col-span-2 lg:col-span-1">
                  <span className="whitespace-pre-line">{c.notas}</span>
                </Dato>
              )}
            </dl>
          </SectionCard>

          {verMovimientos && (
            <Link
              href={ruta(`/stock/movimientos?referenciaTipo=COMPRA&referenciaId=${c.id}`)}
              className={cardVariants({
                variant: "clickable",
                className: "text-body flex min-h-11 items-center gap-3 p-4 font-medium",
              })}
            >
              <History className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">
                Ver los {c.movimientos} movimientos de stock que generó
              </span>
              <ChevronRight
                className="text-subtle size-5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
            </Link>
          )}
        </div>
      </div>
      {verCostos && (
        <CostoFinalPorUnidad
          className="mt-4"
          items={c.items.map((i) => ({
            key: i.varianteId,
            nombreCompleto: i.nombreCompleto,
            sabor: i.sabor,
          }))}
          costos={costos}
          finalesGuardados={c.items.map((i) => i.costoUnitarioFinal)}
          cotizacion={cotizacion}
        />
      )}
      {barraMobile && <div className="h-[4.5rem] md:hidden" aria-hidden />}
    </>
  );
}

function Dato({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-muted text-small">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
