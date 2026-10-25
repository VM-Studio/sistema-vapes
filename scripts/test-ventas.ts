/**
 * Ventas a nivel servicios + DB (panel Vapes): generarVenta con cliente nuevo o
 * existente, precios de lista y costos del servidor, precio especial y
 * descuento (solo con "editar"), falta de stock (todo o nada), teléfono
 * repetido, pagos (PagoVenta por el total), listado y totales, anulación (solo
 * dueños, anula los pagos), ventas de un cliente,
 * más vendidos, aislamiento entre paneles (VAP-/COS-), medios por panel, ventas
 * por Mercado Libre con precio a mano y la carga de sus facturas (Cosmetic).
 * Uso: pnpm test:ventas — pensado para una DB recién sembrada (crea datos).
 */
import {
  EstadoPago,
  EstadoVenta,
  MedioPago,
  Prisma,
  RolUsuario,
  TipoMovimiento,
  TipoVenta,
} from "@prisma/client";

import { prisma } from "../src/lib/db";
import { formatearIdVenta } from "../src/lib/paneles";
import {
  cargarFacturaMLSchema,
  facturarVentaSchema,
  facturaSueltaSchema,
  listarFacturasSchema,
  listarVentasMLSchema,
} from "../src/lib/validations/factura";
import { generarVentaSchema, listarVentasSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "../src/server/errors";
import { ClienteDuplicadoError } from "../src/server/services/cliente.service";
import {
  anular as anularFactura,
  crearDesdeVenta,
  crearSuelta,
  listar as listarFacturas,
  obtener as obtenerFactura,
  pdfFactura,
} from "../src/server/services/factura.service";
import {
  archivoFacturaML,
  listarVentasML,
  marcarFacturaMLCargada,
  totalesFacturasML,
} from "../src/server/services/factura-ml.service";
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
  // Un pago por el total esperado (medio EFECTIVO y $16.000 = 1 Mango, salvo que se indique).
  const entrada = ({
    medioPago = "EFECTIVO",
    monto = 16000,
    ...datos
  }: Record<string, unknown> & { medioPago?: string; monto?: number }) =>
    generarVentaSchema.parse({ depositoId: g1.id, pagos: [{ medioPago, monto }], ...datos });

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
      monto: 47000,
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
  const pagos1 = await db.pagoVenta.findMany({ where: { ventaId: v1.id } });
  check(
    pagos1.length === 1 &&
      pagos1[0]!.medioPago === MedioPago.TRANSFERENCIA &&
      $(pagos1[0]!.monto) === "47000.00" &&
      venta1.estadoPago === EstadoPago.PAGADA &&
      $(venta1.montoPagado) === "47000.00" &&
      $(venta1.saldoPendiente) === "0.00",
    "un PagoVenta por el total · PAGADA",
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
        pagos: [{ medioPago: "EFECTIVO", monto: 16000 }],
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
      monto: 30000,
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
  check(
    (await db.pagoVenta.findMany({ where: { ventaId: v1.id } })).every((p) => p.anulado) &&
      $(anulada.montoPagado) === "0.00",
    "sus pagos quedan anulados (montoPagado 0)",
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
        pagos: [{ medioPago: "EFECTIVO", monto: 17000 }],
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
      pagos: [{ medioPago: "EFECTIVO", monto: 17000 }],
      cliente: { nuevo: { nombre: "Clienta Cosmetic", telefono } },
      items: [{ varianteId: podCos.variantes[0]!.id, cantidad: 1 }],
    }),
    DUENO,
  );
  check(/^COS-\d{6}$/.test(vCos.codigo), `venta en Cosmetic: ${vCos.codigo}`);
  check(vCos.clienteNuevo, "el mismo teléfono es un cliente distinto en otro panel");

  // ---------------------------------------------------------------------------
  console.log(`\nV) Verificar con pistola: la marca la decide el servidor`);
  const verificada = await generarVenta(
    ctx,
    entrada({
      cliente: { id: v1.cliente.id },
      items: [{ varianteId: mango.id, cantidad: 1 }],
      verificacion: [{ varianteId: mango.id, unidades: 1 }],
    }),
    DUENO,
  );
  const incompleta = await generarVenta(
    ctx,
    entrada({
      cliente: { id: v1.cliente.id },
      items: [{ varianteId: mango.id, cantidad: 1 }],
      verificacion: [{ varianteId: frutilla.id, unidades: 1 }],
    }),
    DUENO,
  );
  const sinModo = await generarVenta(
    ctx,
    entrada({ cliente: { id: v1.cliente.id }, items: [{ varianteId: mango.id, cantidad: 1 }] }),
    DUENO,
  );
  const marcas = await db.venta.findMany({
    where: { id: { in: [verificada.id, incompleta.id, sinModo.id] } },
    select: { id: true, verificadaPorEscaneo: true },
  });
  const marca = (id: string) => marcas.find((m) => m.id === id)?.verificadaPorEscaneo;
  check(marca(verificada.id) === true, "todas las unidades escaneadas → verificadaPorEscaneo");
  check(marca(incompleta.id) === false, "detalle que no coincide con lo vendido → no verificada");
  check(marca(sinModo.id) === false, "sin el modo activo → no verificada");
  console.log("\n10) Medios por panel y Mercado Libre (Cosmetic: Efectivo, Transferencia, ML)");
  // Producto a $ 12.000 de lista y $ 15.000 en Mercado Libre; un sabor sin precio ML propio
  // usa el del producto, otro tiene el suyo.
  const ml = await transaccion(ctxCos, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: COSMETIC, nombre: "Test ML" } },
      update: {},
      create: { nombre: "Test ML" },
    });
    return tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Serum ${suf}`,
        especificacion: "30 ml",
        precioVenta: "12000.00",
        precioVentaML: "15000.00",
        variantes: {
          create: [
            { nombre: "Rosa", sku: `TML-R-${suf}`, ultimoCosto: "7000.00" },
            { nombre: "Coco", sku: `TML-C-${suf}`, precioVentaML: "16500.00" },
          ],
        },
      },
      include: { variantes: { orderBy: { nombre: "asc" } } },
    });
  });
  const [coco, rosa] = ml.variantes as [
    (typeof ml.variantes)[number],
    (typeof ml.variantes)[number],
  ];
  const sinML = await transaccion(ctxCos, (tx) =>
    tx.producto.create({
      data: {
        marcaId: ml.marcaId,
        nombre: `Crema ${suf}`,
        precioVenta: "8000.00",
        variantes: { create: [{ nombre: "Único", sku: `TML-U-${suf}` }] },
      },
      include: { variantes: true },
    }),
  );
  for (const v of [rosa, coco, sinML.variantes[0]!])
    await registrarAjuste(ctxCos, {
      depositoId: gCos.id,
      varianteId: v.id,
      cantidadReal: 10,
      motivo: "Preparación test-ventas ML",
    });
  const ventaCos = (pagos: { medioPago: string; monto: number }[], items: object[]) =>
    generarVentaSchema.parse({
      depositoId: gCos.id,
      pagos,
      cliente: { id: vCos.cliente.id },
      items,
    });

  // Venta por Mercado Libre: el precio de cada ítem se carga a mano (obligatorio);
  // el precio ML guardado en el producto ya no se usa.
  const itemsML = [
    { varianteId: rosa.id, cantidad: 2 },
    { varianteId: coco.id, cantidad: 1 },
    { varianteId: sinML.variantes[0]!.id, cantidad: 1 },
  ];
  const sinPrecio = await error(() =>
    generarVenta(ctxCos, ventaCos([{ medioPago: "MERCADO_LIBRE", monto: 30000 }], itemsML), DUENO),
  );
  check(
    sinPrecio instanceof DomainError && /precio de cada producto/.test(msg(sinPrecio)),
    `ML sin precio a mano → «${msg(sinPrecio)}»`,
  );
  const unoSinPrecio = await error(() =>
    generarVenta(
      ctxCos,
      ventaCos(
        [{ medioPago: "MERCADO_LIBRE", monto: 30000 }],
        [
          { ...itemsML[0]!, precioML: 14000 },
          { ...itemsML[1]!, precioML: 0 },
        ],
      ),
      DUENO,
    ),
  );
  check(unoSinPrecio instanceof DomainError, "ML con un precio en 0 → error");
  const porML = await generarVenta(
    ctxCos,
    ventaCos(
      [{ medioPago: "MERCADO_LIBRE", monto: 2 * 14000 + 17250.5 + 9000 }],
      [
        { ...itemsML[0]!, precioML: 14000 },
        { ...itemsML[1]!, precioML: "17250.50" },
        { ...itemsML[2]!, precioML: 9000 },
      ],
    ),
    // El precio a mano de ML no exige "editar" (es propio de Mercado Libre).
    EMPLEADO,
  );
  const item = (venta: typeof porML, id: string) => venta.items.find((i) => i.varianteId === id)!;
  check(
    item(porML, rosa.id).precioUnitario === "14000.00" &&
      item(porML, rosa.id).precioLista === "14000.00" &&
      item(porML, rosa.id).origenPrecio === "ML" &&
      !item(porML, rosa.id).esPrecioEspecial,
    `vendido por ML a mano: $ ${item(porML, rosa.id).precioUnitario} (origenPrecio ${item(porML, rosa.id).origenPrecio}; el guardado era $ 15.000)`,
  );
  check(
    item(porML, coco.id).precioUnitario === "17250.50" &&
      item(porML, sinML.variantes[0]!.id).origenPrecio === "ML",
    "cada ítem a su precio a mano (también los que no tenían precio ML)",
  );
  check(
    porML.total === "54250.50" && porML.medioPago === MedioPago.MERCADO_LIBRE,
    `total = suma de los precios a mano (${porML.total})`,
  );
  const enDb = await prisma.venta.findUniqueOrThrow({
    where: { id: porML.id },
    include: { items: { where: { varianteId: rosa.id } } },
  });
  check(
    $(enDb.items[0]!.precioLista) === "14000.00" &&
      enDb.items[0]!.origenPrecio === "ML" &&
      $(enDb.costoTotal) === "14000.00" &&
      $(enDb.gananciaBruta) === "40250.50",
    `VentaItem guarda el precio a mano (ML); costo y ganancia del servidor (${$(enDb.costoTotal)} / ${$(enDb.gananciaBruta)})`,
  );

  const efectivo = await generarVenta(
    ctxCos,
    ventaCos([{ medioPago: "EFECTIVO", monto: 12000 }], [{ varianteId: rosa.id, cantidad: 1 }]),
    DUENO,
  );
  check(
    item(efectivo, rosa.id).precioUnitario === "12000.00" &&
      item(efectivo, rosa.id).origenPrecio === "LISTA",
    "en efectivo, el mismo producto va a lista",
  );
  const manualSinML = await error(() =>
    generarVenta(
      ctxCos,
      ventaCos(
        [{ medioPago: "EFECTIVO", monto: 12000 }],
        [{ varianteId: rosa.id, cantidad: 1, precioML: 10000 }],
      ),
      DUENO,
    ),
  );
  check(manualSinML instanceof DomainError, "precio a mano sin cobrar por ML → error");

  // Mixto: el medio de mayor monto decide. ML mayoritario → precios a mano.
  const mixto = await generarVenta(
    ctxCos,
    ventaCos(
      [
        { medioPago: "EFECTIVO", monto: 4000 },
        { medioPago: "MERCADO_LIBRE", monto: 9000 },
      ],
      [{ varianteId: rosa.id, cantidad: 1, precioML: 13000 }],
    ),
    DUENO,
  );
  check(
    item(mixto, rosa.id).precioUnitario === "13000.00" &&
      item(mixto, rosa.id).origenPrecio === "ML" &&
      mixto.medioPago === MedioPago.MERCADO_LIBRE,
    "pago dividido con ML mayoritario → precio a mano (ML)",
  );
  const mixtoMinoritario = await generarVenta(
    ctxCos,
    ventaCos(
      [
        { medioPago: "EFECTIVO", monto: 8000 },
        { medioPago: "MERCADO_LIBRE", monto: 4000 },
      ],
      [{ varianteId: rosa.id, cantidad: 1 }],
    ),
    DUENO,
  );
  check(
    item(mixtoMinoritario, rosa.id).origenPrecio === "LISTA" &&
      mixtoMinoritario.medioPago === MedioPago.EFECTIVO,
    "ML minoritario → precio de lista (no es venta ML)",
  );
  const especial = await error(() =>
    generarVenta(
      ctxCos,
      ventaCos(
        [{ medioPago: "MERCADO_LIBRE", monto: 13000 }],
        [{ varianteId: rosa.id, cantidad: 1, precioML: 13000, precioEspecial: 12500 }],
      ),
      DUENO,
    ),
  );
  check(especial instanceof DomainError, "venta ML con precio especial → error (manda el de ML)");

  const binance = await error(() =>
    generarVenta(
      ctxCos,
      ventaCos([{ medioPago: "BINANCE", monto: 12000 }], [{ varianteId: rosa.id, cantidad: 1 }]),
      DUENO,
    ),
  );
  check(
    binance instanceof DomainError && /Mercado Libre/.test(msg(binance)),
    `Binance no está habilitado en Cosmetic → «${msg(binance)}»`,
  );
  const mlEnVapes = await error(() =>
    generarVenta(
      ctx,
      entrada({
        cliente: { id: v1.cliente.id },
        items: [{ varianteId: mango.id, cantidad: 1 }],
        medioPago: "MERCADO_LIBRE",
      }),
      DUENO,
    ),
  );
  check(mlEnVapes instanceof DomainError, "Mercado Libre no está habilitado en Vapes");

  console.log("\n11) Facturas (Cosmetic factura; Vapes no)");
  const facturaB = await crearDesdeVenta(
    ctxCos,
    facturarVentaSchema.parse({ ventaId: porML.id, tipo: "B" }),
  );
  check(/^COS-F-\d{6}$/.test(facturaB.codigo), `factura B desde la venta: ${facturaB.codigo}`);
  const fb = await obtenerFactura(ctxCos, facturaB.id);
  check(
    fb.total === "54250.50" && fb.iva === "0.00" && fb.items.length === 3,
    `toma ítems y total de la venta (${fb.total}, ${fb.items.length} renglones)`,
  );
  const repetida = await error(() =>
    crearDesdeVenta(ctxCos, facturarVentaSchema.parse({ ventaId: porML.id, tipo: "B" })),
  );
  check(repetida instanceof DomainError, `una sola factura emitida por venta → «${msg(repetida)}»`);
  const pdf = await pdfFactura(ctxCos, facturaB.id);
  check(
    Buffer.from(pdf.pdf.subarray(0, 5)).toString() === "%PDF-",
    "el comprobante se genera en PDF",
  );
  const inmutable = await error(
    () => prisma.$executeRaw`UPDATE "Factura" SET "total" = 1 WHERE "id" = ${facturaB.id}`,
  );
  check(/no se modifica/.test(msg(inmutable)), "una factura emitida no se modifica (trigger)");
  await anularFactura(ctxCos, facturaB.id, "Error en el tipo");
  const facturaA = await crearDesdeVenta(
    ctxCos,
    facturarVentaSchema.parse({
      ventaId: porML.id,
      tipo: "A",
      datosFiscales: { razonSocial: "Clienta SRL", cuit: "20-12345678-6" },
    }),
  );
  const fa = await obtenerFactura(ctxCos, facturaA.id);
  check(
    fa.total === "54250.50" && fa.subtotal === "44835.12" && fa.iva === "9415.38",
    `anulada la B, se vuelve a facturar como A con IVA discriminado (${fa.subtotal} + ${fa.iva})`,
  );
  const suelta = await crearSuelta(
    ctxCos,
    facturaSueltaSchema.parse({
      clienteId: vCos.cliente.id,
      tipo: "COMPROBANTE_INTERNO",
      items: [{ descripcion: "Envío", cantidad: 1, precioUnitario: 2500 }],
    }),
  );
  check(
    (await obtenerFactura(ctxCos, suelta.id)).total === "2500.00",
    "factura suelta (comprobante interno)",
  );
  const listado = await listarFacturas(ctxCos, listarFacturasSchema.parse({}));
  check(listado.resumen.cantidad >= 2, `listado: ${listado.resumen.cantidad} emitidas`);
  const enVapes = await error(() =>
    crearDesdeVenta(ctx, facturarVentaSchema.parse({ ventaId: v1.id, tipo: "B" })),
  );
  check(
    enVapes instanceof DomainError && /facturación/.test(msg(enVapes)),
    `Vapes no tiene la facturación habilitada → «${msg(enVapes)}»`,
  );

  console.log("\n12) Facturas de ventas Mercado Libre (ARCA, por fuera)");
  const antes = await totalesFacturasML(ctxCos);
  const listaML = await listarVentasML(ctxCos, listarVentasMLSchema.parse({ pageSize: 100 }));
  const fila = (id: string) => listaML.ventas.find((v) => v.id === id);
  check(
    fila(porML.id)?.estado === "PENDIENTE" && fila(mixto.id)?.estado === "PENDIENTE",
    "cada venta ML aparece sola como pendiente",
  );
  check(
    !fila(efectivo.id) && !fila(mixtoMinoritario.id),
    "las ventas que no son ML (ni ML minoritario) no aparecen",
  );
  // Una venta ML anulada no aparece.
  const anulable = await generarVenta(
    ctxCos,
    ventaCos(
      [{ medioPago: "MERCADO_LIBRE", monto: 5000 }],
      [{ varianteId: rosa.id, cantidad: 1, precioML: 5000 }],
    ),
    DUENO,
  );
  await anularVenta(ctxCos, anulable.id, "Prueba de anulada");
  const conAnulada = await listarVentasML(ctxCos, listarVentasMLSchema.parse({ pageSize: 100 }));
  check(!conAnulada.ventas.some((v) => v.id === anulable.id), "una venta ML anulada no aparece");
  const noML = await error(() =>
    marcarFacturaMLCargada(
      ctxCos,
      cargarFacturaMLSchema.parse({ ventaId: efectivo.id, fecha: "2026-10-25" }),
    ),
  );
  check(noML instanceof DomainError, `una venta en efectivo no se carga → «${msg(noML)}»`);
  const exe = await error(() =>
    marcarFacturaMLCargada(
      ctxCos,
      cargarFacturaMLSchema.parse({ ventaId: porML.id, fecha: "2026-10-25" }),
      { datos: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), nombre: "factura.pdf" },
    ),
  );
  check(
    exe instanceof DomainError,
    "un archivo que no es PDF ni imagen se rechaza (por contenido)",
  );
  const pdfFalso = new TextEncoder().encode("%PDF-1.4\n% factura ARCA de prueba\n%%EOF");
  const cargada = await marcarFacturaMLCargada(
    ctxCos,
    cargarFacturaMLSchema.parse({ ventaId: porML.id, fecha: "2026-10-24" }),
    { datos: pdfFalso, nombre: "Factura ARCA ñandú.pdf" },
  );
  const sinArchivo = await marcarFacturaMLCargada(
    ctxCos,
    cargarFacturaMLSchema.parse({ ventaId: mixto.id, fecha: "2026-10-25" }),
  );
  const despues = await totalesFacturasML(ctxCos);
  const sumar = (a: string, b: string) => $(new Prisma.Decimal(a).plus(b));
  const restar = (a: string, b: string) => $(new Prisma.Decimal(a).minus(b));
  check(
    despues.cargadas.cantidad === antes.cargadas.cantidad + 2 &&
      despues.cargadas.total === sumar(sumar(antes.cargadas.total, porML.total), mixto.total) &&
      despues.pendientes.cantidad === antes.pendientes.cantidad - 2 &&
      despues.pendientes.total === restar(restar(antes.pendientes.total, porML.total), mixto.total),
    `tarjetas: cargadas ${despues.cargadas.cantidad} ($ ${despues.cargadas.total}), pendientes ${despues.pendientes.cantidad} ($ ${despues.pendientes.total})`,
  );
  const soloCargadas = await listarVentasML(
    ctxCos,
    listarVentasMLSchema.parse({ estado: "CARGADA", pageSize: 100 }),
  );
  const filaCargada = soloCargadas.ventas.find((v) => v.id === porML.id);
  check(
    !!filaCargada &&
      soloCargadas.ventas.every((v) => v.estado === "CARGADA") &&
      filaCargada.factura?.tieneArchivo === true &&
      filaCargada.factura.archivoTipo === "application/pdf",
    "filtro por estado: cargada, con su archivo",
  );
  check(
    soloCargadas.ventas.find((v) => v.id === mixto.id)?.factura?.tieneArchivo === false,
    "se puede marcar cargada sin archivo",
  );
  const archivo = await archivoFacturaML(ctxCos, porML.id);
  check(
    Buffer.from(archivo.datos.subarray(0, 5)).toString() === "%PDF-" &&
      archivo.tipo === "application/pdf" &&
      archivo.nombre === "Factura ARCA nandu.pdf",
    `el archivo se puede ver/descargar (${archivo.nombre})`,
  );
  const dosVeces = await error(() =>
    marcarFacturaMLCargada(
      ctxCos,
      cargarFacturaMLSchema.parse({ ventaId: porML.id, fecha: "2026-10-25" }),
    ),
  );
  check(dosVeces instanceof DomainError, `una sola carga por venta → «${msg(dosVeces)}»`);
  const auditoria = await prisma.auditLog.findFirst({
    where: { entidad: "FacturaMercadoLibre", entidadId: cargada.id },
  });
  check(auditoria !== null, "la carga queda en la auditoría");
  const tocada = await error(
    () =>
      prisma.$executeRaw`UPDATE "FacturaMercadoLibre" SET "archivoUrl" = NULL WHERE "id" = ${sinArchivo.id}`,
  );
  check(/no se modifica/.test(msg(tocada)), "la carga no se modifica (trigger)");
  const desdeVapes = await error(() => archivoFacturaML(ctx, porML.id));
  check(desdeVapes instanceof NotFoundError, "desde otro panel la carga no existe");

  console.log(fallos ? `\n✘ ${fallos} verificaciones fallaron` : "\n✔ Todo OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
