import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { calcularComision, detalle, type ComisionListada } from "@/server/services/pasista.service";

import { DeshacerPago, MarcarPagado } from "../acciones-pasista";

export const metadata: Metadata = { title: "Comisión del pasista" };

/** Detalle de una comisión del pasista: la compra completa (productos, sabores, cantidades y fechas). */
export default async function ComisionPasistaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.PASISTA, "ver");
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const { id } = await params;
  const d = await detalle(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { comision: c, compra, totales } = d;
  const owner = esOwner(ctx.usuario);
  const verCompra = puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "ver");
  const filas: ComisionListada[] = [c, ...d.relacionadas].sort((a, b) =>
    a.tipo.localeCompare(b.tipo),
  );
  // La fila ORIGINAL (si se borró por deshacer y juntar, la que se está viendo).
  const original = filas.find((f) => f.tipo === "ORIGINAL") ?? c;
  const ajustes = filas.filter((f) => f.tipo === "AJUSTE");

  return (
    <>
      <PageHeader
        title={`Comisión de ${compra.codigo}`}
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Pasista", href: ruta("/pasista") }, { label: compra.codigo }]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {compra.proveedor ?? "Sin proveedor"}
            <Badge variant={ESTADO_COMPRA_UI[compra.estado].variante}>
              Compra {ESTADO_COMPRA_UI[compra.estado].label.toLowerCase()}
            </Badge>
          </span>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <SectionCard
          title="Productos de la compra"
          description={`${compra.items.length} ${compra.items.length === 1 ? "producto" : "productos"} · ${formatearNumero(compra.unidades)} unidades`}
          className="lg:col-span-2"
        >
          <DataTable
            caption="Ítems de la compra"
            rows={compra.items}
            getRowKey={(i) => i.varianteId}
            columns={[
              {
                key: "producto",
                header: "Producto",
                cell: (i) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{i.producto}</span>
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
                className: "text-right tabular-nums",
                cell: (i) => formatearNumero(i.cantidad),
              },
              {
                key: "costo",
                header: "Costo",
                className: "text-right tabular-nums",
                cell: (i) => formatearPesos(i.costoUnitario),
              },
              {
                key: "final",
                header: "Costo final",
                className: "text-right tabular-nums",
                cell: (i) => formatearPesos(i.costoUnitarioFinal),
              },
              {
                key: "subtotal",
                header: "Subtotal",
                className: "text-right tabular-nums font-medium",
                cell: (i) => formatearPesos(i.subtotal),
              },
            ]}
            renderMobile={(i) => (
              <div className="border-border bg-surface rounded-card flex items-start justify-between gap-3 border p-4">
                <div className="min-w-0">
                  <p className="font-medium">{i.producto}</p>
                  <p className="text-muted text-small">
                    {i.sabor ? `${i.sabor} · ` : ""}
                    {i.cantidad} u. × {formatearPesos(i.costoUnitario)}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{formatearPesos(i.subtotal)}</p>
              </div>
            )}
          />
          <p
            className="border-border mt-3 flex items-baseline justify-between gap-3 border-t pt-3 font-semibold"
            aria-label="Total de los productos"
          >
            <span>Total de los productos ({formatearNumero(compra.unidades)} u.)</span>
            <span className="tabular-nums">{formatearPesos(compra.subtotal)}</span>
          </p>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard
            title="Cálculo de la comisión"
            description="Sobre el total de la compra (sin gastos extras)."
          >
            <dl className="flex flex-col gap-2 text-sm" aria-label="Cálculo de la comisión">
              <Linea label="Productos" valor={formatearPesos(compra.subtotal)} />
              {Number(compra.descuento) > 0 && (
                <Linea label="Descuento" valor={`− ${formatearPesos(compra.descuento)}`} />
              )}
              <Linea label="Total de la compra" valor={formatearPesos(original.base)} fuerte />
              {original.porcentaje && (
                <Linea
                  label={`× ${formatearNumero(Number(original.porcentaje))}% del pasista`}
                  valor={formatearPesos(calcularComision(original.base, original.porcentaje))}
                />
              )}
              {ajustes.map((a) => (
                <Linea
                  key={a.id}
                  label={a.observacion ?? "Ajuste"}
                  valor={`${Number(a.monto) > 0 ? "+ " : "− "}${formatearPesos(Math.abs(Number(a.monto)))}`}
                />
              ))}
              <div className="border-border mt-1 flex items-baseline justify-between gap-3 border-t pt-2">
                <dt className="font-semibold">Comisión total</dt>
                <dd className="text-h3 font-semibold tabular-nums" aria-label="Comisión total">
                  {formatearPesos(totales.total)}
                </dd>
              </div>
              <Linea label="Pagado" valor={formatearPesos(totales.pagado)} />
              <Linea label="Pendiente" valor={formatearPesos(totales.pendiente)} fuerte />
            </dl>
            {original.base !== compra.total && compra.estado !== "ANULADA" && (
              <p className="text-muted text-small mt-3">
                La comisión pagada se calculó sobre {formatearPesos(original.base)}; hoy la compra
                suma {formatearPesos(compra.total)} y la diferencia va como ajuste.
              </p>
            )}
            {compra.estado === "ANULADA" && (
              <p className="text-muted text-small mt-3">
                La compra está anulada: no genera comisión
                {Number(totales.total) !== 0 ? " (queda el saldo a descontar)" : ""}.
              </p>
            )}
          </SectionCard>
          <SectionCard title="Comisión" contentClassName="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {filas.map((f) => (
                <li key={f.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {f.tipo === "AJUSTE"
                        ? "Ajuste"
                        : `Comisión ${f.porcentaje ? `${formatearNumero(Number(f.porcentaje))}%` : ""}`}
                    </span>
                    <strong className="text-h3 tabular-nums">{formatearPesos(f.monto)}</strong>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {f.estado === "PAGADA" ? (
                      <Badge variant="success">Pagada</Badge>
                    ) : (
                      <Badge variant="warning">Pendiente</Badge>
                    )}
                    {owner &&
                      (f.estado === "PENDIENTE" ? (
                        <MarcarPagado
                          objetivo={{ ids: [f.id] }}
                          titulo={`Marcar pagada la comisión de ${compra.codigo}`}
                          resumen={formatearPesos(f.monto)}
                          textoBoton="Marcar pagada"
                          variante="secondary"
                          size="sm"
                        />
                      ) : (
                        <DeshacerPago id={f.id} etiqueta={compra.codigo} />
                      ))}
                  </div>
                  {f.estado === "PAGADA" && f.pagadaAt && (
                    <p className="text-muted text-small">
                      Pagada el {formatearFecha(f.pagadaAt)}
                      {f.medioPago ? ` · ${ETIQUETA_MEDIO_PAGO[f.medioPago]}` : ""}
                      {f.referencia ? ` · ${f.referencia}` : ""}
                      {f.pagadaPor ? ` · ${f.pagadaPor}` : ""}
                    </p>
                  )}
                  {f.observacion && <p className="text-subtle text-xs">{f.observacion}</p>}
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title="Datos de la compra">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-1">
              <Dato label="Compra">
                {verCompra ? (
                  <Link
                    href={ruta(`/compras/${compra.id}`)}
                    className="font-mono font-semibold underline underline-offset-4"
                  >
                    {compra.codigo}
                  </Link>
                ) : (
                  <span className="font-mono font-semibold">{compra.codigo}</span>
                )}
              </Dato>
              <Dato label="Fecha de la compra">{formatearFechaHora(compra.fecha)}</Dato>
              <Dato label="Recibida">
                {compra.recibidaAt ? formatearFechaHora(compra.recibidaAt) : "Todavía no"}
              </Dato>
              <Dato label="Galpón">{compra.deposito}</Dato>
              <Dato label="Cargada por">{compra.cargadaPor}</Dato>
              <Dato label="Total de la compra">{formatearPesos(compra.total)}</Dato>
              <Dato label="Gastos extras">
                {formatearPesos(compra.gastosExtrasTotal)}
                {compra.gastos.length > 0 && (
                  <ul className="text-subtle mt-1 flex flex-col gap-0.5 text-xs">
                    {compra.gastos.map((g) => (
                      <li key={g.id} className="flex justify-between gap-3">
                        <span className="truncate">{g.motivo}</span>
                        <span className="tabular-nums">{formatearPesos(g.monto)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Dato>
              <Dato label="Costo final">
                <span className={cn("font-semibold")}>
                  {formatearPesos(compra.costoFinalTotal)}
                </span>{" "}
                <span className="text-muted">
                  ({formatearPesos(compra.costoUnitarioFinalPromedio)} / u.)
                </span>
              </Dato>
            </dl>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted text-small">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Linea({ label, valor, fuerte }: { label: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={fuerte ? "font-medium" : "text-muted"}>{label}</dt>
      <dd className={cn("tabular-nums", fuerte && "font-semibold")}>{valor}</dd>
    </div>
  );
}
