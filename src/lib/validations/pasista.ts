import { EstadoComisionPasista, MedioPago } from "@prisma/client";
import { z } from "zod";

import { hoyAR } from "@/lib/fechas";

import { id, vacioAUndefined } from "./common";
import { motivoAjuste } from "./movimiento";

const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido");

/** Listado de /pasista (?mes=YYYY-MM&estado=&page=). Mes inválido → el actual (lo resuelve la página). */
export const filtrosPasistaSchema = z.object({
  mes: z.preprocess(vacioAUndefined, mes.optional()).catch(undefined),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoComisionPasista).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(50),
});

const datosPago = {
  medioPago: z.enum(MedioPago, { error: "Elegí cómo se le pagó" }),
  referencia: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** "YYYY-MM-DD" (día argentino, no futuro): hoy → ahora; otro día → 12:00 de ese día. */
  fecha: z
    .string({ error: "Elegí la fecha del pago" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .refine((f) => f <= hoyAR(), "La fecha no puede ser futura")
    .transform((f) => (f === hoyAR() ? new Date() : new Date(`${f}T12:00:00-03:00`))),
};

/** Marcar pagadas: una o varias (`ids`) o todas las pendientes de un `mes`. */
export const marcarPagadasSchema = z.union([
  z.object({ ids: z.array(id).min(1).max(500), ...datosPago }),
  z.object({ mes, ...datosPago }),
]);

export const deshacerPagoPasistaSchema = z.object({ id, motivo: motivoAjuste });
