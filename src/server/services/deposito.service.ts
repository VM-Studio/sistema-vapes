import { AccionAuditoria, Prisma, type Deposito } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import type { ActualizarDeposito, CrearDeposito } from "@/lib/validations/deposito";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";

export interface DepositoListado {
  id: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
  esPrincipal: boolean;
  unidades: number;
}

export interface DepositoBasico {
  id: string;
  nombre: string;
  esPrincipal: boolean;
}

/** Depósitos activos, principal primero (columnas de inventario, selects). */
export async function listarDepositosActivos(tx: Tx = prisma): Promise<DepositoBasico[]> {
  return tx.deposito.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, esPrincipal: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
}

/** Todos los depósitos con las unidades que tiene cada uno. */
export async function listarDepositos(): Promise<DepositoListado[]> {
  const [depositos, unidades] = await Promise.all([
    prisma.deposito.findMany({
      orderBy: [{ esPrincipal: "desc" }, { activo: "desc" }, { nombre: "asc" }],
    }),
    prisma.stock.groupBy({ by: ["depositoId"], _sum: { cantidad: true } }),
  ]);
  const porDeposito = new Map(unidades.map((u) => [u.depositoId, u._sum.cantidad ?? 0]));
  return depositos.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    direccion: d.direccion,
    activo: d.activo,
    esPrincipal: d.esPrincipal,
    unidades: porDeposito.get(d.id) ?? 0,
  }));
}

async function unidadesEnDeposito(tx: Tx, depositoId: string): Promise<number> {
  const r = await tx.stock.aggregate({ where: { depositoId }, _sum: { cantidad: true } });
  return r._sum.cantidad ?? 0;
}

function snapshot(d: Deposito): Prisma.InputJsonObject {
  return { nombre: d.nombre, direccion: d.direccion, activo: d.activo, esPrincipal: d.esPrincipal };
}

function conflictoNombre(error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError("Ya existe un depósito con ese nombre", {
      nombre: ["Ya existe un depósito con ese nombre"],
    });
  }
}

/**
 * Marca `id` como principal desmarcando al anterior en la MISMA transacción
 * (primero desmarca: el índice único parcial no admite dos principales ni un instante).
 */
async function hacerPrincipal(tx: Tx, id: string): Promise<void> {
  await tx.deposito.updateMany({
    where: { esPrincipal: true, id: { not: id } },
    data: { esPrincipal: false },
  });
  await tx.deposito.update({ where: { id }, data: { esPrincipal: true } });
}

export async function crearDeposito(input: CrearDeposito, actor: Actor): Promise<{ id: string }> {
  if (input.esPrincipal && !input.activo)
    throw new DomainError("El depósito principal tiene que estar activo.");
  try {
    return await withTransaction(async (tx) => {
      const d = await tx.deposito.create({
        data: {
          nombre: input.nombre,
          direccion: input.direccion ?? null,
          activo: input.activo,
          esPrincipal: false,
        },
      });
      if (input.esPrincipal) await hacerPrincipal(tx, d.id);
      const final = await tx.deposito.findUniqueOrThrow({ where: { id: d.id } });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Deposito",
        entidadId: d.id,
        datosDespues: snapshot(final),
        meta: actor.meta,
      });
      return { id: d.id };
    });
  } catch (error) {
    conflictoNombre(error);
    throw error;
  }
}

export async function actualizarDeposito(
  input: ActualizarDeposito,
  actor: Actor,
): Promise<{ id: string }> {
  try {
    return await withTransaction(async (tx) => {
      const antes = await tx.deposito.findUnique({ where: { id: input.id } });
      if (!antes) throw new NotFoundError("El depósito no existe");

      if (antes.esPrincipal && !input.esPrincipal) {
        throw new DomainError(
          "Siempre tiene que haber un depósito principal: marcá otro como principal y este deja de serlo.",
        );
      }
      if (input.esPrincipal && !input.activo)
        throw new DomainError("El depósito principal tiene que estar activo.");
      if (antes.activo && !input.activo) await assertPuedeDesactivar(tx, antes);

      await tx.deposito.update({
        where: { id: input.id },
        data: { nombre: input.nombre, direccion: input.direccion ?? null, activo: input.activo },
      });
      if (input.esPrincipal && !antes.esPrincipal) await hacerPrincipal(tx, input.id);

      const despues = await tx.deposito.findUniqueOrThrow({ where: { id: input.id } });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Deposito",
        entidadId: input.id,
        datosAntes: snapshot(antes),
        datosDespues: snapshot(despues),
        meta: actor.meta,
      });
      return { id: input.id };
    });
  } catch (error) {
    conflictoNombre(error);
    throw error;
  }
}

async function assertPuedeDesactivar(tx: Tx, d: Deposito): Promise<void> {
  if (d.esPrincipal) {
    throw new DomainError(
      "El depósito principal no se puede desactivar: marcá otro como principal primero.",
    );
  }
  const unidades = await unidadesEnDeposito(tx, d.id);
  if (unidades > 0) {
    throw new DomainError(
      `"${d.nombre}" tiene ${unidades} unidad${unidades === 1 ? "" : "es"} en stock: transferilas o ajustalas antes de desactivarlo.`,
    );
  }
}

export async function cambiarActivoDeposito(
  id: string,
  activo: boolean,
  actor: Actor,
): Promise<void> {
  await withTransaction(async (tx) => {
    const antes = await tx.deposito.findUnique({ where: { id } });
    if (!antes) throw new NotFoundError("El depósito no existe");
    if (antes.activo === activo) return;
    if (!activo) await assertPuedeDesactivar(tx, antes);
    const despues = await tx.deposito.update({ where: { id }, data: { activo } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Deposito",
      entidadId: id,
      datosAntes: snapshot(antes),
      datosDespues: snapshot(despues),
      meta: actor.meta,
    });
  });
}
