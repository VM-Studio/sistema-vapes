/**
 * Prueba de humo del motor de stock contra la DB real (requiere el seed base; siembra el catálogo de ejemplo).
 * Uso: pnpm test:stock
 *
 * Trabaja en el panel Vapes (depósitos "Ayres Plaza" y "Mercedes").
 * Nota: el ledger es inmutable, así que los movimientos de prueba quedan
 * registrados (motivo "test-stock"). `pnpm db:reset` deja la DB limpia.
 */
import { Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { StockInsuficienteError } from "../src/server/errors";
import {
  movimientos,
  registrarMovimiento,
  resumenStock,
  stockGlobal,
  stockPorDeposito,
  stockTotalVariante,
  transferirStock,
} from "../src/server/services/stock.service";
import { crearYCompletarTransferencia } from "../src/server/services/transferencia.service";
import { sembrarCatalogoEjemplo } from "../e2e/fixtures/catalogo-ejemplo";

const PANEL = "pnl_vapes";
const MOTIVO = "test-stock";
let fallos = 0;

function ok(msg: string) {
  console.log(`  ✔ ${msg}`);
}
function fail(msg: string) {
  fallos++;
  console.log(`  ✘ ${msg}`);
}
function check(cond: boolean, msg: string) {
  if (cond) ok(msg);
  else fail(msg);
}

/** Espera que `fn` falle; devuelve el mensaje de error. */
async function esperarError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function mensajeDb(msg: string): string {
  // Los errores crudos de Postgres vienen envueltos por Prisma: extraemos el mensaje.
  const raw = /Message: `ERROR: ([^`\n]+)/.exec(msg)?.[1];
  const conector = /message: "((?:[^"\\]|\\.)*)"/.exec(msg)?.[1]?.replace(/\\"/g, '"');
  return raw ?? conector ?? msg.split("\n").filter(Boolean).pop() ?? msg;
}

const db = dbPara(PANEL);

async function stockEn(varianteId: string, depositoId: string): Promise<number> {
  const s = await db.stock.findUnique({
    where: { panelId_varianteId_depositoId: { panelId: PANEL, varianteId, depositoId } },
  });
  return s?.cantidad ?? 0;
}

async function main() {
  // El seed base no trae catálogo: el de ejemplo de los tests (idempotente).
  await sembrarCatalogoEjemplo();
  const usuario = await prisma.usuario.findFirstOrThrow({ where: { rol: RolUsuario.OWNER } });
  const ctx: Ctx = { panelId: PANEL, usuarioId: usuario.id };
  const g1 = await db.deposito.findUnique({
    where: { panelId_nombre: { panelId: PANEL, nombre: "Ayres Plaza" } },
  });
  const g2 = await db.deposito.findUnique({
    where: { panelId_nombre: { panelId: PANEL, nombre: "Mercedes" } },
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos de Vapes: corré `pnpm db:seed`");
  const variante = await db.variante.findFirstOrThrow({
    where: { nombre: "Mango Ice" },
    include: { producto: true },
  });
  const nombre = `${variante.producto.nombreCompleto} — ${variante.nombre}`;
  const base = { varianteId: variante.id, usuarioId: usuario.id, motivo: MOTIVO };

  console.log(`\nVariante: ${nombre} | ${g1.nombre} y ${g2.nombre}`);
  const inicialG1 = await stockEn(variante.id, g1.id);
  const inicialTotal = await stockTotalVariante(db, variante.id);
  console.log(`Stock inicial: ${g1.nombre}=${inicialG1}, total=${inicialTotal}\n`);

  // 1. Ingreso
  console.log("1) Ingreso de 10 unidades");
  const mIngreso = await transaccion(ctx, (tx) =>
    registrarMovimiento(tx, {
      ...base,
      tipo: TipoMovimiento.INGRESO_MANUAL,
      depositoId: g1.id,
      cantidad: 10,
      costoUnitario: "9500.00",
    }),
  );
  check(
    mIngreso.stockAnterior === inicialG1 && mIngreso.stockPosterior === inicialG1 + 10,
    `movimiento ${mIngreso.stockAnterior} → ${mIngreso.stockPosterior}`,
  );
  check(mIngreso.panelId === PANEL, `el movimiento quedó en el panel ${PANEL}`);
  check((await stockEn(variante.id, g1.id)) === inicialG1 + 10, `Stock caché = ${inicialG1 + 10}`);

  // 2. Salida
  console.log("2) Salida (VENTA) de 4 unidades");
  const mSalida = await transaccion(ctx, (tx) =>
    registrarMovimiento(tx, {
      ...base,
      tipo: TipoMovimiento.VENTA,
      depositoId: g1.id,
      cantidad: 4,
    }),
  );
  check(
    mSalida.stockPosterior === inicialG1 + 6,
    `movimiento ${mSalida.stockAnterior} → ${mSalida.stockPosterior}`,
  );
  check((await stockEn(variante.id, g1.id)) === inicialG1 + 6, `Stock caché = ${inicialG1 + 6}`);

  // 3. Salida mayor al stock → error de dominio, sin efectos
  console.log("3) Salida mayor al stock disponible");
  const disponible = await stockEn(variante.id, g1.id);
  const movsAntes = await db.movimientoStock.count();
  try {
    await transaccion(ctx, (tx) =>
      registrarMovimiento(tx, {
        ...base,
        tipo: TipoMovimiento.VENTA,
        depositoId: g1.id,
        cantidad: disponible + 1,
      }),
    );
    fail("debería haber fallado");
  } catch (e) {
    check(e instanceof StockInsuficienteError, `StockInsuficienteError: "${(e as Error).message}"`);
  }
  check((await db.movimientoStock.count()) === movsAntes, "no se registró ningún movimiento");
  check((await stockEn(variante.id, g1.id)) === disponible, `stock intacto (${disponible})`);

  // 3b. Fuera de una transacción → rechazado por el motor
  console.log("3b) registrarMovimiento fuera de una transacción");
  const errSinTx = await esperarError(() =>
    registrarMovimiento(db, {
      ...base,
      tipo: TipoMovimiento.INGRESO_MANUAL,
      depositoId: g1.id,
      cantidad: 1,
    }),
  );
  check(errSinTx !== null, `rechazado: "${errSinTx}"`);

  // 4. UPDATE / DELETE directo al ledger → trigger
  console.log("4) Mutación directa de MovimientoStock");
  const errUpdate = await esperarError(
    () =>
      prisma.$executeRaw`UPDATE "MovimientoStock" SET "cantidad" = 999 WHERE "id" = ${mIngreso.id}`,
  );
  check(errUpdate !== null, `UPDATE rechazado: "${mensajeDb(errUpdate ?? "")}"`);
  const errDelete = await esperarError(() =>
    db.movimientoStock.delete({ where: { id: mIngreso.id } }),
  );
  check(errDelete !== null, `DELETE rechazado: "${mensajeDb(errDelete ?? "")}"`);
  const intacto = await db.movimientoStock.findUniqueOrThrow({ where: { id: mIngreso.id } });
  check(intacto.cantidad === 10, "el movimiento sigue intacto");

  // 5. UPDATE directo a Stock sin movimiento → trigger
  console.log("5) UPDATE directo a Stock (sin movimiento en la misma transacción)");
  const errStock = await esperarError(() =>
    db.stock.update({
      where: {
        panelId_varianteId_depositoId: {
          panelId: PANEL,
          varianteId: variante.id,
          depositoId: g1.id,
        },
      },
      data: { cantidad: { increment: 100 } },
    }),
  );
  check(errStock !== null, `rechazado: "${mensajeDb(errStock ?? "")}"`);

  // 6. Movimiento con aritmética inconsistente → trigger
  console.log("6) INSERT de movimiento con stockPosterior falso");
  const actual = await stockEn(variante.id, g1.id);
  const errArit = await esperarError(() =>
    transaccion(ctx, (tx) =>
      tx.movimientoStock.create({
        data: {
          tipo: TipoMovimiento.VENTA,
          varianteId: variante.id,
          depositoId: g1.id,
          cantidad: 1,
          stockAnterior: actual,
          stockPosterior: actual + 1,
          usuarioId: usuario.id,
          motivo: MOTIVO,
        },
      }),
    ),
  );
  check(errArit !== null, `rechazado: "${mensajeDb(errArit ?? "")}"`);

  // 7. Transferencia: la suma total no cambia
  console.log(`7) Transferencia de 5 unidades ${g1.nombre} → ${g2.nombre}`);
  const [t1, t2, tt] = [
    await stockEn(variante.id, g1.id),
    await stockEn(variante.id, g2.id),
    await stockTotalVariante(db, variante.id),
  ];
  const { salida, entrada } = await transaccion(ctx, (tx) =>
    transferirStock(tx, {
      varianteId: variante.id,
      depositoOrigenId: g1.id,
      depositoDestinoId: g2.id,
      cantidad: 5,
      usuarioId: usuario.id,
      motivo: MOTIVO,
    }),
  );
  check(
    salida.tipo === "TRANSFERENCIA_SALIDA" && entrada.tipo === "TRANSFERENCIA_ENTRADA",
    "2 movimientos (SALIDA + ENTRADA)",
  );
  check((await stockEn(variante.id, g1.id)) === t1 - 5, `${g1.nombre}: ${t1} → ${t1 - 5}`);
  check((await stockEn(variante.id, g2.id)) === t2 + 5, `${g2.nombre}: ${t2} → ${t2 + 5}`);
  const ttDespues = await stockTotalVariante(db, variante.id);
  check(ttDespues === tt, `total sin cambios: ${tt} = ${ttDespues}`);

  console.log("   Transferencia mayor al stock de origen");
  const errTransf = await esperarError(() =>
    transaccion(ctx, (tx) =>
      transferirStock(tx, {
        varianteId: variante.id,
        depositoOrigenId: g1.id,
        depositoDestinoId: g2.id,
        cantidad: 100_000,
        usuarioId: usuario.id,
      }),
    ),
  );
  check(errTransf?.startsWith("Stock insuficiente") === true, `rechazada: "${errTransf}"`);
  check((await stockTotalVariante(db, variante.id)) === tt, "total sigue sin cambios");

  // 7b. Aislamiento: el motor no mueve stock de Vapes desde otro panel
  console.log("7b) Movimiento sobre una variante de Vapes desde la transacción de otro panel");
  const depCosmetic = await dbPara("pnl_cosmetic").deposito.findFirstOrThrow();
  const errOtroPanel = await esperarError(() =>
    transaccion({ panelId: "pnl_cosmetic" }, (tx) =>
      registrarMovimiento(tx, {
        ...base,
        tipo: TipoMovimiento.INGRESO_MANUAL,
        depositoId: depCosmetic.id,
        cantidad: 1,
      }),
    ),
  );
  check(errOtroPanel !== null, `rechazado: "${mensajeDb(errOtroPanel ?? "")}"`);

  // 8. Concurrencia — 5 ventas simultáneas compiten por el mismo stock
  console.log(`8) Concurrencia: 5 ventas simultáneas de 3u contra un stock de 7u en ${g2.nombre}`);
  const enG2 = await stockEn(variante.id, g2.id);
  if (enG2 !== 7) {
    await transaccion(ctx, (tx) =>
      registrarMovimiento(tx, {
        ...base,
        tipo: enG2 > 7 ? TipoMovimiento.AJUSTE_NEGATIVO : TipoMovimiento.AJUSTE_POSITIVO,
        depositoId: g2.id,
        cantidad: Math.abs(enG2 - 7),
      }),
    );
  }
  const resultados = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      transaccion(
        ctx,
        (tx) =>
          registrarMovimiento(tx, {
            ...base,
            tipo: TipoMovimiento.VENTA,
            depositoId: g2.id,
            cantidad: 3,
          }),
        { maxRetries: 5 },
      ),
    ),
  );
  const exitos = resultados.filter((r) => r.status === "fulfilled").length;
  const rechazos = resultados.filter(
    (r) => r.status === "rejected" && r.reason instanceof StockInsuficienteError,
  ).length;
  check(
    exitos === 2 && rechazos === 3,
    `${exitos} ventas OK, ${rechazos} rechazadas por stock insuficiente`,
  );
  check((await stockEn(variante.id, g2.id)) === 1, `stock final ${g2.nombre} = 1 (nunca negativo)`);

  // 9. Invariante global: Stock == suma firmada del ledger, para TODA la DB
  console.log("9) Invariante global: Stock = Σ ledger para cada (panel, variante, depósito)");
  const desvios = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS n FROM (
      SELECT s."id"
      FROM "Stock" s
      LEFT JOIN "MovimientoStock" m
        ON m."panelId" = s."panelId" AND m."varianteId" = s."varianteId" AND m."depositoId" = s."depositoId"
      GROUP BY s."id", s."cantidad"
      HAVING s."cantidad" <> COALESCE(SUM(fn_signo_movimiento(m."tipo") * m."cantidad"), 0)
    ) x
  `);
  check(Number(desvios[0]?.n ?? -1) === 0, "0 desvíos entre caché y ledger");

  // 10. Vista consolidada: total = suma de por_deposito
  console.log("10) vw_stock_consolidado (panel_id, total, por_deposito)");
  const [fila] = await prisma.$queryRaw<{ total: number; por_deposito: Record<string, number> }[]>`
    SELECT total, por_deposito FROM vw_stock_consolidado
    WHERE panel_id = ${PANEL} AND variante_id = ${variante.id}
  `;
  const sumaDepositos = Object.values(fila?.por_deposito ?? {}).reduce((a, b) => a + b, 0);
  const totalReal = await stockTotalVariante(db, variante.id);
  check(
    fila?.total === totalReal && sumaDepositos === totalReal,
    `total ${fila?.total} = Σ por_deposito ${sumaDepositos} = stock ${totalReal}`,
  );

  // 11. Lecturas de la pantalla Stock y "Transferir a {otro galpón}" desde la fila
  console.log("11) Stock por galpón / global, ledger y transferencia en el acto");
  const q = variante.nombre;
  const [porG1, global, resumenAntes] = await Promise.all([
    stockPorDeposito(ctx, g1.id, { q }),
    stockGlobal(ctx, { q }),
    resumenStock(ctx),
  ]);
  const filaG1 = porG1.filas.find((f) => f.varianteId === variante.id);
  const filaGlobal = global.filas.find((f) => f.varianteId === variante.id);
  check(
    filaG1?.cantidad === (await stockEn(variante.id, g1.id)) &&
      filaGlobal?.cantidad === totalReal &&
      filaGlobal.porDeposito[g1.id] === filaG1.cantidad &&
      filaGlobal.porDeposito[g2.id] === (await stockEn(variante.id, g2.id)),
    `stockPorDeposito = cantidad del galpón (${filaG1?.cantidad}); stockGlobal = total (${filaGlobal?.cantidad}) con cada galpón`,
  );
  check(
    resumenAntes.porDeposito.length === 2 &&
      resumenAntes.total === resumenAntes.porDeposito.reduce((a, d) => a + d.unidades, 0),
    `resumenStock: ${resumenAntes.porDeposito.map((d) => `${d.nombre} ${d.unidades}`).join(" + ")} = ${resumenAntes.total}`,
  );
  const ajeno = await dbPara("pnl_cosmetic").deposito.findFirstOrThrow();
  check(
    (await esperarError(() => stockPorDeposito(ctx, ajeno.id))) !== null,
    "stockPorDeposito con un galpón de otro panel → no existe",
  );
  await transaccion(ctx, (tx) =>
    registrarMovimiento(tx, {
      ...base,
      tipo: TipoMovimiento.INGRESO_MANUAL,
      depositoId: g1.id,
      cantidad: 5,
    }),
  );
  const totalAntes = await stockTotalVariante(db, variante.id);
  const t = await crearYCompletarTransferencia(ctx, {
    depositoOrigenId: g1.id,
    depositoDestinoId: g2.id,
    observacion: MOTIVO,
    items: [{ varianteId: variante.id, cantidad: 5 }],
  });
  const doc = await db.transferencia.findUniqueOrThrow({ where: { id: t.id } });
  const resumenDespues = await resumenStock(ctx);
  check(
    doc.estado === "COMPLETADA" && (await stockTotalVariante(db, variante.id)) === totalAntes,
    `crearYCompletarTransferencia: ${t.codigo} COMPLETADA en el acto; total sin cambios (${totalAntes})`,
  );
  check(
    resumenDespues.total === resumenAntes.total + 5,
    "el total global del panel no cambia al transferir (solo el ingreso previo de 5)",
  );
  const ledgerG2 = await movimientos(ctx, { depositoId: g2.id, referenciaId: t.id });
  const ledgerTodos = await movimientos(ctx, { depositoId: null, referenciaId: t.id });
  check(
    ledgerG2.total === 1 &&
      ledgerG2.movimientos[0]?.cantidad === 5 &&
      ledgerG2.movimientos[0].referencia?.etiqueta === t.codigo &&
      ledgerTodos.total === 2 &&
      ledgerTodos.movimientos.some((m) => m.cantidad === -5 && m.depositoId === g1.id),
    "movimientos(): filtrado por galpón (+5 en destino) o de todos (−5 / +5) con la referencia",
  );
  const transferenciasAntes = await db.transferencia.count();
  const errorSinStock = await esperarError(() =>
    crearYCompletarTransferencia(ctx, {
      depositoOrigenId: g1.id,
      depositoDestinoId: g2.id,
      observacion: undefined,
      items: [{ varianteId: variante.id, cantidad: 100_000 }],
    }),
  );
  check(
    errorSinStock !== null && (await db.transferencia.count()) === transferenciasAntes,
    `crearYCompletarTransferencia sin stock → error («${errorSinStock}») y no queda ninguna transferencia`,
  );

  console.log(
    fallos === 0 ? "\nTODAS LAS PRUEBAS PASARON ✅\n" : `\n${fallos} PRUEBA(S) FALLARON ❌\n`,
  );
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
