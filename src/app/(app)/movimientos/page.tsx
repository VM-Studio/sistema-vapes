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
import { listarMovimientosSchema } from "@/lib/validations/movimiento";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositos } from "@/server/services/deposito.service";
import { listarMovimientos } from "@/server/services/movimiento.service";
import { obtenerProducto, obtenerVariantesPorId } from "@/server/services/producto.service";
import { listarUsuariosBasico } from "@/server/services/usuario.service";

import { LedgerView } from "./ledger-view";
import { MovimientosTabs } from "./movimientos-tabs";

export const metadata: Metadata = { title: "Movimientos" };

type SP = Record<string, string | string[] | undefined>;

export default async function MovimientosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const usuario = await requirePaginaPermiso(Modulo.MOVIMIENTOS, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  // Rango: preset (hoy, ayer, semana, mes) o fechas a mano (YYYY-MM-DD, en hora AR).
  const rango = RANGOS.includes(plano.rango as Rango) ? (plano.rango as Rango) : null;
  const fechas = rango ? fechasDeRango(rango) : { desde: plano.desde, hasta: plano.hasta };
  const filtros = {
    ...listarMovimientosSchema.parse({ ...plano, desde: undefined, hasta: undefined }),
    desde: esFechaISO(fechas.desde) ? inicioDelDia(fechas.desde) : undefined,
    hasta: esFechaISO(fechas.hasta) ? finDelDia(fechas.hasta) : undefined,
  };

  const [resultado, depositos, usuarios, varianteFiltro, productoFiltro] = await Promise.all([
    listarMovimientos(filtros),
    listarDepositos(),
    listarUsuariosBasico(),
    filtros.varianteId ? obtenerVariantesPorId([filtros.varianteId]) : Promise.resolve([]),
    filtros.productoId
      ? obtenerProducto(filtros.productoId).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <MovimientosTabs usuario={usuario} actual="ledger" />
      <LedgerView
        resultado={resultado}
        params={plano}
        rango={rango}
        fechas={{
          desde: esFechaISO(fechas.desde) ? fechas.desde : "",
          hasta: esFechaISO(fechas.hasta) ? fechas.hasta : "",
        }}
        depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre }))}
        usuarios={usuarios}
        varianteFiltro={varianteFiltro[0] ?? null}
        productoFiltro={
          productoFiltro ? { id: productoFiltro.id, nombre: productoFiltro.nombre } : null
        }
      />
    </>
  );
}
