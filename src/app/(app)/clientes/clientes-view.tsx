"use client";

import { Modulo } from "@prisma/client";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm } from "@/components/clientes/cliente-form";
import { usePuede } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { formatearPesos } from "@/lib/format";
import { cn, formatearFecha } from "@/lib/utils";
import type { ClienteListado } from "@/server/services/cliente.service";

export function ClientesView({
  resultado,
  params,
  puedeDefinirLimite,
}: {
  resultado: { clientes: ClienteListado[]; total: number; page: number; pageSize: number };
  params: Record<string, string>;
  puedeDefinirLimite: boolean;
}) {
  const router = useRouter();
  const puedeCrear = usePuede(Modulo.CLIENTES, "crear");
  const [nuevo, setNuevo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const conDeuda = params.conDeuda === "1";

  const saldo = (c: ClienteListado) => (
    <span className="flex flex-col items-end text-sm tabular-nums">
      {Number(c.saldoDeudor) > 0 && (
        <span className="text-danger font-semibold">debe {formatearPesos(c.saldoDeudor)}</span>
      )}
      {Number(c.saldoAFavor) > 0 && (
        <span className="text-success font-semibold">a favor {formatearPesos(c.saldoAFavor)}</span>
      )}
      {Number(c.saldoDeudor) === 0 && Number(c.saldoAFavor) === 0 && (
        <span className="text-muted">—</span>
      )}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Cuenta corriente, compras y saldos"
        actions={
          puedeCrear && (
            <Button onClick={() => setNuevo(true)}>
              <Plus /> Nuevo cliente
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <SearchInput placeholder="Nombre, DNI o teléfono" />
        <ChipRow ariaLabel="Filtros">
          <ChipLink
            href={hrefCon("/clientes", params, { conDeuda: null, page: null })}
            activo={!conDeuda}
          >
            Todos
          </ChipLink>
          <ChipLink
            href={hrefCon("/clientes", params, { conDeuda: "1", page: null })}
            activo={conDeuda}
          >
            Con deuda
          </ChipLink>
        </ChipRow>
      </div>
      <DataTable
        caption="Clientes"
        rows={resultado.clientes}
        getRowKey={(c) => c.id}
        empty={<EmptyState icon={Users} title="No hay clientes" />}
        columns={[
          {
            key: "nombre",
            header: "Nombre",
            cell: (c) => (
              <Link href={`/clientes/${c.id}`} className="text-primary font-medium hover:underline">
                {c.nombre}
              </Link>
            ),
          },
          {
            key: "telefono",
            header: "Teléfono",
            cell: (c) => <span className="text-muted">{c.telefono ?? "—"}</span>,
          },
          {
            key: "documento",
            header: "Documento",
            cell: (c) => <span className="text-muted tabular-nums">{c.documento ?? "—"}</span>,
          },
          { key: "saldo", header: "Saldo", className: "text-right", cell: saldo },
          {
            key: "limite",
            header: "Límite",
            className: "text-right tabular-nums",
            cell: (c) =>
              c.limiteCredito ? (
                formatearPesos(c.limiteCredito)
              ) : (
                <span className="text-muted">sin fiado</span>
              ),
          },
          {
            key: "ultima",
            header: "Última compra",
            cell: (c) => <span className="text-muted">{formatearFecha(c.ultimaCompra)}</span>,
          },
        ]}
        renderMobile={(c) => (
          <Link
            href={`/clientes/${c.id}`}
            className={cn(
              "border-border bg-surface flex items-center justify-between gap-3 rounded-xl border p-4",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.nombre}</span>
              <span className="text-muted block truncate text-xs">
                {[
                  c.telefono,
                  c.ultimaCompra ? `última compra ${formatearFecha(c.ultimaCompra)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Sin compras"}
              </span>
            </span>
            {saldo(c)}
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={resultado.page}
        pageSize={resultado.pageSize}
        total={resultado.total}
        pathname="/clientes"
        params={params}
      />
      <Sheet
        open={nuevo}
        onOpenChange={setNuevo}
        title="Nuevo cliente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNuevo(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form="form-cliente" loading={enviando}>
              Crear
            </Button>
          </>
        }
      >
        {nuevo && (
          <ClienteForm
            formId="form-cliente"
            cliente={null}
            puedeDefinirLimite={puedeDefinirLimite}
            onEnviando={setEnviando}
            onListo={(c) => {
              setNuevo(false);
              router.push(`/clientes/${c.id}`);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
