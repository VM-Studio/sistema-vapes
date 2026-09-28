import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { listarMarcasActivas } from "@/server/services/marca.service";

import { ProductoForm } from "../producto-form";

export const metadata: Metadata = { title: "Nuevo producto" };

type SP = Record<string, string | string[] | undefined>;

/** ?codigo=X&volver=/p/{slug}/escanear: viene de un código desconocido escaneado; al guardar vuelve y lo agrega. */
export default async function NuevoProductoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "crear");
  const sp = await searchParams;
  const codigo = typeof sp.codigo === "string" ? sp.codigo : undefined;
  // Solo rutas internas (evita redirecciones abiertas).
  const volver =
    typeof sp.volver === "string" && sp.volver.startsWith("/") && !sp.volver.startsWith("//")
      ? sp.volver
      : undefined;
  const [categorias, marcas] = await Promise.all([
    listarCategoriasActivas(ctx),
    listarMarcasActivas(ctx),
  ]);
  return (
    <ProductoForm
      producto={null}
      codigoInicial={codigo}
      volver={volver}
      categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
      marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
    />
  );
}
