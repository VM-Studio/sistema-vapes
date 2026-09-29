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
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
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
    <>
      <PageHeader
        title={producto.nombreCompleto}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Productos", href: ruta("/productos") },
              { label: producto.nombreCompleto },
            ]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{producto.marca}</Badge>
            {producto.categoria && <Badge variant="neutral">{producto.categoria}</Badge>}
            {!producto.activo && <Badge variant="danger">Desactivado</Badge>}
            <EstadoStockBadge estado={producto.estado} />
          </span>
        }
        actions={
          <>
            {puedeEditar && (
              <Link
                href={ruta(`/productos/${producto.id}/editar`)}
                className={buttonVariants({ variant: "secondary" })}
              >
                <Pencil strokeWidth={1.75} /> Editar
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
            {(cargaProductos || cargaStock) && (
              <Link
                href={ruta(`/productos/cargar?producto=${producto.id}`)}
                className={buttonVariants({ className: "basis-full md:basis-auto" })}
              >
                <ScanBarcode strokeWidth={1.75} /> Cargar stock
              </Link>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="flex items-center gap-4 p-5">
          <div className="bg-surface rounded-card flex size-20 shrink-0 items-center justify-center overflow-hidden">
            {producto.imagenUrl ? (
              // URL externa arbitraria cargada por el usuario: sin next/image (requeriría whitelist de dominios).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={producto.imagenUrl}
                alt={producto.nombreCompleto}
                className="size-full object-cover"
              />
            ) : (
              <ImageOff className="text-subtle size-5" strokeWidth={1.75} aria-hidden />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-muted text-small font-medium">Precio de venta</p>
            <p className="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
              {formatearPesos(producto.precioVenta)}
            </p>
          </div>
        </Card>

        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {depositos.map((d) => (
            <div key={d.id} className="bg-card rounded-card flex flex-col gap-1.5 p-5">
              <dt className="text-muted text-small truncate font-medium">{d.nombre}</dt>
              <dd className="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
                {formatearNumero(producto.stockPorDeposito[d.id] ?? 0)}
              </dd>
            </div>
          ))}
          <div className="bg-card rounded-card flex flex-col gap-1.5 p-5">
            <dt className="text-small font-semibold">Total</dt>
            <dd className="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
              {formatearNumero(producto.stockTotal)}
            </dd>
          </div>
        </dl>
      </div>

      <ConfirmDialog
        open={desactivar}
        onOpenChange={setDesactivar}
        title={`¿Desactivar ${producto.nombreCompleto}?`}
        description="Deja de venderse y no aparece en el listado (salvo en Desactivados). Su stock y su historial se conservan; lo podés reactivar desde Editar."
        confirmLabel="Desactivar"
        danger
        onConfirm={confirmarDesactivar}
      />
    </>
  );
}
