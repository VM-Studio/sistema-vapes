import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esOwner } from "@/lib/permisos";
import { rutaPanel } from "@/lib/paneles";
import { listarMovimientosSchema } from "@/lib/validations/movimiento";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import {
  filtrosStockSchema,
  obtenerResumenStock,
  obtenerStock,
} from "@/server/services/inventario.service";
import { listarMarcasActivas } from "@/server/services/marca.service";
import { listarMovimientos } from "@/server/services/movimiento.service";

import { InventarioView } from "./inventario-view";
import { SelectorDeposito, StockTabs } from "./movimientos/movimientos-tabs";
import { UltimosMovimientos } from "./ultimos-movimientos";

export const metadata: Metadata = { title: "Stock" };

type SP = Record<string, string | string[] | undefined>;

/** Stock del panel: "Global" (todos los depósitos + total) o un depósito. */
export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = filtrosStockSchema.parse(plano);

  const [datos, resumen, categorias, marcas] = await Promise.all([
    obtenerStock(ctx, filtros),
    obtenerResumenStock(ctx, filtros.depositoId),
    listarCategoriasActivas(ctx),
    listarMarcasActivas(ctx),
  ]);
  const depositoId = datos.deposito?.id;
  const ultimos = await listarMovimientos(
    ctx,
    listarMovimientosSchema.parse({ depositoId, pageSize: 10 }),
    { incluirCostos: esOwner(ctx.usuario) },
  );
  const pathname = rutaPanel(ctx.panel.slug, "/stock");

  return (
    <>
      <StockTabs panel={ctx.panel} usuario={ctx.usuario} actual="stock" depositoId={depositoId} />
      <InventarioView
        resumen={resumen}
        datos={datos}
        filtros={{ ...filtros, depositoId }}
        params={plano}
        categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
        marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
        selector={
          <SelectorDeposito
            depositos={datos.depositos}
            actual={depositoId}
            pathname={pathname}
            params={plano}
            className="mb-4"
          />
        }
      />
      <UltimosMovimientos
        movimientos={ultimos.movimientos}
        total={ultimos.total}
        verTodosHref={rutaPanel(
          ctx.panel.slug,
          depositoId ? `/stock/movimientos?depositoId=${depositoId}` : "/stock/movimientos",
        )}
        deposito={datos.deposito?.nombre ?? null}
      />
    </>
  );
}
