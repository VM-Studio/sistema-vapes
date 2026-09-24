import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { listarMarcasActivas } from "@/server/services/marca.service";

import { ProductoForm } from "../producto-form";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NuevoProductoPage() {
  await requirePaginaPermiso(Modulo.PRODUCTOS, "crear");
  const [categorias, marcas] = await Promise.all([
    listarCategoriasActivas(),
    listarMarcasActivas(),
  ]);
  return (
    <ProductoForm
      producto={null}
      categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
      marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
    />
  );
}
