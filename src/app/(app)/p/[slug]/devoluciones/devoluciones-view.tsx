"use client";

import { Modulo } from "@prisma/client";
import { Plus, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ESTADO_DEVOLUCION_UI } from "@/components/clientes/etiquetas";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Tooltip } from "@/components/ui/tooltip";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { DevolucionListada } from "@/server/services/devolucion.service";

import { RegistrarDevolucion, type InicialDevolucion } from "./registrar-devolucion";

const productos = (d: DevolucionListada) =>
  d.items.map((i) => (i.cantidad > 1 ? `${i.cantidad} × ${i.titulo}` : i.titulo)).join(", ");

export function DevolucionesView({
  resultado,
  params,
  depositos,
  abrirNueva,
  inicial,
}: {
  resultado: { devoluciones: DevolucionListada[]; total: number; page: number; pageSize: number };
  params: Record<string, string>;
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  abrirNueva: boolean;
  inicial: InicialDevolucion | null;
}) {
  const ruta = useRutaPanel();
  const { actualizar } = useUrlParams();
  const puedeCrear = usePuede(Modulo.DEVOLUCIONES, "crear");
  const [abierto, setAbierto] = useState(abrirNueva);
  const conFiltros = Boolean(params.desde || params.hasta || params.cliente);
  const [inicialModal, setInicialModal] = useState(inicial);
  const [clave, setClave] = useState(0);

  // Llegó un `?nueva=1…` nuevo (ej: desde la ficha de un cliente): abrir con esos datos.
  const inicialRef = useRef(inicial);
  inicialRef.current = inicial;
  const pedido = abrirNueva ? `${params.ventaId ?? ""}|${params.clienteId ?? ""}` : null;
  const pedidoInicial = useRef(pedido);
  useEffect(() => {
    if (pedido === null) {
      pedidoInicial.current = null;
      return;
    }
    if (pedido === pedidoInicial.current) return;
    pedidoInicial.current = pedido;
    setInicialModal(inicialRef.current);
    setClave((k) => k + 1);
    setAbierto(true);
  }, [pedido]);

  function abrir() {
    setInicialModal(null);
    setClave((k) => k + 1);
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
    if (params.nueva) actualizar({ nueva: null, ventaId: null, clienteId: null });
  }

  const codigo = (d: DevolucionListada) => (
    <Link
      href={ruta(`/devoluciones/${d.id}`)}
      className="text-foreground font-mono font-semibold whitespace-nowrap hover:underline"
    >
      {d.codigo}
    </Link>
  );
  const estado = (d: DevolucionListada) => (
    <Badge variant={ESTADO_DEVOLUCION_UI[d.estado].variante}>
      {ESTADO_DEVOLUCION_UI[d.estado].label}
    </Badge>
  );

  return (
    <>
      <PageHeader
        title="Devoluciones"
        subtitle="Garantías: el cliente trae un producto fallado y se le entrega uno nuevo"
        actions={
          puedeCrear && (
            <div className="contents max-md:[&>[aria-hidden]]:hidden">
              <BarraAccion>
                <Button onClick={abrir}>
                  <Plus strokeWidth={1.75} /> Registrar devolución
                </Button>
              </BarraAccion>
            </div>
          )
        }
      />
      <section
        aria-label="Filtros"
        className="bg-card rounded-card mb-4 grid grid-cols-2 gap-2 p-4 md:grid-cols-[12rem_12rem]"
      >
        <label className="text-muted text-small flex flex-col gap-1">
          Desde
          <input
            type="date"
            className={cn(controlClass, "h-11 md:h-10")}
            value={params.desde ?? ""}
            onChange={(e) => actualizar({ desde: e.target.value || null })}
          />
        </label>
        <label className="text-muted text-small flex flex-col gap-1">
          Hasta
          <input
            type="date"
            className={cn(controlClass, "h-11 md:h-10")}
            value={params.hasta ?? ""}
            onChange={(e) => actualizar({ hasta: e.target.value || null })}
          />
        </label>
      </section>
      <DataTable
        caption="Devoluciones"
        rows={resultado.devoluciones}
        getRowKey={(d) => d.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={Undo2}
              title="No hay devoluciones con esos filtros"
              action={
                <Link
                  href={ruta("/devoluciones")}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Limpiar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Undo2}
              title="Todavía no hay devoluciones"
              description="Cuando un cliente traiga un producto fallado, registralo acá."
              action={
                puedeCrear ? (
                  <Button onClick={abrir}>
                    <Plus strokeWidth={1.75} /> Registrar una devolución
                  </Button>
                ) : null
              }
            />
          )
        }
        columns={[
          { key: "codigo", header: "ID", cell: codigo },
          {
            key: "fecha",
            header: "Fecha",
            cell: (d) => (
              <span className="text-muted whitespace-nowrap">{formatearFechaHora(d.fecha)}</span>
            ),
          },
          {
            key: "cliente",
            header: "Cliente",
            cell: (d) => <span className="font-medium">{d.cliente.nombre}</span>,
          },
          {
            key: "productos",
            header: "Producto(s)",
            cell: (d) => <span className="line-clamp-2 min-w-40">{productos(d)}</span>,
          },
          { key: "galpon", header: "Galpón", cell: (d) => d.deposito.nombre },
          {
            key: "observacion",
            header: "Observación",
            cell: (d) => (
              <Tooltip content={d.observacion} className="max-w-56">
                <span
                  tabIndex={0}
                  className="text-muted rounded-inner block min-w-0 truncate focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {d.observacion}
                </span>
              </Tooltip>
            ),
          },
          {
            key: "usuario",
            header: "Usuario",
            cell: (d) => <span className="text-muted">{d.usuario}</span>,
          },
          { key: "estado", header: "Estado", cell: estado },
        ]}
        renderMobile={(d) => (
          <Link
            href={ruta(`/devoluciones/${d.id}`)}
            className={cn(cardVariants({ variant: "clickable" }), "block p-4")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{d.codigo}</span>
              {estado(d)}
            </div>
            <p className="mt-1 text-sm font-medium">{d.cliente.nombre}</p>
            <p className="text-sm">{productos(d)}</p>
            <p className="text-muted mt-1 truncate text-xs" title={d.observacion}>
              {d.observacion}
            </p>
            <p className="text-subtle mt-1 text-xs">
              {formatearFechaHora(d.fecha)} · {d.deposito.nombre} · {d.usuario}
            </p>
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={resultado.page}
        pageSize={resultado.pageSize}
        total={resultado.total}
        pathname={ruta("/devoluciones")}
        params={params}
      />
      {puedeCrear && <div className="h-[4.5rem] md:hidden" aria-hidden />}
      {puedeCrear && (
        <RegistrarDevolucion
          key={clave}
          abierto={abierto}
          onCerrar={cerrar}
          depositos={depositos}
          inicial={inicialModal}
        />
      )}
    </>
  );
}
