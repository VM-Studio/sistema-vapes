import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { listarProductosSchema } from "@/lib/validations/producto";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { listarMarcasActivas } from "@/server/services/marca.service";
import { listarProductos } from "@/server/services/producto.service";

import { ProductosView } from "./productos-view";

export const metadata: Metadata = { title: "Productos" };

type SP = Record<string, string | string[] | undefined>;

export default async function ProductosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = listarProductosSchema.parse(plano);
  const [resultado, depositos, categorias, marcas] = await Promise.all([
    listarProductos(ctx, filtros),
    listarDepositosActivos(ctx),
    listarCategoriasActivas(ctx),
    listarMarcasActivas(ctx),
  ]);
  return (
    <ProductosView
      resultado={resultado}
      depositos={depositos}
      params={plano}
      categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
      marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
    />
  );
}
