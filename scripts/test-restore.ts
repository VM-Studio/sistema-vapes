/**
 * Prueba de restauración (corre en CI sobre la base sembrada; ver docs/DEPLOY.md):
 *  1. `pnpm backup` sobre la base de DATABASE_URL (ej. la demo).
 *  2. Crea una base VACÍA (RESTORE_DB, default gestion_restore) y restaura ahí.
 *  3. Compara COUNT(*) de TODAS las tablas y SUM(Stock.cantidad): tienen que coincidir.
 * Uso: DATABASE_URL=…/gestion_demo pnpm test:restore
 */
import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { hacerBackup } from "../src/server/services/backup.service";

async function conteos(db: PrismaClient) {
  const tablas = await db.$queryRaw<{ t: string }[]>`
    SELECT table_name AS t FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const r: Record<string, number> = {};
  for (const { t } of tablas) {
    const [f] = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "${t.replace(/"/g, "")}"`,
    ); // nombres del catálogo, no del usuario
    r[t] = Number(f!.n);
  }
  const [s] = await db.$queryRaw<{ s: bigint | null }[]>`SELECT SUM("cantidad") AS s FROM "Stock"`;
  // Las protecciones también se restauran: triggers (ledger inmutable, aislamiento entre paneles, etc.) y vistas.
  const [t] = await db.$queryRaw<
    { n: bigint }[]
  >`SELECT COUNT(*) AS n FROM pg_trigger WHERE NOT tgisinternal`;
  const [v] = await db.$queryRaw<
    { n: bigint }[]
  >`SELECT COUNT(*) AS n FROM pg_views WHERE schemaname = 'public'`;
  r["(triggers)"] = Number(t!.n);
  r["(vistas)"] = Number(v!.n);
  return { tablas: r, stock: Number(s?.s ?? 0) };
}

async function main() {
  const destinoDb = process.env.RESTORE_DB ?? "gestion_restore";
  if (/^gestion$/.test(destinoDb))
    throw new Error("La base de restauración no puede ser la de desarrollo");
  const origen = new URL(process.env.DATABASE_URL!);
  console.log(`1) Backup de «${origen.pathname.slice(1)}»`);
  // Conteos del origen en el momento del backup (después se agrega la fila Backup de este mismo backup).
  const a = await conteos(prisma);
  const b = await hacerBackup("manual");
  if (!b.ok) throw new Error(b.error);
  console.log(`   ✔ ${b.archivo} · ${(b.tamanio / 1024).toFixed(1)} KiB · ${b.entradas} entradas`);

  console.log(`2) Base vacía «${destinoDb}» y restauración`);
  // psql contra la base de mantenimiento del mismo servidor (local, docker o
  // el service de Postgres del CI): no depende de un contenedor con nombre.
  const mantenimiento = new URL(origen.toString());
  mantenimiento.pathname = "/postgres";
  mantenimiento.search = "";
  const psqlBin = process.env.PG_DUMP_PATH?.replace(/pg_dump$/, "psql") ?? "psql";
  const psql = (sql: string) => {
    const r = spawnSync(psqlBin, [mantenimiento.toString(), "-qc", sql], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`psql falló (${sql}):\n${r.stderr || r.error}`);
  };
  psql(`DROP DATABASE IF EXISTS "${destinoDb}" WITH (FORCE)`);
  psql(`CREATE DATABASE "${destinoDb}"`);
  const destino = new URL(origen.toString());
  destino.pathname = `/${destinoDb}`;
  const r = spawnSync("pnpm", ["-s", "restore", b.archivo], {
    encoding: "utf8",
    env: { ...process.env, RESTORE_DATABASE_URL: destino.toString() },
  });
  process.stdout.write(r.stdout.replace(/^/gm, "   "));
  if (r.status !== 0) throw new Error(`restore falló:\n${r.stderr}`);

  console.log("3) Comparación antes / después");
  const restaurada = new PrismaClient({ datasources: { db: { url: destino.toString() } } });
  const d = await conteos(restaurada);
  let fallos = 0;
  console.log(`   ${"Tabla".padEnd(28)} ${"Origen".padStart(8)} ${"Restaurada".padStart(11)}`);
  for (const t of Object.keys(a.tablas)) {
    const ok = a.tablas[t] === d.tablas[t];
    if (!ok) fallos++;
    console.log(
      `   ${ok ? "✔" : "✘"} ${t.padEnd(26)} ${String(a.tablas[t]).padStart(8)} ${String(d.tablas[t] ?? "—").padStart(11)}`,
    );
  }
  const okStock = a.stock === d.stock;
  if (!okStock) fallos++;
  console.log(
    `   ${okStock ? "✔" : "✘"} ${"SUM(Stock.cantidad)".padEnd(26)} ${String(a.stock).padStart(8)} ${String(d.stock).padStart(11)}`,
  );
  // Con movimientos, un UPDATE tiene que rebotar; sin movimientos (base recién
  // sembrada) el UPDATE no toca filas: se verifica que el trigger exista.
  await restaurada.$connect();
  const [movs] = await restaurada.$queryRaw<
    { n: bigint }[]
  >`SELECT COUNT(*) AS n FROM "MovimientoStock"`;
  const inmutable =
    Number(movs!.n) > 0
      ? await restaurada
          .$executeRawUnsafe(`UPDATE "MovimientoStock" SET "cantidad" = "cantidad" WHERE true`)
          .then(
            () => false,
            () => true,
          )
      : (
          await restaurada.$queryRaw<{ n: bigint }[]>`
            SELECT COUNT(*) AS n FROM pg_trigger
            WHERE tgrelid = '"MovimientoStock"'::regclass AND NOT tgisinternal
              AND tgtype & 16 = 16 AND tgtype & 2 = 2`
        )[0]!.n > 0;
  await restaurada.$disconnect();
  if (!inmutable) fallos++;
  console.log(
    `   ${inmutable ? "✔" : "✘"} en la restaurada, modificar el ledger sigue rechazado por trigger`,
  );
  console.log(
    fallos
      ? `\n${fallos} DIFERENCIA(S)`
      : `\nRESTAURACIÓN VERIFICADA: ${Object.keys(a.tablas).length - 2} tablas idénticas, triggers y vistas incluidos`,
  );
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
