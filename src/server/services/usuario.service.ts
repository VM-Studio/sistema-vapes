import { AccionAuditoria, Prisma, RolUsuario, type Modulo } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import { MODULOS_DE_PANEL, type PermisoModulo } from "@/lib/permisos";
import type {
  ActualizarAcceso,
  ActualizarComision,
  ActualizarUsuario,
  CrearUsuario,
} from "@/lib/validations/usuario";
import {
  assertPasswordNoComun,
  generarPasswordTemporal,
  hashPassword,
} from "@/server/auth/password";
import { invalidarCacheSesiones, revocarSesionesDeUsuario } from "@/server/auth/sesiones";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria, snapshotUsuario } from "@/server/services/audit.service";

export type { Actor };

export interface PanelDeUsuario {
  id: string;
  nombre: string;
  slug: string;
  logoUrl: string | null;
  colorAcento: string | null;
}

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoLogin: Date | null;
  createdAt: Date;
  /** Comisión orientativa en % ("5.00"); null = sin comisión. */
  comisionUnitariaPct: string | null;
  comisionMayoristaPct: string | null;
  /** Paneles habilitados (EMPLEADO). Un OWNER accede a todos: lista vacía. */
  paneles: PanelDeUsuario[];
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
  comisionUnitariaPct: true,
  comisionMayoristaPct: true,
  paneles: {
    select: {
      panel: {
        select: {
          id: true,
          nombre: true,
          slug: true,
          logoUrl: true,
          colorAcento: true,
          orden: true,
        },
      },
    },
  },
} satisfies Prisma.UsuarioSelect;

type FilaListado = Prisma.UsuarioGetPayload<{ select: typeof selectListado }>;

function aListado(u: FilaListado): UsuarioListado {
  const { paneles, comisionUnitariaPct, comisionMayoristaPct, ...resto } = u;
  return {
    ...resto,
    comisionUnitariaPct: comisionUnitariaPct?.toFixed(2) ?? null,
    comisionMayoristaPct: comisionMayoristaPct?.toFixed(2) ?? null,
    paneles: paneles
      .map((p) => p.panel)
      .sort((a, b) => a.orden - b.orden)
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        slug: p.slug,
        logoUrl: p.logoUrl,
        colorAcento: p.colorAcento,
      })),
  };
}

/** Usuarios no dados de baja: dueños primero, después por nombre. */
export async function listarUsuarios(): Promise<UsuarioListado[]> {
  const filas = await prisma.usuario.findMany({
    where: { deletedAt: null },
    select: selectListado,
    orderBy: [{ rol: "asc" }, { nombre: "asc" }],
  });
  return filas.map(aListado);
}

export async function obtenerUsuario(id: string): Promise<UsuarioListado> {
  const usuario = await prisma.usuario.findFirst({
    where: { id, deletedAt: null },
    select: selectListado,
  });
  if (!usuario) throw new NotFoundError("El usuario no existe o fue dado de baja");
  return aListado(usuario);
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

export async function crearUsuario(actor: Actor, input: CrearUsuario): Promise<{ id: string }> {
  await assertPasswordNoComun(input.password, "password");
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
): Promise<{ id: string }> {
  if (input.id === actor.id) {
    if (!input.activo) throw new DomainError("No podés desactivar tu propio usuario.");
    if (input.rol !== RolUsuario.OWNER)
      throw new DomainError("No podés quitarte el rol de dueño a vos mismo.");
  }

  try {
    const r = await withTransaction(async (tx) => {
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
      // Un dueño accede a todo por rol: sus filas de acceso/permisos no significan nada.
      if (despues.rol === RolUsuario.OWNER) {
        await tx.permisoUsuario.deleteMany({ where: { usuarioId: despues.id } });
        await tx.usuarioPanel.deleteMany({ where: { usuarioId: despues.id } });
      }

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
    // Rol o "activo" cambiaron: el middleware no puede seguir con lo cacheado.
    invalidarCacheSesiones(input.id);
    return r;
  } catch (error) {
    conflictoEmail(error);
    throw error;
  }
}

/** Comisión orientativa de un EMPLEADO (a un dueño no se le carga). */
export async function actualizarComision(actor: Actor, input: ActualizarComision): Promise<void> {
  await withTransaction(async (tx) => {
    const antes = await tx.usuario.findFirst({ where: { id: input.id, deletedAt: null } });
    if (!antes) throw new NotFoundError("El usuario no existe o fue dado de baja");
    if (antes.rol !== RolUsuario.EMPLEADO)
      throw new DomainError("La comisión solo se carga a empleados.");
    const despues = await tx.usuario.update({
      where: { id: input.id },
      data: {
        comisionUnitariaPct: input.comisionUnitariaPct,
        comisionMayoristaPct: input.comisionMayoristaPct,
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Usuario",
      entidadId: input.id,
      datosAntes: {
        comisionUnitariaPct: antes.comisionUnitariaPct?.toFixed(2) ?? null,
        comisionMayoristaPct: antes.comisionMayoristaPct?.toFixed(2) ?? null,
      },
      datosDespues: {
        comisionUnitariaPct: despues.comisionUnitariaPct?.toFixed(2) ?? null,
        comisionMayoristaPct: despues.comisionMayoristaPct?.toFixed(2) ?? null,
      },
      meta: actor.meta,
    });
  });
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
  // Con la contraseña reseteada, las sesiones abiertas con la anterior se cierran.
  await revocarSesionesDeUsuario(usuarioId, actor);

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
  await revocarSesionesDeUsuario(usuarioId, actor);
}

// -----------------------------------------------------------------------------
// Acceso por panel y permisos
// -----------------------------------------------------------------------------

type Acciones = Omit<PermisoModulo, "modulo" | "panelId">;

function acciones(p: Partial<Acciones> | undefined): Acciones {
  return {
    puedeVer: p?.puedeVer ?? false,
    puedeCrear: p?.puedeCrear ?? false,
    puedeEditar: p?.puedeEditar ?? false,
    puedeEliminar: p?.puedeEliminar ?? false,
  };
}

export interface AccesoUsuario {
  /** Paneles habilitados. */
  paneles: string[];
  /** Grilla completa (todos los módulos de panel) de cada panel habilitado. */
  permisos: PermisoModulo[];
}

/** Acceso actual de un usuario: paneles + grilla módulo × acción por panel. */
export async function obtenerAcceso(usuarioId: string, tx: Tx = prisma): Promise<AccesoUsuario> {
  const [paneles, filas] = await Promise.all([
    tx.usuarioPanel.findMany({ where: { usuarioId }, select: { panelId: true } }),
    tx.permisoUsuario.findMany({ where: { usuarioId } }),
  ]);
  const ids = paneles.map((p) => p.panelId);
  const clave = (panelId: string, modulo: Modulo) => `${panelId}:${modulo}`;
  const guardados = new Map(filas.map((f) => [clave(f.panelId, f.modulo), f]));
  return {
    paneles: ids,
    permisos: ids.flatMap((panelId) =>
      MODULOS_DE_PANEL.map((modulo) => ({
        panelId,
        modulo,
        ...acciones(guardados.get(clave(panelId, modulo))),
      })),
    ),
  };
}

function resumenAcceso(acceso: AccesoUsuario): Prisma.InputJsonObject {
  return {
    paneles: acceso.paneles,
    permisos: Object.fromEntries(
      acceso.permisos
        .filter((p) => p.puedeVer)
        .map((p) => [
          `${p.panelId}:${p.modulo}`,
          [
            p.puedeVer && "ver",
            p.puedeCrear && "crear",
            p.puedeEditar && "editar",
            p.puedeEliminar && "eliminar",
          ]
            .filter(Boolean)
            .join(","),
        ]),
    ),
  };
}

/**
 * Reemplaza el acceso de un EMPLEADO: qué paneles puede abrir y, en cada uno,
 * qué puede hacer en cada módulo. Un panel no marcado pierde también sus
 * permisos. AuditLog PERMISO_CAMBIADO con antes/después. El middleware toma el
 * cambio al instante (se invalida el caché de sus sesiones).
 */
export async function actualizarAcceso(
  actor: Actor,
  input: ActualizarAcceso,
): Promise<AccesoUsuario> {
  const r = await withTransaction(async (tx) => {
    const usuario = await tx.usuario.findFirst({
      where: { id: input.usuarioId, deletedAt: null },
      select: { id: true, rol: true },
    });
    if (!usuario) throw new NotFoundError("El usuario no existe o fue dado de baja");
    if (usuario.rol === RolUsuario.OWNER) {
      throw new DomainError(
        "Los dueños acceden a todos los paneles y módulos: no se les asignan permisos.",
      );
    }
    const panelIds = input.paneles.map((p) => p.panelId);
    const existentes = await tx.panel.count({ where: { id: { in: panelIds } } });
    if (existentes !== panelIds.length) throw new NotFoundError("Alguno de los paneles no existe");

    const antes = await obtenerAcceso(usuario.id, tx);

    await tx.permisoUsuario.deleteMany({
      where: { usuarioId: usuario.id, panelId: { notIn: panelIds } },
    });
    await tx.usuarioPanel.deleteMany({
      where: { usuarioId: usuario.id, panelId: { notIn: panelIds } },
    });
    for (const { panelId, permisos } of input.paneles) {
      await tx.usuarioPanel.upsert({
        where: { usuarioId_panelId: { usuarioId: usuario.id, panelId } },
        create: { usuarioId: usuario.id, panelId },
        update: {},
      });
      const nuevos = new Map(permisos.map((p) => [p.modulo, p]));
      for (const modulo of MODULOS_DE_PANEL) {
        const datos = acciones(nuevos.get(modulo)); // módulo omitido => todo apagado
        await tx.permisoUsuario.upsert({
          where: { usuarioId_panelId_modulo: { usuarioId: usuario.id, panelId, modulo } },
          create: { usuarioId: usuario.id, panelId, modulo, ...datos },
          update: datos,
        });
      }
    }

    const despues = await obtenerAcceso(usuario.id, tx);
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.PERMISO_CAMBIADO,
      entidad: "PermisoUsuario",
      entidadId: usuario.id,
      datosAntes: resumenAcceso(antes),
      datosDespues: resumenAcceso(despues),
      meta: actor.meta,
    });
    return despues;
  });
  invalidarCacheSesiones(input.usuarioId);
  return r;
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
