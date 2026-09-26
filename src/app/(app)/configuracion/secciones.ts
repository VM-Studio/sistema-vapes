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
    href: "/configuracion/ventas",
    label: "Ventas y comprobante",
    descripcion: "Datos del negocio, numeración y redondeo (solo dueño)",
  },
  {
    href: "/configuracion/finanzas",
    label: "Caja y reportes",
    descripcion: "Zona horaria, arqueo, reposición y rotación (solo dueño)",
  },
  {
    href: "/configuracion/negocio",
    label: "Negocio y app",
    descripcion: "Ícono de la app instalada (solo dueño)",
  },
  {
    href: "/configuracion/backups",
    label: "Backups",
    descripcion: "Copias de seguridad automáticas y descarga (solo dueño)",
  },
  {
    href: "/configuracion/auditoria",
    label: "Auditoría",
    descripcion: "Quién hizo qué y cuándo (solo dueño)",
  },
  {
    href: "/configuracion/exportar-todo",
    label: "Exportar todo",
    descripcion: "Todos los datos del negocio en Excel",
  },
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
