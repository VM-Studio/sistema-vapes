/**
 * Concurrencia de ventas en el panel Vapes (crea datos: correr sobre una base
 * recién sembrada).
 *  1. 10 confirmaciones SIMULTÁNEAS de borradores de 1 unidad de una variante
 *     con stock 5 → exactamente 5 confirman, 5 fallan por stock, stock 0.
 *  2. 10 cajas venden A LA VEZ la última unidad (vender: borrador + confirmación
 *     en una tx) → exactamente una gana; las que pierden no consumen número.
 *  3. 20 borradores simultáneos → números de venta del panel únicos y
 *     consecutivos (sin huecos ni repetidos); otro panel no se ve afectado.
 * Uso: pnpm test:ventas:concurrencia
 */
import { EstadoVenta, MedioPago, RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { formatearIdVenta } from "../src/lib/paneles";
import { borradorVentaSchema, venderSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { confirmarVenta, crearBorrador, vender } from "../src/server/services/venta.service";

const PANEL = "pnl_vapes";
const db = dbPara(PANEL);

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};

const ultimoNumero = async (panelId: string) =>
  (
    await prisma.secuencia.findUniqueOrThrow({
      where: { panelId_entidad: { panelId, entidad: "VENTA" } },
    })
  ).ultimoNumero;

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const ctx: Ctx = {
    panelId: PANEL,
    usuarioId: owner.id,
    meta: { ip: "127.0.0.1", userAgent: "test-ventas-concurrentes" },
  };
  const deposito = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const variante = await db.variante.findFirstOrThrow({
    where: { nombre: "Grape Ice", producto: { nombre: "Ignite V80" } },
  });
  const stockActual = async () =>
    (
      await db.stock.findUniqueOrThrow({
        where: {
          panelId_varianteId_depositoId: {
            panelId: PANEL,
            varianteId: variante.id,
            depositoId: deposito.id,
          },
        },
      })
    ).cantidad;
  /**
   * Borrador de 1 unidad. Varias cajas creando borradores a la vez compiten por
   * la fila de Secuencia (FOR UPDATE, Serializable): la tx se reintenta.
   */
  const nuevoBorrador = () =>
    transaccion(
      ctx,
      (tx) =>
        crearBorrador(
          ctx,
          borradorVentaSchema.parse({
            depositoId: deposito.id,
            items: [{ varianteId: variante.id, cantidad: 1 }],
          }),
          { puedeEditar: false },
          tx,
        ),
      { maxRetries: 30 },
    );
  const dejarStock = async (cantidadReal: number) => {
    if ((await stockActual()) === cantidadReal) return;
    await registrarAjuste(ctx, {
      depositoId: deposito.id,
      varianteId: variante.id,
      cantidadReal,
      motivo: "Prueba de concurrencia",
    });
  };

  // ---------------------------------------------------------------------------
  console.log(
    `\n1) Ignite V80 — Grape Ice con stock 5 en ${deposito.nombre}: 10 confirmaciones simultáneas`,
  );
  await dejarStock(5);
  check((await stockActual()) === 5, "stock inicial 5");

  const borradores = await Promise.all(Array.from({ length: 10 }, () => nuevoBorrador()));
  check(
    new Set(borradores.map((b) => b.numero)).size === 10,
    `10 borradores con números distintos (${borradores.map((b) => b.idVenta).sort()[0]}…)`,
  );

  const t0 = performance.now();
  const resultados = await Promise.allSettled(
    borradores.map((b) => confirmarVenta(ctx, b.id, { medioPago: MedioPago.EFECTIVO })),
  );
  const ms = Math.round(performance.now() - t0);
  const ok = resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const errores = resultados.flatMap((r) => (r.status === "rejected" ? [mensaje(r.reason)] : []));
  const otros = errores.filter((e) => !/Stock insuficiente/.test(e));
  check(ok.length === 5, `${ok.length} confirmadas (en ${ms} ms)`);
  check(
    errores.length === 5 && otros.length === 0,
    `${errores.length} rechazadas por stock: «${errores[0]}»${otros.length ? ` · OTROS: ${otros.join(" | ")}` : ""}`,
  );
  check((await stockActual()) === 0, "stock final 0 (nunca negativo)");
  const estados = await db.venta.groupBy({
    by: ["estado"],
    where: { id: { in: borradores.map((b) => b.id) } },
    _count: true,
  });
  check(
    estados.find((e) => e.estado === EstadoVenta.CONFIRMADA)?._count === 5 &&
      estados.find((e) => e.estado === EstadoVenta.BORRADOR)?._count === 5,
    `ventas: ${estados.map((e) => `${e._count} ${e.estado}`).join(", ")} (las rechazadas siguen en borrador, sin descontar nada)`,
  );
  check(
    ok.every((v) => v.idVenta === formatearIdVenta("vapes", v.numero)),
    `IDs de venta del panel: ${ok
      .map((v) => v.idVenta)
      .sort()
      .join(", ")}`,
  );
  const ledger = await db.movimientoStock.count({
    where: {
      tipo: "VENTA",
      referenciaTipo: "VENTA",
      referenciaId: { in: borradores.map((b) => b.id) },
    },
  });
  check(ledger === 5, `ledger: ${ledger} movimientos VENTA de estas 10 ventas`);

  // ---------------------------------------------------------------------------
  console.log("\n2) La última unidad: 10 cajas venden a la vez");
  await dejarStock(1);
  const antesUltima = await ultimoNumero(PANEL);
  const carrera = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      vender(
        ctx,
        venderSchema.parse({
          venta: { depositoId: deposito.id, items: [{ varianteId: variante.id, cantidad: 1 }] },
          medioPago: MedioPago.TRANSFERENCIA,
        }),
        { puedeEditar: false },
      ),
    ),
  );
  const ganadoras = carrera.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const perdedoras = carrera.flatMap((r) => (r.status === "rejected" ? [mensaje(r.reason)] : []));
  check(
    ganadoras.length === 1,
    `exactamente una venta gana (${ganadoras.map((g) => g.idVenta).join(", ")})`,
  );
  check(
    perdedoras.length === 9 && perdedoras.every((e) => /Stock insuficiente/.test(e)),
    `9 rechazadas por stock${perdedoras.some((e) => !/Stock insuficiente/.test(e)) ? ` · OTROS: ${perdedoras.filter((e) => !/Stock insuficiente/.test(e)).join(" | ")}` : ""}`,
  );
  check((await stockActual()) === 0, "stock final 0");
  const despuesUltima = await ultimoNumero(PANEL);
  check(
    despuesUltima === antesUltima + 1 && ganadoras[0]?.numero === despuesUltima,
    `la secuencia avanzó exactamente 1 (${antesUltima} → ${despuesUltima}): las ventas fallidas no consumieron número`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Numeración: 20 borradores simultáneos");
  await dejarStock(3);
  const antes = await ultimoNumero(PANEL);
  const otroPanelAntes = await ultimoNumero("pnl_cosmetic");
  const nuevos = await Promise.all(Array.from({ length: 20 }, () => nuevoBorrador()));
  const numeros = nuevos.map((n) => n.numero).sort((a, b) => a - b);
  const esperados = Array.from({ length: 20 }, (_, i) => antes + 1 + i);
  check(
    JSON.stringify(numeros) === JSON.stringify(esperados),
    `números ${numeros[0]}..${numeros.at(-1)}: consecutivos desde ${antes + 1}, sin huecos ni repetidos`,
  );
  check((await ultimoNumero(PANEL)) === antes + 20, "la secuencia avanzó exactamente 20");
  check(
    (await ultimoNumero("pnl_cosmetic")) === otroPanelAntes,
    "la numeración de Cosmetic no se movió",
  );
  const duplicados = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT "numero" FROM "Venta" WHERE "panelId" = ${PANEL} GROUP BY "numero" HAVING COUNT(*) > 1
    ) x`;
  check(Number(duplicados[0]?.n) === 0, "ningún número de venta repetido en el panel");

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
