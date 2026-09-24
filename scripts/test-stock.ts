/**
 * Prueba de humo del motor de stock contra la DB real (requiere seed).
 * Uso: pnpm test:stock
 *
 * Nota: el ledger es inmutable, así que los movimientos de prueba quedan
 * registrados (motivo "test-stock"). `pnpm db:reset` deja la DB limpia.
 */
import { Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma, withTransaction } from "../src/lib/db";
import { StockInsuficienteError } from "../src/server/errors";
import {
  registrarMovimiento,
  stockTotalVariante,
  transferirStock,
} from "../src/server/services/stock.service";

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

async function stockEn(varianteId: string, depositoId: string): Promise<number> {
  const s = await prisma.stock.findUnique({
    where: { varianteId_depositoId: { varianteId, depositoId } },
  });
  return s?.cantidad ?? 0;
}

async function main() {
  const usuario = await prisma.usuario.findFirstOrThrow({ where: { rol: RolUsuario.OWNER } });
  const [g1, g2] = await prisma.deposito.findMany({ orderBy: { nombre: "asc" } });
  if (!g1 || !g2) throw new Error("Faltan depósitos: corré `pnpm db:seed`");
  const variante = await prisma.variante.findFirstOrThrow({
    where: { nombre: "Mango Ice" },
    include: { producto: true },
  });
  const nombre = `${variante.producto.nombre} - ${variante.nombre}`;
  const base = { varianteId: variante.id, usuarioId: usuario.id, motivo: MOTIVO };

  console.log(`\nVariante: ${nombre} | ${g1.nombre} y ${g2.nombre}`);
  const inicialG1 = await stockEn(variante.id, g1.id);
  const inicialTotal = await stockTotalVariante(prisma, variante.id);
  console.log(`Stock inicial: ${g1.nombre}=${inicialG1}, total=${inicialTotal}\n`);

  // 1. Ingreso
  console.log("1) Ingreso de 10 unidades");
  const mIngreso = await withTransaction((tx) =>
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
  check((await stockEn(variante.id, g1.id)) === inicialG1 + 10, `Stock caché = ${inicialG1 + 10}`);

  // 2. Salida
  console.log("2) Salida (VENTA) de 4 unidades");
  const mSalida = await withTransaction((tx) =>
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
  const movsAntes = await prisma.movimientoStock.count();
  try {
    await withTransaction((tx) =>
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
  check((await prisma.movimientoStock.count()) === movsAntes, "no se registró ningún movimiento");
  check((await stockEn(variante.id, g1.id)) === disponible, `stock intacto (${disponible})`);

  // 4. UPDATE / DELETE directo al ledger → trigger
  console.log("4) Mutación directa de MovimientoStock");
  const errUpdate = await esperarError(
    () =>
      prisma.$executeRaw`UPDATE "MovimientoStock" SET "cantidad" = 999 WHERE "id" = ${mIngreso.id}`,
  );
  check(errUpdate !== null, `UPDATE rechazado: "${mensajeDb(errUpdate ?? "")}"`);
  const errDelete = await esperarError(() =>
    prisma.movimientoStock.delete({ where: { id: mIngreso.id } }),
  );
  check(errDelete !== null, `DELETE rechazado: "${mensajeDb(errDelete ?? "")}"`);
  const intacto = await prisma.movimientoStock.findUniqueOrThrow({ where: { id: mIngreso.id } });
  check(intacto.cantidad === 10, "el movimiento sigue intacto");

  // 5. Extra: UPDATE directo a Stock sin movimiento → trigger
  console.log("5) UPDATE directo a Stock (sin movimiento en la misma transacción)");
  const errStock = await esperarError(() =>
    prisma.stock.update({
      where: { varianteId_depositoId: { varianteId: variante.id, depositoId: g1.id } },
      data: { cantidad: { increment: 100 } },
    }),
  );
  check(errStock !== null, `rechazado: "${mensajeDb(errStock ?? "")}"`);

  // 6. Extra: movimiento con aritmética inconsistente → trigger
  console.log("6) INSERT de movimiento con stockPosterior falso");
  const actual = await stockEn(variante.id, g1.id);
  const errArit = await esperarError(() =>
    withTransaction((tx) =>
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
  console.log("7) Transferencia de 5 unidades Galpón 1 → Galpón 2");
  const [t1, t2, tt] = [
    await stockEn(variante.id, g1.id),
    await stockEn(variante.id, g2.id),
    await stockTotalVariante(prisma, variante.id),
  ];
  const { salida, entrada } = await withTransaction((tx) =>
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
  const ttDespues = await stockTotalVariante(prisma, variante.id);
  check(ttDespues === tt, `total sin cambios: ${tt} = ${ttDespues}`);

  console.log("   Transferencia mayor al stock de origen");
  const errTransf = await esperarError(() =>
    withTransaction((tx) =>
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
  check((await stockTotalVariante(prisma, variante.id)) === tt, "total sigue sin cambios");

  // 8. Extra: concurrencia — 5 ventas simultáneas compiten por el mismo stock
  console.log("8) Concurrencia: 5 ventas simultáneas de 3u contra un stock de 7u en Galpón 2");
  const enG2 = await stockEn(variante.id, g2.id);
  // Dejamos exactamente 7 unidades en Galpón 2 con un ajuste.
  if (enG2 !== 7) {
    await withTransaction((tx) =>
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
      withTransaction(
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
  check((await stockEn(variante.id, g2.id)) === 1, `stock final Galpón 2 = 1 (nunca negativo)`);

  // 9. Invariante global: Stock == suma firmada del ledger, para TODA la DB
  console.log("9) Invariante global: Stock = Σ ledger para cada (variante, depósito)");
  const desvios = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS n FROM (
      SELECT s."id"
      FROM "Stock" s
      LEFT JOIN "MovimientoStock" m
        ON m."varianteId" = s."varianteId" AND m."depositoId" = s."depositoId"
      GROUP BY s."id", s."cantidad"
      HAVING s."cantidad" <> COALESCE(SUM(fn_signo_movimiento(m."tipo") * m."cantidad"), 0)
    ) x
  `);
  check(Number(desvios[0]?.n ?? -1) === 0, "0 desvíos entre caché y ledger");

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
