import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePaginaPermiso } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { listarMarcasActivas } from "@/server/services/marca.service";
import { obtenerProducto } from "@/server/services/producto.service";

import { ProductoForm } from "../../producto-form";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePaginaPermiso(Modulo.PRODUCTOS, "editar");
  const { id } = await params;
  const [producto, categorias, marcas] = await Promise.all([
    obtenerProducto(id).catch((e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
    listarCategoriasActivas(),
    listarMarcasActivas(),
  ]);
  // Si la categoría/marca actual está inactiva, igual tiene que aparecer en el select.
  const cats = categorias.map((c) => ({ value: c.id, label: c.nombre }));
  if (!cats.some((c) => c.value === producto.categoriaId))
    cats.push({ value: producto.categoriaId, label: `${producto.categoria} (inactiva)` });
  const mars = marcas.map((m) => ({ value: m.id, label: m.nombre }));
  if (producto.marcaId && !mars.some((m) => m.value === producto.marcaId))
    mars.push({ value: producto.marcaId, label: `${producto.marca} (inactiva)` });
  return <ProductoForm producto={producto} categorias={cats} marcas={mars} />;
}
