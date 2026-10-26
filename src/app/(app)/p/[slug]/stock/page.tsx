import { Modulo, TipoMovimiento } from "@prisma/client";
import type { Metadata } from "next";

import { esFechaISO, finDelDia, inicioDelDia } from "@/lib/fechas";
import { FAMILIAS } from "@/lib/movimientos-ui";
import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { opcionesFiltrosStock } from "@/server/services/inventario.service";
import { listarMarcasActivas } from "@/server/services/marca.service";
import {
  movimientos,
  resumenStock,
  stockGlobal,
  stockPorDeposito,
} from "@/server/services/stock.service";

import { StockView } from "./stock-view";

export const metadata: Metadata = { title: "Stock" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Stock del panel en pestañas: una por galpón (su stock y sus movimientos) y
 * "Global" (cada galpón en su columna + total, y los movimientos de todos).
 * Todo el estado vive en la URL: `tab` (id del galpón o "global"), filtros
 * del stock (q, marcaId, modelo, gusto, pitadas, ver = tarjeta Disponible /
 * Escaneado / Retirado, soloBajoMinimo, vista, page) y del ledger
 * (mfamilia, mtipo, mdesde, mhasta, mpage).
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  const marcaId = plano.marcaId || undefined;
  const [resumen, opciones] = await Promise.all([
    resumenStock(ctx),
    opcionesFiltrosStock(ctx, { marcaId }),
  ]);
  // Un modelo que no es de la marca elegida (se cambió la marca) se ignora.
  const valido = (v: string | undefined, lista: { value: string }[]) =>
    v && lista.some((o) => o.value === v) ? v : undefined;
  const depositos = resumen.porDeposito;
  const principal = depositos.find((d) => d.esPrincipal) ?? depositos[0];
  const deposito =
    plano.tab === "global"
      ? null
      : (depositos.find((d) => d.id === plano.tab) ?? principal ?? null);

  const filtros = {
    q: plano.q?.trim().slice(0, 100) || undefined,
    marcaId,
    modelo: valido(plano.modelo, opciones.modelos),
    gusto: valido(plano.gusto, opciones.gustos),
    pitadas: valido(plano.pitadas, opciones.pitadas),
    ver: (["disponible", "escaneado", "retirado"] as const).find((v) => v === plano.ver),
    soloBajoMinimo: plano.soloBajoMinimo === "1",
    porProducto: !deposito && plano.vista === "producto",
    page: Math.max(1, Number(plano.page) || 1),
  };
  const tipo = Object.values(TipoMovimiento).includes(plano.mtipo as TipoMovimiento)
    ? (plano.mtipo as TipoMovimiento)
    : undefined;

  const [datos, ledger, marcas] = await Promise.all([
    deposito ? stockPorDeposito(ctx, deposito.id, filtros) : stockGlobal(ctx, filtros),
    movimientos(
      ctx,
      {
        depositoId: deposito?.id ?? null,
        tipo,
        familia: FAMILIAS.find((f) => f === plano.mfamilia),
        desde: esFechaISO(plano.mdesde) ? inicioDelDia(plano.mdesde) : undefined,
        hasta: esFechaISO(plano.mhasta) ? finDelDia(plano.mhasta) : undefined,
        page: Math.max(1, Number(plano.mpage) || 1),
        pageSize: 20,
      },
      { incluirCostos: esOwner(ctx.usuario), incluirRetiros: true },
    ),
    listarMarcasActivas(ctx),
  ]);

  return (
    <StockView
      resumen={resumen}
      depositoId={deposito?.id ?? null}
      datos={datos}
      porProducto={filtros.porProducto}
      soloBajoMinimo={filtros.soloBajoMinimo}
      ledger={ledger}
      params={plano}
      marcas={marcas.map((m) => ({ value: m.id, label: m.nombre }))}
      opciones={opciones}
      ver={filtros.ver ?? null}
      puedeExportar={esOwner(ctx.usuario)}
    />
  );
}
