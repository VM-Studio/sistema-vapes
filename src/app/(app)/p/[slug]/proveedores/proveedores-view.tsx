"use client";

import { Modulo } from "@prisma/client";
import { ChevronDown, MessageCircle, Plus, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProveedorForm } from "@/components/compras/proveedor-form";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { formatearMonto } from "@/components/compras/formato";
import { formatearFecha } from "@/lib/utils";
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

  return (
    <>
      <PageHeader
        title="Proveedores"
        subtitle="A quién le comprás, qué te vende y a cuánto."
        actions={
          puedeCrear && (
            <Button onClick={() => setNuevo(true)}>
              <Plus strokeWidth={1.75} /> Nuevo proveedor
            </Button>
          )
        }
      />
      <SearchInput placeholder="Buscar por nombre, tienda o producto" className="mb-4" />
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
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
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
      className="border-border bg-surface flex flex-col gap-3 rounded-card border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={ruta(`/proveedores/${p.id}`)}
            className="text-lg leading-tight font-semibold hover:underline"
          >
            {p.nombre}
          </Link>
          <p className="text-muted flex items-center gap-1.5 text-sm">
            <Store className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{p.nombreTienda}</span>
          </p>
        </div>
        {!p.activo && <Badge variant="neutral">Inactivo</Badge>}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm tabular-nums">
          {p.telefono ? (
            formatearTelefono(p.telefono)
          ) : (
            <span className="text-muted">Sin teléfono</span>
          )}
        </span>
        {p.telefono && (
          <a
            href={enlaceWhatsApp(p.telefono)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary", size: "sm", className: "min-h-11" })}
            aria-label={`WhatsApp a ${p.nombre}`}
          >
            <MessageCircle strokeWidth={1.75} /> WhatsApp
          </a>
        )}
      </div>

      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={panelId}
        onClick={() => setAbierta((a) => !a)}
        disabled={p.cantidadProductos === 0}
        className="border-border hover:bg-surface-2 flex min-h-11 items-center justify-between gap-2 rounded-control border px-3 text-sm font-medium disabled:opacity-60"
      >
        <span>
          {p.cantidadProductos === 0
            ? "Sin productos cargados"
            : `Ver productos (${p.cantidadProductos})`}
        </span>
        {p.cantidadProductos > 0 && (
          <ChevronDown
            className={`size-4 transition-transform ${abierta ? "rotate-180" : ""}`}
            strokeWidth={1.75}
            aria-hidden
          />
        )}
      </button>

      {abierta && (
        <ul
          id={panelId}
          aria-label={`Productos de ${p.nombre}`}
          className="divide-border flex flex-col divide-y"
        >
          {p.productos.map((prod) => (
            <li
              key={prod.productoId}
              className="flex items-start justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block font-medium">{prod.nombreCompleto}</span>
                {verPrecios && prod.actualizadoAt && (
                  <span className="text-muted text-xs">
                    Actualizado {formatearFecha(prod.actualizadoAt)}
                  </span>
                )}
              </span>
              {verPrecios && prod.precio !== null && (
                <span className="shrink-0 text-right font-semibold tabular-nums">
                  {formatearMonto(prod.precio, prod.moneda)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
