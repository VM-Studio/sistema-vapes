import { Modulo } from "@prisma/client";
import { PackageOpen } from "lucide-react";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanel } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Cotizador mayorista" };

export default async function Page() {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "ver");
  return (
    <ModuloProximamente
      titulo="Cotizador mayorista"
      descripcion="Presupuestos por mayor para revendedores."
      icono={PackageOpen}
      incluye={[
        "Presupuestos por cantidad con precios mayoristas.",
        "Descuentos por volumen y totales al instante.",
        "Compartir el presupuesto por WhatsApp o pasarlo a venta.",
      ]}
      inicioHref={rutaPanel(ctx.panel.slug)}
    />
  );
}
