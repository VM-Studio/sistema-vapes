import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { puede } from "@/lib/permisos";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
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
  const usuario = await requirePaginaPermiso(Modulo.VENTAS, "crear");
  const params = await searchParams;
  const [depositos, config] = await Promise.all([listarDepositosActivos(), obtenerConfigVentas()]);

  let inicial: EstadoInicialPos | null = null;
  const borradorId = texto(params.borrador);
  if (borradorId) {
    const b = await obtenerBorradorParaPos(borradorId).catch((e: unknown) => {
      if (e instanceof NotFoundError) return null;
      throw e;
    });
    if (b) {
      const variantes = await obtenerVariantesPorId(
        b.items.map((i) => i.varianteId),
        b.depositoId,
      );
      const porId = new Map(variantes.map((v) => [v.id, v]));
      inicial = {
        borradorId: b.id,
        borradorNumero: b.numero,
        depositoId: b.depositoId,
        cliente: b.clienteId ? await obtenerClientePos(b.clienteId) : null,
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
              varianteId: v.id,
              nombreCompleto: v.nombreCompleto,
              sku: v.sku,
              precioLista: v.precioVenta,
              precioManual: precio !== v.precioVenta ? precio : null,
              cantidad: i.cantidad,
              stock: v.stockDeposito ?? 0,
            },
          ];
        }),
      };
    }
  }
  const clienteParam = texto(params.cliente);
  const clienteInicial = !inicial && clienteParam ? await obtenerClientePos(clienteParam) : null;

  const depositoUrl = texto(params.deposito);
  const depositoInicial =
    inicial?.depositoId ??
    (depositoUrl && depositos.some((d) => d.id === depositoUrl) ? depositoUrl : undefined) ??
    depositos.find((d) => d.esPrincipal)?.id ??
    depositos[0]?.id ??
    "";

  return (
    <>
      <VentasTabs usuario={usuario} actual="nueva" />
      <Pos
        depositos={depositos}
        depositoInicial={depositoInicial}
        depositoFijadoPorUrl={Boolean(depositoUrl) || Boolean(inicial)}
        grillaInicial={depositoInicial ? await productosRapidos(depositoInicial) : []}
        inicial={inicial}
        clienteInicial={clienteInicial}
        puedeEditar={puede(usuario, Modulo.VENTAS, "editar")}
        redondeoConfig={config.redondeoVentas}
        nombreNegocio={config.nombreNegocio}
      />
    </>
  );
}
