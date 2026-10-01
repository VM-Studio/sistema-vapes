import "server-only";

import { PassThrough, Readable } from "node:stream";

import ExcelJS from "exceljs";

import { prisma } from "@/lib/db";
import { formatearIdCompra } from "@/lib/paneles";
import { TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { precioVentaEfectivo } from "@/lib/precios";
import {
  ESTADO_VENTA_UI,
  ESTADO_PAGO_UI,
  ETIQUETA_MEDIO_PAGO,
  etiquetaMedioPrincipal,
  ETIQUETA_TIPO_VENTA,
  saborVisible,
} from "@/lib/ventas-ui";
import { formatearFechaHora } from "@/lib/utils";
import { ESTADO_COTIZACION_UI, ETIQUETA_TIPO_COTIZACION } from "@/lib/validations/cotizacion";

/**
 * Exportación COMPLETA de los datos del negocio a Excel, de todos los
 * sistemas (paneles): cada hoja tiene la columna "Sistema". Es un servicio
 * global de dueños (por eso usa el cliente crudo). Streaming: cada hoja se
 * escribe de a 1.000 filas (paginado por id) y se libera.
 */
const MONEDA = '"$" #,##0.00;[Red]-"$" #,##0.00';
const LOTE = 1000;

type Col = { header: string; key: string; width: number; numFmt?: string };

async function hoja<T extends { id: string }>(
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  nombre: string,
  columnas: Col[],
  pagina: (cursor: string | null) => Promise<T[]>,
  fila: (x: T) => Record<string, unknown>,
) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columnas.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  let cursor: string | null = null;
  let n = 0;
  for (;;) {
    const lote = await pagina(cursor);
    for (const x of lote) ws.addRow(fila(x)).commit();
    n += lote.length;
    if (lote.length < LOTE) break;
    cursor = lote[lote.length - 1]!.id;
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(2, n + 1), column: columnas.length },
  };
  ws.commit();
}

const pag = (cursor: string | null) => ({
  take: LOTE,
  orderBy: { id: "asc" as const },
  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
});
const num = (d: { toString(): string } | null | undefined) =>
  d == null ? null : Number(d.toString());

export function streamExportarTodo(meta: {
  negocio: string;
  usuario: string;
}): ReadableStream<Uint8Array> {
  const paso = new PassThrough();
  void (async () => {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: paso, useStyles: true });
    wb.creator = meta.negocio;
    const info = wb.addWorksheet("Info");
    info.addRow([`${meta.negocio} — exportación completa`]).font = { bold: true, size: 14 };
    info.addRow([`Generada ${formatearFechaHora(new Date())} por ${meta.usuario}`]);
    info.addRow([
      "Hojas: Productos, Stock, Movimientos, Ventas, Pagos de ventas, Ítems de ventas, Devoluciones, Ítems de devoluciones, Compras, Ítems de compras, Cotizaciones, Ítems de cotizaciones, Clientes, Proveedores, Precios de proveedores. Cada fila indica su sistema.",
    ]);
    info.commit();
    const sistemas = new Map(
      (await prisma.panel.findMany({ select: { id: true, nombre: true, slug: true } })).map((p) => [
        p.id,
        p,
      ]),
    );
    const sistema = (panelId: string) => sistemas.get(panelId)?.nombre ?? panelId;
    const SISTEMA: Col = { header: "Sistema", key: "sis", width: 14 };

    await hoja(
      wb,
      "Productos",
      [
        SISTEMA,
        { header: "Marca", key: "m", width: 14 },
        { header: "Modelo", key: "mod", width: 16 },
        { header: "Especificación", key: "esp", width: 14 },
        { header: "Nombre completo", key: "p", width: 30 },
        { header: "Sabor", key: "v", width: 24 },
        { header: "SKU", key: "sku", width: 14 },
        { header: "Código de barras", key: "cb", width: 16 },
        { header: "Códigos alternativos", key: "alt", width: 22 },
        { header: "Categoría", key: "c", width: 14 },
        { header: "Precio efectivo", key: "precio", width: 13, numFmt: MONEDA },
        { header: "Precio propio del sabor", key: "propio", width: 13, numFmt: MONEDA },
        { header: "Último costo", key: "costo", width: 12, numFmt: MONEDA },
        { header: "Stock mínimo", key: "min", width: 10 },
        { header: "Activo", key: "act", width: 8 },
        { header: "Baja", key: "baja", width: 16 },
      ],
      (c) =>
        prisma.variante.findMany({
          ...pag(c),
          include: {
            producto: { include: { categoria: true, marca: true } },
            codigosAlternativos: true,
          },
        }),
      (v) => ({
        sis: sistema(v.panelId),
        m: v.producto.marca.nombre,
        mod: v.producto.nombre,
        esp: v.producto.especificacion,
        p: v.producto.nombreCompleto,
        v: saborVisible(v.nombre) ?? "",
        sku: v.sku,
        cb: v.codigoBarras,
        alt: v.codigosAlternativos.map((a) => a.codigo).join(", "),
        c: v.producto.categoria?.nombre ?? "",
        precio: num(precioVentaEfectivo(v, v.producto)),
        propio: num(v.precioVenta),
        costo: num(v.ultimoCosto),
        min: v.stockMinimo,
        act: v.activo && v.producto.activo ? "Sí" : "No",
        baja: v.deletedAt ? formatearFechaHora(v.deletedAt) : "",
      }),
    );

    await hoja(
      wb,
      "Stock",
      [
        SISTEMA,
        { header: "Producto", key: "p", width: 30 },
        { header: "Sabor", key: "v", width: 24 },
        { header: "Depósito", key: "d", width: 16 },
        { header: "Cantidad", key: "n", width: 10 },
      ],
      (c) =>
        prisma.stock.findMany({
          ...pag(c),
          include: { variante: { include: { producto: true } }, deposito: true },
        }),
      (s) => ({
        sis: sistema(s.panelId),
        p: s.variante.producto.nombreCompleto,
        v: saborVisible(s.variante.nombre) ?? "",
        d: s.deposito.nombre,
        n: s.cantidad,
      }),
    );

    await hoja(
      wb,
      "Movimientos",
      [
        SISTEMA,
        { header: "Fecha", key: "f", width: 17 },
        { header: "Tipo", key: "t", width: 22 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Sabor", key: "v", width: 20 },
        { header: "Depósito", key: "d", width: 14 },
        { header: "Cantidad", key: "n", width: 9 },
        { header: "Stock antes", key: "a", width: 10 },
        { header: "Stock después", key: "b", width: 11 },
        { header: "Costo unitario", key: "c", width: 12, numFmt: MONEDA },
        { header: "Motivo", key: "m", width: 40 },
        { header: "Usuario", key: "u", width: 14 },
      ],
      (c) =>
        prisma.movimientoStock.findMany({
          ...pag(c),
          include: {
            variante: { include: { producto: true } },
            deposito: true,
            usuario: { select: { nombre: true } },
          },
        }),
      (m) => ({
        sis: sistema(m.panelId),
        f: formatearFechaHora(m.createdAt),
        t: TIPO_MOVIMIENTO_UI[m.tipo].label,
        p: m.variante.producto.nombreCompleto,
        v: saborVisible(m.variante.nombre) ?? "",
        d: m.deposito.nombre,
        n: m.cantidad,
        a: m.stockAnterior,
        b: m.stockPosterior,
        c: num(m.costoUnitario),
        m: m.motivo,
        u: m.usuario.nombre,
      }),
    );

    await hoja(
      wb,
      "Ventas",
      [
        SISTEMA,
        { header: "ID de venta", key: "n", width: 12 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Estado", key: "e", width: 12 },
        { header: "Tipo", key: "ti", width: 11 },
        { header: "Medio de pago", key: "mp", width: 14 },
        { header: "Estado de pago", key: "ep", width: 13 },
        { header: "Pagado", key: "pa", width: 12, numFmt: MONEDA },
        { header: "Saldo pendiente", key: "sp", width: 13, numFmt: MONEDA },
        { header: "Cliente", key: "c", width: 22 },
        { header: "Teléfono", key: "tel", width: 16 },
        { header: "Vendedor", key: "u", width: 14 },
        { header: "Depósito", key: "d", width: 14 },
        { header: "Subtotal", key: "st", width: 12, numFmt: MONEDA },
        { header: "Descuento", key: "de", width: 12, numFmt: MONEDA },
        { header: "Total", key: "t", width: 12, numFmt: MONEDA },
        { header: "Costo", key: "co", width: 12, numFmt: MONEDA },
        { header: "Ganancia bruta", key: "g", width: 13, numFmt: MONEDA },
        { header: "Motivo de anulación", key: "an", width: 30 },
      ],
      (c) =>
        prisma.venta.findMany({
          ...pag(c),
          include: {
            cliente: { select: { nombre: true, telefono: true } },
            vendedor: { select: { nombre: true } },
            deposito: { select: { nombre: true } },
          },
        }),
      (v) => ({
        sis: sistema(v.panelId),
        n: v.codigo,
        f: formatearFechaHora(v.fecha),
        e: ESTADO_VENTA_UI[v.estado].label,
        ti: ETIQUETA_TIPO_VENTA[v.tipo],
        mp: etiquetaMedioPrincipal(v.medioPago),
        ep: v.estado === "CONFIRMADA" ? ESTADO_PAGO_UI[v.estadoPago].label : "",
        pa: num(v.montoPagado),
        sp: num(v.saldoPendiente),
        c: v.cliente.nombre,
        tel: v.cliente.telefono,
        u: v.vendedor.nombre,
        d: v.deposito.nombre,
        st: num(v.subtotal),
        de: num(v.descuento),
        t: num(v.total),
        co: num(v.costoTotal),
        g: num(v.gananciaBruta),
        an: v.motivoAnulacion ?? "",
      }),
    );

    await hoja(
      wb,
      "Pagos de ventas",
      [
        SISTEMA,
        { header: "ID de venta", key: "n", width: 12 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Medio de pago", key: "mp", width: 14 },
        { header: "Monto", key: "m", width: 12, numFmt: MONEDA },
        { header: "Referencia", key: "r", width: 18 },
        { header: "Cobro de fiado", key: "cp", width: 10 },
        { header: "Registró", key: "u", width: 14 },
        { header: "Anulado", key: "an", width: 17 },
        { header: "Motivo de anulación", key: "mo", width: 30 },
      ],
      (c) =>
        prisma.pagoVenta.findMany({
          ...pag(c),
          include: {
            venta: { select: { codigo: true } },
            usuario: { select: { nombre: true } },
          },
        }),
      (p) => ({
        sis: sistema(p.panelId),
        n: p.venta.codigo,
        f: formatearFechaHora(p.fecha),
        mp: ETIQUETA_MEDIO_PAGO[p.medioPago],
        m: num(p.monto),
        r: p.referencia ?? "",
        cp: p.esCobroPosterior ? "Sí" : "No",
        u: p.usuario.nombre,
        an: p.anuladoAt ? formatearFechaHora(p.anuladoAt) : "",
        mo: p.motivoAnulacion ?? "",
      }),
    );

    await hoja(
      wb,
      "Ítems de ventas",
      [
        SISTEMA,
        { header: "ID de venta", key: "n", width: 12 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Sabor", key: "v", width: 20 },
        { header: "Cantidad", key: "c", width: 9 },
        { header: "Precio de lista", key: "pl", width: 13, numFmt: MONEDA },
        { header: "Precio cobrado", key: "pr", width: 13, numFmt: MONEDA },
        { header: "Precio especial", key: "esp", width: 9 },
        { header: "Costo", key: "co", width: 12, numFmt: MONEDA },
        { header: "Subtotal", key: "s", width: 12, numFmt: MONEDA },
      ],
      (c) =>
        prisma.ventaItem.findMany({
          ...pag(c),
          include: {
            venta: { select: { codigo: true } },
            variante: { select: { nombre: true } },
            producto: { select: { nombreCompleto: true } },
          },
        }),
      (i) => ({
        sis: sistema(i.panelId),
        n: i.venta.codigo,
        p: i.producto.nombreCompleto,
        v: saborVisible(i.variante.nombre) ?? "",
        c: i.cantidad,
        pl: num(i.precioLista),
        pr: num(i.precioUnitario),
        esp: i.esPrecioEspecial ? "Sí" : "No",
        co: num(i.costoUnitario),
        s: num(i.subtotal),
      }),
    );

    await hoja(
      wb,
      "Devoluciones",
      [
        SISTEMA,
        { header: "ID de devolución", key: "n", width: 15 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Estado", key: "e", width: 12 },
        { header: "Cliente", key: "c", width: 22 },
        { header: "Teléfono", key: "tel", width: 16 },
        { header: "Venta", key: "v", width: 12 },
        { header: "Depósito", key: "d", width: 14 },
        { header: "Observación", key: "o", width: 40 },
        { header: "Diferencia calculada", key: "dc", width: 14, numFmt: MONEDA },
        { header: "Diferencia cobrada (+) / devuelta (−)", key: "df", width: 18, numFmt: MONEDA },
        { header: "Medio de la diferencia", key: "dm", width: 14 },
        { header: "Registró", key: "u", width: 14 },
        { header: "Motivo de anulación", key: "an", width: 30 },
      ],
      (c) =>
        prisma.devolucion.findMany({
          ...pag(c),
          include: {
            cliente: { select: { nombre: true, telefono: true } },
            venta: { select: { codigo: true } },
            deposito: { select: { nombre: true } },
            usuario: { select: { nombre: true } },
          },
        }),
      (x) => ({
        sis: sistema(x.panelId),
        n: x.codigo,
        f: formatearFechaHora(x.fecha),
        e: x.estado === "ANULADA" ? "Anulada" : "Registrada",
        c: x.cliente.nombre,
        tel: x.cliente.telefono,
        v: x.venta?.codigo ?? "",
        d: x.deposito.nombre,
        o: x.observacion,
        dc: Number(x.diferenciaCalculada),
        df: Number(x.diferencia),
        dm: x.medioPagoDiferencia ? ETIQUETA_MEDIO_PAGO[x.medioPagoDiferencia] : "",
        u: x.usuario.nombre,
        an: x.motivoAnulacion ?? "",
      }),
    );

    await hoja(
      wb,
      "Ítems de devoluciones",
      [
        SISTEMA,
        { header: "ID de devolución", key: "n", width: 15 },
        { header: "Producto devuelto", key: "p", width: 30 },
        { header: "Sabor devuelto", key: "v", width: 20 },
        { header: "Cantidad", key: "c", width: 9 },
        { header: "Producto entregado", key: "pe", width: 30 },
        { header: "Sabor entregado", key: "ve", width: 20 },
        { header: "Precio devuelto", key: "prd", width: 13, numFmt: MONEDA },
        { header: "Precio entregado", key: "pre", width: 13, numFmt: MONEDA },
      ],
      (c) =>
        prisma.devolucionItem.findMany({
          ...pag(c),
          include: {
            devolucion: { select: { codigo: true } },
            variante: { select: { nombre: true } },
            producto: { select: { nombreCompleto: true } },
            varianteEntregada: { select: { nombre: true } },
            productoEntregado: { select: { nombreCompleto: true } },
          },
        }),
      (i) => ({
        sis: sistema(i.panelId),
        n: i.devolucion.codigo,
        p: i.producto.nombreCompleto,
        v: saborVisible(i.variante.nombre) ?? "",
        c: i.cantidad,
        pe: i.productoEntregado.nombreCompleto,
        ve: saborVisible(i.varianteEntregada.nombre) ?? "",
        prd: i.precioDevuelto === null ? "" : Number(i.precioDevuelto),
        pre: i.precioEntregado === null ? "" : Number(i.precioEntregado),
      }),
    );

    await hoja(
      wb,
      "Compras",
      [
        SISTEMA,
        { header: "ID de compra", key: "n", width: 14 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Estado", key: "e", width: 11 },
        { header: "Proveedor", key: "p", width: 26 },
        { header: "Depósito", key: "d", width: 14 },
        { header: "Total", key: "t", width: 13, numFmt: MONEDA },
      ],
      (c) => prisma.compra.findMany({ ...pag(c), include: { proveedor: true, deposito: true } }),
      (x) => ({
        sis: sistema(x.panelId),
        n: formatearIdCompra(sistemas.get(x.panelId)?.slug ?? "", x.numero),
        f: formatearFechaHora(x.fecha),
        e: x.estado,
        p: x.proveedor ? `${x.proveedor.nombreTienda} (${x.proveedor.nombre})` : "",
        d: x.deposito.nombre,
        t: num(x.total),
      }),
    );

    await hoja(
      wb,
      "Ítems de compras",
      [
        SISTEMA,
        { header: "ID de compra", key: "n", width: 14 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Sabor", key: "v", width: 20 },
        { header: "Cantidad", key: "c", width: 9 },
        { header: "Costo unitario", key: "co", width: 12, numFmt: MONEDA },
        { header: "Subtotal", key: "s", width: 12, numFmt: MONEDA },
      ],
      (c) =>
        prisma.compraItem.findMany({
          ...pag(c),
          include: {
            compra: { select: { numero: true } },
            variante: { include: { producto: true } },
          },
        }),
      (i) => ({
        sis: sistema(i.panelId),
        n: formatearIdCompra(sistemas.get(i.panelId)?.slug ?? "", i.compra.numero),
        p: i.variante.producto.nombreCompleto,
        v: saborVisible(i.variante.nombre) ?? "",
        c: i.cantidad,
        co: num(i.costoUnitario),
        s: num(i.subtotal),
      }),
    );

    await hoja(
      wb,
      "Cotizaciones",
      [
        SISTEMA,
        { header: "Código", key: "n", width: 14 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Válida hasta", key: "vh", width: 17 },
        { header: "Tipo", key: "ti", width: 11 },
        { header: "Estado", key: "e", width: 14 },
        { header: "Cliente", key: "c", width: 22 },
        { header: "Teléfono", key: "tel", width: 16 },
        { header: "Vendedor", key: "u", width: 14 },
        { header: "Subtotal", key: "st", width: 12, numFmt: MONEDA },
        { header: "Descuento", key: "de", width: 12, numFmt: MONEDA },
        { header: "Total", key: "t", width: 12, numFmt: MONEDA },
        { header: "Venta", key: "v", width: 12 },
        { header: "Motivo de rechazo", key: "mr", width: 26 },
        { header: "Notas", key: "no", width: 30 },
      ],
      (c) =>
        prisma.cotizacion.findMany({
          ...pag(c),
          include: {
            cliente: { select: { nombre: true, telefono: true } },
            vendedor: { select: { nombre: true } },
            venta: { select: { codigo: true } },
          },
        }),
      (x) => ({
        sis: sistema(x.panelId),
        n: x.codigo,
        f: formatearFechaHora(x.fecha),
        vh: formatearFechaHora(x.validaHasta),
        ti: ETIQUETA_TIPO_COTIZACION[x.tipo],
        e: ESTADO_COTIZACION_UI[x.estado].label,
        c: x.cliente?.nombre ?? x.clienteNombre ?? "",
        tel: x.cliente?.telefono ?? x.clienteTelefono ?? "",
        u: x.vendedor.nombre,
        st: num(x.subtotal),
        de: num(x.descuento),
        t: num(x.total),
        v: x.venta?.codigo ?? "",
        mr: x.motivoRechazo ?? "",
        no: x.notas ?? "",
      }),
    );

    await hoja(
      wb,
      "Ítems de cotizaciones",
      [
        SISTEMA,
        { header: "Código", key: "n", width: 14 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Sabor", key: "v", width: 20 },
        { header: "Cantidad", key: "c", width: 9 },
        { header: "Precio de lista", key: "pl", width: 13, numFmt: MONEDA },
        { header: "Precio cotizado", key: "pr", width: 13, numFmt: MONEDA },
        { header: "Escalón", key: "es", width: 9 },
        { header: "Precio manual", key: "pm", width: 9 },
        { header: "Subtotal", key: "s", width: 12, numFmt: MONEDA },
      ],
      (c) =>
        prisma.cotizacionItem.findMany({
          ...pag(c),
          include: {
            cotizacion: { select: { codigo: true } },
            variante: { select: { nombre: true } },
            producto: { select: { nombreCompleto: true } },
          },
        }),
      (i) => ({
        sis: sistema(i.panelId),
        n: i.cotizacion.codigo,
        p: i.producto.nombreCompleto,
        v: saborVisible(i.variante.nombre) ?? "",
        c: i.cantidad,
        pl: num(i.precioLista),
        pr: num(i.precioUnitario),
        es: i.escalonAplicado ?? "",
        pm: i.esPrecioManual ? "Sí" : "No",
        s: num(i.subtotal),
      }),
    );

    await hoja(
      wb,
      "Clientes",
      [
        SISTEMA,
        { header: "Nombre", key: "n", width: 24 },
        { header: "Teléfono", key: "t", width: 16 },
        { header: "Notas", key: "no", width: 40 },
        { header: "Saldo deudor", key: "sd", width: 13, numFmt: MONEDA },
        { header: "Activo", key: "act", width: 8 },
        { header: "Baja", key: "baja", width: 16 },
      ],
      (c) => prisma.cliente.findMany(pag(c)),
      (x) => ({
        sis: sistema(x.panelId),
        n: x.nombre,
        t: x.telefono,
        no: x.notas,
        sd: num(x.saldoDeudor),
        act: x.activo ? "Sí" : "No",
        baja: x.deletedAt ? formatearFechaHora(x.deletedAt) : "",
      }),
    );

    await hoja(
      wb,
      "Proveedores",
      [
        SISTEMA,
        { header: "Tienda", key: "tie", width: 24 },
        { header: "Contacto", key: "n", width: 22 },
        { header: "Teléfono", key: "t", width: 16 },
        { header: "Notas", key: "no", width: 30 },
        { header: "Activo", key: "act", width: 8 },
        { header: "Baja", key: "baja", width: 16 },
      ],
      (c) => prisma.proveedor.findMany(pag(c)),
      (x) => ({
        sis: sistema(x.panelId),
        tie: x.nombreTienda,
        n: x.nombre,
        t: x.telefono,
        no: x.notas,
        act: x.activo ? "Sí" : "No",
        baja: x.deletedAt ? formatearFechaHora(x.deletedAt) : "",
      }),
    );

    await hoja(
      wb,
      "Precios de proveedores",
      [
        SISTEMA,
        { header: "Tienda", key: "tie", width: 24 },
        { header: "Contacto", key: "con", width: 20 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Precio", key: "pr", width: 13, numFmt: "#,##0.00" },
        { header: "Moneda", key: "mo", width: 8 },
        { header: "Actualizado", key: "f", width: 17 },
        { header: "Por", key: "u", width: 14 },
      ],
      (c) =>
        prisma.proveedorProducto.findMany({
          ...pag(c),
          include: {
            proveedor: { select: { nombre: true, nombreTienda: true } },
            producto: { select: { nombreCompleto: true } },
            usuario: { select: { nombre: true } },
          },
        }),
      (x) => ({
        sis: sistema(x.panelId),
        tie: x.proveedor.nombreTienda,
        con: x.proveedor.nombre,
        p: x.producto.nombreCompleto,
        pr: num(x.precio),
        mo: x.moneda,
        f: formatearFechaHora(x.actualizadoAt),
        u: x.usuario.nombre,
      }),
    );

    await wb.commit();
  })().catch((e: unknown) => paso.destroy(e as Error));
  return Readable.toWeb(paso) as ReadableStream<Uint8Array>;
}
