import { Modulo, RolUsuario } from "@prisma/client";

/**
 * Lógica PURA de permisos: sin DB ni cookies, se puede usar en servidor y en
 * cliente. La autorización real siempre ocurre en el servidor
 * (src/server/auth/permissions.ts); en el cliente solo decide qué se muestra.
 */

export type Accion = "ver" | "crear" | "editar" | "eliminar";

export const ACCIONES: readonly Accion[] = ["ver", "crear", "editar", "eliminar"];

export interface PermisoModulo {
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
}

/** Usuario de la sesión tal como lo ve la UI (serializable: viaja del servidor al cliente). */
export interface UsuarioSesion extends SujetoPermisos {
  id: string;
  nombre: string;
  email: string;
  debeCambiarPassword: boolean;
  permisos: PermisoModulo[];
}

const CAMPO: Record<Accion, keyof Omit<PermisoModulo, "modulo">> = {
  ver: "puedeVer",
  crear: "puedeCrear",
  editar: "puedeEditar",
  eliminar: "puedeEliminar",
};

/**
 * Módulos que existen solo para dueños: no se asignan a empleados aunque el
 * enum Modulo los incluya (administrar usuarios = poder darse permisos a uno mismo).
 */
export const MODULOS_SOLO_OWNER: ReadonlySet<Modulo> = new Set([Modulo.USUARIOS]);

/** Módulos que un OWNER puede habilitar a un EMPLEADO, en orden de pantalla. */
export const MODULOS_ASIGNABLES: readonly Modulo[] = Object.values(Modulo).filter(
  (m) => !MODULOS_SOLO_OWNER.has(m),
);

export const MODULO_LABEL: Record<Modulo, string> = {
  DASHBOARD: "Dashboard",
  PRODUCTOS: "Productos",
  INVENTARIO: "Inventario",
  MOVIMIENTOS: "Movimientos",
  VENTAS: "Ventas",
  COMPRAS: "Compras",
  CLIENTES: "Clientes",
  PROVEEDORES: "Proveedores",
  REPORTES: "Reportes",
  USUARIOS: "Usuarios",
  CONFIGURACION: "Configuración",
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

/** ¿El usuario puede hacer `accion` en `modulo`? OWNER: siempre. EMPLEADO: según sus filas. */
export function puede(usuario: SujetoPermisos, modulo: Modulo, accion: Accion): boolean {
  if (esOwner(usuario)) return true;
  if (MODULOS_SOLO_OWNER.has(modulo)) return false;
  const permiso = usuario.permisos.find((p) => p.modulo === modulo);
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
  if (cambio === "ver" && !p.puedeVer) {
    return { ...p, puedeCrear: false, puedeEditar: false, puedeEliminar: false };
  }
  if (p.puedeCrear || p.puedeEditar || p.puedeEliminar) p.puedeVer = true;
  return p;
}
