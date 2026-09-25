/**
 * Concurrencia: 10 confirmaciones SIMULTÁNEAS de ventas de 1 unidad de una
 * variante con stock 5 en un depósito.
 * Esperado: exactamente 5 confirman, 5 fallan con "stock insuficiente", el
 * stock queda en 0 y los comprobantes emitidos son consecutivos, sin huecos
 * ni repetidos.
 * Uso: pnpm test:ventas:concurrencia — DB recién sembrada (crea datos).
 */
import { EstadoVenta, MedioPago, RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { borradorVentaSchema } from "../src/lib/validations/venta";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { confirmarVenta, crearBorrador } from "../src/server/services/venta.service";

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, email: "dueno1@negocio.com" },
  });
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-ventas-concurrentes" } };
  const deposito = await prisma.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const variante = await prisma.variante.findFirstOrThrow({
    where: { nombre: "Grape Ice", producto: { nombre: "Ignite V80" } },
  });

  console.log("\nPreparación: Ignite V80 — Grape Ice con stock 5 en", deposito.nombre);
  await registrarAjuste(
    {
      depositoId: deposito.id,
      varianteId: variante.id,
      cantidadReal: 5,
      motivo: "Prueba de concurrencia",
    },
    actor,
  );
  const stockInicial = (
    await prisma.stock.findUniqueOrThrow({
      where: { varianteId_depositoId: { varianteId: variante.id, depositoId: deposito.id } },
    })
  ).cantidad;
  check(stockInicial === 5, `stock inicial ${stockInicial}`);

  const borradores = await Promise.all(
    Array.from({ length: 10 }, () =>
      crearBorrador(
        borradorVentaSchema.parse({
          depositoId: deposito.id,
          items: [{ varianteId: variante.id, cantidad: 1 }],
        }),
        actor,
        {
          puedeEditar: false,
        },
      ),
    ),
  );
  const ultimoAntes =
    (await prisma.secuenciaComprobante.findFirst({ where: { tipo: "TICKET", puntoVenta: 1 } }))
      ?.ultimoNumero ?? 0;

  console.log("\n10 confirmaciones simultáneas de 1 unidad");
  const t0 = performance.now();
  const resultados = await Promise.allSettled(
    borradores.map((b) =>
      confirmarVenta(
        b.id,
        { pagos: [{ medioPago: MedioPago.EFECTIVO, monto: Number(variante.precioVenta) }] },
        actor,
        { puedeEditar: false },
      ),
    ),
  );
  const ms = Math.round(performance.now() - t0);
  const ok = resultados.filter((r) => r.status === "fulfilled");
  const errores = resultados.flatMap((r) =>
    r.status === "rejected"
      ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
      : [],
  );
  check(ok.length === 5, `${ok.length} confirmadas (en ${ms} ms)`);
  check(
    errores.length === 5 && errores.every((e) => /Stock insuficiente/.test(e)),
    `${errores.length} rechazadas por stock: «${errores[0]}»${errores.some((e) => !/Stock insuficiente/.test(e)) ? ` · OTROS: ${errores.filter((e) => !/Stock insuficiente/.test(e)).join(" | ")}` : ""}`,
  );

  const stockFinal = (
    await prisma.stock.findUniqueOrThrow({
      where: { varianteId_depositoId: { varianteId: variante.id, depositoId: deposito.id } },
    })
  ).cantidad;
  check(stockFinal === 0, `stock final ${stockFinal}`);
  const estados = await prisma.venta.groupBy({
    by: ["estado"],
    where: { id: { in: borradores.map((b) => b.id) } },
    _count: true,
  });
  check(
    estados.find((e) => e.estado === EstadoVenta.CONFIRMADA)?._count === 5 &&
      estados.find((e) => e.estado === EstadoVenta.BORRADOR)?._count === 5,
    `ventas: ${estados.map((e) => `${e._count} ${e.estado}`).join(", ")} (las rechazadas siguen en borrador, sin descontar nada)`,
  );

  const numeros = ok
    .map(
      (r) =>
        (r as PromiseFulfilledResult<Awaited<ReturnType<typeof confirmarVenta>>>).value.comprobante
          ?.numero ?? 0,
    )
    .sort((a, b) => a - b);
  const esperados = Array.from({ length: 5 }, (_, i) => ultimoAntes + 1 + i);
  check(
    JSON.stringify(numeros) === JSON.stringify(esperados),
    `comprobantes emitidos: ${numeros.join(", ")} (consecutivos desde ${ultimoAntes + 1}, sin huecos ni repetidos)`,
  );
  const ultimoDespues = (
    await prisma.secuenciaComprobante.findFirstOrThrow({ where: { tipo: "TICKET", puntoVenta: 1 } })
  ).ultimoNumero;
  check(
    ultimoDespues === ultimoAntes + 5,
    `la secuencia avanzó exactamente 5 (${ultimoAntes} → ${ultimoDespues}): las ventas fallidas no consumieron número`,
  );
  const ledger = await prisma.movimientoStock.count({
    where: {
      tipo: "VENTA",
      referenciaTipo: "VENTA",
      referenciaId: { in: borradores.map((b) => b.id) },
    },
  });
  check(ledger === 5, `ledger: ${ledger} movimientos VENTA de estas 10 ventas`);

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
