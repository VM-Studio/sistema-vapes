import { z } from "zod";

/**
 * Configuración POR PANEL (tabla Configuracion). Claves: "escaner" (ver
 * features/scanner/config), "ventas" (ver validations/venta: configVentasSchema),
 * "alertaStockMinimo" y "prefijoSku" (acá). Lo global (nombre del negocio,
 * ícono, zona horaria) está en ConfiguracionGlobal.
 */

/** Claves "prefijoSku" y "alertaStockMinimo": catálogo del panel. */
export const configCatalogoSchema = z.object({
  prefijoSku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, "Entre 2 y 6 letras o números")
    .default("PRD"),
  alertaStockMinimo: z.boolean().default(true),
});

export type ConfigCatalogo = z.output<typeof configCatalogoSchema>;
