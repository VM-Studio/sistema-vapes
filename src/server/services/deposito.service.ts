import { AccionAuditoria, Prisma, type Deposito } from "@prisma/client";

import type { ActualizarDeposito, CrearDeposito } from "@/lib/validations/deposito";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * Depósitos del panel. Cada panel tiene los suyos y exactamente un principal
 * (índice único parcial por panel en SQL).
 */

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

/** Depósitos activos del panel, principal primero (columnas de inventario, selects). */
export async function listarDepositosActivos(
  ctx: Pick<Ctx, "panelId">,
  tx: Tx = dbPara(ctx.panelId),
): Promise<DepositoBasico[]> {
  return tx.deposito.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, esPrincipal: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
}

/** Todos los depósitos del panel con las unidades que tiene cada uno. */
export async function listarDepositos(ctx: Pick<Ctx, "panelId">): Promise<DepositoListado[]> {
  const db = dbPara(ctx.panelId);
  const [depositos, unidades] = await Promise.all([
    db.deposito.findMany({
      orderBy: [{ esPrincipal: "desc" }, { activo: "desc" }, { nombre: "asc" }],
    }),
    db.stock.groupBy({ by: ["depositoId"], _sum: { cantidad: true } }),
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
 * Marca `id` como principal del panel desmarcando al anterior en la MISMA
 * transacción (primero desmarca: el índice único parcial no admite dos
 * principales ni un instante). `tx` es del panel: solo toca sus depósitos.
 */
async function hacerPrincipal(tx: Tx, id: string): Promise<void> {
  await tx.deposito.updateMany({
    where: { esPrincipal: true, id: { not: id } },
    data: { esPrincipal: false },
  });
  await tx.deposito.update({ where: { id }, data: { esPrincipal: true } });
}

export async function crearDeposito(ctx: Ctx, input: CrearDeposito): Promise<{ id: string }> {
  if (input.esPrincipal && !input.activo)
    throw new DomainError("El depósito principal tiene que estar activo.");
  try {
    return await transaccion(ctx, async (tx) => {
      const d = await tx.deposito.create({
        data: {
          nombre: input.nombre,
          direccion: input.direccion ?? null,
          activo: input.activo,
          esPrincipal: false,
        },
      });
      // El primer depósito activo del panel queda como principal.
      const hayPrincipal = (await tx.deposito.count({ where: { esPrincipal: true } })) > 0;
      if (input.esPrincipal || (!hayPrincipal && input.activo)) await hacerPrincipal(tx, d.id);
      const final = await tx.deposito.findUniqueOrThrow({ where: { id: d.id } });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Deposito",
        entidadId: d.id,
        datosDespues: snapshot(final),
        meta: ctx.meta,
      });
      return { id: d.id };
    });
  } catch (error) {
    conflictoNombre(error);
    throw error;
  }
}

export async function actualizarDeposito(
  ctx: Ctx,
  input: ActualizarDeposito,
): Promise<{ id: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
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
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Deposito",
        entidadId: input.id,
        datosAntes: snapshot(antes),
        datosDespues: snapshot(despues),
        meta: ctx.meta,
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

export async function cambiarActivoDeposito(ctx: Ctx, id: string, activo: boolean): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const antes = await tx.deposito.findUnique({ where: { id } });
    if (!antes) throw new NotFoundError("El depósito no existe");
    if (antes.activo === activo) return;
    if (!activo) await assertPuedeDesactivar(tx, antes);
    const despues = await tx.deposito.update({ where: { id }, data: { activo } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Deposito",
      entidadId: id,
      datosAntes: snapshot(antes),
      datosDespues: snapshot(despues),
      meta: ctx.meta,
    });
  });
}
