import type { TabNavItem } from "@/components/ui/tabs-nav";
import { rutaPanel } from "@/lib/paneles";

/** Ajustes del panel (solo dueños): cada panel tiene los suyos. */
export const SECCIONES_AJUSTES_PANEL = [
  {
    ruta: "/configuracion/categorias",
    label: "Categorías",
    descripcion: "Cómo se agrupan los productos del panel",
  },
  { ruta: "/configuracion/marcas", label: "Marcas", descripcion: "Fabricantes de los productos" },
  {
    ruta: "/configuracion/depositos",
    label: "Depósitos",
    descripcion: "Dónde se guarda la mercadería y cuál es el principal",
  },
  {
    ruta: "/configuracion/escaner",
    label: "Escáner",
    descripcion: "Pistola lectora: parámetros y prueba",
  },
  {
    ruta: "/configuracion/ventas",
    label: "Ventas y catálogo",
    descripcion: "Redondeo del cobro, prefijo de SKU y alertas de stock",
  },
] as const;

export type RutaAjustes = (typeof SECCIONES_AJUSTES_PANEL)[number]["ruta"];

export function tabsAjustesPanel(slug: string, actual: RutaAjustes): TabNavItem[] {
  return SECCIONES_AJUSTES_PANEL.map((s) => ({
    href: rutaPanel(slug, s.ruta),
    label: s.label,
    activo: s.ruta === actual,
  }));
}
