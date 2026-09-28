import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

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
import { requirePaginaPanel } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import { listarMovimientos } from "@/server/services/movimiento.service";
import { obtenerProducto, obtenerVariantesPorId } from "@/server/services/producto.service";
import { listarUsuariosBasico } from "@/server/services/usuario.service";

import { LedgerView } from "./ledger-view";
import { SelectorDeposito, StockTabs } from "./movimientos-tabs";

export const metadata: Metadata = { title: "Movimientos de stock" };

type SP = Record<string, string | string[] | undefined>;

/** Ledger del panel: Global (todos los depósitos) o un depósito. */
export default async function MovimientosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "ver");
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

  return (
    <>
      <StockTabs panel={ctx.panel} actual="ledger" depositoId={deposito?.id} />
      <LedgerView
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
            pathname={rutaPanel(ctx.panel.slug, "/stock/movimientos")}
            params={plano}
          />
        }
      />
    </>
  );
}
