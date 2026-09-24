import { AccionAuditoria, Prisma, RolUsuario, type Modulo } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import { MODULOS_ASIGNABLES, type PermisoModulo } from "@/lib/permisos";
import type {
  ActualizarPermisos,
  ActualizarUsuario,
  CrearUsuario,
} from "@/lib/validations/usuario";
import { generarPasswordTemporal, hashPassword } from "@/server/auth/password";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria, snapshotUsuario } from "@/server/services/audit.service";

export type { Actor };

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoLogin: Date | null;
  createdAt: Date;
}

const selectListado = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  activo: true,
  debeCambiarPassword: true,
  ultimoLogin: true,
  createdAt: true,
} satisfies Prisma.UsuarioSelect;

/** Usuarios no dados de baja: dueños primero, después por nombre. */
export async function listarUsuarios(): Promise<UsuarioListado[]> {
  return prisma.usuario.findMany({
    where: { deletedAt: null },
    select: selectListado,
    orderBy: [{ rol: "asc" }, { nombre: "asc" }],
  });
}

export async function obtenerUsuario(id: string): Promise<UsuarioListado> {
  const usuario = await prisma.usuario.findFirst({
    where: { id, deletedAt: null },
    select: selectListado,
  });
  if (!usuario) throw new NotFoundError("El usuario no existe o fue dado de baja");
  return usuario;
}

// -----------------------------------------------------------------------------
// Reglas de dueños
// -----------------------------------------------------------------------------

/**
 * Serializa todo cambio que pueda afectar a los OWNER activos (misma llave que
 * el trigger diferido de la DB) y verifica, ya aplicado el cambio, que quede
 * al menos uno. La DB lo vuelve a verificar al COMMIT.
 */
async function bloquearOwners(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('usuarios:owner_activo'))`;
}

async function assertQuedaOwnerActivo(tx: Tx): Promise<void> {
  const owners = await tx.usuario.count({
    where: { rol: RolUsuario.OWNER, activo: true, deletedAt: null },
  });
  if (owners === 0) {
    throw new DomainError("No se puede: el sistema tiene que quedar con al menos un dueño activo.");
  }
}

function conflictoEmail(error: unknown): never | void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError("Ya existe un usuario con ese email (puede ser uno dado de baja).", {
      email: ["Este email ya está en uso"],
    });
  }
}

// -----------------------------------------------------------------------------
// ABM
// -----------------------------------------------------------------------------

export async function crearUsuario(actor: Actor, input: CrearUsuario): Promise<UsuarioListado> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nombre: input.nombre,
          email: input.email,
          rol: input.rol,
          passwordHash,
          debeCambiarPassword: true, // la inicial la eligió otro: se cambia al primer ingreso
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Usuario",
        entidadId: usuario.id,
        datosDespues: snapshotUsuario(usuario),
        meta: actor.meta,
      });
      return usuario;
    });
  } catch (error) {
    conflictoEmail(error);
    throw error;
  }
}

export async function actualizarUsuario(
  actor: Actor,
  input: ActualizarUsuario,
): Promise<UsuarioListado> {
  if (input.id === actor.id) {
    if (!input.activo) throw new DomainError("No podés desactivar tu propio usuario.");
    if (input.rol !== RolUsuario.OWNER)
      throw new DomainError("No podés quitarte el rol de dueño a vos mismo.");
  }

  try {
    return await withTransaction(async (tx) => {
      const antes = await tx.usuario.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El usuario no existe o fue dado de baja");

      const afectaOwners =
        antes.rol === RolUsuario.OWNER && (input.rol !== RolUsuario.OWNER || !input.activo);
      if (afectaOwners) await bloquearOwners(tx);

      const despues = await tx.usuario.update({
        where: { id: input.id },
        data: { nombre: input.nombre, email: input.email, rol: input.rol, activo: input.activo },
      });
      if (afectaOwners) await assertQuedaOwnerActivo(tx);

      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Usuario",
        entidadId: despues.id,
        datosAntes: snapshotUsuario(antes),
        datosDespues: snapshotUsuario(despues),
        meta: actor.meta,
      });
      return despues;
    });
  } catch (error) {
    conflictoEmail(error);
    throw error;
  }
}

/**
 * Genera una contraseña temporal, la guarda hasheada y la devuelve UNA vez
 * (no se puede volver a consultar). El usuario deberá cambiarla al ingresar.
 */
export async function resetearPassword(
  actor: Actor,
  usuarioId: string,
): Promise<{ passwordTemporal: string }> {
  if (usuarioId === actor.id) {
    throw new DomainError("Para cambiar tu propia contraseña usá «Mi cuenta».");
  }
  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = await hashPassword(passwordTemporal);

  await withTransaction(async (tx) => {
    const antes = await tx.usuario.findFirst({ where: { id: usuarioId, deletedAt: null } });
    if (!antes) throw new NotFoundError("El usuario no existe o fue dado de baja");
    const despues = await tx.usuario.update({
      where: { id: usuarioId },
      data: { passwordHash, debeCambiarPassword: true },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Usuario",
      entidadId: usuarioId,
      datosAntes: snapshotUsuario(antes),
      datosDespues: { ...snapshotUsuario(despues), cambio: "password_reseteada" },
      meta: actor.meta,
    });
  });

  return { passwordTemporal };
}

/**
 * Baja: soft delete + activo=false. Desde el próximo request el middleware
 * deja de aceptar sus sesiones (verifica activo/deletedAt en cada request).
 */
export async function darDeBajaUsuario(actor: Actor, usuarioId: string): Promise<void> {
  if (usuarioId === actor.id) throw new DomainError("No podés dar de baja tu propio usuario.");

  await withTransaction(async (tx) => {
    const antes = await tx.usuario.findFirst({ where: { id: usuarioId, deletedAt: null } });
    if (!antes) throw new NotFoundError("El usuario no existe o ya fue dado de baja");

    const afectaOwners = antes.rol === RolUsuario.OWNER;
    if (afectaOwners) await bloquearOwners(tx);
    const despues = await tx.usuario.update({
      where: { id: usuarioId },
      data: { activo: false, deletedAt: new Date() },
    });
    if (afectaOwners) await assertQuedaOwnerActivo(tx);

    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "Usuario",
      entidadId: usuarioId,
      datosAntes: snapshotUsuario(antes),
      datosDespues: snapshotUsuario(despues),
      meta: actor.meta,
    });
  });
}

// -----------------------------------------------------------------------------
// Permisos
// -----------------------------------------------------------------------------

/** Grilla completa (un registro por módulo asignable, en orden), con lo guardado. */
export async function obtenerPermisos(
  usuarioId: string,
  tx: Tx = prisma,
): Promise<PermisoModulo[]> {
  const filas = await tx.permisoUsuario.findMany({ where: { usuarioId } });
  const porModulo = new Map(filas.map((f) => [f.modulo, f]));
  return MODULOS_ASIGNABLES.map((modulo) => ({ modulo, ...acciones(porModulo.get(modulo)) }));
}

type Acciones = Omit<PermisoModulo, "modulo">;

function acciones(p: Partial<Acciones> | undefined): Acciones {
  return {
    puedeVer: p?.puedeVer ?? false,
    puedeCrear: p?.puedeCrear ?? false,
    puedeEditar: p?.puedeEditar ?? false,
    puedeEliminar: p?.puedeEliminar ?? false,
  };
}

function mapaPermisos(permisos: PermisoModulo[]): Record<string, Acciones> {
  return Object.fromEntries(permisos.map((p) => [p.modulo, acciones(p)]));
}

/** Upsert de la grilla completa + AuditLog PERMISO_CAMBIADO con antes/después. */
export async function actualizarPermisos(
  actor: Actor,
  input: ActualizarPermisos,
): Promise<PermisoModulo[]> {
  return withTransaction(async (tx) => {
    const usuario = await tx.usuario.findFirst({
      where: { id: input.usuarioId, deletedAt: null },
      select: { id: true, rol: true },
    });
    if (!usuario) throw new NotFoundError("El usuario no existe o fue dado de baja");
    if (usuario.rol === RolUsuario.OWNER) {
      throw new DomainError("Los dueños tienen acceso total: no se les asignan permisos.");
    }

    const antes = await tx.permisoUsuario.findMany({ where: { usuarioId: usuario.id } });
    const nuevos = new Map<Modulo, PermisoModulo>(input.permisos.map((p) => [p.modulo, p]));

    for (const modulo of MODULOS_ASIGNABLES) {
      const datos = acciones(nuevos.get(modulo)); // módulo omitido => todo apagado
      await tx.permisoUsuario.upsert({
        where: { usuarioId_modulo: { usuarioId: usuario.id, modulo } },
        create: { usuarioId: usuario.id, modulo, ...datos },
        update: datos,
      });
    }

    const despues = await tx.permisoUsuario.findMany({ where: { usuarioId: usuario.id } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.PERMISO_CAMBIADO,
      entidad: "PermisoUsuario",
      entidadId: usuario.id,
      datosAntes: mapaPermisos(antes),
      datosDespues: mapaPermisos(despues),
      meta: actor.meta,
    });

    return obtenerPermisos(usuario.id, tx);
  });
}

/** Nombres de usuarios (incluye dados de baja: aparecen en el historial) para filtros. */
export async function listarUsuariosBasico(): Promise<
  { id: string; nombre: string; activo: boolean }[]
> {
  const filas = await prisma.usuario.findMany({
    select: { id: true, nombre: true, activo: true, deletedAt: true },
    orderBy: { nombre: "asc" },
  });
  return filas.map((u) => ({
    id: u.id,
    nombre: u.nombre,
    activo: u.activo && u.deletedAt === null,
  }));
}
