import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { DomainError, NotFoundError } from "@/server/errors";
import { obtenerClientePos } from "@/server/services/cliente.service";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";
import { obtenerBorradorParaPos, productosRapidos } from "@/server/services/venta.service";

import { VentasTabs } from "../ventas-tabs";
import { Pos, type EstadoInicialPos } from "./pos";

export const metadata: Metadata = { title: "Nueva venta" };

type SP = Record<string, string | string[] | undefined>;
const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** ?deposito=id · ?borrador=id (retomar) · ?cliente=id (vender a un cliente desde su ficha). */
export default async function NuevaVentaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.VENTAS, "crear");
  const params = await searchParams;
  const [depositos, config] = await Promise.all([
    listarDepositosActivos(ctx),
    obtenerConfigVentas(ctx),
  ]);

  let inicial: EstadoInicialPos | null = null;
  const borradorId = texto(params.borrador);
  if (borradorId) {
    const b = await obtenerBorradorParaPos(ctx, borradorId).catch((e: unknown) => {
      if (e instanceof NotFoundError || e instanceof DomainError) return null;
      throw e;
    });
    if (b) {
      const variantes = await obtenerVariantesPorId(
        ctx,
        b.items.map((i) => i.varianteId),
        b.depositoId,
      );
      const porId = new Map(variantes.map((v) => [v.varianteId, v]));
      inicial = {
        borradorId: b.id,
        borradorIdVenta: b.idVenta,
        depositoId: b.depositoId,
        cliente: b.clienteId ? await obtenerClientePos(ctx, b.clienteId) : null,
        descuento: b.descuento.greaterThan(0)
          ? { tipo: "monto", valor: b.descuento.toFixed(2) }
          : null,
        notas: b.notas ?? "",
        items: b.items.flatMap((i) => {
          const v = porId.get(i.varianteId);
          if (!v) return [];
          const precio = i.precioUnitario.toFixed(2);
          return [
            {
              varianteId: v.varianteId,
              nombreCompleto: v.titulo,
              sku: v.sku,
              precioLista: v.precioVenta,
              precioManual: precio !== v.precioVenta ? precio : null,
              cantidad: i.cantidad,
              stock: v.stockEnDeposito ?? 0,
            },
          ];
        }),
      };
    }
  }
  const clienteParam = texto(params.cliente);
  const clienteInicial =
    !inicial && clienteParam ? await obtenerClientePos(ctx, clienteParam) : null;

  const depositoUrl = texto(params.deposito);
  const depositoInicial =
    inicial?.depositoId ??
    (depositoUrl && depositos.some((d) => d.id === depositoUrl) ? depositoUrl : undefined) ??
    depositos.find((d) => d.esPrincipal)?.id ??
    depositos[0]?.id ??
    "";

  return (
    <>
      <VentasTabs ctx={ctx} actual="nueva" />
      <Pos
        depositos={depositos}
        depositoInicial={depositoInicial}
        depositoFijadoPorUrl={Boolean(depositoUrl) || Boolean(inicial)}
        grillaInicial={depositoInicial ? await productosRapidos(ctx, depositoInicial) : []}
        inicial={inicial}
        clienteInicial={clienteInicial}
        puedeEditar={puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "editar")}
        redondeoConfig={config.redondeoVentas}
      />
    </>
  );
}
