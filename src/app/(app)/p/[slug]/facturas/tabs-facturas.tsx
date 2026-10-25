import { TabsNav } from "@/components/ui/tabs-nav";
import { rutaPanel } from "@/lib/paneles";

/**
 * Pestañas de Facturas en los paneles que cobran por Mercado Libre: las
 * facturas del sistema y la carga de las facturas de las ventas ML (ARCA).
 */
export function TabsFacturas({
  slug,
  activa,
  pendientesML,
}: {
  slug: string;
  activa: "facturas" | "mercado-libre";
  /** Ventas ML con la factura pendiente de cargar (badge). */
  pendientesML?: number;
}) {
  return (
    <TabsNav
      ariaLabel="Secciones de Facturas"
      className="mb-4"
      items={[
        { href: rutaPanel(slug, "/facturas"), label: "Facturas", activo: activa === "facturas" },
        {
          href: rutaPanel(slug, "/facturas/mercado-libre"),
          label: "Ventas Mercado Libre",
          activo: activa === "mercado-libre",
          ...(pendientesML ? { badge: pendientesML } : {}),
        },
      ]}
    />
  );
}
