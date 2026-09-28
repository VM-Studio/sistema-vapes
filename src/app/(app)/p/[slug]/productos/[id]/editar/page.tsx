import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { listarMarcasActivas } from "@/server/services/marca.service";
import { obtener } from "@/server/services/producto.service";

import { ProductoForm } from "../../producto-form";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "editar");
  const { id } = await params;
  const [producto, categorias, marcas] = await Promise.all([
    obtener(ctx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
    listarCategoriasActivas(ctx),
    listarMarcasActivas(ctx),
  ]);
  // Si la categoría actual está inactiva, igual tiene que aparecer en el select.
  const cats = categorias.map((c) => ({ value: c.id, label: c.nombre }));
  if (producto.categoriaId && !cats.some((c) => c.value === producto.categoriaId))
    cats.push({ value: producto.categoriaId, label: `${producto.categoria} (inactiva)` });
  return (
    <ProductoForm producto={producto} categorias={cats} marcas={marcas.map((m) => m.nombre)} />
  );
}
