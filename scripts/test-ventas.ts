/**
 * Ventas a nivel servicios + DB (panel Vapes): generarVenta con cliente nuevo o
 * existente, precios de lista y costos del servidor, precio especial y
 * descuento (solo con "editar"), falta de stock (todo o nada), teléfono
 * repetido, listado y totales, anulación (solo dueños), ventas de un cliente,
 * más vendidos y aislamiento entre paneles (VAP-/COS-).
 * Uso: pnpm test:ventas — pensado para una DB recién sembrada (crea datos).
 */
import {
  EstadoVenta,
  MedioPago,
  Prisma,
  RolUsuario,
  TipoMovimiento,
  TipoVenta,
} from "@prisma/client";

import { prisma } from "../src/lib/db";
import { formatearIdVenta } from "../src/lib/paneles";
import { generarVentaSchema, listarVentasSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "../src/server/errors";
import { ClienteDuplicadoError } from "../src/server/services/cliente.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import {
  anularVenta,
  generarVenta,
  listarVentas,
  obtenerVenta,
  productosMasVendidos,
  ventasDeCliente,
} from "../src/server/services/venta.service";

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
const ultimoNumero = async (panelId: string) =>
  (
    await prisma.secuencia.findUniqueOrThrow({
      where: { panelId_entidad: { panelId, entidad: "VENTA" } },
    })
  ).ultimoNumero;

/** Producto propio del test con sus sabores (no depende del catálogo del seed). */
async function crearCatalogo(ctx: Ctx, suf: string) {
  return transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: ctx.panelId, nombre: "Test Ventas" } },
      update: {},
      create: { nombre: "Test Ventas" },
    });
    return tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod ${suf}`,
        especificacion: "5000",
        precioVenta: "16000.00",
        variantes: {
          create: [
            { nombre: "Mango Ice", sku: `TV-M-${suf}`, ultimoCosto: "9500.00" },
            {
              nombre: "Frutilla",
              sku: `TV-F-${suf}`,
              precioVenta: "17000.00",
              ultimoCosto: "9800.00",
            },
            { nombre: "Sin compras", sku: `TV-S-${suf}` },
          ],
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
  const empleado = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-ventas" };
  const ctx: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const ctxEmp: Ctx = { panelId: VAPES, usuarioId: empleado.id, meta };
  const ctxCos: Ctx = { panelId: COSMETIC, usuarioId: owner.id, meta };
  const DUENO = { puedeEditar: true };
  const EMPLEADO = { puedeEditar: false };

  const g1 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const stock = async (varianteId: string, depositoId = g1.id) =>
    (await dbPara(VAPES).stock.findFirst({ where: { varianteId, depositoId } }))?.cantidad ?? 0;
  const suf = String(Date.now()).slice(-7);
  const pod = await crearCatalogo(ctx, suf);
  const [frutilla, mango, sinCompras] = pod.variantes as [
    (typeof pod.variantes)[number],
    (typeof pod.variantes)[number],
    (typeof pod.variantes)[number],
  ];
  for (const v of [mango, frutilla, sinCompras]) {
    await registrarAjuste(ctx, {
      depositoId: g1.id,
      varianteId: v.id,
      cantidadReal: 10,
      motivo: "Preparación test-ventas",
    });
  }
  const telefono = `11${suf.slice(-4)}${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const entrada = (datos: Record<string, unknown>) =>
    generarVentaSchema.parse({ depositoId: g1.id, medioPago: "EFECTIVO", ...datos });

  // ---------------------------------------------------------------------------
  console.log(`\n1) Cliente nuevo, 2 Mango + 1 Frutilla con precio especial, transferencia`);
  const numeroAntes = await ultimoNumero(VAPES);
  const v1 = await generarVenta(
    ctx,
    entrada({
      cliente: { nuevo: { nombre: "Nico Test", telefono } },
      items: [
        { varianteId: mango.id, cantidad: 2 },
        { varianteId: frutilla.id, cantidad: 1, precioEspecial: 15000 },
      ],
      medioPago: "TRANSFERENCIA",
    }),
    DUENO,
  );
  check(
    v1.numero === numeroAntes + 1 && v1.codigo === formatearIdVenta("vapes", v1.numero),
    `código ${v1.codigo} (número ${v1.numero} = secuencia + 1)`,
  );
  check(/^VAP-\d{6}$/.test(v1.codigo), "formato VAP-######");
  check(v1.clienteNuevo && v1.cliente.nombre === "Nico Test", "cliente nuevo creado en la venta");
  check(v1.cliente.telefono === `+54${telefono}`, `teléfono normalizado ${v1.cliente.telefono}`);
  const venta1 = await db.venta.findUniqueOrThrow({
    where: { id: v1.id },
    include: { items: true },
  });
  const itemMango = venta1.items.find((i) => i.varianteId === mango.id)!;
  const itemFrutilla = venta1.items.find((i) => i.varianteId === frutilla.id)!;
  check(
    $(itemMango.precioLista) === "16000.00" &&
      $(itemMango.precioUnitario) === "16000.00" &&
      !itemMango.esPrecioEspecial,
    "Mango: precio de lista = el del producto (16000), sin precio especial",
  );
  check(
    $(itemFrutilla.precioLista) === "17000.00" &&
      $(itemFrutilla.precioUnitario) === "15000.00" &&
      itemFrutilla.esPrecioEspecial,
    "Frutilla: lista 17000 (precio propio), cobrado 15000 → esPrecioEspecial",
  );
  check(
    $(itemMango.costoUnitario) === "9500.00" && $(itemFrutilla.costoUnitario) === "9800.00",
    "costoUnitario = ultimoCosto de cada sabor",
  );
  check(
    $(venta1.total) === "47000.00" &&
      $(venta1.costoTotal) === "28800.00" &&
      $(venta1.gananciaBruta) === "18200.00",
    `total ${$(venta1.total)} · costo ${$(venta1.costoTotal)} · ganancia ${$(venta1.gananciaBruta)}`,
  );
  check(
    venta1.estado === EstadoVenta.CONFIRMADA &&
      venta1.medioPago === MedioPago.TRANSFERENCIA &&
      venta1.vendedorId === owner.id &&
      venta1.tipo === TipoVenta.UNITARIA,
    "CONFIRMADA · TRANSFERENCIA · vendedor = usuario del ctx · UNITARIA",
  );
  const movs1 = await db.movimientoStock.findMany({
    where: { referenciaTipo: "VENTA", referenciaId: v1.id },
  });
  check(
    movs1.length === 2 &&
      movs1.every((m) => m.tipo === TipoMovimiento.VENTA && m.depositoId === g1.id),
    `2 movimientos VENTA en ${g1.nombre}`,
  );
  check(
    (await stock(mango.id)) === 8 && (await stock(frutilla.id)) === 9,
    "stock descontado (Mango 10→8, Frutilla 10→9)",
  );
  const audit = await prisma.auditLog.count({ where: { entidad: "Venta", entidadId: v1.id } });
  check(audit === 1, "AuditLog de la venta");

  // ---------------------------------------------------------------------------
  console.log("\n2) Validaciones: galpón, medio de pago, cliente, repetidos");
  const sinGalpon = await error(() =>
    generarVenta(
      ctx,
      generarVentaSchema.parse({
        medioPago: "EFECTIVO",
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: mango.id, cantidad: 1 }],
      }),
      DUENO,
    ),
  );
  check(sinGalpon instanceof DomainError, `sin galpón → «${msg(sinGalpon)}»`);
  const sinMedio = await error(() =>
    generarVenta(
      ctx,
      generarVentaSchema.parse({
        depositoId: g1.id,
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: mango.id, cantidad: 1 }],
      }),
      DUENO,
    ),
  );
  check(sinMedio instanceof DomainError, `sin medio de pago → «${msg(sinMedio)}»`);
  const sinCliente = await error(() =>
    generarVenta(ctx, entrada({ items: [{ varianteId: mango.id, cantidad: 1 }] }), DUENO),
  );
  check(sinCliente instanceof DomainError, `sin cliente → «${msg(sinCliente)}»`);
  const repetidos = await error(() =>
    generarVenta(
      ctx,
      entrada({
        cliente: { id: v1.cliente.id },
        items: [
          { varianteId: mango.id, cantidad: 1 },
          { varianteId: mango.id, cantidad: 1 },
        ],
      }),
      DUENO,
    ),
  );
  check(repetidos instanceof DomainError, `sabor repetido → «${msg(repetidos)}»`);

  // ---------------------------------------------------------------------------
  console.log("\n3) Sin stock: falla ENTERA (ni venta, ni movimientos, ni cliente, ni número)");
  const numero3 = await ultimoNumero(VAPES);
  const ventas3 = await db.venta.count();
  const tel3 = `${telefono.slice(0, -1)}${(Number(telefono.at(-1)) + 1) % 10}`;
  const faltaStock = await error(() =>
    generarVenta(
      ctx,
      entrada({
        cliente: { nuevo: { nombre: "No debería existir", telefono: tel3 } },
        items: [
          { varianteId: mango.id, cantidad: 1 },
          { varianteId: sinCompras.id, cantidad: 50 },
        ],
      }),
      DUENO,
    ),
  );
  const esperado = `No hay stock de ${pod.nombreCompleto} — Sin compras en ${g1.nombre}: hay 10, se piden 50`;
  check(
    faltaStock instanceof DomainError &&
      (faltaStock as DomainError).code === "STOCK_INSUFICIENTE" &&
      msg(faltaStock) === esperado,
    `«${msg(faltaStock)}»`,
  );
  check(
    (await db.venta.count()) === ventas3 && (await ultimoNumero(VAPES)) === numero3,
    "ninguna venta creada y el número no se consumió",
  );
  check((await stock(mango.id)) === 8, "Mango sigue en 8 (el ítem con stock tampoco se movió)");
  check(
    (await db.cliente.count({ where: { telefono: `+54${tel3}` } })) === 0,
    "el cliente nuevo no quedó creado",
  );

  // ---------------------------------------------------------------------------
  console.log("\n4) Permisos: precio especial y descuento solo con 'editar'");
  const especialEmp = await error(() =>
    generarVenta(
      ctxEmp,
      entrada({
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: mango.id, cantidad: 1, precioEspecial: 100 }],
      }),
      EMPLEADO,
    ),
  );
  check(especialEmp instanceof ForbiddenError, `empleado + precio especial → FORBIDDEN`);
  const descuentoEmp = await error(() =>
    generarVenta(
      ctxEmp,
      entrada({
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: mango.id, cantidad: 1 }],
        descuento: 1000,
      }),
      EMPLEADO,
    ),
  );
  check(descuentoEmp instanceof ForbiddenError, `empleado + descuento → FORBIDDEN`);
  const vEmp = await generarVenta(
    ctxEmp,
    entrada({ cliente: { id: v1.cliente.id }, items: [{ varianteId: mango.id, cantidad: 1 }] }),
    EMPLEADO,
  );
  const ventaEmp = await db.venta.findUniqueOrThrow({ where: { id: vEmp.id } });
  check(
    ventaEmp.vendedorId === empleado.id && $(ventaEmp.total) === "16000.00",
    `el empleado vende a precio de lista (vendedor = ${empleado.nombre})`,
  );
  const excede = await error(() =>
    generarVenta(
      ctx,
      entrada({
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: mango.id, cantidad: 1 }],
        descuento: 20000,
      }),
      DUENO,
    ),
  );
  check(excede instanceof DomainError, `descuento mayor al subtotal → «${msg(excede)}»`);
  const conDescuento = await generarVenta(
    ctx,
    entrada({
      cliente: { id: v1.cliente.id },
      items: [{ varianteId: sinCompras.id, cantidad: 2 }],
      descuento: 2000,
      medioPago: "BINANCE",
      tipo: "MAYORISTA",
    }),
    DUENO,
  );
  const vDesc = await db.venta.findUniqueOrThrow({ where: { id: conDescuento.id } });
  check(
    $(vDesc.subtotal) === "32000.00" &&
      $(vDesc.descuento) === "2000.00" &&
      $(vDesc.total) === "30000.00" &&
      $(vDesc.costoTotal) === "0.00" &&
      vDesc.medioPago === MedioPago.BINANCE &&
      vDesc.tipo === TipoVenta.MAYORISTA,
    "dueño: descuento 2000 sobre 32000 → 30000 · costo 0 (sabor sin compras) · BINANCE · MAYORISTA",
  );

  // ---------------------------------------------------------------------------
  console.log("\n5) Teléfono repetido → ClienteDuplicadoError con el cliente existente");
  const dup = await error(() =>
    generarVenta(
      ctx,
      entrada({
        cliente: { nuevo: { nombre: "Otro Nico", telefono: `0${telefono}` } },
        items: [{ varianteId: mango.id, cantidad: 1 }],
      }),
      DUENO,
    ),
  );
  check(
    dup instanceof ClienteDuplicadoError && dup.clienteExistente.id === v1.cliente.id,
    `«${msg(dup)}» → ${dup instanceof ClienteDuplicadoError ? dup.clienteExistente.nombre : "?"}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n6) Listado, búsqueda y totales");
  const filtros = (f: Record<string, unknown>) => listarVentasSchema.parse(f);
  const porCodigo = await listarVentas(ctx, filtros({ q: v1.codigo }), { verCostos: true });
  check(
    porCodigo.ventas.length === 1 && porCodigo.ventas[0]!.id === v1.id,
    `buscar ${v1.codigo} → 1 venta`,
  );
  const porNumero = await listarVentas(ctx, filtros({ q: String(v1.numero) }), {
    verCostos: false,
  });
  check(
    porNumero.ventas.some((v) => v.id === v1.id),
    `buscar "${v1.numero}" la encuentra`,
  );
  const porCliente = await listarVentas(ctx, filtros({ clienteId: v1.cliente.id }), {
    verCostos: true,
  });
  check(
    porCliente.resumen.cantidad === 3 && porCliente.resumen.total === "93000.00",
    `ventas del cliente: ${porCliente.resumen.cantidad} por ${porCliente.resumen.total}`,
  );
  const sinCostos = await listarVentas(ctx, filtros({ q: "Nico Test" }), { verCostos: false });
  check(
    sinCostos.resumen.gananciaBruta === null &&
      sinCostos.ventas.every((v) => v.gananciaBruta === null),
    "sin verCostos: no llega la ganancia",
  );
  const porVendedor = await listarVentas(
    ctx,
    filtros({ vendedorId: empleado.id, medioPago: "EFECTIVO" }),
    { verCostos: true },
  );
  check(
    porVendedor.ventas.some((v) => v.id === vEmp.id),
    "filtro por vendedor + medio de pago",
  );
  const detalle = await obtenerVenta(ctxEmp, v1.id, { verCostos: false });
  check(
    detalle.costoTotal === null &&
      detalle.items.every((i) => i.costoUnitario === null) &&
      detalle.movimientos.length === 2,
    "detalle sin costos para el empleado, con sus 2 movimientos",
  );

  // ---------------------------------------------------------------------------
  console.log("\n7) Anulación: solo dueños, vuelve el stock (VENTA_ANULADA)");
  const anulaEmp = await error(() => anularVenta(ctxEmp, v1.id, "Probando"));
  check(anulaEmp instanceof ForbiddenError, "empleado → FORBIDDEN");
  await anularVenta(ctx, v1.id, "Se arrepintió");
  const anulada = await db.venta.findUniqueOrThrow({ where: { id: v1.id } });
  check(
    anulada.estado === EstadoVenta.ANULADA && anulada.anuladaPorId === owner.id,
    "venta ANULADA por el dueño",
  );
  const movsAnul = await db.movimientoStock.findMany({
    where: { referenciaId: v1.id, tipo: TipoMovimiento.VENTA_ANULADA },
  });
  check(movsAnul.length === 2, "2 movimientos VENTA_ANULADA");
  check(
    (await stock(mango.id)) === 9 && (await stock(frutilla.id)) === 10,
    "stock devuelto (Mango 7→9, Frutilla 9→10)",
  );
  const otraVez = await error(() => anularVenta(ctx, v1.id, "De nuevo"));
  check(otraVez instanceof DomainError, `anular dos veces → «${msg(otraVez)}»`);

  // ---------------------------------------------------------------------------
  console.log("\n8) Ventas de un cliente y más vendidos");
  const delCliente = await ventasDeCliente(ctx, v1.cliente.id);
  check(
    delCliente.length === 2 && !delCliente.some((v) => v.id === v1.id),
    `ventasDeCliente: ${delCliente.map((v) => v.codigo).join(", ")} (sin la anulada)`,
  );
  check(
    delCliente.every((v) => v.items.every((i) => i.titulo.includes(pod.nombreCompleto))),
    "con sus ítems (título producto — sabor)",
  );
  const top = await productosMasVendidos(ctx, { dias: 30, limit: 12, depositoId: g1.id });
  check(
    top.length > 0 && top.length <= 12 && top.some((t) => t.varianteId === sinCompras.id),
    `más vendidos: ${top.length} sabores (incluye "Sin compras")`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n9) Aislamiento entre paneles y código COS-");
  const galponAjeno = await error(() =>
    generarVenta(
      ctxCos,
      entrada({ cliente: { id: v1.cliente.id }, items: [{ varianteId: mango.id, cantidad: 1 }] }),
      DUENO,
    ),
  );
  check(
    galponAjeno instanceof NotFoundError,
    `galpón de Vapes desde Cosmetic → «${msg(galponAjeno)}»`,
  );
  const gCos = await dbPara(COSMETIC).deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const podCos = await crearCatalogo(ctxCos, `${suf}c`);
  await registrarAjuste(ctxCos, {
    depositoId: gCos.id,
    varianteId: podCos.variantes[0]!.id,
    cantidadReal: 3,
    motivo: "Preparación test-ventas",
  });
  const clienteAjeno = await error(() =>
    generarVenta(
      ctxCos,
      generarVentaSchema.parse({
        depositoId: gCos.id,
        medioPago: "EFECTIVO",
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: podCos.variantes[0]!.id, cantidad: 1 }],
      }),
      DUENO,
    ),
  );
  check(clienteAjeno instanceof NotFoundError, "cliente de Vapes desde Cosmetic → no existe");
  const vCos = await generarVenta(
    ctxCos,
    generarVentaSchema.parse({
      depositoId: gCos.id,
      medioPago: "EFECTIVO",
      cliente: { nuevo: { nombre: "Clienta Cosmetic", telefono } },
      items: [{ varianteId: podCos.variantes[0]!.id, cantidad: 1 }],
    }),
    DUENO,
  );
  check(/^COS-\d{6}$/.test(vCos.codigo), `venta en Cosmetic: ${vCos.codigo}`);
  check(vCos.clienteNuevo, "el mismo teléfono es un cliente distinto en otro panel");

  console.log(fallos ? `\n✘ ${fallos} verificaciones fallaron` : "\n✔ Todo OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
