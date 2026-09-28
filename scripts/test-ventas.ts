/**
 * Ventas a nivel servicios + DB (panel Vapes): venta con un único medio de
 * pago, totales/costos/ganancia, ID de venta por panel, redondeo y precio
 * manual, anulación, snapshot de precios y costos (último costo de compra),
 * precio del producto vs. precio propio del sabor, permisos del empleado,
 * costos solo para dueños y aislamiento entre paneles.
 * Uso: pnpm test:ventas — pensado para una DB recién sembrada (crea datos).
 */
import { EstadoVenta, MedioPago, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { formatearIdVenta } from "../src/lib/paneles";
import { costoParaVenta, precioVentaEfectivo } from "../src/lib/precios";
import { crearClienteSchema } from "../src/lib/validations/cliente";
import {
  borradorVentaSchema,
  listarVentasSchema,
  venderSchema,
} from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../src/server/errors";
import { crearCliente } from "../src/server/services/cliente.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import {
  anularVenta,
  confirmarVenta,
  crearBorrador,
  listarVentas,
  obtenerVenta,
  vender,
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
const msg = (e: unknown) =>
  e instanceof Error ? (e.message.split("\n").filter(Boolean).pop() ?? e.message) : String(e);
const $ = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n).toFixed(2);

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
  const ctxCosmetic: Ctx = { panelId: COSMETIC, usuarioId: owner.id, meta };
  const DUENO = { puedeEditar: true };
  const EMPLEADO = { puedeEditar: false };
  const CON_COSTOS = { verCostos: true };
  const SIN_COSTOS = { verCostos: false };

  const g1 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const stock = async (varianteId: string) =>
    (
      await db.stock.findUnique({
        where: { panelId_varianteId_depositoId: { panelId: VAPES, varianteId, depositoId: g1.id } },
      })
    )?.cantidad ?? 0;
  // Catálogo propio (no depende del seed): un pod con 3 sabores —uno usa el
  // precio del producto, otro tiene precio propio y otro todavía no tiene
  // costo— y un cargador sin sabor (variante "Único").
  const suf = String(Date.now()).slice(-7);
  const catalogo = await transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test Ventas" } },
      update: {},
      create: { nombre: "Test Ventas" },
    });
    const pod = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod ${suf}`,
        especificacion: "5000",
        precioVenta: "16000.00",
        variantes: {
          create: [
            { nombre: "Mango Ice", sku: `TV-M-${suf}`, ultimoCosto: "9500.00" },
            {
              nombre: "Strawberry Watermelon",
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
    const cargador = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Cargador ${suf}`,
        precioVenta: "8900.00",
        variantes: { create: [{ nombre: "Único", sku: `TV-C-${suf}`, ultimoCosto: "4000.00" }] },
      },
      include: { variantes: true },
    });
    return { pod, cargador };
  });
  const { pod } = catalogo;
  const deVariante = (v: (typeof pod.variantes)[number], p: { precioVenta: Prisma.Decimal }) => ({
    ...v,
    precio: new Prisma.Decimal(precioVentaEfectivo(v, p)),
    costo: new Prisma.Decimal(costoParaVenta(v)),
  });
  const porNombre = (n: string) =>
    deVariante(
      pod.variantes.find((v) => v.nombre === n)!,
      pod,
    );
  const mango = porNombre("Mango Ice");
  const frutilla = porNombre("Strawberry Watermelon");
  const sinCosto = porNombre("Sin compras");
  const cargador = deVariante(catalogo.cargador.variantes[0]!, catalogo.cargador);
  // Stock holgado para no depender de lo que haya dejado otra prueba.
  for (const v of [mango, frutilla, sinCosto, cargador]) {
    if ((await stock(v.id)) < 10) {
      await registrarAjuste(ctx, {
        depositoId: g1.id,
        varianteId: v.id,
        cantidadReal: 20,
        motivo: "Preparación test-ventas",
      });
    }
  }
  const borrador = (
    items: { varianteId: string; cantidad: number; precioUnitario?: number }[],
    extra: Record<string, unknown> = {},
  ) => borradorVentaSchema.parse({ depositoId: g1.id, items, ...extra });

  // ---------------------------------------------------------------------------
  console.log(`\n1) 2 sabores + 1 cargador desde ${g1.nombre}, cobrado por transferencia`);
  const antes = await Promise.all([mango, frutilla, cargador].map((v) => stock(v.id)));
  const b1 = await crearBorrador(
    ctx,
    borrador([
      { varianteId: mango.id, cantidad: 1 },
      { varianteId: frutilla.id, cantidad: 1 },
      { varianteId: cargador.id, cantidad: 1 },
    ]),
    DUENO,
  );
  check(
    b1.idVenta === formatearIdVenta("vapes", b1.numero),
    `borrador ${b1.idVenta} (numeración del panel)`,
  );
  const v1 = await confirmarVenta(ctx, b1.id, { medioPago: MedioPago.TRANSFERENCIA });
  const d1 = await obtenerVenta(ctx, v1.id, CON_COSTOS);
  const total1 = mango.precio.plus(frutilla.precio).plus(cargador.precio);
  check(
    d1.estado === EstadoVenta.CONFIRMADA && d1.medioPago === MedioPago.TRANSFERENCIA,
    `venta ${d1.idVenta}: ${d1.estado} · ${d1.medioPago}`,
  );
  check(
    d1.total === $(total1),
    `total ${d1.total} = ${$(mango.precio)} + ${$(frutilla.precio)} + ${$(cargador.precio)}`,
  );
  const item = (d: typeof d1, varianteId: string) =>
    d.items.find((i) => i.varianteId === varianteId);
  check(
    item(d1, mango.id)?.precioUnitario === "16000.00" &&
      item(d1, frutilla.id)?.precioUnitario === "17000.00",
    "sabor sin precio propio cobra el del producto (16000); con precio propio, el suyo (17000)",
  );
  check(
    item(d1, mango.id)?.costoUnitario === "9500.00" &&
      item(d1, cargador.id)?.costoUnitario === "4000.00",
    "costoUnitario de cada ítem = snapshot del último costo del sabor",
  );
  check(
    item(d1, mango.id)?.nombre.includes(pod.nombreCompleto) === true &&
      item(d1, mango.id)?.nombre.includes("Mango Ice") === true &&
      item(d1, cargador.id)?.nombre === catalogo.cargador.nombreCompleto,
    `nombres: «${item(d1, mango.id)?.nombre}» · «${item(d1, cargador.id)?.nombre}» (sin "Único")`,
  );
  const costoEsperado = mango.costo.plus(frutilla.costo).plus(cargador.costo);
  check(
    d1.costoTotal === $(costoEsperado) && d1.gananciaBruta === $(total1.minus(costoEsperado)),
    `costoTotal ${d1.costoTotal} · gananciaBruta ${d1.gananciaBruta} = ${d1.total} − ${d1.costoTotal}`,
  );
  const movs = await db.movimientoStock.findMany({
    where: { referenciaTipo: "VENTA", referenciaId: v1.id },
  });
  check(
    movs.length === 3 && movs.every((m) => m.tipo === TipoMovimiento.VENTA && m.cantidad === 1),
    "3 movimientos VENTA con referencia a la venta",
  );
  const despues = await Promise.all([mango, frutilla, cargador].map((v) => stock(v.id)));
  check(
    despues.every((s, i) => s === antes[i]! - 1),
    `stock ${g1.nombre}: ${antes.join("/")} → ${despues.join("/")}`,
  );
  const reConfirmar = await error(() =>
    confirmarVenta(ctx, b1.id, { medioPago: MedioPago.EFECTIVO }),
  );
  check(reConfirmar instanceof DomainError, `confirmar dos veces → «${msg(reConfirmar)}»`);

  // ---------------------------------------------------------------------------
  console.log("\n2) Costos y ganancia: solo para dueños");
  const dEmp = await obtenerVenta(ctxEmp, v1.id, SIN_COSTOS);
  check(
    dEmp.costoTotal === null &&
      dEmp.gananciaBruta === null &&
      dEmp.items.every((i) => i.costoUnitario === null),
    "sin verCostos: ni costoTotal, ni ganancia, ni costo por ítem",
  );
  const lista = await listarVentas(ctxEmp, listarVentasSchema.parse({ q: d1.idVenta }), SIN_COSTOS);
  check(
    lista.ventas.length === 1 &&
      lista.ventas[0]?.id === v1.id &&
      lista.resumen.gananciaBruta === null,
    `buscar por ID de venta «${d1.idVenta}» la encuentra (sin ganancia para el empleado)`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Redondeo y precio manual (POS: vender)");
  const vRed = await vender(
    ctx,
    venderSchema.parse({
      venta: borrador([{ varianteId: cargador.id, cantidad: 1, precioUnitario: 8950 }]),
      medioPago: MedioPago.EFECTIVO,
      redondearA: 100,
    }),
    DUENO,
  );
  const dRed = await obtenerVenta(ctx, vRed.id, CON_COSTOS);
  check(
    dRed.total === "8900.00" && dRed.redondeo === "-50.00",
    `redondeo a $100: ${dRed.subtotal} → total ${dRed.total} (redondeo ${dRed.redondeo}, a favor del cliente)`,
  );
  check(
    new RegExp(`^Precio modificado por ${owner.nombre} de \\$\\s8\\.900 a \\$\\s8\\.950$`).test(
      dRed.items[0]?.notas ?? "",
    ),
    `precio manual registrado en el ítem: «${dRed.items[0]?.notas}»`,
  );
  const sinMedio = venderSchema.safeParse({
    venta: borrador([{ varianteId: cargador.id, cantidad: 1 }]),
  });
  check(!sinMedio.success, "vender sin medio de pago → error de validación");

  // ---------------------------------------------------------------------------
  console.log("\n4) Anular: la mercadería vuelve al depósito");
  const antesAnular = await stock(cargador.id);
  const anul = await anularVenta(ctx, vRed.id, "Error de carga (test)");
  const dAnul = await obtenerVenta(ctx, vRed.id, CON_COSTOS);
  check(
    dAnul.estado === EstadoVenta.ANULADA && dAnul.anulacion?.motivo === "Error de carga (test)",
    `venta ${anul.idVenta} ANULADA con motivo`,
  );
  check(
    (await stock(cargador.id)) === antesAnular + 1,
    `stock del cargador: ${antesAnular} → ${antesAnular + 1}`,
  );
  const devolucion = await db.movimientoStock.count({
    where: { referenciaId: vRed.id, tipo: TipoMovimiento.DEVOLUCION_CLIENTE },
  });
  check(devolucion === 1, "1 movimiento DEVOLUCION_CLIENTE por la anulación");
  const reAnular = await error(() => anularVenta(ctx, vRed.id, "otra vez"));
  check(reAnular instanceof DomainError, `anular dos veces → «${msg(reAnular)}»`);

  // ---------------------------------------------------------------------------
  console.log("\n5) Cambiar precios y costos después de vender no toca la venta vieja");
  await transaccion(ctx, async (tx) => {
    await tx.producto.update({ where: { id: pod.id }, data: { precioVenta: "17500.00" } });
    await tx.variante.update({ where: { id: mango.id }, data: { ultimoCosto: "10200.00" } });
  });
  const itemViejo = item(await obtenerVenta(ctx, v1.id, CON_COSTOS), mango.id)!;
  check(
    itemViejo.precioUnitario === $(mango.precio) && itemViejo.costoUnitario === $(mango.costo),
    `venta ${d1.idVenta} conserva precio ${itemViejo.precioUnitario} y costo ${itemViejo.costoUnitario} (lista nueva: 17500 / 10200)`,
  );
  const bNuevo = await crearBorrador(ctx, borrador([{ varianteId: mango.id, cantidad: 1 }]), DUENO);
  await transaccion(ctx, async (tx) => {
    await tx.producto.update({ where: { id: pod.id }, data: { precioVenta: "18000.00" } });
    await tx.variante.update({ where: { id: mango.id }, data: { ultimoCosto: "10300.00" } });
  });
  const vNuevo = await confirmarVenta(ctx, bNuevo.id, { medioPago: MedioPago.EFECTIVO });
  const dNuevo = await obtenerVenta(ctx, vNuevo.id, CON_COSTOS);
  check(
    vNuevo.total === "17500.00" && dNuevo.costoTotal === "10300.00",
    `borrador armado a 17500 y confirmado después del aumento a 18000 → cobra ${vNuevo.total}, costo del momento ${dNuevo.costoTotal}`,
  );
  const vSinCosto = await vender(
    ctx,
    venderSchema.parse({
      venta: borrador([{ varianteId: sinCosto.id, cantidad: 2 }]),
      medioPago: MedioPago.EFECTIVO,
    }),
    DUENO,
  );
  const dSinCosto = await obtenerVenta(ctx, vSinCosto.id, CON_COSTOS);
  check(
    dSinCosto.total === "36000.00" &&
      dSinCosto.items[0]?.costoUnitario === "0.00" &&
      dSinCosto.gananciaBruta === "36000.00",
    `sabor sin compras (ultimoCosto null): precio del producto 18000 ×2, costo snapshot ${dSinCosto.items[0]?.costoUnitario}`,
  );
  await transaccion(ctx, (tx) =>
    tx.variante.update({ where: { id: sinCosto.id }, data: { ultimoCosto: "9000.00" } }),
  );
  check(
    item(await obtenerVenta(ctx, vSinCosto.id, CON_COSTOS), sinCosto.id)?.costoUnitario === "0.00",
    "cargar el costo después no cambia la ganancia de esa venta",
  );

  // ---------------------------------------------------------------------------
  console.log("\n6) Empleado con «crear» sin «editar»: ni descuento ni precio manual");
  const eDesc = await error(() =>
    crearBorrador(
      ctxEmp,
      borrador([{ varianteId: cargador.id, cantidad: 1 }], {
        descuentoGlobal: { tipo: "monto", valor: 500 },
      }),
      EMPLEADO,
    ),
  );
  const ePrecio = await error(() =>
    crearBorrador(
      ctxEmp,
      borrador([{ varianteId: cargador.id, cantidad: 1, precioUnitario: 100 }]),
      EMPLEADO,
    ),
  );
  check(
    eDesc instanceof ForbiddenError && ePrecio instanceof ForbiddenError,
    `descuento → «${msg(eDesc)}» · precio manual → «${msg(ePrecio)}»`,
  );
  const vEmp = await vender(
    ctxEmp,
    venderSchema.parse({
      venta: borrador([{ varianteId: cargador.id, cantidad: 1 }]),
      medioPago: MedioPago.DEBITO,
    }),
    EMPLEADO,
  );
  check(
    vEmp.total === $(cargador.precio),
    `el empleado sí vende al precio de lista: ${vEmp.idVenta} ${vEmp.total}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n7) Clientes: teléfono normalizado y sin repetir dentro del panel");
  const tel = `11 ${String(Date.now()).slice(-8)}`;
  const cli = await crearCliente(
    ctx,
    crearClienteSchema.parse({ nombre: "Cliente", apellido: "Test ventas", telefono: tel }),
  );
  const dup = await error(() =>
    crearCliente(ctx, crearClienteSchema.parse({ nombre: "Otro", telefono: `+54 ${tel}` })),
  );
  check(
    dup instanceof ConflictError && /Test ventas/.test(msg(dup)),
    `mismo teléfono en Vapes → «${msg(dup)}»`,
  );
  const enCosmetic = await crearCliente(
    ctxCosmetic,
    crearClienteSchema.parse({ nombre: "Homónimo", telefono: tel }),
  );
  check(
    enCosmetic.id !== cli.id,
    "el mismo teléfono en Cosmetic es otro cliente (paneles independientes)",
  );
  const vCli = await vender(
    ctx,
    venderSchema.parse({
      venta: borrador([{ varianteId: cargador.id, cantidad: 1 }], { clienteId: cli.id }),
      medioPago: MedioPago.MERCADOPAGO,
    }),
    DUENO,
  );
  const dCli = await obtenerVenta(ctx, vCli.id, SIN_COSTOS);
  check(
    dCli.cliente?.telefono?.startsWith("+54") === true,
    `venta ${vCli.idVenta} a ${dCli.cliente?.nombre} (${dCli.cliente?.telefono})`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n8) Aislamiento entre paneles");
  const depCosmetic = await dbPara(COSMETIC).deposito.findFirstOrThrow({
    where: { esPrincipal: true },
  });
  const eVar = await error(() =>
    crearBorrador(
      ctxCosmetic,
      borradorVentaSchema.parse({
        depositoId: depCosmetic.id,
        items: [{ varianteId: mango.id, cantidad: 1 }],
      }),
      DUENO,
    ),
  );
  check(eVar instanceof NotFoundError, `vender en Cosmetic una variante de Vapes → «${msg(eVar)}»`);
  const eDep = await error(() =>
    crearBorrador(
      ctxCosmetic,
      borradorVentaSchema.parse({
        depositoId: g1.id,
        items: [{ varianteId: mango.id, cantidad: 1 }],
      }),
      DUENO,
    ),
  );
  check(
    eDep instanceof NotFoundError,
    `vender en Cosmetic desde un depósito de Vapes → «${msg(eDep)}»`,
  );
  const eCli = await error(() =>
    crearBorrador(
      ctx,
      borrador([{ varianteId: mango.id, cantidad: 1 }], { clienteId: enCosmetic.id }),
      DUENO,
    ),
  );
  check(
    eCli instanceof NotFoundError,
    `cliente de Cosmetic en una venta de Vapes → «${msg(eCli)}»`,
  );
  const eLeer = await error(() => obtenerVenta(ctxCosmetic, v1.id, CON_COSTOS));
  check(eLeer instanceof NotFoundError, "leer una venta de Vapes desde Cosmetic → no existe");
  const eAnular = await error(() => anularVenta(ctxCosmetic, v1.id, "intruso"));
  check(eAnular instanceof NotFoundError, "anular una venta de Vapes desde Cosmetic → no existe");
  check(
    (await obtenerVenta(ctx, v1.id, SIN_COSTOS)).estado === EstadoVenta.CONFIRMADA,
    "la venta de Vapes sigue intacta",
  );
  const listaCosmetic = await listarVentas(ctxCosmetic, listarVentasSchema.parse({}), CON_COSTOS);
  check(
    listaCosmetic.ventas.every((v) => v.id !== v1.id),
    "el listado de Cosmetic no muestra ventas de Vapes",
  );

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
