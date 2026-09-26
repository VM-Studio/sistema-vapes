/**
 * pnpm backup — pg_dump de la base (DIRECT_URL o DATABASE_URL), verificado con
 * pg_restore --list, subido al bucket de backups y con rotación.
 * Programado a las 04:00 (hora Argentina): GitHub Actions (.github/workflows/backup.yml),
 * Railway cron (`pnpm backup`) o cualquier cron HTTP contra /api/cron/backup.
 * Uso: pnpm backup [--origen=manual|cron|release]
 */
import { prisma } from "../src/lib/db";
import { hacerBackup } from "../src/server/services/backup.service";

async function main() {
  const origen = (process.argv.find((a) => a.startsWith("--origen="))?.split("=")[1] ??
    "manual") as "manual" | "cron" | "release";
  const r = await hacerBackup(origen);
  if (!r.ok) {
    console.error(`✘ Backup FALLIDO: ${r.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `✔ ${r.archivo} · ${(r.tamanio / 1024).toFixed(1)} KiB · ${r.entradas} entradas verificadas con pg_restore --list · ${r.duracionMs} ms` +
      (r.borrados.length ? ` · rotados: ${r.borrados.join(", ")}` : ""),
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
