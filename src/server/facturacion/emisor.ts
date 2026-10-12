import "server-only";

import type { TipoFactura } from "@prisma/client";

/**
 * PUNTO DE EXTENSIÓN PARA FACTURACIÓN ELECTRÓNICA (AFIP / ARCA)
 *
 * Hoy el sistema no habla con AFIP: las facturas A, B y C se emiten por fuera
 * (facturador de AFIP, sistema del contador) y acá se REGISTRAN con su número
 * externo y, si se quiere, el PDF real; el comprobante interno lo genera el
 * sistema. `factura.service` llama a `emisorFiscal().emitir()` dentro de la
 * transacción que crea la factura, con todos sus datos ya calculados.
 *
 * Para emitir electrónicamente alcanza con otra implementación de
 * `EmisorFiscal` (p. ej. contra el web service WSFEv1 con el certificado del
 * negocio: FECAESolicitar con punto de venta, tipo, importes neto/IVA/total y
 * documento del receptor) que devuelva el CAE, su vencimiento y el número
 * asignado, y elegirla en `emisorFiscal()` según la configuración del panel.
 * El esquema ya guarda lo que AFIP pide (punto de venta, tipo, CUIT y
 * condición frente al IVA del receptor, neto, alícuota e IVA discriminado);
 * habría que sumar las columnas del CAE.
 */

export interface DatosEmision {
  panelId: string;
  tipo: TipoFactura;
  puntoVenta: number;
  fecha: Date;
  receptor: { razonSocial: string; cuit: string | null; condicionIva: string | null };
  subtotal: string;
  alicuotaIva: string;
  iva: string;
  total: string;
}

export interface ResultadoEmision {
  /** Número fiscal asignado por el organismo ("0001-00001234"); null = no lo asigna el sistema. */
  numeroExterno: string | null;
}

export interface EmisorFiscal {
  readonly nombre: string;
  emitir(datos: DatosEmision): Promise<ResultadoEmision>;
}

/** Registro manual: la factura ya se emitió por fuera (o es un comprobante interno). */
export const emisorManual: EmisorFiscal = {
  nombre: "manual",
  emitir: async () => ({ numeroExterno: null }),
};

export function emisorFiscal(): EmisorFiscal {
  return emisorManual;
}
