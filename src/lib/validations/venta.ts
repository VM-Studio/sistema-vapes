import { EstadoVenta, MedioPago, TipoVenta } from "@prisma/client";
import { z } from "zod";

import { enteroPositivo, id, montoOpcional, texto, textoOpcional, vacioAUndefined } from "./common";

/**
 * Ventas: el cliente manda galpón, cliente, sabores, cantidades y el medio de
 * pago. Precios de lista, costos y totales los calcula SIEMPRE el servidor.
 * Precio especial y descuento global solo con permiso "editar" en VENTAS (lo
 * valida el servicio). Galpón, cliente y medio de pago son obligatorios: si
 * faltan, el servicio responde con un mensaje de negocio (no un error de campo).
 */

export const medioPagoSchema = z.enum(MedioPago, { error: "Elegí el medio de pago" });

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
  medioPago: z.preprocess(vacioAUndefined, medioPagoSchema.optional()),
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

export type ConfigVentas = z.output<typeof configVentasSchema>;
export type ClienteVenta = z.output<typeof clienteVentaSchema>;
export type GenerarVenta = z.output<typeof generarVentaSchema>;
export type GenerarVentaInput = z.input<typeof generarVentaSchema>;
export type FiltrosVentas = z.output<typeof listarVentasSchema>;
