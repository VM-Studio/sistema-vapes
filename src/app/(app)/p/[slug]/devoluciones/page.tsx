import { Modulo } from "@prisma/client";
import { Undo2 } from "lucide-react";
import type { Metadata } from "next";

import { ModuloProximamente } from "@/components/layout/modulo-proximamente";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanel } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Devoluciones" };

export default async function Page() {
  const ctx = await requirePaginaPanel(Modulo.DEVOLUCIONES, "ver");
  return (
    <ModuloProximamente
      titulo="Devoluciones"
      descripcion="Devoluciones por garantía de productos vendidos."
      icono={Undo2}
      incluye={[
        "Registrar la devolución de un producto por garantía, a partir del ID de venta.",
        "Reponer el producto al cliente y dejar el movimiento de stock asentado.",
        "Historial de devoluciones por producto y por cliente.",
      ]}
      inicioHref={rutaPanel(ctx.panel.slug)}
    />
  );
}
