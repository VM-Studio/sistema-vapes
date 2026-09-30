/**
 * Cotizador a nivel servicios + DB (panel Vapes): escalones mezclando sabores,
 * defaults del panel, modo POR_TOTAL, conversión en venta de una mayorista
 * cuyo precio de lista subió (sin permiso de editar), falta de stock (todo o
 * nada), permisos de Trinidad (precio manual prohibido, vendedorId), Cosmetic
 * sin los defaults de Vapes (COS-Q-000001) y aislamiento entre paneles.
 * Uso: npx tsx --conditions=react-server scripts/test-cotizador.ts — pensado
 * para una DB recién sembrada (crea datos).
 */
import { EstadoCotizacion, Prisma, RolUsuario, TipoVenta } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "../src/server/errors";
import {
  guardarConfigCotizacion,
  obtenerConfigCotizacion,
} from "../src/server/services/configuracion.service";
import {
  convertirEnVenta,
  crearCotizacion,
  duplicar,
  generarPDF,
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
  await guardarEscalones(ctx, elf.id, [
    { cantidadMinima: 10, precioUnitario: "9000", activo: true },
    { cantidadMinima: 50, precioUnitario: "8200", activo: true },
    { cantidadMinima: 100, precioUnitario: "7500", activo: true },
  ]);
  await guardarEscalonesDefault(ctx, [
    { cantidadMinima: 10, porcentajeDescuento: "5", activo: true },
    { cantidadMinima: 50, porcentajeDescuento: "12", activo: true },
  ]);
  const configOriginal = await obtenerConfigCotizacion(ctx);
  await guardarConfigCotizacion(ctx, { ...configOriginal, modoEscalonMayorista: "POR_PRODUCTO" });

  // ---------------------------------------------------------------------------
  console.log("\n1) Escalones: validación del set");
  const creciente = await error(() =>
    guardarEscalones(ctx, elf.id, [
      { cantidadMinima: 10, precioUnitario: "9000", activo: true },
      { cantidadMinima: 50, precioUnitario: "9500", activo: true },
    ]),
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
  console.log("\n4) POR_TOTAL: 55 Elf + 10 Uva = 65 unidades");
  await guardarConfigCotizacion(ctx, { ...configOriginal, modoEscalonMayorista: "POR_TOTAL" });
  const total = await calcularPrecios(
    ctx,
    {
      tipo: "MAYORISTA",
      items: [
        { varianteId: mango.id, cantidad: 20 },
        { varianteId: frutilla.id, cantidad: 35 },
        { varianteId: uva.id, cantidad: 10 },
      ],
    },
    DUENO,
  );
  const itUva = total.items.find((i) => i.varianteId === uva.id)!;
  check(total.modo === "POR_TOTAL", "modo POR_TOTAL");
  check(
    itUva.escalonAplicado === 50 && itUva.precioUnitario === "8800.00",
    `Uva (10 u.) entra en el escalón de 50 por las 65 totales: ${itUva.precioUnitario}`,
  );
  check(
    total.resumenEscalones.every((r) => r.unidades === 65),
    "resumen de escalones con 65 unidades",
  );
  await guardarConfigCotizacion(ctx, { ...configOriginal, modoEscalonMayorista: "POR_PRODUCTO" });
  const porProducto = await calcularPrecios(
    ctx,
    { tipo: "MAYORISTA", items: [{ varianteId: uva.id, cantidad: 10 }] },
    DUENO,
  );
  check(porProducto.items[0]!.precioUnitario === "9500.00", "POR_PRODUCTO: Uva 10 u. → $9.500");

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
  const pdf = await generarPDF(ctx, q1.id);
  check(
    pdf.url.endsWith(".pdf") && (await obtener(ctx, q1.id)).pdfUrl === pdf.url,
    "PDF generado y guardado en pdfUrl",
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
  console.log(fallos ? `\n✘ ${fallos} verificaciones fallaron` : "\n✔ Todo OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
