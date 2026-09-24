import { Modulo } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { obtenerStockPorProducto } from "@/server/services/inventario.service";
import { listarMarcasActivas } from "@/server/services/marca.service";
import { listarMovimientos } from "@/server/services/movimiento.service";
import { listarHistorialPrecios, obtenerProducto } from "@/server/services/producto.service";

import { CabeceraProducto } from "./cabecera-producto";
import { HistorialPrecios } from "./historial-precios";
import { MatrizStock } from "./matriz-stock";
import { MovimientosProducto } from "./movimientos-producto";
import { VariantesProducto } from "./variantes-producto";

export const metadata: Metadata = { title: "Producto" };

type SP = Record<string, string | string[] | undefined>;

export default async function FichaProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  await requirePaginaPermiso(Modulo.PRODUCTOS, "ver");
  const { id } = await params;
  const tab = (await searchParams).tab;
  const seccion = tab === "movimientos" || tab === "precios" ? tab : "variantes";

  const producto = await obtenerProducto(id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [matriz, categorias, marcas, movimientos, historial] = await Promise.all([
    obtenerStockPorProducto(id),
    listarCategoriasActivas(),
    listarMarcasActivas(),
    seccion === "movimientos"
      ? listarMovimientos({ productoId: id, page: 1, pageSize: 50 })
      : Promise.resolve(null),
    seccion === "precios" ? listarHistorialPrecios(id) : Promise.resolve(null),
  ]);
  const base = `/productos/${id}`;

  return (
    <>
      <Link
        href="/productos"
        className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2 -ml-2" })}
      >
        <ArrowLeft /> Productos
      </Link>
      <CabeceraProducto
        producto={producto}
        categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
        marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
      />
      {producto.tieneVariantes && <MatrizStock matriz={matriz} />}
      <TabsNav
        className="mb-4"
        ariaLabel="Secciones del producto"
        items={[
          {
            href: base,
            label: producto.tieneVariantes ? "Variantes" : "Detalle",
            activo: seccion === "variantes",
            badge: producto.tieneVariantes ? producto.variantes.length : undefined,
          },
          {
            href: `${base}?tab=movimientos`,
            label: "Movimientos",
            activo: seccion === "movimientos",
          },
          {
            href: `${base}?tab=precios`,
            label: "Historial de precios",
            activo: seccion === "precios",
          },
        ]}
      />
      {seccion === "variantes" && (
        <VariantesProducto producto={producto} depositos={matriz.depositos} />
      )}
      {seccion === "movimientos" && movimientos && (
        <MovimientosProducto
          movimientos={movimientos.movimientos}
          total={movimientos.total}
          productoId={id}
        />
      )}
      {seccion === "precios" && historial && <HistorialPrecios filas={historial} />}
    </>
  );
}
