import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esOwner } from "@/lib/permisos";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import {
  filtrosInventarioSchema,
  obtenerResumenInventario,
  obtenerStockConsolidado,
} from "@/server/services/inventario.service";
import { listarMarcasActivas } from "@/server/services/marca.service";

import { InventarioView } from "./inventario-view";

export const metadata: Metadata = { title: "Inventario" };

type SP = Record<string, string | string[] | undefined>;

export default async function InventarioPage({ searchParams }: { searchParams: Promise<SP> }) {
  const usuario = await requirePaginaPermiso(Modulo.INVENTARIO, "ver");
  const params = await searchParams;
  const filtros = filtrosInventarioSchema.parse(params);
  // La valorización (costos) es información sensible: solo para dueños, y ni siquiera viaja al cliente si no lo es.
  const incluirValorizacion = esOwner(usuario);

  const [resumen, datos, categorias, marcas] = await Promise.all([
    obtenerResumenInventario({ incluirValorizacion }),
    obtenerStockConsolidado(filtros, { incluirValorizacion }),
    listarCategoriasActivas(),
    listarMarcasActivas(),
  ]);

  const paramsPlanos = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  return (
    <InventarioView
      resumen={resumen}
      datos={datos}
      filtros={filtros}
      params={paramsPlanos}
      categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
      marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
    />
  );
}
