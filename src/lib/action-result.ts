/**
 * Contrato de toda Server Action (compartido servidor/cliente).
 * Nunca se lanza un error al cliente: siempre vuelve uno de estos dos.
 */
export interface ActionError {
  code: string;
  message: string;
  /** Errores por campo (ruta con puntos, ej: "permisos.0.puedeVer"). */
  fields?: Record<string, string[]>;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
