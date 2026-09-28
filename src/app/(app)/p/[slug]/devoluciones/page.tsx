import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esFechaISO } from "@/lib/fechas";
import { puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerClienteBasico } from "@/server/services/cliente.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { listarDevoluciones, ventaParaDevolucion } from "@/server/services/devolucion.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { DevolucionesView } from "./devoluciones-view";
import type { InicialDevolucion } from "./registrar-devolucion";

export const metadata: Metadata = { title: "Devoluciones" };

type SP = Record<string, string | string[] | undefined>;

export default async function DevolucionesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.DEVOLUCIONES, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const puedeCrear = puede(ctx.usuario, ctx.panelId, Modulo.DEVOLUCIONES, "crear");

  const [resultado, depositos, inicial] = await Promise.all([
    listarDevoluciones(ctx, {
      desde: esFechaISO(plano.desde) ? plano.desde : undefined,
      hasta: esFechaISO(plano.hasta) ? plano.hasta : undefined,
      clienteId: plano.cliente || undefined,
      page: Math.max(1, Number(plano.page) || 1),
      pageSize: 30,
    }),
    puedeCrear ? listarDepositosActivos(ctx) : Promise.resolve([]),
    puedeCrear && plano.nueva === "1" ? inicialDesdeUrl(ctx, plano) : Promise.resolve(null),
  ]);

  return (
    <DevolucionesView
      resultado={resultado}
      params={plano}
      depositos={depositos}
      abrirNueva={puedeCrear && plano.nueva === "1"}
      inicial={inicial}
    />
  );
}

/** `?nueva=1&ventaId=…` (cliente y sabores de esa venta) o `?nueva=1&clienteId=…`. */
async function inicialDesdeUrl(
  ctx: Parameters<typeof listarDevoluciones>[0],
  p: Record<string, string>,
): Promise<InicialDevolucion | null> {
  if (p.ventaId) {
    const v = await ventaParaDevolucion(ctx, p.ventaId);
    if (!v) return null;
    const variantes = await obtenerVariantesPorId(ctx, [
      ...new Set(v.venta.items.map((i) => i.varianteId)),
    ]);
    return { cliente: v.cliente, venta: v.venta, variantes };
  }
  if (p.clienteId) {
    const c = await obtenerClienteBasico(ctx, p.clienteId);
    return c ? { cliente: c, venta: null, variantes: [] } : null;
  }
  return null;
}
