import { Modulo } from "@prisma/client";
import {
  BarChart3,
  Boxes,
  Building2,
  FileSpreadsheet,
  Calculator,
  HandCoins,
  Home,
  Package,
  PackageOpen,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Undo2,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { esOwner, puede, type SujetoPermisos } from "@/lib/permisos";
import { rutaPanel } from "@/lib/paneles";

/**
 * ÚNICA fuente de la navegación DENTRO de un panel: sidebar (desktop),
 * bottom bar y sheet "Más" (mobile), accesos rápidos del inicio y título de
 * la barra superior. Los `href` son relativos al panel ("/productos" →
 * "/p/{slug}/productos"); navegacionPermitida() los resuelve y filtra con los
 * permisos del usuario EN ESE PANEL. (Ocultarlo es solo UX: cada página y
 * acción valida en el servidor.)
 */

export type GrupoNavegacion = "Operación" | "Compras" | "Análisis" | "Administración";

export const GRUPOS: readonly GrupoNavegacion[] = [
  "Operación",
  "Compras",
  "Análisis",
  "Administración",
];

export interface ItemNavegacion {
  /**
   * Módulo que hay que poder "ver". null = siempre visible (Inicio).
   * Array = alcanza con poder ver cualquiera de los módulos.
   * "OWNER" = solo dueños (configuración del panel).
   */
  modulo: Modulo | readonly Modulo[] | "OWNER" | null;
  label: string;
  /** Relativo al panel ("/" = inicio del panel), o absoluto si `global`. */
  href: string;
  icon: LucideIcon;
  /** null = fuera de grupos (arriba de todo en el sidebar). */
  grupo: GrupoNavegacion | null;
  /** Bottom navigation mobile: Inicio, Ventas, Productos, Stock (+ "Más"). */
  enBottomBar: boolean;
  /**
   * Orden en mobile (bottom bar y sheet "Más"), que no es el del sidebar:
   * Inicio · Ventas · Productos · Stock | Fiados, Clientes, Devoluciones, Proveedores,
   * Compras, Cotizadores, Reportes, ajustes.
   */
  ordenMobile: number;
  /** Texto corto para los accesos rápidos del inicio. */
  descripcion: string;
  /** Ruta global (fuera del panel): /usuarios, /configuracion. */
  global?: boolean;
  /**
   * Destino directo si el usuario puede hacer `accion` en el módulo (Ventas abre el POS);
   * si no, `href`. El ítem queda activo en todo `href/*` igual.
   */
  accionPrincipal?: { href: string; accion: "crear" };
  /** Prefijo de ruta absoluto para marcar el ítem activo (lo completa navegacionPermitida). */
  base?: string;
}

export const NAVEGACION: readonly ItemNavegacion[] = [
  {
    modulo: null,
    label: "Inicio",
    href: "/",
    icon: Home,
    grupo: null,
    enBottomBar: true,
    ordenMobile: 0,
    descripcion: "Resumen del sistema",
  },
  {
    modulo: Modulo.VENTAS,
    label: "Ventas",
    href: "/ventas",
    accionPrincipal: { href: "/ventas?nueva=1", accion: "crear" },
    icon: ShoppingCart,
    grupo: "Operación",
    enBottomBar: true,
    ordenMobile: 1,
    descripcion: "Vender y consultar ventas",
  },
  {
    modulo: Modulo.STOCK,
    label: "Stock",
    href: "/stock",
    icon: Boxes,
    grupo: "Operación",
    enBottomBar: true,
    ordenMobile: 3,
    descripcion: "Stock por galpón y global, transferencias y movimientos",
  },
  {
    modulo: Modulo.PRODUCTOS,
    label: "Productos",
    href: "/productos",
    icon: Package,
    grupo: "Operación",
    enBottomBar: true,
    ordenMobile: 2,
    descripcion: "Productos, sabores, precios y carga de stock",
  },
  {
    modulo: Modulo.DEVOLUCIONES,
    label: "Devoluciones",
    href: "/devoluciones",
    icon: Undo2,
    grupo: "Operación",
    enBottomBar: false,
    ordenMobile: 11,
    descripcion: "Devoluciones por garantía",
  },
  {
    modulo: Modulo.CLIENTES,
    label: "Clientes",
    href: "/clientes",
    icon: Users,
    grupo: "Operación",
    enBottomBar: false,
    ordenMobile: 10,
    descripcion: "Clientes y sus compras",
  },
  {
    modulo: Modulo.FIADOS,
    label: "Fiados",
    href: "/fiados",
    icon: HandCoins,
    grupo: "Operación",
    enBottomBar: false,
    ordenMobile: 9,
    descripcion: "Cuenta corriente: quién debe y cobros",
  },
  {
    modulo: Modulo.PROVEEDORES,
    label: "Proveedores",
    href: "/proveedores",
    icon: Building2,
    grupo: "Compras",
    enBottomBar: false,
    ordenMobile: 12,
    descripcion: "Proveedores y sus precios",
  },
  {
    modulo: Modulo.COMPRAS,
    label: "Compras",
    href: "/compras",
    icon: Truck,
    grupo: "Compras",
    enBottomBar: false,
    ordenMobile: 13,
    descripcion: "Mercadería recibida de proveedores",
  },
  // Los dos accesos directos van antes que el listado: tituloDeRuta toma el primero que coincide.
  {
    modulo: Modulo.COTIZADOR,
    label: "Cotizar por unidad",
    href: "/cotizador/unitaria/nueva",
    icon: Calculator,
    grupo: "Análisis",
    enBottomBar: false,
    ordenMobile: 14,
    descripcion: "Presupuesto por unidad",
  },
  {
    modulo: Modulo.COTIZADOR,
    label: "Cotizar por mayor",
    href: "/cotizador/mayorista/nueva",
    icon: PackageOpen,
    grupo: "Análisis",
    enBottomBar: false,
    ordenMobile: 15,
    descripcion: "Presupuesto con precios por escalón",
  },
  {
    modulo: Modulo.COTIZADOR,
    label: "Cotizaciones",
    href: "/cotizador",
    icon: FileSpreadsheet,
    grupo: "Análisis",
    enBottomBar: false,
    ordenMobile: 16,
    descripcion: "Presupuestos guardados, enviados y convertidos",
  },
  {
    modulo: Modulo.REPORTES,
    label: "Reportes",
    href: "/reportes",
    icon: BarChart3,
    grupo: "Análisis",
    enBottomBar: false,
    ordenMobile: 17,
    descripcion: "Ventas, stock y rendimiento",
  },
  {
    modulo: "OWNER",
    label: "Equipo",
    href: "/equipo",
    icon: UsersRound,
    grupo: "Análisis",
    enBottomBar: false,
    ordenMobile: 18,
    descripcion: "Rendimiento de cada vendedor",
  },
  {
    modulo: "OWNER",
    label: "Ajustes del panel",
    href: "/configuracion",
    icon: SlidersHorizontal,
    grupo: "Administración",
    enBottomBar: false,
    ordenMobile: 20,
    descripcion: "Depósitos, categorías, marcas, escáner y ventas",
  },
  {
    modulo: Modulo.USUARIOS,
    label: "Usuarios",
    href: "/usuarios",
    icon: UserCog,
    grupo: "Administración",
    enBottomBar: false,
    ordenMobile: 21,
    global: true,
    descripcion: "Accesos y permisos del equipo",
  },
  {
    modulo: Modulo.CONFIGURACION,
    label: "Configuración",
    href: "/configuracion",
    icon: Settings,
    grupo: "Administración",
    enBottomBar: false,
    ordenMobile: 22,
    global: true,
    descripcion: "Negocio, backups, auditoría",
  },
];

export function puedeVerItem(
  usuario: SujetoPermisos,
  panelId: string,
  item: ItemNavegacion,
): boolean {
  if (item.modulo === null) return true;
  if (item.modulo === "OWNER") return esOwner(usuario);
  const modulos: readonly Modulo[] = Array.isArray(item.modulo)
    ? item.modulo
    : [item.modulo as Modulo];
  return modulos.some((m) => puede(usuario, item.global ? null : panelId, m, "ver"));
}

/** Ítems que el usuario puede ver en el panel, con `href` y `base` absolutos. */
export function navegacionPermitida(
  usuario: SujetoPermisos,
  panel: { id: string; slug: string },
): ItemNavegacion[] {
  const abs = (item: ItemNavegacion, href: string) =>
    item.global ? href : rutaPanel(panel.slug, href);
  return NAVEGACION.filter((item) => puedeVerItem(usuario, panel.id, item)).map((item) => {
    const principal = item.accionPrincipal;
    const modulo =
      Array.isArray(item.modulo) || item.modulo === "OWNER" ? null : (item.modulo as Modulo | null);
    const base = abs(item, item.href);
    return principal && modulo && puede(usuario, panel.id, modulo, principal.accion)
      ? { ...item, href: abs(item, principal.href), base }
      : { ...item, href: base, base };
  });
}

/** ¿`href` corresponde a la ruta actual? (inicio del panel solo exacto; el resto por prefijo). */
export function esRutaActiva(href: string, pathname: string): boolean {
  if (/^\/p\/[^/]+$/.test(href) || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rutas globales que necesitan título en la barra superior. */
const TITULOS_GLOBALES: Record<string, string> = {
  "/paneles": "Sistemas",
  "/cuenta": "Mi cuenta",
  "/usuarios": "Usuarios",
  "/configuracion": "Configuración",
  "/ayuda": "Ayuda",
  "/sin-acceso": "Sin acceso",
};

export function tituloDeRuta(pathname: string): string {
  const m = pathname.match(/^\/p\/[^/]+(\/.*)?$/);
  if (m) {
    const resto = m[1] ?? "/";
    const item = NAVEGACION.find((i) => !i.global && i.href !== "/" && esRutaActiva(i.href, resto));
    return item?.label ?? "Inicio";
  }
  const extra = Object.entries(TITULOS_GLOBALES).find(([href]) => esRutaActiva(href, pathname));
  return extra?.[1] ?? "Inicio";
}
