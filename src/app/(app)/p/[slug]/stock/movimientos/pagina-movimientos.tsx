import { Modulo } from "@prisma/client";

import { TabsNav } from "@/components/ui/tabs-nav";
import {
  esFechaISO,
  fechasDeRango,
  finDelDia,
  inicioDelDia,
  RANGOS,
  type Rango,
} from "@/lib/fechas";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { listarMovimientosSchema } from "@/lib/validations/movimiento";
import { requirePaginaPanelAlguno } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import { listarMovimientos } from "@/server/services/movimiento.service";
import { obtenerProducto, obtenerVariantesPorId } from "@/server/services/producto.service";
import { listarUsuariosBasico } from "@/server/services/usuario.service";

import { LedgerView } from "./ledger-view";
import { SelectorDeposito, StockTabs } from "./movimientos-tabs";

export type SP = Record<string, string | string[] | undefined>;

/**
 * Ledger del panel (Global o un galpón), la misma vista desde Stock y desde
 * Productos: la ve quien ve STOCK o PRODUCTOS. Filtros en la URL: galpón,
 * familia (entradas, salidas, ventas…) o tipo, fechas, texto (producto, sabor,
 * SKU), sabor/producto puntual, usuario y referencia. Mezcla por fecha los
 * retiros de ventas (sin cambio de cantidad).
 */
export async function PaginaMovimientos({
  searchParams,
  seccion,
}: {
  searchParams: Promise<SP>;
  seccion: "stock" | "productos";
}) {
  const ctx = await requirePaginaPanelAlguno([Modulo.STOCK, Modulo.PRODUCTOS], "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  // Rango: preset (hoy, ayer, semana, mes) o fechas a mano (YYYY-MM-DD, en hora AR).
  const rango = RANGOS.includes(plano.rango as Rango) ? (plano.rango as Rango) : null;
  const fechas = rango ? fechasDeRango(rango) : { desde: plano.desde, hasta: plano.hasta };
  const depositos = await depositosActivosPanel(ctx);
  const base = listarMovimientosSchema.parse({ ...plano, desde: undefined, hasta: undefined });
  const filtros = {
    ...base,
    depositoId: depositos.some((d) => d.id === base.depositoId) ? base.depositoId : undefined,
    desde: esFechaISO(fechas.desde) ? inicioDelDia(fechas.desde) : undefined,
    hasta: esFechaISO(fechas.hasta) ? finDelDia(fechas.hasta) : undefined,
  };

  const [resultado, usuarios, varianteFiltro, productoFiltro] = await Promise.all([
    listarMovimientos(ctx, filtros, { incluirCostos: esOwner(ctx.usuario) }),
    listarUsuariosBasico(),
    filtros.varianteId ? obtenerVariantesPorId(ctx, [filtros.varianteId]) : Promise.resolve([]),
    filtros.productoId
      ? obtenerProducto(ctx, filtros.productoId).catch(() => null)
      : Promise.resolve(null),
  ]);
  const deposito = depositos.find((d) => d.id === filtros.depositoId) ?? null;
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);

  return (
    <LedgerView
      seccion={seccion}
      tabs={
        seccion === "stock" ? (
          <StockTabs panel={ctx.panel} actual="ledger" depositoId={deposito?.id} />
        ) : (
          <TabsNav
            className="mb-6"
            ariaLabel="Productos"
            items={[
              { href: ruta("/productos"), label: "Productos", activo: false },
              { href: ruta("/productos/movimientos"), label: "Movimientos", activo: true },
            ]}
          />
        )
      }
      resultado={resultado}
      params={plano}
      rango={rango}
      fechas={{
        desde: esFechaISO(fechas.desde) ? fechas.desde : "",
        hasta: esFechaISO(fechas.hasta) ? fechas.hasta : "",
      }}
      deposito={deposito?.nombre ?? null}
      usuarios={usuarios}
      varianteFiltro={varianteFiltro[0] ?? null}
      productoFiltro={
        productoFiltro ? { id: productoFiltro.id, nombre: productoFiltro.nombreCompleto } : null
      }
      selector={
        <SelectorDeposito
          depositos={depositos}
          actual={deposito?.id}
          pathname={ruta(`/${seccion}/movimientos`)}
          params={plano}
        />
      }
    />
  );
}
