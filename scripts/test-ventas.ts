/**
 * Ventas a nivel servicios + DB (panel Vapes): venta con un único medio de
 * pago, totales/costos/ganancia, ID de venta por panel, redondeo y precio
 * manual, anulación, snapshot de precios, permisos del empleado, costos solo
 * para dueños y aislamiento entre paneles.
 * Uso: pnpm test:ventas — pensado para una DB recién sembrada (crea datos).
 */
import { EstadoVenta, MedioPago, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { formatearIdVenta } from "../src/lib/paneles";
import { crearClienteSchema } from "../src/lib/validations/cliente";
import {
  borradorVentaSchema,
  listarVentasSchema,
  venderSchema,
} from "../src/lib/validations/venta";
import { dbPara, type Ctx } from "../src/server/db/panel-scoped";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../src/server/errors";
import { crearCliente } from "../src/server/services/cliente.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { actualizarPrecios } from "../src/server/services/producto.service";
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
  const variante = (producto: string, nombre: string) =>
    db.variante.findFirstOrThrow({ where: { nombre, producto: { nombre: producto } } });
  const stock = async (varianteId: string) =>
    (
      await db.stock.findUnique({
        where: { panelId_varianteId_depositoId: { panelId: VAPES, varianteId, depositoId: g1.id } },
      })
    )?.cantidad ?? 0;
  const [mango, frutilla, cargador] = await Promise.all([
    variante("Ignite V80", "Mango Ice"),
    variante("Ignite V80", "Strawberry Watermelon"),
    variante("Cargador USB-C 20W", "Único"),
  ]);
  // Stock holgado para no depender de lo que haya dejado otra prueba.
  for (const v of [mango, frutilla, cargador]) {
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
  const total1 = mango.precioVenta.plus(frutilla.precioVenta).plus(cargador.precioVenta);
  check(
    d1.estado === EstadoVenta.CONFIRMADA && d1.medioPago === MedioPago.TRANSFERENCIA,
    `venta ${d1.idVenta}: ${d1.estado} · ${d1.medioPago}`,
  );
  check(
    d1.total === $(total1),
    `total ${d1.total} = ${$(mango.precioVenta)} + ${$(frutilla.precioVenta)} + ${$(cargador.precioVenta)}`,
  );
  const costoEsperado = mango.precioCosto.plus(frutilla.precioCosto).plus(cargador.precioCosto);
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
  console.log("\n5) Cambiar precios después de vender no toca la venta vieja");
  await actualizarPrecios(
    ctx,
    mango.id,
    { precioVenta: 17500, precioCosto: 10200 },
    "Aumento de lista (test)",
  );
  const itemViejo = (await obtenerVenta(ctx, v1.id, CON_COSTOS)).items.find(
    (i) => i.varianteId === mango.id,
  )!;
  check(
    itemViejo.precioUnitario === $(mango.precioVenta) &&
      itemViejo.costoUnitario === $(mango.precioCosto),
    `venta ${d1.idVenta} conserva precio ${itemViejo.precioUnitario} y costo ${itemViejo.costoUnitario} (lista nueva: 17500 / 10200)`,
  );
  const bNuevo = await crearBorrador(ctx, borrador([{ varianteId: mango.id, cantidad: 1 }]), DUENO);
  await actualizarPrecios(ctx, mango.id, { precioVenta: 18000 }, "Otro aumento (test)");
  const vNuevo = await confirmarVenta(ctx, bNuevo.id, { medioPago: MedioPago.EFECTIVO });
  const dNuevo = await obtenerVenta(ctx, vNuevo.id, CON_COSTOS);
  check(
    vNuevo.total === "17500.00" && dNuevo.costoTotal === "10200.00",
    `borrador armado a 17500 y confirmado después del aumento a 18000 → cobra ${vNuevo.total}, costo del momento ${dNuevo.costoTotal}`,
  );
  await actualizarPrecios(
    ctx,
    mango.id,
    { precioVenta: mango.precioVenta.toNumber(), precioCosto: mango.precioCosto.toNumber() },
    "Restaurar (test)",
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
    vEmp.total === $(cargador.precioVenta),
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

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
