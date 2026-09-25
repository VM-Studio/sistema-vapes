import { Modulo } from "@prisma/client";

import { TabsNav } from "@/components/ui/tabs-nav";
import { puede, type UsuarioSesion } from "@/lib/permisos";

/** Arriba de las pantallas de ventas: el POS primero, el listado como secundario. */
export function VentasTabs({
  usuario,
  actual,
}: {
  usuario: UsuarioSesion;
  actual: "nueva" | "listado" | "borradores";
}) {
  const items = [
    { id: "nueva", href: "/ventas/nueva", label: "Nueva venta", accion: "crear" },
    { id: "listado", href: "/ventas", label: "Ventas", accion: "ver" },
    { id: "borradores", href: "/ventas?estado=BORRADOR", label: "Borradores", accion: "crear" },
  ] as const;
  return (
    <TabsNav
      className="mb-4"
      ariaLabel="Ventas"
      items={items
        .filter((i) => puede(usuario, Modulo.VENTAS, i.accion))
        .map((i) => ({ href: i.href, label: i.label, activo: i.id === actual }))}
    />
  );
}
