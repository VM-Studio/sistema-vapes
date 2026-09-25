import "server-only";

import type { DocumentoReporte } from "@/lib/reportes/documento";
import { formatearFechaHora } from "@/lib/utils";
import { ahora } from "@/lib/reloj";
import { ETIQUETA_MEDIO_PAGO } from "@/server/services/comprobante.service";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { reporteCierre } from "@/server/services/caja.service";

import { generarPdfReporte } from "./pdf-reporte";

/** "Z de caja": apertura, cobros por medio, gastos, retiros, arqueo, anuladas y responsables. */
export async function documentoCierreCaja(cajaId: string): Promise<DocumentoReporte> {
  const r = await reporteCierre(cajaId);
  const c = r.caja;
  const t = c.totales;
  const cerrada = c.estado === "CERRADA";
  return {
    titulo: `${cerrada ? "Cierre" : "Estado"} de caja · ${c.deposito.nombre}`,
    filtros: [
      { etiqueta: "Apertura", valor: `${formatearFechaHora(c.abiertaAt)} por ${c.abiertaPor}` },
      {
        etiqueta: "Cierre",
        valor: cerrada ? `${formatearFechaHora(c.cerradaAt)} por ${c.cerradaPor}` : "abierta",
      },
    ],
    orientacion: "vertical",
    kpis: [
      { etiqueta: "Efectivo esperado", valor: c.montoEsperado ?? t.esperado, tipo: "moneda" },
      { etiqueta: "Contado", valor: c.montoContado, tipo: "moneda" },
      { etiqueta: "Diferencia", valor: c.diferencia, tipo: "moneda" },
      { etiqueta: "Efectivo fuera de caja", valor: r.efectivoFueraDeCaja, tipo: "moneda" },
    ],
    secciones: [
      {
        id: "arqueo",
        titulo: "Efectivo de la caja",
        columnas: [
          { clave: "concepto", titulo: "Concepto", tipo: "texto", ancho: 4 },
          { clave: "monto", titulo: "Monto", tipo: "moneda", ancho: 2 },
        ],
        filas: [
          { concepto: "Monto inicial", monto: t.inicial },
          { concepto: "+ Ventas en efectivo", monto: t.ventas },
          { concepto: "+ Cobros a clientes", monto: t.pagosClientes },
          { concepto: "+ Ingresos extra", monto: t.ingresosExtra },
          { concepto: "− Devoluciones y anulaciones", monto: `-${t.devoluciones}` },
          { concepto: "− Gastos pagados de la caja", monto: `-${t.gastos}` },
          { concepto: "− Retiros", monto: `-${t.retiros}` },
          { concepto: "= Esperado", monto: c.montoEsperado ?? t.esperado, _estilo: "subtotal" },
          ...(cerrada
            ? [
                { concepto: "Contado (arqueo)", monto: c.montoContado },
                {
                  concepto: `Diferencia${c.requiereRevision ? " — PARA REVISAR" : ""}`,
                  monto: c.diferencia,
                  _estilo: "subtotal" as const,
                  ...(c.requiereRevision ? { _alerta: "danger" as const } : {}),
                },
              ]
            : []),
        ],
      },
      {
        id: "medios",
        titulo: "Cobrado en el período por medio de pago",
        descripcion:
          "Efectivo: lo que entró a esta caja. El resto: cobros de ventas de este depósito mientras estuvo abierta.",
        columnas: [
          { clave: "medio", titulo: "Medio", tipo: "texto", ancho: 3 },
          { clave: "cantidad", titulo: "Pagos", tipo: "entero" },
          { clave: "total", titulo: "Total", tipo: "moneda", ancho: 2 },
        ],
        filas: r.porMedioPago.map((m) => ({
          medio: ETIQUETA_MEDIO_PAGO[m.medioPago],
          cantidad: m.cantidad,
          total: m.total,
        })),
        totales: {
          medio: "Total",
          total: r.porMedioPago.reduce((a, m) => a + Number(m.total), 0).toFixed(2),
        },
      },
      {
        id: "gastos",
        titulo: "Gastos pagados de la caja",
        columnas: [
          { clave: "categoria", titulo: "Categoría", tipo: "texto", ancho: 1.5 },
          { clave: "descripcion", titulo: "Descripción", tipo: "texto", ancho: 3 },
          { clave: "monto", titulo: "Monto", tipo: "moneda", ancho: 1.5 },
        ],
        filas: r.gastos.map((g) => ({ ...g })),
        vacio: "Sin gastos.",
      },
      {
        id: "manuales",
        titulo: "Retiros e ingresos extra",
        columnas: [
          { clave: "fecha", titulo: "Hora", tipo: "fechaHora", ancho: 1.4 },
          { clave: "tipo", titulo: "Tipo", tipo: "texto", ancho: 1.2 },
          { clave: "descripcion", titulo: "Detalle", tipo: "texto", ancho: 3 },
          { clave: "usuario", titulo: "Usuario", tipo: "texto", ancho: 1.3 },
          { clave: "monto", titulo: "Monto", tipo: "moneda", ancho: 1.5 },
        ],
        filas: [...r.retiros, ...r.ingresosExtra]
          .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
          .map((m) => ({
            fecha: m.fecha.toISOString(),
            tipo: m.etiqueta,
            descripcion: m.descripcion,
            usuario: m.usuario,
            monto: m.monto,
          })),
        vacio: "Sin retiros ni ingresos extra.",
      },
      {
        id: "anuladas",
        titulo: "Ventas anuladas en el período",
        columnas: [
          { clave: "numero", titulo: "Venta", tipo: "entero", ancho: 1 },
          { clave: "motivo", titulo: "Motivo", tipo: "texto", ancho: 3 },
          { clave: "por", titulo: "Anuló", tipo: "texto", ancho: 1.4 },
          { clave: "total", titulo: "Total", tipo: "moneda", ancho: 1.5 },
        ],
        filas: r.ventasAnuladas.map((v) => ({ ...v })),
        vacio: "Ninguna.",
      },
    ],
    nota: c.observaciones ? `Observaciones: ${c.observaciones}` : undefined,
  };
}

export async function pdfCierreCaja(cajaId: string, generadoPor: string) {
  const [doc, config] = await Promise.all([documentoCierreCaja(cajaId), obtenerConfigVentas()]);
  return generarPdfReporte(doc, {
    negocio: config.nombreNegocio,
    generadoPor,
    generadoEn: ahora(),
  });
}
