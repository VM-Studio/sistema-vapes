import { EstadoVenta, MedioPago, TipoVenta } from "@prisma/client";
import { z } from "zod";

import {
  enteroPositivo,
  id,
  monto,
  montoOpcional,
  sinDuplicados,
  texto,
  textoOpcional,
  vacioAUndefined,
} from "./common";

/**
 * Ventas: el cliente manda galpón, cliente, sabores, cantidades y los pagos
 * (hasta 3, un medio por fila). Precios de lista, costos y totales los calcula
 * SIEMPRE el servidor, que también decide si la venta queda PAGADA o fiada.
 * Precio especial y descuento global solo con permiso "editar" en VENTAS;
 * vender fiado ("fiar": true) con "crear" en FIADOS (lo valida el servicio).
 * Galpón, cliente y pago son obligatorios: si faltan, el servicio responde con
 * un mensaje de negocio (no un error de campo).
 */

export const medioPagoSchema = z.enum(MedioPago, { error: "Elegí el medio de pago" });

/** Un pago: medio + monto aplicado a la venta (el vuelto no se registra). */
export const pagoSchema = z.object({
  medioPago: medioPagoSchema,
  monto,
  /** Nro. de operación de la transferencia / Binance. */
  referencia: textoOpcional(100),
});

export const pagosSchema = z
  .array(pagoSchema)
  .max(3, "Máximo 3 pagos por venta")
  .refine((p) => sinDuplicados(p, (x) => x.medioPago), "Usá cada medio de pago una sola vez")
  .default([]);

const idOpcional = z.preprocess(vacioAUndefined, id.optional());

export const clienteVentaSchema = z.union([
  z.object({ id }),
  z.object({
    nuevo: z.object({
      nombre: texto(100),
      telefono: z.string().trim().min(1, "Ingresá el teléfono").max(40, "Máximo 40 caracteres"),
    }),
  }),
]);

export const itemVentaSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
  /** Precio cobrado por unidad si difiere del de lista (requiere "editar" en VENTAS). */
  precioEspecial: montoOpcional,
});

export const generarVentaSchema = z.object({
  depositoId: idOpcional,
  cliente: clienteVentaSchema.optional(),
  items: z.array(itemVentaSchema).max(300, "Máximo 300 productos por venta"),
  /** Vacío solo si se fía todo. Σ montos ≤ total (lo valida el servicio). */
  pagos: pagosSchema,
  /** Lo que no cubren los pagos queda como saldo pendiente del cliente (FIADOS "crear"). */
  fiar: z.boolean().default(false),
  /** Descuento global en pesos (requiere "editar" en VENTAS). */
  descuento: montoOpcional,
  notas: textoOpcional(2000),
  tipo: z.preprocess(vacioAUndefined, z.enum(TipoVenta).default(TipoVenta.UNITARIA)),
});

export const anularVentaSchema = z.object({
  ventaId: id,
  motivo: texto(500).refine((m) => m.length >= 3, "Contá brevemente por qué se anula"),
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

const idFiltro = z.preprocess(vacioAUndefined, id.optional()).catch(undefined);

export const listarVentasSchema = z.object({
  desde: fechaISO,
  hasta: fechaISO,
  depositoId: idFiltro,
  vendedorId: idFiltro,
  clienteId: idFiltro,
  medioPago: z.preprocess(vacioAUndefined, z.enum(MedioPago).optional()).catch(undefined),
  tipo: z.preprocess(vacioAUndefined, z.enum(TipoVenta).optional()).catch(undefined),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoVenta).optional()).catch(undefined),
  /** ID de venta (VAP-000123 o 123), nombre o teléfono del cliente. */
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

// --- Configuración de ventas del panel (clave "ventas") ---------------------------

export const configVentasSchema = z.object({
  redondeoVentas: z.coerce
    .number()
    .refine((n) => [0, 10, 50, 100].includes(n), "Elegí 0, 10, 50 o 100")
    .default(0),
});

/** Un pago tal como lo arma un servicio (convertir una cotización, scripts). */
export interface PagoVentaInput {
  medioPago: MedioPago;
  monto: number;
  referencia?: string;
}
export type ConfigVentas = z.output<typeof configVentasSchema>;
export type ClienteVenta = z.output<typeof clienteVentaSchema>;
export type GenerarVenta = z.output<typeof generarVentaSchema>;
export type GenerarVentaInput = z.input<typeof generarVentaSchema>;
export type FiltrosVentas = z.output<typeof listarVentasSchema>;
