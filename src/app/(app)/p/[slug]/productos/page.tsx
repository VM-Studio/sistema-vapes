import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { listarProductosSchema } from "@/lib/validations/producto";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { listarMarcas } from "@/server/services/marca.service";
import { listar } from "@/server/services/producto.service";

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
  const [resultado, depositos, marcas] = await Promise.all([
    listar(ctx, filtros),
    listarDepositosActivos(ctx),
    listarMarcas(ctx),
  ]);
  return (
    <ProductosView
      resultado={resultado}
      depositos={depositos}
      params={plano}
      marcas={marcas
        .filter((m) => m.productosActivos > 0 || m.id === filtros.marcaId)
        .map((m) => ({ value: m.id, label: m.nombre }))}
    />
  );
}
