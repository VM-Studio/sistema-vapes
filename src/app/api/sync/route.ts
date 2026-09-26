import { EstadoOperacionSync, Modulo, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withTransaction, type Tx } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { ajusteMasivoSchema, ingresoManualSchema } from "@/lib/validations/movimiento";
import { crearTransferenciaSchema } from "@/lib/validations/transferencia";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireUsuario, type UsuarioConPermisos } from "@/server/auth/permissions";
import { metaDesdeHeaders } from "@/server/auth/request-meta";
import { AppError, ForbiddenError } from "@/server/errors";
import { loggerRequest } from "@/server/log";
import type { Actor } from "@/server/services/actor";
import {
  completarTransferencia,
  crearTransferencia,
  registrarAjusteMasivo,
  registrarIngresoManual,
} from "@/server/services/movimiento.service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync — operaciones del escáner hechas SIN CONEXIÓN (ingresar,
 * contar, transferir; nunca ventas), enviadas en orden al volver la red.
 *
 * Idempotencia por `idOperacion` (UUID generado en el celular):
 *  - Se aplica con los MISMOS servicios que la app online, dentro de UNA
 *    transacción que además inserta OperacionSincronizada (idOperacion UNIQUE).
 *    Si la misma operación llega dos veces a la vez, la segunda choca con el
 *    índice único y se revierte entera (sus movimientos también).
 *  - Si ya se procesó, devuelve el resultado guardado sin tocar el stock.
 *  - Si la rechaza una regla de negocio (ej. no alcanza el stock para
 *    transferir porque alguien vendió mientras no había señal), queda
 *    RECHAZADA con el motivo: el usuario la ve y decide. Nunca se descarta sola.
 *  - Un error de infraestructura (DB caída) responde 5xx: queda pendiente y
 *    el celular reintenta.
 */

const operacionSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("INGRESO"),
    idOperacion: z.uuid(),
    creadaEn: z.iso.datetime(),
    payload: ingresoManualSchema,
  }),
  z.object({
    tipo: z.literal("RECUENTO"),
    idOperacion: z.uuid(),
    creadaEn: z.iso.datetime(),
    payload: ajusteMasivoSchema,
  }),
  z.object({
    tipo: z.literal("TRANSFERENCIA"),
    idOperacion: z.uuid(),
    creadaEn: z.iso.datetime(),
    payload: z.object({
      transferencia: crearTransferenciaSchema,
      completar: z.boolean().default(false),
    }),
  }),
]);

const cuerpoSchema = z.object({ operaciones: z.array(z.unknown()).min(1).max(50) });
const autorSchema = z.object({ usuarioId: z.string().min(1) });

type Operacion = z.output<typeof operacionSchema>;

export interface ResultadoSync {
  idOperacion: string;
  estado: "APLICADA" | "RECHAZADA" | "PROCESANDO";
  motivo?: string | null;
  resultado?: unknown;
  /** true: ya se había procesado antes (no se repitió nada). */
  repetida: boolean;
}

function permisoPara(u: UsuarioConPermisos, op: Operacion): string | null {
  if (op.tipo === "INGRESO" && !puede(u, Modulo.MOVIMIENTOS, "crear"))
    return "Necesitás permiso para crear en Movimientos.";
  if (op.tipo === "RECUENTO" && !puede(u, Modulo.MOVIMIENTOS, "editar"))
    return "Necesitás permiso para editar en Movimientos.";
  if (op.tipo === "TRANSFERENCIA") {
    if (!puede(u, Modulo.MOVIMIENTOS, "crear"))
      return "Necesitás permiso para crear en Movimientos.";
    if (op.payload.completar && !puede(u, Modulo.MOVIMIENTOS, "editar"))
      return "Necesitás permiso para completar transferencias.";
  }
  return null;
}

async function aplicar(tx: Tx, op: Operacion, actor: Actor): Promise<unknown> {
  switch (op.tipo) {
    case "INGRESO":
      return registrarIngresoManual(op.payload, actor, tx);
    case "RECUENTO":
      return registrarAjusteMasivo(op.payload, actor, tx);
    case "TRANSFERENCIA": {
      const t = await crearTransferencia(op.payload.transferencia, actor, tx);
      if (!op.payload.completar) return { ...t, completada: false };
      const c = await completarTransferencia(t.id, actor, tx);
      return { ...t, ...c, completada: true };
    }
  }
}

const esUnicoDuplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

function guardado(fila: {
  idOperacion: string;
  estado: EstadoOperacionSync;
  motivo: string | null;
  resultado: Prisma.JsonValue;
}): ResultadoSync {
  return {
    idOperacion: fila.idOperacion,
    estado: fila.estado,
    motivo: fila.motivo,
    resultado: fila.resultado,
    repetida: true,
  };
}

async function procesar(
  op: Operacion,
  usuario: UsuarioConPermisos,
  actor: Actor,
): Promise<ResultadoSync> {
  const previa = await prisma.operacionSincronizada.findUnique({
    where: { idOperacion: op.idOperacion },
  });
  if (previa) {
    if (previa.usuarioId !== usuario.id)
      throw new ForbiddenError("Esa operación es de otro usuario.");
    return guardado(previa);
  }
  const base = {
    idOperacion: op.idOperacion,
    tipo: op.tipo,
    usuarioId: usuario.id,
    payload: op.payload as Prisma.InputJsonValue,
    creadaEnCliente: new Date(op.creadaEn),
  };
  const sinPermiso = permisoPara(usuario, op);
  try {
    if (sinPermiso) throw new ForbiddenError(sinPermiso);
    const resultado = await withTransaction(
      async (tx) => {
        const r = await aplicar(tx, op, actor);
        await tx.operacionSincronizada.create({
          data: {
            ...base,
            estado: EstadoOperacionSync.APLICADA,
            resultado: r as Prisma.InputJsonValue,
            procesadaAt: new Date(),
          },
        });
        return r;
      },
      { maxRetries: 3, timeout: 30_000 },
    );
    return { idOperacion: op.idOperacion, estado: "APLICADA", resultado, repetida: false };
  } catch (e) {
    if (esUnicoDuplicado(e)) {
      // Llegó dos veces a la vez: la otra ganó; esta se revirtió entera.
      const ganadora = await prisma.operacionSincronizada.findUnique({
        where: { idOperacion: op.idOperacion },
      });
      if (ganadora) return guardado(ganadora);
    }
    if (!(e instanceof AppError)) throw e; // infraestructura: que el celular reintente
    try {
      await prisma.operacionSincronizada.create({
        data: {
          ...base,
          estado: EstadoOperacionSync.RECHAZADA,
          motivo: e.message,
          procesadaAt: new Date(),
        },
      });
    } catch (e2) {
      if (!esUnicoDuplicado(e2)) throw e2;
      const otra = await prisma.operacionSincronizada.findUnique({
        where: { idOperacion: op.idOperacion },
      });
      if (otra) return guardado(otra);
    }
    return { idOperacion: op.idOperacion, estado: "RECHAZADA", motivo: e.message, repetida: false };
  }
}

export async function POST(req: Request) {
  try {
    const usuario = await requireUsuario();
    const actor: Actor = {
      id: usuario.id,
      meta: {
        ...metaDesdeHeaders(req.headers),
        userAgent: `sync-offline · ${req.headers.get("user-agent") ?? ""}`.slice(0, 500),
      },
    };
    const { operaciones } = cuerpoSchema.parse(await req.json());
    const log = await loggerRequest();
    const resultados: ResultadoSync[] = [];
    // En orden: un recuento hecho después de un ingreso tiene que aplicarse después.
    for (const cruda of operaciones) {
      // Hecha por OTRO usuario en este celular: no se le atribuye a quien tiene la sesión ahora.
      const autor = autorSchema.safeParse(cruda);
      if (autor.success && autor.data.usuarioId !== usuario.id) {
        const idOperacion = (cruda as { idOperacion?: string }).idOperacion ?? "desconocida";
        resultados.push({
          idOperacion,
          estado: "PROCESANDO",
          motivo: "Es de otro usuario: se sincroniza cuando esa persona inicie sesión.",
          repetida: false,
        });
        continue;
      }
      const parsed = operacionSchema.safeParse(cruda);
      if (!parsed.success) {
        const idOperacion = (cruda as { idOperacion?: string })?.idOperacion ?? "desconocida";
        resultados.push({
          idOperacion,
          estado: "RECHAZADA",
          motivo: "Operación con datos inválidos",
          repetida: false,
        });
        continue;
      }
      const r = await procesar(parsed.data, usuario, actor);
      log.info(
        {
          idOperacion: r.idOperacion,
          tipo: parsed.data.tipo,
          estado: r.estado,
          repetida: r.repetida,
        },
        "sync offline",
      );
      resultados.push(r);
    }
    return NextResponse.json({ ok: true, data: { resultados } });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
