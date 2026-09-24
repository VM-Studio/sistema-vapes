import { Modulo } from "@prisma/client";

import { TabsNav } from "@/components/ui/tabs-nav";
import { puede, type UsuarioSesion } from "@/lib/permisos";

type Seccion = "ledger" | "ingreso" | "ajuste" | "transferencias";

/** Sub-navegación del módulo: solo muestra lo que el usuario puede hacer. */
export function MovimientosTabs({ usuario, actual }: { usuario: UsuarioSesion; actual: Seccion }) {
  const items = [
    { id: "ledger", href: "/movimientos", label: "Historial", accion: "ver" },
    { id: "ingreso", href: "/movimientos/ingreso", label: "Ingreso manual", accion: "crear" },
    { id: "ajuste", href: "/movimientos/ajuste", label: "Ajuste / recuento", accion: "editar" },
    {
      id: "transferencias",
      href: "/movimientos/transferencias",
      label: "Transferencias",
      accion: "ver",
    },
  ] as const;
  return (
    <TabsNav
      className="mb-4"
      ariaLabel="Movimientos"
      items={items
        .filter((i) => puede(usuario, Modulo.MOVIMIENTOS, i.accion))
        .map((i) => ({ href: i.href, label: i.label, activo: i.id === actual }))}
    />
  );
}
