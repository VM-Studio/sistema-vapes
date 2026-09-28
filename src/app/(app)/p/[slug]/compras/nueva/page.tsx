import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { hoyAR } from "@/lib/fechas";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";
import { listarProveedoresActivos } from "@/server/services/proveedor.service";

import { CompraForm } from "../compra-form";

export const metadata: Metadata = { title: "Nueva compra" };

type SP = Record<string, string | string[] | undefined>;

/**
 * ?proveedor=id preselecciona el proveedor (desde su ficha) · ?deposito=id
 * preselecciona el galpón · ?items=varianteId:cantidad,… precarga ítems
 * (ítems precargados por URL). El costo sugerido se
 * completa en el cliente apenas hay proveedor.
 */
export default async function NuevaCompraPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "crear");
  const params = await searchParams;
  const [depositos, proveedores] = await Promise.all([
    listarDepositosActivos(ctx),
    listarProveedoresActivos(ctx),
  ]);
  const depositoId =
    typeof params.deposito === "string" && depositos.some((d) => d.id === params.deposito)
      ? params.deposito
      : "";
  const proveedorId =
    typeof params.proveedor === "string" && proveedores.some((p) => p.id === params.proveedor)
      ? params.proveedor
      : "";
  const pedidos = new Map<string, number>();
  if (typeof params.items === "string") {
    for (const par of params.items.split(",").slice(0, 300)) {
      const [id, cant] = par.split(":");
      const n = Number(cant);
      if (id && Number.isInteger(n) && n > 0) pedidos.set(id, (pedidos.get(id) ?? 0) + n);
    }
  }
  const variantes = await obtenerVariantesPorId(ctx, [...pedidos.keys()]);

  return (
    <CompraForm
      proveedores={proveedores}
      depositos={depositos}
      inicial={{
        id: null,
        proveedorId,
        depositoId,
        fecha: hoyAR(),
        notas: "",
        items: variantes.map((v) => ({
          varianteId: v.varianteId,
          productoId: v.productoId,
          nombreCompleto: v.nombreCompleto,
          sabor: v.sabor,
          sku: v.sku,
          cantidad: String(pedidos.get(v.varianteId) ?? 1),
          costo: "",
          origenCosto: null,
        })),
      }}
    />
  );
}
