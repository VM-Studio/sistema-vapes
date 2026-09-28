import { Modulo } from "@prisma/client";
import { Calculator } from "lucide-react";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanel } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Cotizador unitario" };

export default async function Page() {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "ver");
  return (
    <ModuloProximamente
      titulo="Cotizador unitario"
      descripcion="Presupuestos por unidad para tus clientes."
      icono={Calculator}
      incluye={[
        "Armar un presupuesto escaneando o buscando productos.",
        "Precios por unidad con el stock disponible a la vista.",
        "Compartir el presupuesto por WhatsApp o pasarlo a venta.",
      ]}
      inicioHref={rutaPanel(ctx.panel.slug)}
    />
  );
}
