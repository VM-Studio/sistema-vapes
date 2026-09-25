import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  Home,
  Package,
  Receipt,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
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
  /** Bottom navigation mobile (máx. 4 + "Más"): Inicio, Ventas, [Escanear], Inventario. */
  enBottomBar: boolean;
  /** Texto corto para los accesos rápidos del inicio. */
  descripcion: string;
  /** Botón central elevado de la bottom bar (Escanear). */
  destacado?: boolean;
  /**
   * Destino directo si el usuario puede hacer `accion` en el módulo (Ventas abre el POS);
   * si no, `href`. El ítem queda activo en todo `href/*` igual.
   */
  accionPrincipal?: { href: string; accion: "crear" };
  /** Prefijo de ruta para marcar el ítem activo (lo completa navegacionPermitida). */
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
    descripcion: "Resumen del negocio",
  },
  {
    modulo: Modulo.VENTAS,
    label: "Ventas",
    href: "/ventas",
    accionPrincipal: { href: "/ventas/nueva", accion: "crear" },
    icon: ShoppingCart,
    grupo: "Operación",
    enBottomBar: true,
    descripcion: "Cobrar (punto de venta) y consultar ventas",
  },
  {
    modulo: Modulo.INVENTARIO,
    label: "Escanear",
    href: "/escanear",
    icon: ScanBarcode,
    grupo: "Operación",
    enBottomBar: true,
    destacado: true,
    descripcion: "Consultar, ingresar, contar y transferir escaneando",
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
    enBottomBar: false,
    descripcion: "Productos, sabores y precios",
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
    modulo: Modulo.CAJA,
    label: "Caja",
    href: "/caja",
    icon: Wallet,
    grupo: "Operación",
    enBottomBar: false,
    descripcion: "Apertura, movimientos y arqueo del efectivo",
  },
  {
    modulo: Modulo.CLIENTES,
    label: "Clientes",
    href: "/clientes",
    icon: Users,
    grupo: "Operación",
    enBottomBar: false,
    descripcion: "Cuenta corriente, compras y saldos",
  },
  {
    modulo: Modulo.PROVEEDORES,
    label: "Proveedores",
    href: "/proveedores",
    icon: Building2,
    grupo: "Operación",
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
    modulo: Modulo.GASTOS,
    label: "Gastos",
    href: "/gastos",
    icon: Receipt,
    grupo: "Administración",
    enBottomBar: false,
    descripcion: "Alquiler, servicios, sueldos y otros gastos",
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
  "/notificaciones": "Notificaciones",
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
  return NAVEGACION.filter((item) => puedeVerItem(usuario, item)).map((item) => {
    const principal = item.accionPrincipal;
    const modulo = Array.isArray(item.modulo) ? null : (item.modulo as Modulo | null);
    return principal && modulo && puede(usuario, modulo, principal.accion)
      ? { ...item, href: principal.href, base: item.href }
      : { ...item, base: item.href };
  });
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
