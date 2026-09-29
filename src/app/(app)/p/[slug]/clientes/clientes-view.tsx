"use client";

import { Modulo } from "@prisma/client";
import { Plus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm } from "@/components/clientes/cliente-form";
import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { formatearPesos } from "@/lib/format";
import { formatearFecha } from "@/lib/utils";
import type { ClienteListado } from "@/server/services/cliente.service";

export function ClientesView({
  resultado,
  params,
  nuevosDelMes,
  verTotales,
}: {
  resultado: { clientes: ClienteListado[]; total: number; page: number; pageSize: number };
  params: Record<string, string>;
  nuevosDelMes: number;
  verTotales: boolean;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const puedeCrear = usePuede(Modulo.CLIENTES, "crear");
  const [nuevo, setNuevo] = useState(false);
  const conFiltros = Object.entries(params).some(([k, v]) => k !== "page" && v !== "");
  const [enviando, setEnviando] = useState(false);

  const nombre = (c: ClienteListado) => (
    <Link href={ruta(`/clientes/${c.id}`)} className="text-primary font-medium hover:underline">
      {c.nombre}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Datos de contacto e historial de compras y devoluciones"
        actions={
          puedeCrear && (
            <Button onClick={() => setNuevo(true)}>
              <Plus strokeWidth={1.75} /> Nuevo cliente
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput placeholder="Nombre o teléfono" className="flex-1" />
        <p
          className="bg-primary-soft text-primary-soft-foreground inline-flex items-center gap-2 self-start rounded-xl px-4 py-2.5 text-sm font-medium md:self-auto"
          data-testid="clientes-nuevos-mes"
        >
          <UserPlus className="size-4" strokeWidth={1.75} aria-hidden />
          Clientes nuevos este mes: {nuevosDelMes}
        </p>
      </div>
      <DataTable
        caption="Clientes"
        rows={resultado.clientes}
        getRowKey={(c) => c.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={Users}
              title={
                params.q ? `No hay clientes con “${params.q}”` : "No hay clientes con esos filtros"
              }
              action={
                <Link href={ruta("/clientes")} className={buttonVariants({ variant: "secondary" })}>
                  Limpiar búsqueda
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="Todavía no hay clientes"
              description="Se agregan solos al registrar una venta, o podés cargarlos a mano."
              action={
                puedeCrear ? (
                  <Button onClick={() => setNuevo(true)}>
                    <Plus strokeWidth={1.75} /> Agregar un cliente
                  </Button>
                ) : null
              }
            />
          )
        }
        columns={[
          {
            key: "nombre",
            header: "Nombre",
            cell: (c) => (
              <span className="flex items-center gap-2">
                {nombre(c)}
                {!c.activo && <Badge>Inactivo</Badge>}
              </span>
            ),
          },
          {
            key: "telefono",
            header: "Teléfono",
            cell: (c) => <TelefonoWhatsApp telefono={c.telefono} className="text-muted" />,
          },
          {
            key: "compras",
            header: "Compras",
            className: "text-right tabular-nums",
            cell: (c) => c.compras,
          },
          ...(verTotales
            ? [
                {
                  key: "total",
                  header: "Total comprado",
                  className: "text-right tabular-nums",
                  cell: (c: ClienteListado) => formatearPesos(c.totalComprado),
                },
              ]
            : []),
          {
            key: "ultima",
            header: "Última compra",
            cell: (c) => <span className="text-muted">{formatearFecha(c.ultimaCompra)}</span>,
          },
        ]}
        renderMobile={(c) => (
          <div className="border-border bg-surface shadow-card flex items-center gap-3 rounded-2xl border p-4">
            <Link href={ruta(`/clientes/${c.id}`)} className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{c.nombre}</span>
                {!c.activo && <Badge>Inactivo</Badge>}
              </span>
              <span className="text-muted block truncate text-xs">
                {c.compras} compra{c.compras === 1 ? "" : "s"}
                {verTotales && c.compras > 0 ? ` · ${formatearPesos(c.totalComprado)}` : ""}
                {c.ultimaCompra ? ` · última ${formatearFecha(c.ultimaCompra)}` : ""}
              </span>
            </Link>
            <TelefonoWhatsApp telefono={c.telefono} className="text-muted shrink-0 text-xs" />
          </div>
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
