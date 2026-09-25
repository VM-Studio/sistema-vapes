import type { TabNavItem } from "@/components/ui/tabs-nav";

export const SECCIONES_CONFIGURACION = [
  {
    href: "/configuracion/depositos",
    label: "Depósitos",
    descripcion: "Galpones donde se guarda la mercadería",
  },
  {
    href: "/configuracion/categorias",
    label: "Categorías",
    descripcion: "Vapes, pods, líquidos, accesorios…",
  },
  { href: "/configuracion/marcas", label: "Marcas", descripcion: "Fabricantes de los productos" },
  {
    href: "/configuracion/escaner",
    label: "Escáner",
    descripcion: "Pistola lectora: parámetros y prueba",
  },
] as const;

export function tabsConfiguracion(actual: string): TabNavItem[] {
  return SECCIONES_CONFIGURACION.map((s) => ({
    href: s.href,
    label: s.label,
    activo: s.href === actual,
  }));
}
