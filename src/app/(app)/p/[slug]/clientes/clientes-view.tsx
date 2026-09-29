"use client";

import { Modulo } from "@prisma/client";
import { MessageCircle, Plus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm } from "@/components/clientes/cliente-form";
import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { linkWhatsApp, mostrarTelefono } from "@/lib/validations/cliente";
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
    <Link
      href={ruta(`/clientes/${c.id}`)}
      className="text-foreground flex min-w-0 items-center gap-3 font-medium hover:underline"
    >
      <Avatar nombre={c.nombre} />
      <span className="truncate">{c.nombre}</span>
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Datos de contacto e historial de compras y devoluciones"
        actions={
          puedeCrear && (
            <div className="contents max-md:[&>[aria-hidden]]:hidden">
              <BarraAccion>
                <Button onClick={() => setNuevo(true)}>
                  <Plus strokeWidth={1.75} /> Nuevo cliente
                </Button>
              </BarraAccion>
            </div>
          )
        }
      />
      <section aria-label="Resumen" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <Card variant="kpi" data-testid="clientes-nuevos-mes">
          <p className="text-muted text-small flex items-center gap-2 font-medium">
            <UserPlus className="size-4" strokeWidth={1.75} aria-hidden />
            Clientes nuevos este mes<span className="sr-only">:</span>
          </p>
          <p className="text-2xl leading-tight font-semibold tracking-tight tabular-nums lg:text-[1.75rem]">
            {nuevosDelMes}
          </p>
        </Card>
        {!conFiltros && (
          <StatCard label="Clientes registrados" value={formatearNumero(resultado.total)} />
        )}
      </section>
      <section aria-label="Buscar clientes" className="bg-card rounded-card mb-4 p-4">
        <SearchInput placeholder="Nombre o teléfono" />
      </section>
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
            cell: (c) => (
              <span className="text-muted whitespace-nowrap">{formatearFecha(c.ultimaCompra)}</span>
            ),
          },
        ]}
        renderMobile={(c) => (
          <div className="bg-card rounded-card flex items-center gap-3 p-4">
            <Link
              href={ruta(`/clientes/${c.id}`)}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <Avatar nombre={c.nombre} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{c.nombre}</span>
                  {!c.activo && <Badge>Inactivo</Badge>}
                </span>
                <span className="text-muted text-small block tabular-nums">
                  {mostrarTelefono(c.telefono)}
                </span>
                <span className="text-subtle block truncate text-xs">
                  {c.compras} compra{c.compras === 1 ? "" : "s"}
                  {verTotales && c.compras > 0 ? ` · ${formatearPesos(c.totalComprado)}` : ""}
                  {c.ultimaCompra ? ` · última ${formatearFecha(c.ultimaCompra)}` : ""}
                </span>
              </span>
            </Link>
            <a
              href={linkWhatsApp(c.telefono)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary", size: "icon" })}
              aria-label={`WhatsApp a ${mostrarTelefono(c.telefono)}`}
            >
              <MessageCircle strokeWidth={1.75} aria-hidden />
            </a>
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
      {puedeCrear && <div className="h-[4.5rem] md:hidden" aria-hidden />}
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
