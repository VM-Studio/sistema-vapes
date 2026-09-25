import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatearPesos } from "@/lib/format";
import { formatearFechaHora } from "@/lib/utils";
import { requireAccesoCaja } from "@/server/auth/caja-acceso";
import { AppError } from "@/server/errors";
import { obtenerCaja } from "@/server/services/caja.service";

import { CompartirCierre } from "./compartir-cierre";

export const metadata: Metadata = { title: "Caja" };

export default async function CajaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireAccesoCaja(id);
  } catch (e) {
    if (e instanceof AppError) redirect(e.status === 401 ? "/login" : "/sin-acceso");
    throw e;
  }
  const c = await obtenerCaja(id);
  const dif = c.diferencia === null ? null : Number(c.diferencia);
  return (
    <>
      <PageHeader
        title={`Caja · ${c.deposito.nombre}`}
        subtitle={
          <>
            <Link href="/caja" className="text-primary hover:underline">
              Caja
            </Link>{" "}
            · Abierta {formatearFechaHora(c.abiertaAt)} por {c.abiertaPor}
            {c.cerradaAt && ` · cerrada ${formatearFechaHora(c.cerradaAt)} por ${c.cerradaPor}`}
          </>
        }
        actions={
          <>
            <a
              href={`/api/caja/${c.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "secondary" })}
            >
              <FileText /> PDF {c.estado === "CERRADA" ? "del cierre" : "del estado"}
            </a>
            <CompartirCierre cajaId={c.id} deposito={c.deposito.nombre} diferencia={c.diferencia} />
          </>
        }
      />
      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Estado"
          value={c.estado === "ABIERTA" ? "Abierta" : "Cerrada"}
          hint={c.requiereRevision ? "Para revisar" : undefined}
          tono={c.requiereRevision ? "alerta" : "neutral"}
        />
        <StatCard label="Esperado" value={formatearPesos(c.montoEsperado ?? c.totales.esperado)} />
        <StatCard label="Contado" value={formatearPesos(c.montoContado)} />
        <StatCard
          label="Diferencia"
          value={dif === null ? "—" : `${dif > 0 ? "+" : ""}${formatearPesos(c.diferencia)}`}
          tono={dif === null || dif === 0 ? "neutral" : "alerta"}
        />
      </section>
      {c.observaciones && (
        <p className="bg-warning-soft text-warning-soft-foreground mb-4 rounded-xl px-4 py-3 text-sm">
          Observaciones: {c.observaciones}
        </p>
      )}
      <DataTable
        caption="Movimientos de la caja"
        rows={c.movimientos}
        getRowKey={(m) => m.id}
        columns={[
          {
            key: "f",
            header: "Hora",
            cell: (m) => <span className="text-muted">{formatearFechaHora(m.fecha)}</span>,
          },
          {
            key: "t",
            header: "Tipo",
            cell: (m) => (
              <Badge
                variant={
                  Number(m.monto) < 0
                    ? "danger"
                    : m.tipo === "APERTURA" || m.tipo === "CIERRE"
                      ? "neutral"
                      : "success"
                }
              >
                {m.etiqueta}
              </Badge>
            ),
          },
          {
            key: "d",
            header: "Detalle",
            cell: (m) =>
              m.href ? (
                <Link href={m.href} className="text-primary hover:underline">
                  {m.descripcion ?? m.etiqueta}
                </Link>
              ) : (
                (m.descripcion ?? "")
              ),
          },
          { key: "u", header: "Usuario", cell: (m) => m.usuario },
          {
            key: "m",
            header: "Monto",
            className: "text-right tabular-nums font-medium",
            cell: (m) => formatearPesos(m.monto),
          },
        ]}
      />
    </>
  );
}
