import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  Home,
  Package,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { puede, type SujetoPermisos } from "@/lib/permisos";

/**
 * ÚNICA fuente de la navegación: sidebar (desktop), bottom bar y sheet "Más"
 * (mobile), accesos rápidos del inicio y título de la barra superior.
 * Todo se filtra con navegacionPermitida(): lo que el usuario no puede ver, no
 * aparece. (Ocultarlo es solo UX: cada página y acción valida en el servidor.)
 */

export type GrupoNavegacion = "Operación" | "Catálogo" | "Administración";

export const GRUPOS: readonly GrupoNavegacion[] = ["Operación", "Catálogo", "Administración"];

export interface ItemNavegacion {
  /**
   * Módulo que hay que poder "ver". null = siempre visible (Inicio).
   * Array = alcanza con poder ver cualquiera de ellos (Escanear sirve para
   * vender y para inventario).
   */
  modulo: Modulo | readonly Modulo[] | null;
  label: string;
  href: string;
  icon: LucideIcon;
  /** null = fuera de grupos (arriba de todo en el sidebar). */
  grupo: GrupoNavegacion | null;
  /** Aparece en la bottom navigation mobile (máximo 4 + "Más"): Inicio, Ventas, Inventario, Productos. */
  enBottomBar: boolean;
  /** Texto corto para los accesos rápidos del inicio. */
  descripcion: string;
}

export const NAVEGACION: readonly ItemNavegacion[] = [
  {
    modulo: null,
    label: "Inicio",
    href: "/",
    icon: Home,
    grupo: null,
    enBottomBar: true,
    descripcion: "Resumen del negocio",
  },
  {
    modulo: Modulo.VENTAS,
    label: "Ventas",
    href: "/ventas",
    icon: ShoppingCart,
    grupo: "Operación",
    enBottomBar: true,
    descripcion: "Registrar y consultar ventas",
  },
  {
    modulo: Modulo.INVENTARIO,
    label: "Inventario",
    href: "/inventario",
    icon: Boxes,
    grupo: "Operación",
    enBottomBar: true,
    descripcion: "Stock por depósito",
  },
  {
    modulo: Modulo.PRODUCTOS,
    label: "Productos",
    href: "/productos",
    icon: Package,
    grupo: "Catálogo",
    enBottomBar: true,
    descripcion: "Productos, sabores y precios",
  },
  {
    modulo: [Modulo.VENTAS, Modulo.INVENTARIO],
    label: "Escanear",
    href: "/escanear",
    icon: ScanBarcode,
    grupo: "Operación",
    enBottomBar: false,
    descripcion: "Buscar productos por código de barras",
  },
  {
    modulo: Modulo.MOVIMIENTOS,
    label: "Movimientos",
    href: "/movimientos",
    icon: ArrowLeftRight,
    grupo: "Operación",
    enBottomBar: false,
    descripcion: "Ingresos, ajustes y transferencias",
  },
  {
    modulo: Modulo.COMPRAS,
    label: "Compras",
    href: "/compras",
    icon: Truck,
    grupo: "Operación",
    enBottomBar: false,
    descripcion: "Mercadería recibida de proveedores",
  },
  {
    modulo: Modulo.CLIENTES,
    label: "Clientes",
    href: "/clientes",
    icon: Users,
    grupo: "Catálogo",
    enBottomBar: false,
    descripcion: "Datos y compras de clientes",
  },
  {
    modulo: Modulo.PROVEEDORES,
    label: "Proveedores",
    href: "/proveedores",
    icon: Building2,
    grupo: "Catálogo",
    enBottomBar: false,
    descripcion: "Proveedores e importadores",
  },
  {
    modulo: Modulo.REPORTES,
    label: "Reportes",
    href: "/reportes",
    icon: BarChart3,
    grupo: "Administración",
    enBottomBar: false,
    descripcion: "Ganancias, ventas y rotación",
  },
  {
    modulo: Modulo.USUARIOS,
    label: "Usuarios",
    href: "/usuarios",
    icon: UserCog,
    grupo: "Administración",
    enBottomBar: false,
    descripcion: "Accesos y permisos del equipo",
  },
  {
    modulo: Modulo.CONFIGURACION,
    label: "Configuración",
    href: "/configuracion",
    icon: Settings,
    grupo: "Administración",
    enBottomBar: false,
    descripcion: "Datos del negocio y preferencias",
  },
];

/** Rutas que no son módulos pero necesitan título en la barra superior. */
const TITULOS_EXTRA: Record<string, string> = {
  "/cuenta": "Mi cuenta",
  "/sin-acceso": "Sin acceso",
};

export function puedeVerItem(usuario: SujetoPermisos, item: ItemNavegacion): boolean {
  if (item.modulo === null) return true;
  const modulos: readonly Modulo[] = Array.isArray(item.modulo)
    ? item.modulo
    : [item.modulo as Modulo];
  return modulos.some((m) => puede(usuario, m, "ver"));
}

/** Ítems que el usuario puede ver, en el orden declarado. */
export function navegacionPermitida(usuario: SujetoPermisos): ItemNavegacion[] {
  return NAVEGACION.filter((item) => puedeVerItem(usuario, item));
}

/** ¿`href` corresponde a la ruta actual? ("/" solo exacto; el resto por prefijo). */
export function esRutaActiva(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function tituloDeRuta(pathname: string): string {
  const item = NAVEGACION.find((i) => i.href !== "/" && esRutaActiva(i.href, pathname));
  if (item) return item.label;
  const extra = Object.entries(TITULOS_EXTRA).find(([href]) => esRutaActiva(href, pathname));
  return extra?.[1] ?? "Inicio";
}
