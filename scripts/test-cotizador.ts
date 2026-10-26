/**
 * Cotizador a nivel servicios + DB (panel Vapes): escalones mezclando sabores,
 * defaults del panel, escalón SIEMPRE por producto (dos productos de 30 u. no
 * suman 60), escalones en dólares con el blue venta y su snapshot (la
 * cotización vigente no cambia sus pesos si cambia el blue; vencida se
 * recalcula con el de hoy), conversión en venta de una mayorista
 * cuyo precio de lista subió (sin permiso de editar), falta de stock (todo o
 * nada), permisos de Trinidad (precio manual prohibido, vendedorId), Cosmetic
 * sin los defaults de Vapes (COS-Q-000001) y aislamiento entre paneles.
 * A4: «Aceptada ✓» desde la lista (venta pendiente de pago sin FIADOS, stock,
 * vencida) y «Marcar pagada» (cobro parcial/total con VENTAS editar).
 * Uso: npx tsx --conditions=react-server scripts/test-cotizador.ts — pensado
 * para una DB recién sembrada (crea datos).
 */
import { EstadoCotizacion, Prisma, RolUsuario, TipoVenta } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "../src/server/errors";
import { guardarOverride, quitarOverride } from "../src/server/services/cambio.service";
import {
  guardarConfigCotizacion,
  obtenerConfigCotizacion,
} from "../src/server/services/configuracion.service";
import {
  aceptarYVender,
  actualizarCotizacion,
  convertirEnVenta,
  crearCotizacion,
  duplicar,
  pdfCotizacion,
  listar,
  marcarAceptada,
  marcarEnviada,
  obtener,
  prepararConversion,
  textoWhatsApp,
} from "../src/server/services/cotizacion.service";
import {
  guardarEscalones,
  guardarEscalonesDefault,
  tablaPreciosProducto,
} from "../src/server/services/escalon.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { cobrarVenta, puedeFiados } from "../src/server/services/fiado.service";
import { calcularPrecios } from "../src/server/services/precio.service";

const VAPES = "pnl_vapes";
const COSMETIC = "pnl_cosmetic";
const db = dbPara(VAPES);

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
async function error(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const $ = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n).toFixed(2);

async function crearProducto(ctx: Ctx, nombre: string, sabores: string[], suf: string) {
  return transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: ctx.panelId, nombre: "Test Cotizador" } },
      update: {},
      create: { nombre: "Test Cotizador" },
    });
    return tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `${nombre} ${suf}`,
        especificacion: "5000",
        precioVenta: "10000.00",
        variantes: {
          create: sabores.map((s, i) => ({
            nombre: s,
            sku: `TQ-${nombre.slice(0, 2).toUpperCase()}${i}-${suf}-${ctx.panelId.slice(4, 7)}`,
            ultimoCosto: "5000.00",
          })),
        },
      },
      include: { variantes: { orderBy: { nombre: "asc" } } },
    });
  });
}

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const trinidad = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-cotizador" };
  const ctx: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const ctxTri: Ctx = { panelId: VAPES, usuarioId: trinidad.id, meta };
  const ctxCos: Ctx = { panelId: COSMETIC, usuarioId: owner.id, meta };
  const DUENO = { puedeEditar: true };
  const SIN_EDITAR = { puedeEditar: false };

  const g1 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const suf = String(Date.now()).slice(-7);
  const elf = await crearProducto(ctx, "Elf", ["Frutilla", "Mango"], suf);
  const [frutilla, mango] = elf.variantes as [
    (typeof elf.variantes)[number],
    (typeof elf.variantes)[number],
  ];
  const otro = await crearProducto(ctx, "Otro", ["Uva"], suf);
  const uva = otro.variantes[0]!;
  for (const v of [frutilla, mango, uva]) {
    await registrarAjuste(ctx, {
      depositoId: g1.id,
      varianteId: v.id,
      cantidadReal: 100,
      motivo: "Preparación test-cotizador",
    });
  }
  await guardarEscalones(
    ctx,
    elf.id,
    [
      { cantidadMinima: 10, precioUnitario: "9000", activo: true },
      { cantidadMinima: 50, precioUnitario: "8200", activo: true },
      { cantidadMinima: 100, precioUnitario: "7500", activo: true },
    ],
    "ARS",
  );
  await guardarEscalonesDefault(ctx, [
    { cantidadMinima: 10, porcentajeDescuento: "5", activo: true },
    { cantidadMinima: 50, porcentajeDescuento: "12", activo: true },
  ]);
  const configOriginal = await obtenerConfigCotizacion(ctx);
  // Blue venta fijo para el test (override manual; se quita al final).
  const actor = { id: owner.id, meta };
  const overrideAntes = await prisma.configuracionGlobal.findUnique({
    where: { clave: "cambio.overrideUSD_BLUE" },
  });
  await guardarOverride("USD_BLUE", 1300, actor);

  // ---------------------------------------------------------------------------
  console.log("\n1) Escalones: validación del set");
  const creciente = await error(() =>
    guardarEscalones(
      ctx,
      elf.id,
      [
        { cantidadMinima: 10, precioUnitario: "9000", activo: true },
        { cantidadMinima: 50, precioUnitario: "9500", activo: true },
      ],
      "ARS",
    ),
  );
  check(
    creciente instanceof ValidationError,
    `precio que sube con la cantidad → «${msg(creciente)}»`,
  );
  const tabla = await tablaPreciosProducto(ctx, otro.id);
  check(
    tabla.origen === "DEFAULT" &&
      tabla.escalones.map((e) => e.precioUnitario).join() === "9500.00,8800.00",
    "tabla de precios de un producto sin escalones: defaults 9500 / 8800",
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) Mayorista mezclando sabores: 20 Mango + 35 Frutilla");
  const mezcla = await calcularPrecios(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: mango.id, cantidad: 20 },
        { varianteId: frutilla.id, cantidad: 35 },
      ],
    },
    DUENO,
  );
  check(
    mezcla.items.every((i) => i.escalonAplicado === 50 && i.precioUnitario === "8200.00"),
    "escalón 50 para ambos sabores a $8.200",
  );
  check(
    mezcla.items.every(
      (i) => i.proximoEscalon?.faltan === 45 && i.proximoEscalon.precioUnitario === "7500.00",
    ),
    "próximo escalón: faltan 45 para $7.500",
  );
  check(
    mezcla.items.every((i) => i.stockTotal === 100),
    "stockTotal de cada sabor = 100",
  );
  check(mezcla.subtotal === "451000.00", `subtotal ${mezcla.subtotal}`);

  // ---------------------------------------------------------------------------
  console.log("\n3) Defaults del panel: lista $10.000, 50 u. → $8.800");
  const def = await calcularPrecios(
    ctx,
    { tipo: "MAYORISTA", items: [{ varianteId: uva.id, cantidad: 50 }] },
    DUENO,
  );
  check(
    def.items[0]!.precioUnitario === "8800.00" && def.items[0]!.escalonAplicado === 50,
    `precio ${def.items[0]!.precioUnitario} (escalón ${def.items[0]!.escalonAplicado})`,
  );
  const unit = await calcularPrecios(
    ctx,
    { tipo: "UNITARIA", items: [{ varianteId: uva.id, cantidad: 50 }] },
    DUENO,
  );
  check(unit.items[0]!.precioUnitario === "10000.00", "unitaria: siempre precio de lista");

  // ---------------------------------------------------------------------------
  console.log("\n4) Escalón SIEMPRE por producto: 30 Elf + 30 Otro (escalón 50 en los dos)");
  await guardarEscalones(
    ctx,
    otro.id,
    [{ cantidadMinima: 50, precioUnitario: "7000", activo: true }],
    "ARS",
  );
  const dos = await calcularPrecios(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: mango.id, cantidad: 30 },
        { varianteId: uva.id, cantidad: 30 },
      ],
    },
    DUENO,
  );
  check(
    dos.items.every((i) => i.escalonAplicado !== 50),
    "60 unidades en la cotización pero 30 de cada producto: ninguno al escalón 50",
  );
  check(
    dos.items[0]!.precioUnitario === "9000.00" && dos.items[1]!.precioUnitario === "10000.00",
    `Elf 30 u. → escalón 10 ($9.000); Otro 30 u. → lista ($10.000)`,
  );
  check(
    dos.resumenEscalones.map((r) => r.unidades).join() === "30,30",
    "resumen de escalones por producto: 30 y 30",
  );
  await guardarEscalones(ctx, otro.id, [], "ARS");

  // ---------------------------------------------------------------------------
  console.log("\n4b) Escalones en dólares (blue venta $1.300) y snapshot");
  const usd = await crearProducto(ctx, "Dolar", ["Mango", "Frutilla"], suf);
  const [usdFrutilla, usdMango] = usd.variantes as [
    (typeof usd.variantes)[number],
    (typeof usd.variantes)[number],
  ];
  for (const v of [usdFrutilla, usdMango])
    await registrarAjuste(ctx, {
      depositoId: g1.id,
      varianteId: v.id,
      cantidadReal: 100,
      motivo: "Preparación test-cotizador",
    });
  const guardados = await guardarEscalones(ctx, usd.id, [
    { cantidadMinima: 10, precioUnitario: "8", activo: true },
    { cantidadMinima: 50, precioUnitario: "6.5", activo: true },
  ]);
  check(
    guardados.every((e) => e.moneda === "USD"),
    "escalones nuevos en USD por defecto",
  );
  const tablaUsd = await tablaPreciosProducto(ctx, usd.id);
  check(
    tablaUsd.moneda === "USD" &&
      tablaUsd.escalones.map((e) => `${e.precioUnitarioUSD}/${e.precioUnitario}`).join() ===
        "8.00/10400.00,6.50/8450.00",
    "tabla de precios: USD con su equivalente en pesos (8 → $10.400, 6,50 → $8.450)",
  );
  const enUsd = await calcularPrecios(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: usdMango.id, cantidad: 20 },
        { varianteId: usdFrutilla.id, cantidad: 35 },
      ],
    },
    DUENO,
  );
  check(
    enUsd.items.every(
      (i) =>
        i.escalonAplicado === 50 &&
        i.precioUnitarioUSD === "6.50" &&
        i.precioUnitario === "8450.00",
    ),
    "20 Mango + 35 Frutilla → ambos al escalón 50: U$D 6,50 = $8.450",
  );
  check(
    enUsd.tipoCambioBlue?.valor === "1300.00" && enUsd.subtotalUSD === "357.50",
    `blue usado ${enUsd.tipoCambioBlue?.valor} · total U$D ${enUsd.subtotalUSD}`,
  );
  const qUsd = await crearCotizacion(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: usdMango.id, cantidad: 20 },
        { varianteId: usdFrutilla.id, cantidad: 35 },
      ],
      cliente: { nombre: "Mayorista Dólar", telefono: `11${suf}7` },
    },
    DUENO,
  );
  const cUsd = await db.cotizacion.findUniqueOrThrow({
    where: { id: qUsd.id },
    include: { items: true },
  });
  check(
    $(cUsd.tipoCambioBlue!) === "1300.00" &&
      cUsd.tipoCambioObtenidoAt !== null &&
      cUsd.items.every((i) => $(i.precioUnitarioUSD!) === "6.50"),
    "la cotización guarda el snapshot del blue y el precio en USD por ítem",
  );
  // Sube el blue: la cotización vigente conserva sus pesos al editarla.
  await guardarOverride("USD_BLUE", 1540, actor);
  await actualizarCotizacion(
    ctx,
    qUsd.id,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: usdMango.id, cantidad: 25 },
        { varianteId: usdFrutilla.id, cantidad: 35 },
      ],
      cliente: { nombre: "Mayorista Dólar", telefono: `11${suf}7` },
    },
    DUENO,
  );
  const dUsd = await obtener(ctx, qUsd.id);
  check(
    dUsd.tipoCambioBlue?.valor === "1300.00" &&
      dUsd.items.every((i) => i.precioUnitario === "8450.00"),
    "vigente: editada con el blue en $1.540 sigue a $8.450 (blue del snapshot)",
  );
  const waUsd = await textoWhatsApp(ctx, qUsd.id);
  waUsd.texto = waUsd.texto.replace(/\s/g, " ");
  check(
    waUsd.texto.includes("U$D 6,50 · $ 8.450") &&
      waUsd.texto.includes("Precios en dólares convertidos a blue venta $ 1.300 del"),
    "WhatsApp con USD y pesos y la leyenda del blue usado",
  );
  const pdfUsd = await pdfCotizacion(ctx, qUsd.id);
  check(Buffer.from(pdfUsd.pdf).subarray(0, 5).toString() === "%PDF-", "PDF mayorista en USD");
  // Vencida: al convertir se recalcula con el blue de hoy y se muestra el cambio.
  await db.cotizacion.update({
    where: { id: qUsd.id },
    data: {
      fecha: new Date(Date.now() - 20 * 86400000),
      validaHasta: new Date(Date.now() - 86400000),
    },
  });
  const prepUsd = await prepararConversion(ctx, qUsd.id);
  check(
    prepUsd.vencida &&
      prepUsd.blue?.cotizado?.valor === "1300.00" &&
      prepUsd.blue?.hoy?.valor === "1540.00" &&
      prepUsd.cambios.every((c) => c.antes === "8450.00" && c.despues === "10010.00"),
    "vencida: prepararConversion muestra blue $1.300 → $1.540 y $8.450 → $10.010",
  );
  const vUsd = await convertirEnVenta(ctx, qUsd.id, {
    depositoId: g1.id,
    pagos: [{ medioPago: "EFECTIVO", monto: 60 * 10010 }],
    recalcular: true,
  });
  check(
    vUsd.items.every((i) => i.precioUnitario === "10010.00"),
    "convertida vencida con recalcular: precios con el blue de hoy ($10.010)",
  );
  // Precio manual en USD.
  const manualUsd = await calcularPrecios(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [{ varianteId: usdMango.id, cantidad: 5, precioManual: 7.25, monedaManual: "USD" }],
    },
    DUENO,
  );
  check(
    manualUsd.items[0]!.precioUnitarioUSD === "7.25" &&
      manualUsd.items[0]!.precioUnitario === "11170.00",
    "precio manual U$D 7,25 con blue $1.540 → $11.170",
  );
  await guardarOverride("USD_BLUE", 1300, actor);

  // ---------------------------------------------------------------------------
  console.log("\n5) Crear, estados, duplicar y WhatsApp");
  const q1 = await crearCotizacion(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: mango.id, cantidad: 20 },
        { varianteId: frutilla.id, cantidad: 35 },
      ],
      cliente: { nombre: "Mayorista Test", telefono: `11${suf}1` },
      notas: "Retira el viernes",
    },
    SIN_EDITAR,
  );
  check(/^VAP-Q-\d{6}$/.test(q1.codigo), `código ${q1.codigo}`);
  const d1 = await obtener(ctx, q1.id);
  check(
    d1.estado === EstadoCotizacion.BORRADOR && d1.total === "451000.00",
    `BORRADOR · total ${d1.total}`,
  );
  const wa = await textoWhatsApp(ctx, q1.id);
  check(
    wa.texto.includes(q1.codigo) && wa.telefono === `+5411${suf}1`,
    "texto de WhatsApp con código y teléfono",
  );
  const pdf = await pdfCotizacion(ctx, q1.id);
  const pdf2 = await pdfCotizacion(ctx, q1.id);
  check(
    Buffer.from(pdf.pdf).subarray(0, 5).toString() === "%PDF-" &&
      pdf.archivo === `cotizacion-${q1.codigo}.pdf` &&
      Buffer.from(pdf2.pdf).equals(Buffer.from(pdf.pdf)),
    "PDF generado en el momento y servido del caché la segunda vez",
  );
  await marcarEnviada(ctx, q1.id);
  await marcarAceptada(ctx, q1.id);
  check((await obtener(ctx, q1.id)).estado === EstadoCotizacion.ACEPTADA, "ENVIADA → ACEPTADA");
  const dup = await duplicar(ctx, q1.id);
  check(
    dup.codigo !== q1.codigo && (await obtener(ctx, dup.id)).estado === "BORRADOR",
    `duplicada: ${dup.codigo}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n6) Convertir una mayorista cuyo precio de lista subió (Trinidad, sin editar)");
  await db.producto.update({ where: { id: elf.id }, data: { precioVenta: "12000.00" } });
  const g2 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: false } });
  // Un pago por el total cotizado.
  const pagoTotal = async (id: string, medioPago: "EFECTIVO" | "TRANSFERENCIA" = "EFECTIVO") => [
    { medioPago, monto: Number((await obtener(ctx, id)).total) },
  ];
  const pagosQ1 = await pagoTotal(q1.id);
  const sinStock = await error(() =>
    convertirEnVenta(ctxTri, q1.id, { depositoId: g2.id, pagos: pagosQ1 }),
  );
  const tras = await obtener(ctx, q1.id);
  check(
    sinStock instanceof DomainError && tras.estado === EstadoCotizacion.ACEPTADA && !tras.venta,
    `sin stock en el otro galpón → falla entera y la cotización queda igual («${msg(sinStock).slice(0, 60)}…»)`,
  );
  const clientesAntes = await db.cliente.count();
  const venta = await convertirEnVenta(ctxTri, q1.id, { depositoId: g1.id, pagos: pagosQ1 });
  const v = await db.venta.findUniqueOrThrow({ where: { id: venta.id }, include: { items: true } });
  check(v.tipo === TipoVenta.MAYORISTA, "venta MAYORISTA");
  check(
    v.items.every(
      (i) =>
        $(i.precioUnitario) === "8200.00" && $(i.precioLista) === "12000.00" && i.esPrecioEspecial,
    ),
    "respeta el precio cotizado ($8.200) con esPrecioEspecial (lista hoy $12.000)",
  );
  check(
    v.cotizacionId === q1.id && v.vendedorId === trinidad.id,
    "venta vinculada a la cotización, vendedora Trinidad",
  );
  check(
    (await db.cliente.count()) === clientesAntes + 1,
    "cliente creado con el nombre y teléfono de la cotización",
  );
  const conv = await obtener(ctx, q1.id);
  check(
    conv.estado === EstadoCotizacion.CONVERTIDA && conv.venta?.id === venta.id,
    `cotización CONVERTIDA → ${conv.venta?.codigo}`,
  );
  const otraVez = await error(() =>
    convertirEnVenta(ctx, q1.id, { depositoId: g1.id, pagos: pagosQ1 }),
  );
  check(otraVez instanceof DomainError, "no se convierte dos veces");
  const tocar = await error(() =>
    db.cotizacion.update({ where: { id: q1.id }, data: { notas: "x" } }),
  );
  check(tocar !== null, "la DB no deja modificar una convertida");

  // Cliente por teléfono existente + vencida recalculada.
  const q2 = await crearCotizacion(
    ctx,
    {
      tipo: "UNITARIA",
      items: [{ varianteId: uva.id, cantidad: 2 }],
      cliente: { nombre: "Otro nombre", telefono: `11${suf}1` },
    },
    SIN_EDITAR,
  );
  const d2 = await obtener(ctx, q2.id);
  check(
    d2.cliente?.id === conv.cliente?.id,
    "teléfono existente → queda a nombre del cliente existente",
  );
  await db.cotizacion.update({
    where: { id: q2.id },
    data: {
      fecha: new Date(Date.now() - 20 * 86400000),
      validaHasta: new Date(Date.now() - 86400000),
    },
  });
  await db.producto.update({ where: { id: otro.id }, data: { precioVenta: "11000.00" } });
  await listar(ctx, {});
  const prep = await prepararConversion(ctx, q2.id);
  check(
    prep.vencida && prep.cambios.length === 1 && prep.cambios[0]!.despues === "11000.00",
    "vencida: prepararConversion informa el cambio 10000 → 11000",
  );
  // Recalculada: 2 × $11.000 de hoy.
  const v2 = await convertirEnVenta(ctx, q2.id, {
    depositoId: g1.id,
    pagos: [{ medioPago: "TRANSFERENCIA", monto: 22000 }],
    recalcular: true,
  });
  check(
    v2.items[0]!.precioUnitario === "11000.00" &&
      !v2.items[0]!.esPrecioEspecial &&
      v2.tipo === "UNITARIA",
    "vencida con recalcular: precios de hoy, sin precio especial, UNITARIA",
  );

  // ---------------------------------------------------------------------------
  console.log("\n7) Trinidad: precio manual prohibido y vendedorId");
  const manual = await error(() =>
    crearCotizacion(
      ctxTri,
      {
        tipo: "MAYORISTA",
        items: [{ varianteId: uva.id, cantidad: 5, precioManual: 1 }],
        cliente: null,
      },
      SIN_EDITAR,
    ),
  );
  check(manual instanceof ForbiddenError, `precioManual sin editar → «${msg(manual)}»`);
  const desc = await error(() =>
    crearCotizacion(
      ctxTri,
      {
        tipo: "UNITARIA",
        items: [{ varianteId: uva.id, cantidad: 1 }],
        cliente: null,
        descuento: 100,
      },
      SIN_EDITAR,
    ),
  );
  check(desc instanceof ForbiddenError, "descuento sin editar → Forbidden");
  const q3 = await crearCotizacion(
    ctxTri,
    { tipo: "UNITARIA", items: [{ varianteId: uva.id, cantidad: 1 }], cliente: null },
    SIN_EDITAR,
  );
  const c3 = await db.cotizacion.findUniqueOrThrow({ where: { id: q3.id } });
  check(c3.vendedorId === trinidad.id, "vendedorId = Trinidad");
  const conManual = await crearCotizacion(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [{ varianteId: uva.id, cantidad: 5, precioManual: 7777 }],
      cliente: null,
    },
    DUENO,
  );
  const dm = await obtener(ctx, conManual.id);
  check(
    dm.items[0]!.esPrecioManual && dm.items[0]!.precioUnitario === "7777.00",
    "un dueño sí puede poner precio manual",
  );

  // ---------------------------------------------------------------------------
  console.log("\n7b) «Aceptada ✓» desde la lista y «Marcar pagada» (Trinidad, sin FIADOS)");
  check(!(await puedeFiados(ctxTri, "crear")), "Trinidad no tiene FIADOS crear");
  const telA = `11${suf}9`;
  const qa = await crearCotizacion(
    ctxTri,
    {
      tipo: "UNITARIA",
      items: [{ varianteId: uva.id, cantidad: 2 }],
      cliente: { nombre: `Cliente aceptada ${suf}`, telefono: telA },
    },
    SIN_EDITAR,
  );
  const stockUvaAntes = (await db.stock.findFirstOrThrow({
    where: { depositoId: g1.id, varianteId: uva.id },
  }))!.cantidad;
  const va = await aceptarYVender(ctxTri, qa.id, { depositoId: g1.id });
  const dva = await db.venta.findUniqueOrThrow({
    where: { id: va.id },
    include: { pagos: true, cliente: true, items: true },
  });
  check(
    dva.estadoPago === "PENDIENTE" &&
      $(dva.saldoPendiente) === $(dva.total) &&
      $(dva.montoPagado) === "0.00" &&
      dva.pagos.length === 0 &&
      dva.medioPago === null,
    `venta ${va.codigo} pendiente de pago: sin pagos, saldo = total (${$(dva.total)})`,
  );
  check(
    dva.vendedorId === trinidad.id && dva.cotizacionId === qa.id,
    "vendedora Trinidad y vinculada a la cotización",
  );
  check(
    dva.items.every((i) => i.origenPrecio === "COTIZACION"),
    "ítems con origenPrecio COTIZACION",
  );
  check(
    dva.cliente.telefono.endsWith(telA) && $(dva.cliente.saldoDeudor) === $(dva.total),
    "cliente dado de alta con el teléfono de la cotización y la deuda en su cuenta",
  );
  const stockUvaDespues = (await db.stock.findFirstOrThrow({
    where: { depositoId: g1.id, varianteId: uva.id },
  }))!.cantidad;
  check(stockUvaDespues === stockUvaAntes - 2, "descuenta el stock del galpón");
  check(
    (await obtener(ctx, qa.id)).estado === EstadoCotizacion.CONVERTIDA,
    "la cotización queda CONVERTIDA",
  );
  const deNuevo = await error(() => aceptarYVender(ctxTri, qa.id, { depositoId: g1.id }));
  check(deNuevo instanceof DomainError, `aceptarla de nuevo → «${msg(deNuevo)}»`);

  const qMucho = await crearCotizacion(
    ctxTri,
    {
      tipo: "UNITARIA",
      items: [{ varianteId: uva.id, cantidad: 100_000 }],
      cliente: { nombre: `Cliente aceptada ${suf}`, telefono: telA },
    },
    SIN_EDITAR,
  );
  const sinStockA = await error(() => aceptarYVender(ctxTri, qMucho.id, { depositoId: g1.id }));
  check(
    sinStockA instanceof DomainError &&
      sinStockA.code === "STOCK_INSUFICIENTE" &&
      msg(sinStockA).includes("Uva") &&
      (await obtener(ctx, qMucho.id)).estado !== EstadoCotizacion.CONVERTIDA,
    `sin stock → error claro por producto y la cotización queda igual («${msg(sinStockA).slice(0, 70)}…»)`,
  );
  const qSinCliente = await crearCotizacion(
    ctxTri,
    { tipo: "UNITARIA", items: [{ varianteId: uva.id, cantidad: 1 }], cliente: null },
    SIN_EDITAR,
  );
  const sinCliente = await error(() =>
    aceptarYVender(ctxTri, qSinCliente.id, { depositoId: g1.id }),
  );
  check(sinCliente instanceof DomainError, `sin cliente → «${msg(sinCliente)}»`);
  const vSinCliente = await aceptarYVender(ctxTri, qSinCliente.id, {
    depositoId: g1.id,
    clienteId: dva.clienteId,
  });
  check(vSinCliente.cliente.id === dva.clienteId, "con el cliente elegido en el modal");
  await db.cotizacion.update({
    where: { id: qMucho.id },
    data: {
      fecha: new Date(Date.now() - 3 * 86_400_000),
      validaHasta: new Date(Date.now() - 86_400_000),
    },
  });
  const vencidaA = await error(() => aceptarYVender(ctxTri, qMucho.id, { depositoId: g1.id }));
  check(
    vencidaA instanceof DomainError && msg(vencidaA).includes("vencida"),
    "una vencida no se acepta desde la lista",
  );

  const charly = await prisma.usuario.findFirst({ where: { email: "charly@negocio.com" } });
  if (charly) {
    const sinPermiso = await error(() =>
      cobrarVenta({ panelId: VAPES, usuarioId: charly.id, meta }, va.id, {
        monto: 1,
        medioPago: "EFECTIVO",
      }),
    );
    check(
      sinPermiso instanceof ForbiddenError,
      "sin VENTAS editar ni FIADOS editar → no marca pagada",
    );
  }
  const parcial = await cobrarVenta(ctxTri, va.id, {
    monto: 1000,
    medioPago: "TRANSFERENCIA",
    referencia: "op 123",
  });
  const tras1 = await db.venta.findUniqueOrThrow({ where: { id: va.id } });
  check(
    parcial.imputaciones.length === 1 &&
      tras1.estadoPago === "PARCIAL" &&
      $(tras1.saldoPendiente) === $(dva.total.minus(1000)),
    "pago parcial con VENTAS editar → PARCIAL",
  );
  const excede = await error(() =>
    cobrarVenta(ctxTri, va.id, { monto: Number(tras1.saldoPendiente) + 1, medioPago: "EFECTIVO" }),
  );
  check(excede instanceof DomainError, "más que el saldo → error");
  await cobrarVenta(ctxTri, va.id, {
    monto: Number(tras1.saldoPendiente),
    medioPago: "TRANSFERENCIA",
  });
  const tras2 = await db.venta.findUniqueOrThrow({
    where: { id: va.id },
    include: { pagos: true, cliente: true },
  });
  check(
    tras2.estadoPago === "PAGADA" &&
      $(tras2.saldoPendiente) === "0.00" &&
      tras2.pagos.length === 2 &&
      tras2.pagos.every((p) => p.esCobroPosterior && p.medioPago === "TRANSFERENCIA"),
    "saldo completo → PAGADA, con sus cobros por Transferencia",
  );
  check(
    $(tras2.cliente.saldoDeudor) === $(vSinCliente.total),
    "la cuenta del cliente baja (queda solo la otra venta pendiente)",
  );
  const yaPagada = await error(() =>
    cobrarVenta(ctxTri, va.id, { monto: 1, medioPago: "EFECTIVO" }),
  );
  check(yaPagada instanceof DomainError, `ya pagada → «${msg(yaPagada)}»`);

  // ---------------------------------------------------------------------------
  console.log("\n8) Cosmetic: sin los defaults de Vapes y COS-Q-000001");
  const cos = await crearProducto(ctxCos, "Crema", ["Único"], suf);
  const pCos = await calcularPrecios(
    ctxCos,
    { tipo: "MAYORISTA", items: [{ varianteId: cos.variantes[0]!.id, cantidad: 60 }] },
    DUENO,
  );
  check(
    pCos.items[0]!.precioUnitario === "10000.00" && pCos.items[0]!.escalonAplicado === null,
    "60 u. en Cosmetic → lista (no usa los defaults de Vapes)",
  );
  const secCos = await prisma.secuencia.findUniqueOrThrow({
    where: { panelId_entidad: { panelId: COSMETIC, entidad: "COTIZACION" } },
  });
  const qCos = await crearCotizacion(
    ctxCos,
    {
      tipo: "MAYORISTA",
      items: [{ varianteId: cos.variantes[0]!.id, cantidad: 60 }],
      cliente: null,
    },
    DUENO,
  );
  check(
    qCos.codigo === `COS-Q-${String(secCos.ultimoNumero + 1).padStart(6, "0")}`,
    `código ${qCos.codigo}${secCos.ultimoNumero === 0 ? " (primera del panel)" : ""}`,
  );
  if (secCos.ultimoNumero === 0) check(qCos.codigo === "COS-Q-000001", "COS-Q-000001");

  // ---------------------------------------------------------------------------
  console.log("\n9) Aislamiento entre paneles");
  check(
    (await error(() => obtener(ctxCos, q1.id))) instanceof NotFoundError,
    "cotización de Vapes desde Cosmetic → no existe",
  );
  check(
    (await error(() =>
      calcularPrecios(
        ctxCos,
        { tipo: "UNITARIA", items: [{ varianteId: uva.id, cantidad: 1 }] },
        DUENO,
      ),
    )) instanceof NotFoundError,
    "sabor de Vapes desde Cosmetic → no existe",
  );
  const listaCos = await listar(ctxCos, {});
  check(
    listaCos.cotizaciones.every((c) => c.codigo.startsWith("COS-")),
    "el listado de Cosmetic solo trae COS-",
  );
  check(
    (await error(() =>
      convertirEnVenta(ctxCos, q2.id, {
        depositoId: g1.id,
        pagos: [{ medioPago: "EFECTIVO", monto: 22000 }],
      }),
    )) instanceof NotFoundError,
    "convertir una de Vapes desde Cosmetic → no existe",
  );

  await guardarConfigCotizacion(ctx, configOriginal);
  if (overrideAntes) {
    await prisma.configuracionGlobal.update({
      where: { clave: overrideAntes.clave },
      data: { valor: overrideAntes.valor as Prisma.InputJsonValue },
    });
  } else {
    await quitarOverride("USD_BLUE", actor);
  }
  console.log(fallos ? `\n✘ ${fallos} verificaciones fallaron` : "\n✔ Todo OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
