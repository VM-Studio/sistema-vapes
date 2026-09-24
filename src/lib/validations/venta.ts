import { MedioPago, TipoComprobante } from "@prisma/client";
import { z } from "zod";

import { cantidad, cuitOpcional, id, monto, sinDuplicados, texto, textoOpcional } from "./common";

export const ventaItemSchema = z.object({
  varianteId: id,
  cantidad,
  /** Si no se envía, se usa el precioVenta actual de la variante. */
  precioUnitario: monto.optional(),
  descuento: monto.default(0),
});

export const comprobanteVentaSchema = z.object({
  tipo: z.enum(TipoComprobante),
  puntoVenta: z.number().int().positive().default(1),
  razonSocial: textoOpcional(200),
  cuit: cuitOpcional,
  condicionIva: textoOpcional(50),
});

export const crearVentaSchema = z
  .object({
    clienteId: id.optional(),
    depositoId: id,
    fecha: z.coerce.date().optional(),
    medioPago: z.enum(MedioPago),
    descuento: monto.default(0),
    notas: textoOpcional(2000),
    items: z
      .array(ventaItemSchema)
      .min(1, "La venta debe tener al menos un ítem")
      .refine(
        (items) => sinDuplicados(items, (i) => i.varianteId),
        "Hay productos repetidos: sumá la cantidad",
      ),
    comprobante: comprobanteVentaSchema.optional(),
  })
  .refine(
    (v) => v.comprobante?.tipo !== TipoComprobante.FACTURA_A || v.comprobante.cuit !== undefined,
    {
      message: "La Factura A requiere CUIT",
      path: ["comprobante", "cuit"],
    },
  );

export const anularVentaSchema = z.object({
  ventaId: id,
  motivo: texto(500),
});

export type CrearVentaInput = z.input<typeof crearVentaSchema>;
export type CrearVenta = z.output<typeof crearVentaSchema>;
export type AnularVenta = z.output<typeof anularVentaSchema>;
