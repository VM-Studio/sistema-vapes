import { z } from "zod";

import { id, textoOpcional } from "./common";

/** El nombre es nombre de columna en vw_stock_consolidado: máximo 60 (la DB limita a 63 bytes). */
const nombreDeposito = z.string().trim().min(1, "Campo requerido").max(60, "Máximo 60 caracteres");

export const crearDepositoSchema = z.object({
  nombre: nombreDeposito,
  direccion: textoOpcional(300),
  activo: z.boolean().default(true),
  esPrincipal: z.boolean().default(false),
});

export const actualizarDepositoSchema = crearDepositoSchema.extend({ id });

export const cambiarActivoSchema = z.object({ id, activo: z.boolean() });

export type CrearDeposito = z.output<typeof crearDepositoSchema>;
export type ActualizarDeposito = z.output<typeof actualizarDepositoSchema>;
