import { Modulo } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { TabsNav } from "@/components/ui/tabs-nav";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerStockPorProducto } from "@/server/services/inventario.service";
import { listarMovimientos } from "@/server/services/movimiento.service";
import { obtenerProducto } from "@/server/services/producto.service";

import { CabeceraProducto } from "./cabecera-producto";
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
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "ver");
  const { id } = await params;
  const seccion = (await searchParams).tab === "movimientos" ? "movimientos" : "variantes";

  const producto = await obtenerProducto(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [matriz, movimientos] = await Promise.all([
    obtenerStockPorProducto(ctx, id),
    seccion === "movimientos"
      ? listarMovimientos(
          ctx,
          { productoId: id, page: 1, pageSize: 50 },
          { incluirCostos: esOwner(ctx.usuario) },
        )
      : Promise.resolve(null),
  ]);
  const base = rutaPanel(ctx.panel.slug, `/productos/${id}`);

  return (
    <>
      <Link
        href={rutaPanel(ctx.panel.slug, "/productos")}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2 -ml-2" })}
      >
        <ArrowLeft strokeWidth={1.75} /> Productos
      </Link>
      <CabeceraProducto producto={producto} />
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
        ]}
      />
      {seccion === "variantes" && (
        <VariantesProducto producto={producto} depositos={matriz.depositos} />
      )}
      {seccion === "movimientos" && movimientos && (
        <MovimientosProducto
          movimientos={movimientos.movimientos}
          total={movimientos.total}
          hrefTodos={rutaPanel(ctx.panel.slug, `/stock/movimientos?productoId=${id}`)}
        />
      )}
    </>
  );
}
