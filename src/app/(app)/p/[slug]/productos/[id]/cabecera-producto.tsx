"use client";

import { Modulo } from "@prisma/client";
import { EyeOff, ImageOff, Pencil, ScanBarcode, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatearNumero, formatearPesos } from "@/lib/format";
import type { DepositoBasico } from "@/server/services/deposito.service";
import type { ProductoDetalle } from "@/server/services/producto.service";

import { desactivarProductoAction } from "../actions";

export function CabeceraProducto({
  producto,
  depositos,
}: {
  producto: ProductoDetalle;
  depositos: DepositoBasico[];
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const puedeEditar = usePuede(Modulo.PRODUCTOS, "editar");
  const cargaProductos = usePuede(Modulo.PRODUCTOS, "crear");
  const cargaStock = usePuede(Modulo.STOCK, "crear");
  const [desactivar, setDesactivar] = useState(false);

  async function confirmarDesactivar() {
    const r = await desactivarProductoAction({ id: producto.id });
    setDesactivar(false);
    if (!r.ok) return toast.error("No se pudo desactivar", r.error.message);
    toast.success(`${producto.nombreCompleto} desactivado`);
    router.refresh();
  }

  return (
    <header className="mb-5 flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="border-border bg-surface-2 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border md:size-24">
          {producto.imagenUrl ? (
            // URL externa arbitraria cargada por el usuario: sin next/image (requeriría whitelist de dominios).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={producto.imagenUrl}
              alt={producto.nombreCompleto}
              className="size-full object-cover"
            />
          ) : (
            <ImageOff className="text-muted size-6" strokeWidth={1.75} aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="primary">{producto.marca}</Badge>
            {producto.categoria && <Badge>{producto.categoria}</Badge>}
            {!producto.activo && <Badge variant="danger">Desactivado</Badge>}
            <EstadoStockBadge estado={producto.estado} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {producto.nombreCompleto}
          </h1>
          <p className="text-muted text-sm">
            Precio de venta{" "}
            <strong className="text-foreground text-base tabular-nums">
              {formatearPesos(producto.precioVenta)}
            </strong>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
          {(cargaProductos || cargaStock) && (
            <Link
              href={ruta(`/productos/cargar?producto=${producto.id}`)}
              className={buttonVariants({ className: "col-span-2" })}
            >
              <ScanBarcode strokeWidth={1.75} /> Cargar stock
            </Link>
          )}
          <Link
            href={ruta(`/productos/etiquetas?producto=${producto.id}`)}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Tags strokeWidth={1.75} /> Etiquetas
          </Link>
          {puedeEditar && producto.activo && (
            <Button variant="secondary" onClick={() => setDesactivar(true)}>
              <EyeOff strokeWidth={1.75} /> Desactivar
            </Button>
          )}
          {puedeEditar && (
            <Link
              href={ruta(`/productos/${producto.id}/editar`)}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Pencil strokeWidth={1.75} /> Editar
            </Link>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {depositos.map((d) => (
          <div key={d.id} className="border-border bg-surface rounded-2xl border p-3">
            <dt className="text-muted text-xs">{d.nombre}</dt>
            <dd className="text-2xl font-bold tabular-nums">
              {formatearNumero(producto.stockPorDeposito[d.id] ?? 0)}
            </dd>
          </div>
        ))}
        <div className="bg-primary-soft text-primary-soft-foreground rounded-2xl p-3">
          <dt className="text-xs">Total</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {formatearNumero(producto.stockTotal)}
          </dd>
        </div>
      </dl>

      <ConfirmDialog
        open={desactivar}
        onOpenChange={setDesactivar}
        title={`¿Desactivar ${producto.nombreCompleto}?`}
        description="Deja de venderse y no aparece en el listado (salvo en Desactivados). Su stock y su historial se conservan; lo podés reactivar desde Editar."
        confirmLabel="Desactivar"
        danger
        onConfirm={confirmarDesactivar}
      />
    </header>
  );
}
