import { EstadoPago, EstadoVenta, MedioPago, TipoComprobante } from "@prisma/client";
import { z } from "zod";

import {
  enteroPositivo,
  id,
  montoOpcional,
  montoPositivo,
  sinDuplicados,
  texto,
  textoOpcional,
  vacioAUndefined,
} from "./common";

/**
 * Ventas: el cliente manda ids, cantidades y montos de pago. Precios, costos
 * y totales los calcula SIEMPRE el servidor. Precio manual y descuento global
 * solo con permiso "editar" en VENTAS (lo valida la acción, no el schema).
 */

export const REDONDEOS_VENTA = [0, 1, 10, 50, 100] as const;
export type RedondeoVenta = (typeof REDONDEOS_VENTA)[number];

export const ventaItemSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
  /** Precio manual (requiere permiso). Vacío/ausente → el precioVenta actual. */
  precioUnitario: montoOpcional,
});

export const descuentoGlobalSchema = z
  .discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("monto"), valor: montoPositivo }),
    z.object({
      tipo: z.literal("porcentaje"),
      valor: z.coerce.number().positive("Mayor a 0").max(100, "Máximo 100%"),
    }),
  ])
  .optional();

export const borradorVentaSchema = z.object({
  depositoId: id,
  clienteId: z.preprocess(vacioAUndefined, id.optional()),
  descuentoGlobal: descuentoGlobalSchema,
  notas: textoOpcional(2000),
  items: z
    .array(ventaItemSchema)
    .min(1, "Agregá al menos un producto")
    .max(300)
    .refine(
      (items) => sinDuplicados(items, (i) => i.varianteId),
      "Hay productos repetidos: sumá la cantidad",
    ),
});

/** Medios que puede elegir el cajero (CREDITO_CLIENTE solo si el cliente tiene saldo a favor). */
export const MEDIOS_PAGO_POS = [
  MedioPago.EFECTIVO,
  MedioPago.TRANSFERENCIA,
  MedioPago.DEBITO,
  MedioPago.CREDITO,
  MedioPago.MERCADOPAGO,
  MedioPago.CREDITO_CLIENTE,
  MedioPago.OTRO,
] as const;

export const pagoSchema = z.object({
  medioPago: z.enum(MedioPago),
  monto: montoPositivo,
  referencia: textoOpcional(100),
});

export const confirmarVentaSchema = z.object({
  id,
  pagos: z.array(pagoSchema).max(10).default([]),
  redondearA: z.coerce
    .number()
    .refine(
      (n): n is RedondeoVenta => (REDONDEOS_VENTA as readonly number[]).includes(n),
      "Redondeo inválido",
    )
    .default(0),
});

/** Crea (o actualiza) el borrador y lo confirma: el caso normal del POS. */
export const venderSchema = z.object({
  borradorId: z.preprocess(vacioAUndefined, id.optional()),
  venta: borradorVentaSchema,
  pagos: confirmarVentaSchema.shape.pagos,
  redondearA: confirmarVentaSchema.shape.redondearA,
});

export const registrarPagoSchema = z.object({ ventaId: id, pago: pagoSchema });

export const anularPagoSchema = z.object({ pagoId: id, motivo: texto(500) });

export const anularVentaSchema = z.object({ ventaId: id, motivo: texto(500) });

export const devolucionSchema = z.object({
  ventaId: id,
  depositoId: id,
  motivo: texto(500),
  items: z
    .array(z.object({ ventaItemId: id, cantidad: enteroPositivo }))
    .min(1, "Elegí al menos un producto")
    .refine((items) => sinDuplicados(items, (i) => i.ventaItemId), "Ítem repetido"),
  /** Dinero de vuelta (el monto lo calcula el servidor) o a la cuenta del cliente. */
  reintegro: z.discriminatedUnion("tipo", [
    z.object({
      tipo: z.literal("dinero"),
      medioPago: z
        .enum(MedioPago)
        .refine((m) => m !== MedioPago.CREDITO_CLIENTE, "Elegí cómo se devuelve el dinero"),
    }),
    z.object({ tipo: z.literal("cuentaCorriente") }),
  ]),
});

/** Pago a cuenta: se imputa a las ventas pendientes (por defecto, de la más vieja a la más nueva). */
export const pagoACuentaSchema = z.object({
  clienteId: id,
  medioPago: z.enum(MedioPago).refine((m) => m !== MedioPago.CREDITO_CLIENTE, "Medio inválido"),
  monto: montoPositivo,
  referencia: textoOpcional(100),
  /** Orden de imputación; si falta, las pendientes de la más vieja a la más nueva. */
  ventaIds: z.array(id).max(200).optional(),
});

const fechaISO = z
  .preprocess(
    vacioAUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  )
  .catch(undefined);

export const listarVentasSchema = z.object({
  desde: fechaISO,
  hasta: fechaISO,
  depositoId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  clienteId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  usuarioId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoVenta).optional()).catch(undefined),
  estadoPago: z.preprocess(vacioAUndefined, z.enum(EstadoPago).optional()).catch(undefined),
  medioPago: z.preprocess(vacioAUndefined, z.enum(MedioPago).optional()).catch(undefined),
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

// --- Configuración de ventas / comprobante ------------------------------------------

export const configVentasSchema = z.object({
  nombreNegocio: z.string().trim().max(120).default("Mi Negocio"),
  cuit: z.string().trim().max(20).default(""),
  direccion: z.string().trim().max(200).default(""),
  telefono: z.string().trim().max(40).default(""),
  /** URL https de una imagen PNG/JPG (opcional). */
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === "" || /^https:\/\/\S+$/.test(u), "Tiene que ser una URL https")
    .default(""),
  leyenda: z.string().trim().max(200).default("Documento no válido como factura"),
  emitirComprobanteAutomatico: z.boolean().default(true),
  tipoComprobanteDefault: z.enum(TipoComprobante).default(TipoComprobante.TICKET),
  puntoVenta: z.coerce.number().int().min(1).max(99_999).default(1),
  redondeoVentas: z.coerce
    .number()
    .refine((n) => [0, 10, 50, 100].includes(n), "Elegí 0, 10, 50 o 100")
    .default(0),
});

export type ConfigVentas = z.output<typeof configVentasSchema>;
export type BorradorVenta = z.output<typeof borradorVentaSchema>;
export type BorradorVentaInput = z.input<typeof borradorVentaSchema>;
export type PagoInput = Omit<z.output<typeof pagoSchema>, "referencia"> & {
  referencia?: string | undefined;
};
export type Devolucion = z.output<typeof devolucionSchema>;
export type FiltrosVentas = z.output<typeof listarVentasSchema>;
export type PagoACuenta = Omit<z.output<typeof pagoACuentaSchema>, "referencia"> & {
  referencia?: string | undefined;
};
