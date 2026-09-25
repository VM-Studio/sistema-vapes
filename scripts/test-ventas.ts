/**
 * Verificación del Prompt 5 a nivel servicios + DB: venta con pago partido,
 * fiado con límite, cobro de cuenta corriente, devoluciones, anulación,
 * snapshot de precios/costos, permisos y protecciones de la DB.
 * Uso: pnpm test:ventas — pensado para una DB recién sembrada (crea datos).
 */
import {
  EstadoComprobante,
  EstadoPago,
  EstadoVenta,
  MedioPago,
  Prisma,
  RolUsuario,
  TipoMovimiento,
} from "@prisma/client";

import { prisma, withTransaction } from "../src/lib/db";
import { borradorVentaSchema, devolucionSchema } from "../src/lib/validations/venta";
import { crearClienteSchema } from "../src/lib/validations/cliente";
import { DomainError, ForbiddenError } from "../src/server/errors";
import { crearCliente, obtenerCuentaCorriente } from "../src/server/services/cliente.service";
import { actualizarPrecios } from "../src/server/services/producto.service";
import {
  anularPago,
  anularVenta,
  confirmarVenta,
  crearBorrador,
  crearDevolucion,
  obtenerVenta,
  pagarACuenta,
  registrarPago,
  resumenVentas,
  topVariantes,
} from "../src/server/services/venta.service";
import { claveDeUrl, storage } from "../src/server/storage";

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
    where: { rol: RolUsuario.OWNER, email: "dueno1@negocio.com" },
  });
  const empleado = await prisma.usuario.findFirstOrThrow({
    where: { email: "empleado@negocio.com" },
  });
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-ventas" } };
  const actorEmp = { id: empleado.id, meta: { ip: "127.0.0.1", userAgent: "test-ventas" } };
  const DUENO = { puedeEditar: true };
  const EMPLEADO = { puedeEditar: false };
  const [g1] = await prisma.deposito.findMany({ where: { esPrincipal: true } });
  if (!g1) throw new Error("Falta el depósito principal");
  const variante = (producto: string, nombre: string) =>
    prisma.variante.findFirstOrThrow({ where: { nombre, producto: { nombre: producto } } });
  const mango = await variante("Ignite V80", "Mango Ice");
  const frutilla = await variante("Ignite V80", "Strawberry Watermelon");
  const cargador = await variante("Cargador USB-C 20W", "Único");
  const stock = async (varianteId: string) =>
    (
      await prisma.stock.findUnique({
        where: { varianteId_depositoId: { varianteId, depositoId: g1.id } },
      })
    )?.cantidad ?? 0;
  const borrador = (
    items: { varianteId: string; cantidad: number; precioUnitario?: number }[],
    extra: Record<string, unknown> = {},
  ) => borradorVentaSchema.parse({ depositoId: g1.id, items, ...extra });

  // ---------------------------------------------------------------------------
  console.log(
    "\n1) 2 sabores + 1 cargador desde Galpón 1, pago partido $10.000 efectivo + resto transferencia",
  );
  const antes = await Promise.all([mango, frutilla, cargador].map((v) => stock(v.id)));
  const ultimoTicket =
    (await prisma.secuenciaComprobante.findFirst({ where: { tipo: "TICKET", puntoVenta: 1 } }))
      ?.ultimoNumero ?? 0;
  const b1 = await crearBorrador(
    borrador([
      { varianteId: mango.id, cantidad: 1 },
      { varianteId: frutilla.id, cantidad: 1 },
      { varianteId: cargador.id, cantidad: 1 },
    ]),
    actor,
    DUENO,
  );
  const total1 = mango.precioVenta.plus(frutilla.precioVenta).plus(cargador.precioVenta);
  const v1 = await confirmarVenta(
    b1.id,
    {
      pagos: [
        { medioPago: MedioPago.EFECTIVO, monto: 10000 },
        {
          medioPago: MedioPago.TRANSFERENCIA,
          monto: total1.minus(10000).toNumber(),
          referencia: "OP-778899",
        },
      ],
    },
    actor,
    DUENO,
  );
  const d1 = await obtenerVenta(v1.id);
  check(
    d1.estado === EstadoVenta.CONFIRMADA && d1.estadoPago === EstadoPago.PAGADA,
    `venta #${d1.numero}: ${d1.estado} · ${d1.estadoPago}`,
  );
  check(
    d1.total === $(total1),
    `total ${d1.total} = ${$(mango.precioVenta)} + ${$(frutilla.precioVenta)} + ${$(cargador.precioVenta)}`,
  );
  const costoEsperado = mango.precioCosto.plus(frutilla.precioCosto).plus(cargador.precioCosto);
  check(
    d1.costoTotal === $(costoEsperado) && d1.gananciaBruta === $(total1.minus(costoEsperado)),
    `costoTotal ${d1.costoTotal} = ${$(mango.precioCosto)} + ${$(frutilla.precioCosto)} + ${$(cargador.precioCosto)} · gananciaBruta ${d1.gananciaBruta} = ${d1.total} − ${d1.costoTotal}`,
  );
  check(
    d1.pagos.length === 2 &&
      d1.pagos[1]?.referencia === "OP-778899" &&
      d1.pagos[1]?.monto === $(total1.minus(10000)),
    `pagos: ${d1.pagos.map((p) => `${p.etiqueta} ${p.monto}${p.referencia ? ` (${p.referencia})` : ""}`).join(" + ")}`,
  );
  const movs = await prisma.movimientoStock.findMany({
    where: { referenciaTipo: "VENTA", referenciaId: v1.id },
  });
  check(
    movs.length === 3 && movs.every((m) => m.tipo === TipoMovimiento.VENTA && m.cantidad === 1),
    "3 movimientos VENTA con referencia a la venta",
  );
  const despues = await Promise.all([mango, frutilla, cargador].map((v) => stock(v.id)));
  check(
    despues.every((s, i) => s === antes[i]! - 1),
    `stock Galpón 1: ${antes.join("/")} → ${despues.join("/")}`,
  );
  check(
    v1.comprobante?.tipo === "TICKET" && v1.comprobante.numero === ultimoTicket + 1,
    `comprobante TICKET N° ${v1.comprobante?.numero} emitido`,
  );
  const clave = v1.comprobante?.pdfUrl ? claveDeUrl(v1.comprobante.pdfUrl) : null;
  const archivo = clave ? await storage.leer(clave) : null;
  check(
    archivo !== null && Buffer.from(archivo.datos.slice(0, 5)).toString() === "%PDF-",
    `PDF generado (${archivo?.datos.length ?? 0} bytes) en ${v1.comprobante?.pdfUrl}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n   Reglas del cobro");
  const bMas = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1 }]),
    actor,
    DUENO,
  );
  const eMas = await error(() =>
    confirmarVenta(
      bMas.id,
      { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 10000 }] },
      actor,
      DUENO,
    ),
  );
  check(
    eMas instanceof DomainError && /superan el total/.test(msg(eMas)),
    `pagar de más → «${msg(eMas)}»`,
  );
  const eSinCliente = await error(() =>
    confirmarVenta(
      bMas.id,
      { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 5000 }] },
      actor,
      DUENO,
    ),
  );
  check(
    eSinCliente instanceof DomainError && /elegí el cliente/.test(msg(eSinCliente)),
    `pago parcial sin cliente → «${msg(eSinCliente)}»`,
  );
  const bRed = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1, precioUnitario: 8950 }]),
    actor,
    DUENO,
  );
  const vRed = await confirmarVenta(
    bRed.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 8900 }], redondearA: 100 },
    actor,
    DUENO,
  );
  const dRed = await obtenerVenta(vRed.id);
  check(
    dRed.total === "8900.00" && dRed.redondeo === "-50.00",
    `redondeo a $100: ${dRed.subtotal} → total ${dRed.total} (redondeo ${dRed.redondeo}, a favor del cliente)`,
  );
  check(
    /^Precio modificado por Dueño 1 de \$\s8\.900 a \$\s8\.950$/.test(dRed.items[0]?.notas ?? ""),
    `precio manual registrado en el ítem: «${dRed.items[0]?.notas}»`,
  );
  await confirmarVenta(
    bMas.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 8900 }] },
    actor,
    DUENO,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Fiado a un cliente con límite $50.000");
  const cli = await crearCliente(
    crearClienteSchema.parse({
      nombre: "Juana",
      apellido: `Fiada ${Date.now() % 100000}`,
      telefono: "11 5555-1234",
      limiteCredito: "50000",
    }),
    actor,
    { puedeDefinirLimite: true },
  );
  const eLimiteEmp = await error(() =>
    crearCliente(crearClienteSchema.parse({ nombre: "X", limiteCredito: "1000" }), actorEmp, {
      puedeDefinirLimite: false,
    }),
  );
  check(eLimiteEmp instanceof ForbiddenError, "un empleado no puede definir límite de crédito");
  const b3 = await crearBorrador(
    borrador([{ varianteId: mango.id, cantidad: 2, precioUnitario: 15000 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  const eFiadoEmp = await error(() =>
    confirmarVenta(
      b3.id,
      { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 10000 }] },
      actorEmp,
      EMPLEADO,
    ),
  );
  check(
    eFiadoEmp instanceof ForbiddenError,
    `empleado sin «editar» no puede fiar → «${msg(eFiadoEmp)}»`,
  );
  const v3 = await confirmarVenta(
    b3.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 10000 }] },
    actor,
    DUENO,
  );
  let c3 = await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } });
  check(
    v3.total === "30000.00" &&
      v3.estadoPago === EstadoPago.PARCIAL &&
      v3.saldoPendiente === "20000.00" &&
      $(c3.saldoDeudor) === "20000.00",
    `total ${v3.total}, pagó 10000 → ${v3.estadoPago}, saldoPendiente ${v3.saldoPendiente}, cliente.saldoDeudor ${$(c3.saldoDeudor)}`,
  );
  const ePagoDeMas = await error(() =>
    registrarPago(v3.id, { medioPago: MedioPago.EFECTIVO, monto: 25000 }, actor),
  );
  check(ePagoDeMas instanceof DomainError, `cobrar más que el saldo → «${msg(ePagoDeMas)}»`);
  const p3 = await registrarPago(
    v3.id,
    { medioPago: MedioPago.MERCADOPAGO, monto: 20000, referencia: "MP-1" },
    actor,
  );
  c3 = await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } });
  check(
    p3.estadoPago === EstadoPago.PAGADA &&
      p3.saldoPendiente === "0.00" &&
      $(c3.saldoDeudor) === "0.00",
    `pago de 20000 → ${p3.estadoPago}, saldo ${p3.saldoPendiente}, deuda ${$(c3.saldoDeudor)}`,
  );
  const stockAntesFiar = await stock(mango.id);
  const b60 = await crearBorrador(
    borrador([{ varianteId: mango.id, cantidad: 2, precioUnitario: 30000 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  const e60 = await error(() => confirmarVenta(b60.id, { pagos: [] }, actor, DUENO));
  const sigueBorrador = (await prisma.venta.findUniqueOrThrow({ where: { id: b60.id } })).estado;
  check(
    e60 instanceof DomainError && /límite de crédito/.test(msg(e60)),
    `fiar $60.000 → «${msg(e60)}»`,
  );
  check(
    sigueBorrador === EstadoVenta.BORRADOR && (await stock(mango.id)) === stockAntesFiar,
    "…y no se descontó nada: la venta sigue en borrador",
  );

  // Pago a cuenta imputado a varias ventas (de la más vieja a la más nueva).
  const bA = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  const vA = await confirmarVenta(bA.id, { pagos: [] }, actor, DUENO);
  const bB = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  await confirmarVenta(
    bB.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 900 }] },
    actor,
    DUENO,
  );
  const acuenta = await pagarACuenta(
    { clienteId: cli.id, medioPago: MedioPago.EFECTIVO, monto: 10000 },
    actor,
  );
  check(
    acuenta.imputaciones.length === 2 &&
      acuenta.imputaciones[0]?.ventaId === vA.id &&
      acuenta.imputaciones[0]?.monto === "8900.00" &&
      acuenta.imputaciones[1]?.monto === "1100.00",
    `pago a cuenta de 10000 → ${acuenta.imputaciones.map((i) => `#${i.numero}: ${i.monto}`).join(", ")} · deuda ${acuenta.saldoDeudor}`,
  );
  const cc = await obtenerCuentaCorriente(cli.id);
  check(
    cc.movimientos.at(-1)?.saldo === cc.saldoDeudor,
    `cuenta corriente: ${cc.movimientos.length} movimientos, saldo acumulado final ${cc.movimientos.at(-1)?.saldo} = saldoDeudor ${cc.saldoDeudor}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n4) Devolución parcial: 1 unidad de un sabor, reintegro en efectivo");
  const itemMango = d1.items.find((i) => i.varianteId === mango.id)!;
  const stockMangoAntes = await stock(mango.id);
  const dev = await crearDevolucion(
    devolucionSchema.parse({
      ventaId: v1.id,
      depositoId: g1.id,
      motivo: "Venía fallado",
      items: [{ ventaItemId: itemMango.id, cantidad: 1 }],
      reintegro: { tipo: "dinero", medioPago: "EFECTIVO" },
    }),
    actor,
  );
  const movDev = await prisma.movimientoStock.findMany({
    where: { referenciaTipo: "DEVOLUCION", referenciaId: dev.id },
  });
  const itemTras = await prisma.ventaItem.findUniqueOrThrow({ where: { id: itemMango.id } });
  check(
    movDev.length === 1 &&
      movDev[0]!.tipo === TipoMovimiento.DEVOLUCION_CLIENTE &&
      movDev[0]!.cantidad === 1,
    "1 movimiento DEVOLUCION_CLIENTE por 1 unidad",
  );
  check(
    itemTras.cantidadDevuelta === 1 && (await stock(mango.id)) === stockMangoAntes + 1,
    `cantidadDevuelta 1 · stock ${stockMangoAntes} → ${await stock(mango.id)}`,
  );
  check(
    dev.reintegroMonto === $(mango.precioVenta),
    `reintegroMonto ${dev.reintegroMonto} (precio del ítem, sin descuento global)`,
  );
  const itemFiado = (await obtenerVenta(v3.id)).items[0]!;
  const e5de2 = await error(() =>
    crearDevolucion(
      devolucionSchema.parse({
        ventaId: v3.id,
        depositoId: g1.id,
        motivo: "x",
        items: [{ ventaItemId: itemFiado.id, cantidad: 5 }],
        reintegro: { tipo: "dinero", medioPago: "EFECTIVO" },
      }),
      actor,
    ),
  );
  check(
    e5de2 instanceof DomainError && /se pueden devolver 2, no 5/.test(msg(e5de2)),
    `devolver 5 de un ítem de 2 → «${msg(e5de2)}»`,
  );
  const eOtraVez = await error(() =>
    crearDevolucion(
      devolucionSchema.parse({
        ventaId: v1.id,
        depositoId: g1.id,
        motivo: "x",
        items: [{ ventaItemId: itemMango.id, cantidad: 1 }],
        reintegro: { tipo: "dinero", medioPago: "EFECTIVO" },
      }),
      actor,
    ),
  );
  check(
    eOtraVez instanceof DomainError,
    `volver a devolver el mismo ítem ya devuelto → «${msg(eOtraVez)}»`,
  );

  // Devolución con descuento global: el reintegro es proporcional.
  const bDesc = await crearBorrador(
    borrador([{ varianteId: frutilla.id, cantidad: 2 }], {
      descuentoGlobal: { tipo: "porcentaje", valor: 10 },
    }),
    actor,
    DUENO,
  );
  // Precios del momento (otros tests pueden haber aplicado aumentos): 2 × precio − 10%.
  const totalDesc = frutilla.precioVenta.mul(2).mul(0.9).toDecimalPlaces(2);
  const vDesc = await confirmarVenta(
    bDesc.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: totalDesc.toNumber() }] },
    actor,
    DUENO,
  );
  const itemDesc = (await obtenerVenta(vDesc.id)).items[0]!;
  const devDesc = await crearDevolucion(
    devolucionSchema.parse({
      ventaId: vDesc.id,
      depositoId: g1.id,
      motivo: "No le gustó",
      items: [{ ventaItemId: itemDesc.id, cantidad: 1 }],
      reintegro: { tipo: "dinero", medioPago: "EFECTIVO" },
    }),
    actor,
  );
  check(
    vDesc.total === $(totalDesc) && devDesc.reintegroMonto === $(totalDesc.div(2)),
    `venta 2×${$(frutilla.precioVenta)} −10% = ${vDesc.total} → devolver 1 reintegra ${devDesc.reintegroMonto} (proporcional al descuento)`,
  );

  // Devolución a cuenta corriente: cancela deuda primero, el resto queda a favor.
  const bCC = await crearBorrador(
    borrador([{ varianteId: frutilla.id, cantidad: 2 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  const vCC = await confirmarVenta(
    bCC.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 10000 }] },
    actor,
    DUENO,
  );
  const deudaAntes = (await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } }))
    .saldoDeudor;
  const itemCC = (await obtenerVenta(vCC.id)).items[0]!;
  const devCC = await crearDevolucion(
    devolucionSchema.parse({
      ventaId: vCC.id,
      depositoId: g1.id,
      motivo: "Cambio de idea",
      items: [{ ventaItemId: itemCC.id, cantidad: 2 }],
      reintegro: { tipo: "cuentaCorriente" },
    }),
    actor,
  );
  const cCC = await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } });
  const ventaCC = await prisma.venta.findUniqueOrThrow({ where: { id: vCC.id } });
  // Debía (2 × precio − 10000) de esta venta + lo que quedaba de antes: el crédito cancela todo y el resto queda a favor.
  const credito = frutilla.precioVenta.mul(2);
  const aFavorEsperado = credito.minus(deudaAntes);
  check(
    devCC.aCuentaCorriente === $(credito) &&
      ventaCC.saldoPendiente.isZero() &&
      cCC.saldoDeudor.isZero() &&
      cCC.saldoAFavor.equals(aFavorEsperado),
    `devolución a cuenta de ${$(credito)}: cancela esta venta (${$(credito.minus(10000))}) y la deuda vieja · deuda ${$(deudaAntes)} → ${$(cCC.saldoDeudor)} · a favor ${$(cCC.saldoAFavor)}`,
  );
  const bUsa = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  const vUsa = await confirmarVenta(
    bUsa.id,
    {
      pagos: [
        { medioPago: MedioPago.CREDITO_CLIENTE, monto: aFavorEsperado.toNumber() },
        { medioPago: MedioPago.EFECTIVO, monto: 8900 - aFavorEsperado.toNumber() },
      ],
    },
    actor,
    DUENO,
  );
  const cUsa = await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } });
  check(
    vUsa.estadoPago === EstadoPago.PAGADA && cUsa.saldoAFavor.isZero(),
    `compra de 8900: ${$(aFavorEsperado)} con saldo a favor + el resto en efectivo → saldo a favor ${$(cUsa.saldoAFavor)}`,
  );
  const eSinSaldo = await error(async () => {
    const b = await crearBorrador(
      borrador([{ varianteId: cargador.id, cantidad: 1 }], { clienteId: cli.id }),
      actor,
      DUENO,
    );
    await confirmarVenta(
      b.id,
      { pagos: [{ medioPago: MedioPago.CREDITO_CLIENTE, monto: 100 }] },
      actor,
      DUENO,
    );
  });
  check(eSinSaldo instanceof DomainError, `usar saldo a favor que no tiene → «${msg(eSinSaldo)}»`);

  // ---------------------------------------------------------------------------
  console.log("\n5) Anular una venta fiada");
  const bAn = await crearBorrador(
    borrador(
      [
        { varianteId: frutilla.id, cantidad: 1 },
        { varianteId: cargador.id, cantidad: 1 },
      ],
      { clienteId: cli.id },
    ),
    actor,
    DUENO,
  );
  const vAn = await confirmarVenta(
    bAn.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 5000 }] },
    actor,
    DUENO,
  );
  const deudaConVenta = (await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } }))
    .saldoDeudor;
  const stockAnAntes = await Promise.all([frutilla, cargador].map((v) => stock(v.id)));
  await anularVenta(vAn.id, "El cliente se arrepintió", actor);
  const dAn = await obtenerVenta(vAn.id);
  const movAn = await prisma.movimientoStock.findMany({
    where: {
      referenciaTipo: "VENTA",
      referenciaId: vAn.id,
      tipo: TipoMovimiento.DEVOLUCION_CLIENTE,
    },
  });
  const deudaDespues = (await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } }))
    .saldoDeudor;
  check(
    dAn.estado === EstadoVenta.ANULADA && dAn.anulacion?.motivo === "El cliente se arrepintió",
    `venta #${dAn.numero} ANULADA por ${dAn.anulacion?.por}`,
  );
  check(movAn.length === 2, "2 movimientos DEVOLUCION_CLIENTE (uno por ítem)");
  check(
    (await Promise.all([frutilla, cargador].map((v) => stock(v.id)))).every(
      (s, i) => s === stockAnAntes[i]! + 1,
    ),
    "el stock volvió al depósito",
  );
  check(
    dAn.pagos.every((p) => p.anulado),
    `pagos anulados: ${dAn.pagos.length}/${dAn.pagos.length}`,
  );
  check(
    dAn.comprobante?.estado === EstadoComprobante.ANULADO,
    `comprobante N° ${dAn.comprobante?.numero} → ${dAn.comprobante?.estado}`,
  );
  check(
    deudaDespues.equals(deudaConVenta.minus(vAn.saldoPendiente)),
    `saldoDeudor ${$(deudaConVenta)} → ${$(deudaDespues)} (se revirtieron los ${vAn.saldoPendiente} fiados)`,
  );
  const eAnConDev = await error(() => anularVenta(v1.id, "x", actor));
  check(
    eAnConDev instanceof DomainError && /devoluciones/.test(msg(eAnConDev)),
    `anular una venta con devoluciones → «${msg(eAnConDev)}»`,
  );

  // Anular un pago (OWNER): la venta vuelve a deber.
  const pagoTransf = d1.pagos.find((p) => p.medioPago === MedioPago.TRANSFERENCIA)!;
  const bP = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1 }], { clienteId: cli.id }),
    actor,
    DUENO,
  );
  const vP = await confirmarVenta(
    bP.id,
    { pagos: [{ medioPago: MedioPago.TRANSFERENCIA, monto: 8900, referencia: "rebotó" }] },
    actor,
    DUENO,
  );
  const pagoP = (await obtenerVenta(vP.id)).pagos[0]!;
  const deudaP = (await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } })).saldoDeudor;
  await anularPago(pagoP.id, "La transferencia no llegó", actor);
  const vPd = await prisma.venta.findUniqueOrThrow({ where: { id: vP.id } });
  const deudaP2 = (await prisma.cliente.findUniqueOrThrow({ where: { id: cli.id } })).saldoDeudor;
  check(
    vPd.estadoPago === EstadoPago.PENDIENTE &&
      $(vPd.saldoPendiente) === "8900.00" &&
      deudaP2.equals(deudaP.plus(8900)),
    `anular un pago → venta PENDIENTE, deuda del cliente +8900`,
  );
  void pagoTransf;

  // ---------------------------------------------------------------------------
  console.log("\n6) Cambiar precios después de vender no toca la venta vieja");
  await actualizarPrecios(
    mango.id,
    { precioVenta: 17500, precioCosto: 10200 },
    actor,
    "Aumento de lista (test)",
  );
  const itemViejo = (await obtenerVenta(v1.id)).items.find((i) => i.varianteId === mango.id)!;
  check(
    itemViejo.precioUnitario === $(mango.precioVenta) &&
      itemViejo.costoUnitario === $(mango.precioCosto),
    `venta #${d1.numero} conserva precio ${itemViejo.precioUnitario} y costo ${itemViejo.costoUnitario} (lista nueva: 17500 / 10200)`,
  );
  const bNuevo = await crearBorrador(
    borrador([{ varianteId: mango.id, cantidad: 1 }]),
    actor,
    DUENO,
  );
  await actualizarPrecios(mango.id, { precioVenta: 18000 }, actor, "Otro aumento (test)");
  const vNuevo = await confirmarVenta(
    bNuevo.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 17500 }] },
    actor,
    DUENO,
  );
  check(
    vNuevo.total === "17500.00",
    `borrador armado a 17500 y confirmado después del aumento a 18000 → cobra ${vNuevo.total} (lo que vio el vendedor)`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n7) Empleado con «crear» sin «editar»: ni descuento ni precio manual");
  const eDesc = await error(() =>
    crearBorrador(
      borrador([{ varianteId: cargador.id, cantidad: 1 }], {
        descuentoGlobal: { tipo: "monto", valor: 500 },
      }),
      actorEmp,
      EMPLEADO,
    ),
  );
  const ePrecio = await error(() =>
    crearBorrador(
      borrador([{ varianteId: cargador.id, cantidad: 1, precioUnitario: 100 }]),
      actorEmp,
      EMPLEADO,
    ),
  );
  check(
    eDesc instanceof ForbiddenError && ePrecio instanceof ForbiddenError,
    `descuento → «${msg(eDesc)}» · precio manual → «${msg(ePrecio)}»`,
  );
  const bEmp = await crearBorrador(
    borrador([{ varianteId: cargador.id, cantidad: 1 }]),
    actorEmp,
    EMPLEADO,
  );
  const vEmp = await confirmarVenta(
    bEmp.id,
    { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: 8900 }] },
    actorEmp,
    EMPLEADO,
  );
  check(
    vEmp.estadoPago === EstadoPago.PAGADA,
    `el empleado sí vende al precio de lista: venta #${vEmp.numero} ${vEmp.total}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n   Protecciones de la DB");
  const pagoUno = await prisma.pagoVenta.findFirstOrThrow({ where: { ventaId: v1.id } });
  const eMonto = await error(() =>
    prisma.pagoVenta.update({ where: { id: pagoUno.id }, data: { monto: 1 } }),
  );
  check(
    eMonto !== null && /no se modifica/.test(msg(eMonto)),
    "editar el monto de un pago → rechazado por trigger",
  );
  const eBorrar = await error(() => prisma.pagoVenta.delete({ where: { id: pagoUno.id } }));
  check(eBorrar !== null, "borrar un pago → rechazado por trigger");
  const eSaldo = await error(() =>
    prisma.cliente.update({ where: { id: cli.id }, data: { saldoDeudor: { increment: 1 } } }),
  );
  check(
    eSaldo !== null && /Saldo deudor/.test(msg(eSaldo)),
    "tocar saldoDeudor a mano → rechazado al COMMIT (no coincide con las ventas)",
  );
  const ePagado = await error(() =>
    withTransaction((tx) =>
      tx.venta.update({
        where: { id: v1.id },
        data: { montoPagado: 1, saldoPendiente: new Prisma.Decimal(d1.total).minus(1) },
      }),
    ),
  );
  check(
    ePagado !== null && /montoPagado/.test(msg(ePagado)),
    "montoPagado distinto de la suma de pagos → rechazado al COMMIT",
  );
  const eDevItem = await error(() =>
    prisma.ventaItem.update({ where: { id: itemMango.id }, data: { cantidadDevuelta: 0 } }),
  );
  check(
    eDevItem !== null && /cantidadDevuelta/.test(msg(eDevItem)),
    "cantidadDevuelta distinta de lo devuelto → rechazado al COMMIT",
  );

  // ---------------------------------------------------------------------------
  console.log("\n   Agregados para el Prompt 6");
  const hoy = { desde: new Date(Date.now() - 3600_000), hasta: new Date(Date.now() + 3600_000) };
  const r = await resumenVentas(hoy);
  const top = await topVariantes({ ...hoy, limit: 3 });
  check(
    r.cantidad > 0 && r.porMedioPago.length > 0,
    `resumen: ${r.cantidad} ventas · ${r.total} · ganancia ${r.gananciaBruta} · ticket ${r.ticketPromedio} · ${r.porMedioPago.map((m) => `${m.medioPago} ${m.total}`).join(", ")}`,
  );
  check(
    top.length > 0,
    `top variantes: ${top.map((t) => `${t.nombre} (${t.unidades})`).join(", ")}`,
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
