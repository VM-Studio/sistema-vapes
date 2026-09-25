import { Prisma } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import { ahora } from "@/lib/reloj";
import { diaEn, esDiaISO, limitesRango, type DiaISO } from "@/lib/zona-horaria";
import { obtenerZonaHoraria } from "@/server/services/configuracion.service";

/**
 * RESUMEN DIARIO — agregados precalculados por (día, depósito) + una fila
 * consolidada por día (depositoId NULL), para que el dashboard no recorra
 * años de ventas.
 *
 * Se RECALCULA (no se suma un delta) desde las tablas de origen, dentro de la
 * misma transacción de negocio que cambia el día: confirmar/anular una venta,
 * cobrar/anular un pago, devolver, cargar/editar/borrar un gasto. Bajo
 * Serializable, dos transacciones que recalculan el mismo día chocan y una se
 * reintenta: la fila nunca queda con un total viejo.
 *
 * Definiciones (día = día calendario en Configuracion.timezone):
 *  - ventas / unidades / total / costo: ventas CONFIRMADAS con `fecha` ese día.
 *  - gananciaBruta = totalVentas − costoVentas.
 *  - totalPorMedioPago: lo COBRADO ese día (PagoVenta vigentes por su fecha),
 *    incluidos cobros de cuenta corriente de ventas de otros días.
 *  - devoluciones / costoDevoluciones: devoluciones hechas ese día (la
 *    mercadería vuelve al stock, así que solo se pierde su margen).
 *  - totalGastos: gastos no borrados de ese día. En la fila de un depósito,
 *    solo los atribuidos a ese depósito; en la consolidada, todos.
 *  - gananciaNeta = gananciaBruta − (devoluciones − costoDevoluciones) − totalGastos.
 */

/** `fecha` es timestamp sin zona guardado en UTC: los parámetros Date se pasan a UTC explícito. */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

export interface ClaveResumen {
  /** Instante (se convierte al día de la zona configurada) o día ya calculado. */
  fecha: Date | DiaISO;
  /** Depósito afectado (null: solo la fila consolidada, ej. un gasto general). */
  depositoId: string | null;
}

/** Recalcula la fila (día, depósito) y la consolidada de ese día. */
export async function recalcularResumenDiario(
  tx: Tx,
  fecha: Date | DiaISO,
  depositoId: string | null,
): Promise<void> {
  await recalcularResumenes(tx, [{ fecha, depositoId }]);
}

/** Varias claves a la vez (una query por día distinto). */
export async function recalcularResumenes(tx: Tx, claves: ClaveResumen[]): Promise<void> {
  if (claves.length === 0) return;
  const tz = await obtenerZonaHoraria(tx);
  const porDia = new Map<DiaISO, Set<string>>();
  for (const c of claves) {
    const dia = typeof c.fecha === "string" ? c.fecha : diaEn(c.fecha, tz);
    if (!esDiaISO(dia)) throw new Error(`Día inválido para el resumen: ${dia}`);
    const deps = porDia.get(dia) ?? new Set<string>();
    if (c.depositoId) deps.add(c.depositoId);
    porDia.set(dia, deps);
  }
  for (const [dia, deps] of [...porDia].sort(([a], [b]) => a.localeCompare(b))) {
    await recalcularRango(tx, { desde: dia, hasta: dia, tz, depositoIds: [...deps].sort() });
  }
}

/**
 * Upsert de todas las filas de [desde, hasta] para los depósitos pedidos
 * (null = todos) + la consolidada de cada día. Los días sin movimiento quedan
 * en cero (así una venta anulada "desaparece" del día).
 */
export async function recalcularRango(
  tx: Tx,
  r: { desde: DiaISO; hasta: DiaISO; tz: string; depositoIds: string[] | null },
): Promise<number> {
  const { inicio, fin } = limitesRango(r.desde, r.hasta, r.tz);
  const tz = r.tz;
  const dia = (col: Prisma.Sql) => Prisma.sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date`;
  const enRango = (col: Prisma.Sql) =>
    Prisma.sql`${col} >= ${utc(inicio)} AND ${col} < ${utc(fin)}`;
  const filtroDeps =
    r.depositoIds === null
      ? Prisma.empty
      : r.depositoIds.length
        ? Prisma.sql`WHERE "id" IN (${Prisma.join(r.depositoIds)})`
        : Prisma.sql`WHERE false`;

  // GROUPING SETS ((día, depósito), (día)): la fila consolidada sale de la
  // misma pasada. `cons` = 1 en la consolidada; así un gasto sin depósito
  // (depositoId NULL, cons 0) no se confunde con la fila consolidada.
  return tx.$executeRaw`
    WITH
    dias AS (
      SELECT gs::date AS fecha
      FROM generate_series(${r.desde}::date, ${r.hasta}::date, interval '1 day') gs
    ),
    deps AS (SELECT "id" FROM "Deposito" ${filtroDeps}),
    claves AS (
      SELECT dias.fecha, deps."id" AS dep, 0 AS cons FROM dias CROSS JOIN deps
      UNION ALL
      SELECT dias.fecha, NULL, 1 FROM dias
    ),
    v AS (
      SELECT ${dia(Prisma.sql`v."fecha"`)} AS fecha, v."depositoId", v."total", v."costoTotal",
             COALESCE(u.unidades, 0) AS unidades
      FROM "Venta" v
      LEFT JOIN LATERAL (
        SELECT SUM(vi."cantidad") AS unidades FROM "VentaItem" vi WHERE vi."ventaId" = v."id"
      ) u ON true
      WHERE v."estado" = 'CONFIRMADA' AND ${enRango(Prisma.sql`v."fecha"`)}
    ),
    va AS (
      SELECT fecha, "depositoId" AS dep, GROUPING("depositoId") AS cons,
             COUNT(*) AS cantidad, SUM(unidades) AS unidades,
             SUM("total") AS total, SUM("costoTotal") AS costo
      FROM v GROUP BY GROUPING SETS ((fecha, "depositoId"), (fecha))
    ),
    p AS (
      SELECT ${dia(Prisma.sql`p."fecha"`)} AS fecha, v."depositoId", p."medioPago", p."monto"
      FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
      WHERE NOT p."anulado" AND ${enRango(Prisma.sql`p."fecha"`)}
    ),
    pm AS (
      SELECT fecha, "depositoId" AS dep, GROUPING("depositoId") AS cons, "medioPago", SUM("monto") AS total
      FROM p GROUP BY GROUPING SETS ((fecha, "depositoId", "medioPago"), (fecha, "medioPago"))
    ),
    pa AS (
      SELECT fecha, dep, cons, jsonb_object_agg("medioPago", to_char(total, 'FM999999999990.00')) AS medios
      FROM pm GROUP BY fecha, dep, cons
    ),
    d AS (
      SELECT ${dia(Prisma.sql`d."fecha"`)} AS fecha, d."depositoId", d."total",
             COALESCE(c.costo, 0) AS costo
      FROM "Devolucion" d
      LEFT JOIN LATERAL (
        SELECT SUM(di."cantidad" * vi."costoUnitario") AS costo
        FROM "DevolucionItem" di JOIN "VentaItem" vi ON vi."id" = di."ventaItemId"
        WHERE di."devolucionId" = d."id"
      ) c ON true
      WHERE ${enRango(Prisma.sql`d."fecha"`)}
    ),
    da AS (
      SELECT fecha, "depositoId" AS dep, GROUPING("depositoId") AS cons,
             SUM("total") AS total, SUM(costo) AS costo
      FROM d GROUP BY GROUPING SETS ((fecha, "depositoId"), (fecha))
    ),
    g AS (
      SELECT ${dia(Prisma.sql`g."fecha"`)} AS fecha, g."depositoId", g."monto"
      FROM "Gasto" g
      WHERE g."deletedAt" IS NULL AND ${enRango(Prisma.sql`g."fecha"`)}
    ),
    ga AS (
      SELECT fecha, "depositoId" AS dep, GROUPING("depositoId") AS cons, SUM("monto") AS total
      FROM g GROUP BY GROUPING SETS ((fecha, "depositoId"), (fecha))
    ),
    calc AS (
      SELECT k.fecha, k.dep,
             COALESCE(va.cantidad, 0)::int AS cantidad,
             COALESCE(va.unidades, 0)::int AS unidades,
             COALESCE(va.total, 0) AS total,
             COALESCE(va.costo, 0) AS costo,
             COALESCE(ga.total, 0) AS gastos,
             COALESCE(pa.medios, '{}'::jsonb) AS medios,
             COALESCE(da.total, 0) AS devol,
             COALESCE(da.costo, 0) AS costo_devol
      FROM claves k
      LEFT JOIN va ON va.fecha = k.fecha AND va.cons = k.cons AND va.dep IS NOT DISTINCT FROM k.dep
      LEFT JOIN pa ON pa.fecha = k.fecha AND pa.cons = k.cons AND pa.dep IS NOT DISTINCT FROM k.dep
      LEFT JOIN da ON da.fecha = k.fecha AND da.cons = k.cons AND da.dep IS NOT DISTINCT FROM k.dep
      LEFT JOIN ga ON ga.fecha = k.fecha AND ga.cons = k.cons AND ga.dep IS NOT DISTINCT FROM k.dep
    )
    INSERT INTO "ResumenDiario" (
      "id", "fecha", "depositoId", "cantidadVentas", "unidadesVendidas", "totalVentas", "costoVentas",
      "gananciaBruta", "totalGastos", "gananciaNeta", "totalPorMedioPago", "devoluciones",
      "costoDevoluciones", "updatedAt"
    )
    SELECT gen_random_uuid()::text, fecha, dep, cantidad, unidades, total, costo,
           total - costo, gastos, (total - costo) - (devol - costo_devol) - gastos, medios, devol,
           costo_devol, now()
    FROM calc
    ON CONFLICT ("fecha", "depositoId") DO UPDATE SET
      "cantidadVentas"    = EXCLUDED."cantidadVentas",
      "unidadesVendidas"  = EXCLUDED."unidadesVendidas",
      "totalVentas"       = EXCLUDED."totalVentas",
      "costoVentas"       = EXCLUDED."costoVentas",
      "gananciaBruta"     = EXCLUDED."gananciaBruta",
      "totalGastos"       = EXCLUDED."totalGastos",
      "gananciaNeta"      = EXCLUDED."gananciaNeta",
      "totalPorMedioPago" = EXCLUDED."totalPorMedioPago",
      "devoluciones"      = EXCLUDED."devoluciones",
      "costoDevoluciones" = EXCLUDED."costoDevoluciones",
      "updatedAt"         = now()
  `;
}

/**
 * Reconstruye TODA la tabla desde el ledger (ventas, pagos, devoluciones y
 * gastos): desde el primer día con actividad hasta hoy. Para recuperación.
 */
export async function reconstruirResumenDiario(): Promise<{
  desde: DiaISO | null;
  hasta: DiaISO;
  filas: number;
}> {
  const tz = await obtenerZonaHoraria();
  const hasta = diaEn(ahora(), tz);
  const [primero] = await prisma.$queryRaw<{ min: Date | null }[]>`
    SELECT LEAST(
      (SELECT MIN("fecha") FROM "Venta" WHERE "estado" = 'CONFIRMADA'),
      (SELECT MIN("fecha") FROM "PagoVenta"),
      (SELECT MIN("fecha") FROM "Devolucion"),
      (SELECT MIN("fecha") FROM "Gasto" WHERE "deletedAt" IS NULL)
    ) AT TIME ZONE 'UTC' AS min
  `;
  const desde = primero?.min ? diaEn(primero.min, tz) : null;
  const filas = await withTransaction(
    async (tx) => {
      await tx.$executeRaw`DELETE FROM "ResumenDiario"`;
      if (!desde) return 0;
      return recalcularRango(tx, {
        desde,
        hasta: desde > hasta ? desde : hasta,
        tz,
        depositoIds: null,
      });
    },
    { timeout: 300_000 },
  );
  return { desde, hasta, filas };
}
