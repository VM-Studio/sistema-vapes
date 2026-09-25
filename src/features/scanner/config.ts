import { z } from "zod";

/** Sufijos que puede mandar una pistola al terminar un código. */
export const SUFIJOS = ["Enter", "Tab"] as const;
export type Sufijo = (typeof SUFIJOS)[number];

/**
 * Parámetros del escáner (se guardan en Configuracion, clave "escaner").
 * Compartido servidor/cliente: el layout los lee de la DB y los pasa al ScannerProvider.
 */
export const configEscanerSchema = z.object({
  sufijos: z.array(z.enum(SUFIJOS)).min(1, "Elegí al menos un sufijo").default(["Enter", "Tab"]),
  prefijo: z.string().max(10).default(""),
  maxIntervalMs: z.coerce.number().int().min(10).max(200).default(50),
  minLength: z.coerce.number().int().min(2).max(20).default(4),
  sonidos: z.boolean().default(true),
});

export type ConfigEscaner = z.output<typeof configEscanerSchema>;

export const CONFIG_ESCANER_DEFAULT: ConfigEscaner = configEscanerSchema.parse({});

/** Lee un valor guardado (JSON de la DB) tolerando claves faltantes o viejas. */
export function parsearConfigEscaner(valor: unknown): ConfigEscaner {
  const r = configEscanerSchema.safeParse(valor ?? {});
  return r.success ? r.data : CONFIG_ESCANER_DEFAULT;
}

export type FuenteEscaneo = "pistola" | "camara" | "manual";
