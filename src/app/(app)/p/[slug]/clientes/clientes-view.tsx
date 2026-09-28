"use client";

import { Modulo } from "@prisma/client";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm } from "@/components/clientes/cliente-form";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { formatearFecha } from "@/lib/utils";
import type { ClienteListado } from "@/server/services/cliente.service";

export function ClientesView({
  resultado,
  params,
}: {
  resultado: { clientes: ClienteListado[]; total: number; page: number; pageSize: number };
  params: Record<string, string>;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const puedeCrear = usePuede(Modulo.CLIENTES, "crear");
  const [nuevo, setNuevo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Datos de contacto e historial de compras"
        actions={
          puedeCrear && (
            <Button onClick={() => setNuevo(true)}>
              <Plus strokeWidth={1.75} /> Nuevo cliente
            </Button>
          )
        }
      />
      <div className="mb-4">
        <SearchInput placeholder="Nombre, DNI o teléfono" />
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
              <Link
                href={ruta(`/clientes/${c.id}`)}
                className="text-primary font-medium hover:underline"
              >
                {c.nombre}
              </Link>
            ),
          },
          {
            key: "telefono",
            header: "Teléfono",
            cell: (c) => <span className="text-muted tabular-nums">{c.telefono ?? "—"}</span>,
          },
          {
            key: "documento",
            header: "Documento",
            cell: (c) => <span className="text-muted tabular-nums">{c.documento ?? "—"}</span>,
          },
          {
            key: "ultima",
            header: "Última compra",
            cell: (c) => <span className="text-muted">{formatearFecha(c.ultimaCompra)}</span>,
          },
        ]}
        renderMobile={(c) => (
          <Link
            href={ruta(`/clientes/${c.id}`)}
            className="border-border bg-surface flex min-h-14 items-center justify-between gap-3 rounded-2xl border p-4"
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
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={resultado.page}
        pageSize={resultado.pageSize}
        total={resultado.total}
        pathname={ruta("/clientes")}
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
            onEnviando={setEnviando}
            onListo={(c) => {
              setNuevo(false);
              router.push(ruta(`/clientes/${c.id}`));
            }}
          />
        )}
      </Sheet>
    </>
  );
}
