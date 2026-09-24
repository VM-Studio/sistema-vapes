"use client";

import { Modulo } from "@prisma/client";
import { ImageOff, PackagePlus, Pencil, Percent, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatearNumero } from "@/lib/format";
import type { ProductoDetalle } from "@/server/services/producto.service";

import { darDeBajaProductoAction } from "../actions";
import { AumentoSheet } from "../aumento-sheet";

export function CabeceraProducto({
  producto,
  categorias,
  marcas,
}: {
  producto: ProductoDetalle;
  categorias: { value: string; label: string }[];
  marcas: { value: string; label: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const puedeEditar = usePuede(Modulo.PRODUCTOS, "editar");
  const puedeEliminar = usePuede(Modulo.PRODUCTOS, "eliminar");
  const puedeIngresar = usePuede(Modulo.MOVIMIENTOS, "crear");
  const [aumento, setAumento] = useState(false);
  const [baja, setBaja] = useState(false);

  async function darDeBaja() {
    const r = await darDeBajaProductoAction({ id: producto.id });
    setBaja(false);
    if (!r.ok) return toast.error("No se pudo dar de baja", r.error.message);
    toast.success(`${producto.nombre} dado de baja`);
    router.push("/productos");
  }

  return (
    <header className="mb-4 flex flex-col gap-4 md:flex-row md:items-start">
      <div className="border-border bg-surface-2 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border md:size-24">
        {producto.imagenUrl ? (
          // URL externa arbitraria cargada por el usuario: sin next/image (requeriría whitelist de dominios).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={producto.imagenUrl} alt={producto.nombre} className="size-full object-cover" />
        ) : (
          <ImageOff className="text-muted size-6" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{producto.nombre}</h1>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {producto.marca && <Badge variant="primary">{producto.marca}</Badge>}
          <Badge>{producto.categoria}</Badge>
          {!producto.activo && <Badge variant="danger">Inactivo</Badge>}
          <EstadoStockBadge estado={producto.estado} />
          <span className="text-muted">
            ·{" "}
            <strong className="text-foreground tabular-nums">
              {formatearNumero(producto.stockTotal)}
            </strong>{" "}
            unidades
          </span>
        </div>
        {producto.descripcion && <p className="text-muted text-sm">{producto.descripcion}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
        {puedeIngresar && (
          <Link
            href={`/movimientos/ingreso?variantes=${producto.variantes.map((v) => v.id).join(",")}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            <PackagePlus /> Cargar stock
          </Link>
        )}
        {puedeEditar && (
          <Button variant="secondary" onClick={() => setAumento(true)}>
            <Percent /> Precios
          </Button>
        )}
        {puedeEliminar && (
          <Button variant="secondary" className="text-danger" onClick={() => setBaja(true)}>
            <Trash2 /> Dar de baja
          </Button>
        )}
        {puedeEditar && (
          <Link href={`/productos/${producto.id}/editar`} className={buttonVariants()}>
            <Pencil /> Editar
          </Link>
        )}
      </div>

      <AumentoSheet
        open={aumento}
        onOpenChange={setAumento}
        categorias={categorias}
        marcas={marcas}
        producto={{ id: producto.id, nombre: producto.nombre }}
      />
      <ConfirmDialog
        open={baja}
        onOpenChange={setBaja}
        title={`¿Dar de baja ${producto.nombre}?`}
        description="Deja de aparecer en el catálogo. Su historial se conserva. Solo se puede si no tiene stock."
        confirmLabel="Dar de baja"
        danger
        onConfirm={darDeBaja}
      />
    </header>
  );
}
