"use client";

import { Modulo } from "@prisma/client";
import { ChevronDown, MessageCircle, Phone, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProveedorForm } from "@/components/compras/proveedor-form";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { formatearMonto } from "@/components/compras/formato";
import { cn, formatearFecha } from "@/lib/utils";
import { enlaceWhatsApp, formatearTelefono } from "@/lib/validations/proveedor";
import type { ProveedorTarjeta } from "@/server/services/proveedor.service";

const FORM_ID = "form-proveedor";

export function ProveedoresView({
  proveedores,
  verPrecios,
  buscado,
}: {
  proveedores: ProveedorTarjeta[];
  verPrecios: boolean;
  buscado: string;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const puedeCrear = usePuede(Modulo.PROVEEDORES, "crear");
  const [nuevo, setNuevo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const botonNuevo = puedeCrear && (
    <Button onClick={() => setNuevo(true)}>
      <Plus strokeWidth={1.75} /> Nuevo proveedor
    </Button>
  );

  return (
    <>
      <PageHeader title="Proveedores" subtitle="A quién le comprás, qué te vende y a cuánto." />
      <div className="mb-6 flex items-center justify-between gap-4">
        <SearchInput
          placeholder="Buscar por nombre, tienda o producto"
          className="w-full md:max-w-md"
        />
        {botonNuevo && <BarraAccion>{botonNuevo}</BarraAccion>}
      </div>
      {proveedores.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={
            buscado ? `Ningún proveedor coincide con “${buscado}”` : "Todavía no hay proveedores"
          }
          description={buscado ? undefined : "Cargá a quién le comprás y qué productos te vende."}
          action={
            buscado ? (
              <Link
                href={ruta("/proveedores")}
                className={buttonVariants({ variant: "secondary" })}
              >
                Limpiar búsqueda
              </Link>
            ) : puedeCrear ? (
              <Button onClick={() => setNuevo(true)}>
                <Plus strokeWidth={1.75} /> Agregar un proveedor
              </Button>
            ) : null
          }
        />
      ) : (
        <ul
          aria-label="Proveedores"
          className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {proveedores.map((p) => (
            <TarjetaProveedor key={p.id} proveedor={p} verPrecios={verPrecios} />
          ))}
        </ul>
      )}
      <Sheet
        open={nuevo}
        onOpenChange={setNuevo}
        title="Nuevo proveedor"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNuevo(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_ID} loading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        {nuevo && (
          <ProveedorForm
            formId={FORM_ID}
            proveedor={null}
            verPrecios={verPrecios}
            onEnviando={setEnviando}
            onListo={() => {
              setNuevo(false);
              router.refresh();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function TarjetaProveedor({
  proveedor: p,
  verPrecios,
}: {
  proveedor: ProveedorTarjeta;
  verPrecios: boolean;
}) {
  const ruta = useRutaPanel();
  const [abierta, setAbierta] = useState(false);
  const panelId = `productos-${p.id}`;

  return (
    <li
      aria-label={`${p.nombre} · ${p.nombreTienda}`}
      className="bg-card rounded-card flex flex-col gap-4 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={ruta(`/proveedores/${p.id}`)}
            className="text-h3 font-semibold underline-offset-4 hover:underline"
          >
            {p.nombre}
          </Link>
          <p className="text-muted text-small truncate">{p.nombreTienda}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant="neutral">
            {p.cantidadProductos === 1 ? "1 producto" : `${p.cantidadProductos} productos`}
          </Badge>
          {!p.activo && <Badge variant="neutral">Inactivo</Badge>}
        </div>
      </div>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-body flex min-w-0 items-center gap-2 tabular-nums">
          <Phone className="text-subtle size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          {p.telefono ? (
            formatearTelefono(p.telefono)
          ) : (
            <span className="text-subtle">Sin teléfono</span>
          )}
        </span>
        {p.telefono && (
          <a
            href={enlaceWhatsApp(p.telefono)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: "secondary",
              size: "sm",
              className: "max-md:h-11",
            })}
            aria-label={`WhatsApp a ${p.nombre}`}
          >
            <MessageCircle strokeWidth={1.75} /> WhatsApp
          </a>
        )}
      </div>

      <div className="border-border -mx-2 flex flex-col gap-3 border-t pt-2">
        <Button
          variant="ghost"
          aria-expanded={abierta}
          aria-controls={panelId}
          onClick={() => setAbierta((a) => !a)}
          disabled={p.cantidadProductos === 0}
          className="w-full justify-between px-2"
        >
          <span>
            {p.cantidadProductos === 0
              ? "Sin productos cargados"
              : `Ver productos (${p.cantidadProductos})`}
          </span>
          {p.cantidadProductos > 0 && (
            <ChevronDown
              className={cn("transition-transform duration-150", abierta && "rotate-180")}
              strokeWidth={1.75}
              aria-hidden
            />
          )}
        </Button>

        {abierta && (
          <div
            id={panelId}
            className="border-border bg-surface rounded-control mx-2 overflow-hidden border"
          >
            <div
              aria-hidden
              className={cn(
                "border-border bg-card text-muted grid gap-3 border-b px-3 py-2 text-xs font-medium",
                verPrecios
                  ? "grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_5.5rem]"
                  : "grid-cols-1",
              )}
            >
              <span>Producto</span>
              {verPrecios && (
                <>
                  <span className="hidden sm:block">Moneda</span>
                  <span className="text-right">Precio</span>
                </>
              )}
            </div>
            <ul aria-label={`Productos de ${p.nombre}`} className="divide-border divide-y">
              {p.productos.map((prod) => (
                <li
                  key={prod.productoId}
                  className={cn(
                    "text-small grid items-center gap-3 px-3 py-2.5",
                    verPrecios
                      ? "grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_5.5rem]"
                      : "grid-cols-1",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{prod.nombreCompleto}</span>
                    {verPrecios && prod.actualizadoAt && (
                      <span className="text-subtle block text-xs">
                        Actualizado {formatearFecha(prod.actualizadoAt)}
                      </span>
                    )}
                  </span>
                  {verPrecios && (
                    <>
                      <span className="text-muted hidden text-xs sm:block">
                        {prod.moneda ?? "—"}
                      </span>
                      <span className="text-right font-semibold tabular-nums">
                        {prod.precio !== null ? formatearMonto(prod.precio, prod.moneda) : "—"}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}
