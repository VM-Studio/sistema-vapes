import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { hrefCon } from "@/components/ui/pagination";
import { formatearPesos } from "@/lib/format";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { filtrosCajasSchema } from "@/lib/validations/finanzas";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { estadoCajas, listarCajas, obtenerCaja } from "@/server/services/caja.service";
import { obtenerConfigFinanzas } from "@/server/services/configuracion.service";

import { CajaView } from "./caja-view";

export const metadata: Metadata = { title: "Caja" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CajaPage({ searchParams }: { searchParams: SP }) {
  const usuario = await requirePaginaPermiso(Modulo.CAJA, "ver");
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const owner = esOwner(usuario);
  const config = await obtenerConfigFinanzas();
  const estados = await estadoCajas();
  const abiertas = await Promise.all(
    estados.filter((e) => e.caja).map((e) => obtenerCaja(e.caja!.id)),
  );
  const filtros = filtrosCajasSchema.parse(plano);
  const historico = owner ? await listarCajas(filtros, config.timezone) : null;

  return (
    <>
      <PageHeader
        title="Caja"
        subtitle="Solo el efectivo pasa por la caja: transferencias, débito y MercadoPago se ven en los reportes."
      />
      <CajaView
        cajas={estados.map((e) => ({
          depositoId: e.depositoId,
          deposito: e.deposito,
          ultimoCierre: e.ultimoCierre,
          caja: e.caja ? abiertas.find((a) => a.id === e.caja!.id)! : null,
        }))}
        tolerancia={config.toleranciaArqueo}
        permisos={{ operar: puede(usuario, Modulo.CAJA, "crear"), retirar: owner }}
        inicial={{ depositoId: plano.deposito ?? null, accion: plano.accion ?? null }}
      />

      {historico && (
        <section className="mt-8 flex flex-col gap-3" aria-labelledby="historico">
          <h2 id="historico" className="text-lg font-semibold">
            Histórico de cierres
          </h2>
          <ChipRow ariaLabel="Filtro de diferencias">
            <ChipLink
              href={hrefCon("/caja", plano, { diferencia: null, page: null })}
              activo={!filtros.conDiferencia}
            >
              Todos
            </ChipLink>
            <ChipLink
              href={hrefCon("/caja", plano, { diferencia: "1", page: null })}
              activo={filtros.conDiferencia}
            >
              Con diferencia
            </ChipLink>
          </ChipRow>
          <DataTable
            caption="Cierres de caja"
            rows={historico.cajas}
            getRowKey={(c) => c.id}
            columns={[
              {
                key: "dep",
                header: "Depósito",
                cell: (c) => (
                  <Link href={`/caja/${c.id}`} className="text-primary font-medium hover:underline">
                    {c.deposito}
                  </Link>
                ),
              },
              {
                key: "ap",
                header: "Apertura",
                cell: (c) => `${formatearFechaHora(c.abiertaAt)} · ${c.abiertaPor}`,
              },
              {
                key: "ci",
                header: "Cierre",
                cell: (c) =>
                  c.cerradaAt ? (
                    `${formatearFechaHora(c.cerradaAt)} · ${c.cerradaPor}`
                  ) : (
                    <Badge variant="success">Abierta</Badge>
                  ),
              },
              {
                key: "esp",
                header: "Esperado",
                className: "text-right tabular-nums",
                cell: (c) => formatearPesos(c.montoEsperado),
              },
              {
                key: "con",
                header: "Contado",
                className: "text-right tabular-nums",
                cell: (c) => formatearPesos(c.montoContado),
              },
              {
                key: "dif",
                header: "Diferencia",
                className: "text-right",
                cell: (c) => <Diferencia c={c} />,
              },
            ]}
            renderMobile={(c) => (
              <Link
                href={`/caja/${c.id}`}
                className="border-border bg-surface block rounded-xl border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.deposito}</span>
                  <Diferencia c={c} />
                </div>
                <p className="text-muted mt-1 text-xs">
                  {formatearFechaHora(c.abiertaAt)} →{" "}
                  {c.cerradaAt ? formatearFechaHora(c.cerradaAt) : "abierta"}
                  {c.montoContado && ` · contado ${formatearPesos(c.montoContado)}`}
                </p>
              </Link>
            )}
          />
          <Pagination
            page={historico.page}
            pageSize={historico.pageSize}
            total={historico.total}
            pathname="/caja"
            params={plano}
          />
        </section>
      )}
    </>
  );
}

function Diferencia({ c }: { c: { diferencia: string | null; requiereRevision: boolean } }) {
  if (c.diferencia === null) return <span className="text-muted">—</span>;
  const n = Number(c.diferencia);
  return (
    <span className="inline-flex items-center gap-1.5">
      {c.requiereRevision && <Badge variant="danger">Revisar</Badge>}
      <span
        className={`font-semibold tabular-nums ${n === 0 ? "text-success" : n < 0 ? "text-danger" : "text-warning-soft-foreground"}`}
      >
        {n > 0 ? "+" : ""}
        {formatearPesos(c.diferencia)}
      </span>
    </span>
  );
}
