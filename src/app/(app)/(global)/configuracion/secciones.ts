import type { TabNavItem } from "@/components/ui/tabs-nav";

/**
 * Configuración GLOBAL (solo dueños). Lo de cada panel (depósitos, categorías,
 * marcas, escáner, ventas) está en "Ajustes del panel", dentro de cada sistema.
 */
export const SECCIONES_CONFIGURACION = [
  {
    href: "/configuracion/negocio",
    label: "Negocio y app",
    descripcion: "Ícono de la app instalada",
  },
  {
    href: "/configuracion/sistemas",
    label: "Sistemas",
    descripcion: "Paneles activos y baja de paneles",
  },
  {
    href: "/configuracion/backups",
    label: "Backups",
    descripcion: "Copias de seguridad automáticas y descarga",
  },
  {
    href: "/configuracion/auditoria",
    label: "Auditoría",
    descripcion: "Quién hizo qué y cuándo, en todos los sistemas",
  },
  {
    href: "/configuracion/exportar-todo",
    label: "Exportar todo",
    descripcion: "Todos los datos de todos los sistemas en Excel",
  },
] as const;

export function tabsConfiguracion(actual: string): TabNavItem[] {
  return SECCIONES_CONFIGURACION.map((s) => ({
    href: s.href,
    label: s.label,
    activo: s.href === actual,
  }));
}
