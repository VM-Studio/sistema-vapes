import { Modulo, RolUsuario } from "@prisma/client";

/**
 * Lógica PURA de permisos: sin DB ni cookies, se puede usar en servidor y en
 * cliente. La autorización real siempre ocurre en el servidor
 * (src/server/auth/permissions.ts); en el cliente solo decide qué se muestra.
 */

export type Accion = "ver" | "crear" | "editar" | "eliminar";

export const ACCIONES: readonly Accion[] = ["ver", "crear", "editar", "eliminar"];

export interface PermisoModulo {
  /** Los permisos son por panel: Ventas en Vapes no habilita Ventas en Cosmetic. */
  panelId: string;
  modulo: Modulo;
  puedeVer: boolean;
  puedeCrear: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
}

/** Lo mínimo que hace falta de un usuario para decidir permisos. */
export interface SujetoPermisos {
  rol: RolUsuario;
  permisos: readonly PermisoModulo[];
  /** Ids de los paneles habilitados (EMPLEADO). Un OWNER accede a todos. */
  paneles: readonly string[];
}

/** Usuario de la sesión tal como lo ve la UI (serializable: viaja del servidor al cliente). */
export interface UsuarioSesion extends SujetoPermisos {
  id: string;
  nombre: string;
  email: string;
  debeCambiarPassword: boolean;
  permisos: PermisoModulo[];
  paneles: string[];
}

const CAMPO: Record<Accion, keyof Omit<PermisoModulo, "modulo" | "panelId">> = {
  ver: "puedeVer",
  crear: "puedeCrear",
  editar: "puedeEditar",
  eliminar: "puedeEliminar",
};

/**
 * Módulos globales (fuera de los paneles): solo dueños. No se asignan a
 * empleados (administrar usuarios = poder darse permisos a uno mismo).
 */
export const MODULOS_GLOBALES: ReadonlySet<Modulo> = new Set([
  Modulo.USUARIOS,
  Modulo.CONFIGURACION,
]);

/** Módulos de un panel que un OWNER puede habilitar a un EMPLEADO, en orden de pantalla. */
export const MODULOS_DE_PANEL: readonly Modulo[] = [
  Modulo.DASHBOARD,
  Modulo.PROVEEDORES,
  Modulo.PRODUCTOS,
  Modulo.STOCK,
  Modulo.VENTAS,
  Modulo.CLIENTES,
  Modulo.DEVOLUCIONES,
  Modulo.COMPRAS,
  Modulo.COTIZADOR,
  Modulo.REPORTES,
];

export const MODULO_LABEL: Record<Modulo, string> = {
  DASHBOARD: "Dashboard",
  PROVEEDORES: "Proveedores",
  PRODUCTOS: "Productos",
  STOCK: "Stock",
  VENTAS: "Ventas",
  CLIENTES: "Clientes",
  DEVOLUCIONES: "Devoluciones",
  COMPRAS: "Compras",
  COTIZADOR: "Cotizador",
  REPORTES: "Reportes",
  USUARIOS: "Usuarios",
  CONFIGURACION: "Configuración",
};

/** Acciones que tienen sentido para el módulo (la grilla muestra solo esas). */
export function accionesDe(modulo: Modulo): readonly Accion[] {
  return modulo === Modulo.DASHBOARD || modulo === Modulo.REPORTES ? ["ver"] : ACCIONES;
}

/** Aclaración que se muestra en la grilla de permisos. */
export const MODULO_AYUDA: Partial<Record<Modulo, string>> = {
  STOCK: "Stock por depósito, movimientos, ingresos, ajustes y transferencias.",
  COTIZADOR: "Cotizador unitario y mayorista.",
  REPORTES: "Solo «Ver». Los costos y ganancias los ven únicamente los dueños.",
};

export const ACCION_LABEL: Record<Accion, string> = {
  ver: "Ver",
  crear: "Crear",
  editar: "Editar",
  eliminar: "Eliminar",
};

export function esOwner(usuario: Pick<SujetoPermisos, "rol">): boolean {
  return usuario.rol === RolUsuario.OWNER;
}

/** ¿Accede al panel? OWNER: a todos. EMPLEADO: solo a los habilitados. */
export function accedeAPanel(
  usuario: Pick<SujetoPermisos, "rol" | "paneles">,
  panelId: string,
): boolean {
  return esOwner(usuario) || usuario.paneles.includes(panelId);
}

/**
 * ¿El usuario puede hacer `accion` en `modulo` del panel `panelId`?
 * OWNER: siempre. EMPLEADO: nunca en módulos globales; en los de panel, según
 * sus filas de ese panel (y solo si el panel le está habilitado).
 * `panelId` null = módulo global.
 */
export function puede(
  usuario: SujetoPermisos,
  panelId: string | null,
  modulo: Modulo,
  accion: Accion,
): boolean {
  if (esOwner(usuario)) return true;
  if (MODULOS_GLOBALES.has(modulo) || !panelId || !accedeAPanel(usuario, panelId)) return false;
  const permiso = usuario.permisos.find((p) => p.panelId === panelId && p.modulo === modulo);
  return permiso?.[CAMPO[accion]] ?? false;
}

/**
 * Normaliza una fila de permisos respetando la regla "sin ver no hay nada":
 * - cualquier acción encendida enciende "ver";
 * - "ver" apagado apaga todo.
 * `cambio` indica qué toggle tocó el usuario, para saber en qué sentido resolver.
 */
export function normalizarPermiso(permiso: PermisoModulo, cambio?: Accion): PermisoModulo {
  const p = { ...permiso };
  if (accionesDe(p.modulo).length === 1) {
    p.puedeCrear = false;
    p.puedeEditar = false;
    p.puedeEliminar = false;
  }
  if (cambio === "ver" && !p.puedeVer) {
    return { ...p, puedeCrear: false, puedeEditar: false, puedeEliminar: false };
  }
  if (p.puedeCrear || p.puedeEditar || p.puedeEliminar) p.puedeVer = true;
  return p;
}
