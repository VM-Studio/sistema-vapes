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

/** ?deposito=id&items=varianteId:cantidad,… precargan la compra (ej: "Registrar como compra" desde /escanear). */
export default async function NuevaCompraPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "crear");
  const params = await searchParams;
  const [depositos, proveedores] = await Promise.all([
    listarDepositosActivos(ctx),
    listarProveedoresActivos(ctx),
  ]);
  const depositoId =
    (typeof params.deposito === "string" && depositos.find((d) => d.id === params.deposito)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const pedidos = new Map<string, number>();
  if (typeof params.items === "string") {
    for (const par of params.items.split(",").slice(0, 300)) {
      const [id, cant] = par.split(":");
      const n = Number(cant);
      if (id && Number.isInteger(n) && n > 0) pedidos.set(id, (pedidos.get(id) ?? 0) + n);
    }
  }
  const variantes = await obtenerVariantesPorId(ctx, [...pedidos.keys()]);
  const proveedorId =
    typeof params.proveedor === "string" && proveedores.some((p) => p.id === params.proveedor)
      ? params.proveedor
      : "";

  return (
    <CompraForm
      proveedores={proveedores}
      depositos={depositos}
      inicial={{
        id: null,
        proveedorId,
        depositoId,
        fecha: hoyAR(),
        descuento: "0",
        notas: "",
        items: variantes.map((v) => ({
          varianteId: v.id,
          nombre: v.nombreCompleto,
          sku: v.sku,
          precioCostoActual: v.precioCosto,
          cantidad: String(pedidos.get(v.id) ?? 1),
          costo: v.precioCosto === null ? "" : String(Number(v.precioCosto)),
        })),
      }}
    />
  );
}
