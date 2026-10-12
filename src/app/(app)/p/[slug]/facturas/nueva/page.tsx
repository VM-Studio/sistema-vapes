import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { rutaPanel } from "@/lib/paneles";
import { tiposPermitidos } from "@/lib/validations/factura";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerConfigFacturacion } from "@/server/services/configuracion.service";
import { ventaParaFacturar } from "@/server/services/factura.service";

import { NuevaFactura } from "./nueva-factura";

export const metadata: Metadata = { title: "Nueva factura" };

/** Nueva factura: desde una venta (`?venta=COS-000123`) o suelta. FACTURAS "crear". */
export default async function NuevaFacturaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.FACTURAS, "crear");
  const config = await obtenerConfigFacturacion(ctx);
  if (!config.habilitada) redirect(rutaPanel(ctx.panel.slug, "/facturas"));
  const { venta } = await searchParams;
  const inicial = typeof venta === "string" ? await ventaParaFacturar(ctx, venta) : null;
  return (
    <NuevaFactura
      tipos={tiposPermitidos(config.condicionIva)}
      alicuotaIva={config.alicuotaIva}
      ventaInicial={inicial}
    />
  );
}
