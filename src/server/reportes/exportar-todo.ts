import "server-only";

import { PassThrough, Readable } from "node:stream";

import ExcelJS from "exceljs";

import { prisma } from "@/lib/db";
import { formatearFechaHora } from "@/lib/utils";

/**
 * Exportación COMPLETA de los datos del negocio a Excel (es su negocio: se los
 * pueden llevar cuando quieran). Streaming: cada hoja se escribe de a 1.000
 * filas (paginado por id) y se libera; no se arma el libro entero en memoria.
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
      "Hojas: Productos, Stock, Movimientos, Ventas, Ítems de ventas, Pagos, Compras, Ítems de compras, Clientes, Proveedores, Gastos, Cajas.",
    ]);
    info.commit();

    await hoja(
      wb,
      "Productos",
      [
        { header: "Producto", key: "p", width: 30 },
        { header: "Sabor / variante", key: "v", width: 24 },
        { header: "SKU", key: "sku", width: 14 },
        { header: "Código de barras", key: "cb", width: 16 },
        { header: "Códigos alternativos", key: "alt", width: 22 },
        { header: "Categoría", key: "c", width: 14 },
        { header: "Marca", key: "m", width: 14 },
        { header: "Costo", key: "costo", width: 12, numFmt: MONEDA },
        { header: "Precio", key: "precio", width: 12, numFmt: MONEDA },
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
        p: v.producto.nombre,
        v: v.nombre,
        sku: v.sku,
        cb: v.codigoBarras,
        alt: v.codigosAlternativos.map((a) => a.codigo).join(", "),
        c: v.producto.categoria.nombre,
        m: v.producto.marca?.nombre ?? "",
        costo: num(v.precioCosto),
        precio: num(v.precioVenta),
        min: v.stockMinimo,
        act: v.activo && v.producto.activo ? "Sí" : "No",
        baja: v.deletedAt ? formatearFechaHora(v.deletedAt) : "",
      }),
    );

    await hoja(
      wb,
      "Stock",
      [
        { header: "Producto", key: "p", width: 30 },
        { header: "Variante", key: "v", width: 24 },
        { header: "Depósito", key: "d", width: 16 },
        { header: "Cantidad", key: "n", width: 10 },
      ],
      (c) =>
        prisma.stock.findMany({
          ...pag(c),
          include: { variante: { include: { producto: true } }, deposito: true },
        }),
      (s) => ({
        p: s.variante.producto.nombre,
        v: s.variante.nombre,
        d: s.deposito.nombre,
        n: s.cantidad,
      }),
    );

    await hoja(
      wb,
      "Movimientos",
      [
        { header: "Fecha", key: "f", width: 17 },
        { header: "Tipo", key: "t", width: 22 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Variante", key: "v", width: 20 },
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
        f: formatearFechaHora(m.createdAt),
        t: m.tipo,
        p: m.variante.producto.nombre,
        v: m.variante.nombre,
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
        { header: "N.º", key: "n", width: 8 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Estado", key: "e", width: 12 },
        { header: "Cliente", key: "c", width: 22 },
        { header: "Vendedor", key: "u", width: 14 },
        { header: "Depósito", key: "d", width: 14 },
        { header: "Total", key: "t", width: 12, numFmt: MONEDA },
        { header: "Costo", key: "co", width: 12, numFmt: MONEDA },
        { header: "Ganancia bruta", key: "g", width: 13, numFmt: MONEDA },
        { header: "Pagado", key: "p", width: 12, numFmt: MONEDA },
        { header: "Saldo", key: "s", width: 12, numFmt: MONEDA },
      ],
      (c) =>
        prisma.venta.findMany({
          ...pag(c),
          include: { cliente: true, usuario: { select: { nombre: true } }, deposito: true },
        }),
      (v) => ({
        n: v.numero,
        f: formatearFechaHora(v.fecha),
        e: v.estado,
        c: v.cliente ? [v.cliente.nombre, v.cliente.apellido].filter(Boolean).join(" ") : "",
        u: v.usuario.nombre,
        d: v.deposito.nombre,
        t: num(v.total),
        co: num(v.costoTotal),
        g: num(v.gananciaBruta),
        p: num(v.montoPagado),
        s: num(v.saldoPendiente),
      }),
    );

    await hoja(
      wb,
      "Ítems de ventas",
      [
        { header: "Venta", key: "n", width: 8 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Variante", key: "v", width: 20 },
        { header: "Cantidad", key: "c", width: 9 },
        { header: "Devueltas", key: "d", width: 9 },
        { header: "Precio", key: "pr", width: 12, numFmt: MONEDA },
        { header: "Costo", key: "co", width: 12, numFmt: MONEDA },
        { header: "Subtotal", key: "s", width: 12, numFmt: MONEDA },
      ],
      (c) =>
        prisma.ventaItem.findMany({
          ...pag(c),
          include: {
            venta: { select: { numero: true } },
            variante: { include: { producto: true } },
          },
        }),
      (i) => ({
        n: i.venta.numero,
        p: i.variante.producto.nombre,
        v: i.variante.nombre,
        c: i.cantidad,
        d: i.cantidadDevuelta,
        pr: num(i.precioUnitario),
        co: num(i.costoUnitario),
        s: num(i.subtotal),
      }),
    );

    await hoja(
      wb,
      "Pagos",
      [
        { header: "Venta", key: "n", width: 8 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Medio", key: "m", width: 16 },
        { header: "Monto", key: "t", width: 12, numFmt: MONEDA },
        { header: "Referencia", key: "r", width: 18 },
        { header: "Anulado", key: "a", width: 9 },
      ],
      (c) =>
        prisma.pagoVenta.findMany({ ...pag(c), include: { venta: { select: { numero: true } } } }),
      (p) => ({
        n: p.venta.numero,
        f: formatearFechaHora(p.fecha),
        m: p.medioPago,
        t: num(p.monto),
        r: p.referencia,
        a: p.anulado ? "Sí" : "No",
      }),
    );

    await hoja(
      wb,
      "Compras",
      [
        { header: "N.º", key: "n", width: 8 },
        { header: "Fecha", key: "f", width: 17 },
        { header: "Estado", key: "e", width: 11 },
        { header: "Proveedor", key: "p", width: 26 },
        { header: "Depósito", key: "d", width: 14 },
        { header: "Total", key: "t", width: 13, numFmt: MONEDA },
      ],
      (c) => prisma.compra.findMany({ ...pag(c), include: { proveedor: true, deposito: true } }),
      (x) => ({
        n: x.numero,
        f: formatearFechaHora(x.fecha),
        e: x.estado,
        p: x.proveedor?.nombre ?? "",
        d: x.deposito.nombre,
        t: num(x.total),
      }),
    );

    await hoja(
      wb,
      "Ítems de compras",
      [
        { header: "Compra", key: "n", width: 8 },
        { header: "Producto", key: "p", width: 30 },
        { header: "Variante", key: "v", width: 20 },
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
        n: i.compra.numero,
        p: i.variante.producto.nombre,
        v: i.variante.nombre,
        c: i.cantidad,
        co: num(i.costoUnitario),
        s: num(i.subtotal),
      }),
    );

    await hoja(
      wb,
      "Clientes",
      [
        { header: "Nombre", key: "n", width: 18 },
        { header: "Apellido", key: "a", width: 16 },
        { header: "Documento", key: "d", width: 14 },
        { header: "Teléfono", key: "t", width: 16 },
        { header: "Email", key: "e", width: 24 },
        { header: "Límite de crédito", key: "l", width: 14, numFmt: MONEDA },
        { header: "Saldo deudor", key: "s", width: 13, numFmt: MONEDA },
        { header: "Saldo a favor", key: "f", width: 13, numFmt: MONEDA },
      ],
      (c) => prisma.cliente.findMany(pag(c)),
      (x) => ({
        n: x.nombre,
        a: x.apellido,
        d: x.documento,
        t: x.telefono,
        e: x.email,
        l: num(x.limiteCredito),
        s: num(x.saldoDeudor),
        f: num(x.saldoAFavor),
      }),
    );

    await hoja(
      wb,
      "Proveedores",
      [
        { header: "Nombre", key: "n", width: 26 },
        { header: "CUIT", key: "c", width: 14 },
        { header: "Teléfono", key: "t", width: 16 },
        { header: "Email", key: "e", width: 24 },
      ],
      (c) => prisma.proveedor.findMany(pag(c)),
      (x) => ({ n: x.nombre, c: x.cuit, t: x.telefono, e: x.email }),
    );

    await hoja(
      wb,
      "Gastos",
      [
        { header: "Fecha", key: "f", width: 17 },
        { header: "Categoría", key: "c", width: 14 },
        { header: "Descripción", key: "d", width: 36 },
        { header: "Medio", key: "m", width: 14 },
        { header: "Monto", key: "t", width: 12, numFmt: MONEDA },
        { header: "Depósito", key: "dep", width: 14 },
        { header: "Borrado", key: "b", width: 9 },
      ],
      (c) => prisma.gasto.findMany({ ...pag(c), include: { categoria: true, deposito: true } }),
      (g) => ({
        f: formatearFechaHora(g.fecha),
        c: g.categoria.nombre,
        d: g.descripcion,
        m: g.medioPago,
        t: num(g.monto),
        dep: g.deposito?.nombre ?? "General",
        b: g.deletedAt ? "Sí" : "No",
      }),
    );

    await hoja(
      wb,
      "Cajas",
      [
        { header: "Depósito", key: "d", width: 14 },
        { header: "Apertura", key: "a", width: 17 },
        { header: "Cierre", key: "c", width: 17 },
        { header: "Inicial", key: "i", width: 12, numFmt: MONEDA },
        { header: "Esperado", key: "e", width: 12, numFmt: MONEDA },
        { header: "Contado", key: "k", width: 12, numFmt: MONEDA },
        { header: "Diferencia", key: "x", width: 12, numFmt: MONEDA },
        { header: "Observaciones", key: "o", width: 30 },
      ],
      (c) => prisma.caja.findMany({ ...pag(c), include: { deposito: true } }),
      (x) => ({
        d: x.deposito.nombre,
        a: formatearFechaHora(x.abiertaAt),
        c: x.cerradaAt ? formatearFechaHora(x.cerradaAt) : "Abierta",
        i: num(x.montoInicial),
        e: num(x.montoEsperado),
        k: num(x.montoContado),
        x: num(x.diferencia),
        o: x.observaciones,
      }),
    );

    await wb.commit();
  })().catch((e: unknown) => paso.destroy(e as Error));
  return Readable.toWeb(paso) as ReadableStream<Uint8Array>;
}
