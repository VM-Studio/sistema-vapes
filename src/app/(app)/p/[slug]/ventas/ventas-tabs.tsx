import { Modulo } from "@prisma/client";

import { TabsNav } from "@/components/ui/tabs-nav";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import type { CtxPanel } from "@/server/auth/permissions";

/** Arriba de las pantallas de ventas: el POS primero, el listado como secundario. */
export function VentasTabs({
  ctx,
  actual,
}: {
  ctx: CtxPanel;
  actual: "nueva" | "listado" | "borradores";
}) {
  const items = [
    { id: "nueva", ruta: "/ventas/nueva", label: "Nueva venta", accion: "crear" },
    { id: "listado", ruta: "/ventas", label: "Ventas", accion: "ver" },
    { id: "borradores", ruta: "/ventas?estado=BORRADOR", label: "Borradores", accion: "crear" },
  ] as const;
  return (
    <TabsNav
      className="mb-4"
      ariaLabel="Ventas"
      items={items
        .filter((i) => puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, i.accion))
        .map((i) => ({
          href: rutaPanel(ctx.panel.slug, i.ruta),
          label: i.label,
          activo: i.id === actual,
        }))}
    />
  );
}
