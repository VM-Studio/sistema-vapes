import { Modulo } from "@prisma/client";
import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanel } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Reportes" };

export default async function Page() {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  return (
    <ModuloProximamente
      titulo="Reportes"
      descripcion="Ventas, stock y rendimiento del panel."
      icono={BarChart3}
      incluye={[
        "Ventas por período, producto, categoría y vendedor.",
        "Stock por depósito y productos sin movimiento.",
        "Costos y ganancias, visibles solo para los dueños.",
      ]}
      inicioHref={rutaPanel(ctx.panel.slug)}
    />
  );
}
