import { Modulo } from "@prisma/client";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import {
  CONDICION_IVA_LABEL,
  ESTADO_FACTURA_UI,
  formatearCuit,
  TIPO_FACTURA_LABEL,
} from "@/lib/validations/factura";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtener } from "@/server/services/factura.service";

import { AccionesFactura } from "./acciones-factura";

export const metadata: Metadata = { title: "Factura" };

export default async function FacturaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.FACTURAS, "ver");
  const { slug } = ctx.panel;
  const f = await obtener(ctx, (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const pdf = `/api/p/${slug}/facturas/${f.id}/pdf`;
  const datos: [string, string][] = [
    ["Fecha", formatearFecha(f.fecha)],
    ["Punto de venta", String(f.puntoVenta).padStart(4, "0")],
    ["Número fiscal", f.numeroExterno ?? "—"],
    ["Cliente", f.razonSocial ?? f.cliente.nombre],
    ...(f.cuit ? ([["CUIT", formatearCuit(f.cuit)]] as [string, string][]) : []),
    ...(f.condicionIva
      ? ([["Condición IVA", CONDICION_IVA_LABEL[f.condicionIva]]] as [string, string][])
      : []),
    ...(f.domicilio ? ([["Domicilio", f.domicilio]] as [string, string][]) : []),
    ["Registró", `${f.usuario} · ${formatearFechaHora(f.createdAt)}`],
  ];
  return (
    <>
      <PageHeader
        title={`${TIPO_FACTURA_LABEL[f.tipo]} ${f.codigo}`}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Facturas", href: rutaPanel(slug, "/facturas/comunes") },
              { label: f.codigo },
            ]}
          />
        }
        actions={
          <>
            <a
              href={pdf}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: "secondary" })}
              data-testid="pdf-factura"
            >
              <FileText strokeWidth={1.75} /> {f.tieneArchivo ? "Ver factura" : "Ver comprobante"}
            </a>
            <AccionesFactura
              id={f.id}
              codigo={f.codigo}
              emitida={f.estado === "EMITIDA"}
              numeroExterno={f.numeroExterno}
              interna={f.tipo === "COMPROBANTE_INTERNO"}
              puedeEditar={puede(ctx.usuario, ctx.panelId, Modulo.FACTURAS, "editar")}
              puedeAnular={esOwner(ctx.usuario)}
            />
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {f.anulacion && (
          <p className="bg-danger-soft text-danger-soft-foreground rounded-card px-4 py-3 text-sm">
            Anulada por {f.anulacion.por} el {formatearFechaHora(f.anulacion.at)}:{" "}
            {f.anulacion.motivo}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <SectionCard title="Renglones">
            <ul className="divide-border border-border bg-surface rounded-card flex flex-col divide-y border">
              {f.items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{i.descripcion}</p>
                    <p className="text-muted text-small tabular-nums">
                      {i.cantidad} × {formatearPesos(i.precioUnitario)}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatearPesos(i.subtotal)}</p>
                </li>
              ))}
              <li className="flex flex-col gap-1 px-4 py-3 text-sm">
                {Number(f.descuento) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Descuento</span>
                    <span className="tabular-nums">−{formatearPesos(f.descuento)}</span>
                  </div>
                )}
                {f.tipo === "A" && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted">Neto gravado</span>
                      <span className="tabular-nums">{formatearPesos(f.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">
                        IVA {Number(f.alicuotaIva).toLocaleString("es-AR")}%
                      </span>
                      <span className="tabular-nums">{formatearPesos(f.iva)}</span>
                    </div>
                  </>
                )}
                <div className="text-h3 flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums" data-testid="total-factura">
                    {formatearPesos(f.total)}
                  </span>
                </div>
              </li>
            </ul>
          </SectionCard>
          <SectionCard
            title="Datos"
            action={
              <Badge variant={ESTADO_FACTURA_UI[f.estado].variante}>
                {ESTADO_FACTURA_UI[f.estado].label}
              </Badge>
            }
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              {datos.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
              <dt className="text-muted">Venta</dt>
              <dd className="text-right font-medium">
                {f.venta ? (
                  <Link
                    href={rutaPanel(slug, `/ventas/${f.venta.id}`)}
                    className="font-mono hover:underline"
                  >
                    {f.venta.codigo}
                  </Link>
                ) : (
                  "Suelta"
                )}
              </dd>
            </dl>
            {f.observacion && <p className="text-muted mt-3 text-sm">{f.observacion}</p>}
            {f.tipo === "COMPROBANTE_INTERNO" && (
              <p className="text-muted text-small mt-3">Comprobante no válido como factura.</p>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
