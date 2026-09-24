import "server-only";

import { Prisma } from "@prisma/client";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import type { ActionError, ActionResult } from "@/lib/action-result";
import { AppError, type CamposConError } from "@/server/errors";

export type { ActionError, ActionResult };

function camposDeZod(error: ZodError): CamposConError {
  const campos: CamposConError = {};
  for (const issue of error.issues) {
    const clave = issue.path.join(".") || "_form";
    (campos[clave] ??= []).push(issue.message);
  }
  return campos;
}

export function mapearError(error: unknown): ActionError {
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION_ERROR",
      message: "Revisá los datos ingresados",
      fields: camposDeZod(error),
    };
  }
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { code: "CONFLICT", message: "Ya existe un registro con esos datos" };
  }
  console.error("[action] error inesperado:", error);
  return { code: "INTERNAL_ERROR", message: "Ocurrió un error inesperado. Probá de nuevo." };
}

/**
 * Envuelve una Server Action: captura errores esperados (AppError), mapea
 * ZodError a `fields`, loguea los inesperados y devuelve siempre ActionResult.
 * redirect()/notFound() se dejan pasar (Next los implementa lanzando).
 */
export function actionHandler<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<ActionResult<T>> {
  return async (...args: A) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      unstable_rethrow(error);
      return { ok: false, error: mapearError(error) };
    }
  };
}
