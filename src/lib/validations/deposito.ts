import { z } from "zod";

import { id, texto, textoOpcional } from "./common";

export const crearDepositoSchema = z.object({
  nombre: texto(100),
  direccion: textoOpcional(300),
  activo: z.boolean().default(true),
  esPrincipal: z.boolean().default(false),
});

export const actualizarDepositoSchema = crearDepositoSchema.partial().extend({ id });

export type CrearDeposito = z.output<typeof crearDepositoSchema>;
export type ActualizarDeposito = z.output<typeof actualizarDepositoSchema>;
