/**
 * pnpm release — paso de release de producción, ANTES de publicar la versión nueva:
 *   1. backup de la base (origen "release"), verificado; si falla, se corta acá.
 *   2. prisma migrate deploy (solo aplica migraciones versionadas; nunca migrate dev ni db push).
 * Si una migración falla, el deploy no avanza y queda el backup recién hecho
 * para restaurar (ver docs/DEPLOY.md → Rollback).
 */
import { execFileSync } from "node:child_process";

import { prisma } from "../src/lib/db";
import { hacerBackup } from "../src/server/services/backup.service";

async function main() {
  // `migrate status` sale con código ≠ 0 cuando hay migraciones pendientes.
  let alDia: boolean;
  try {
    alDia = execFileSync("npx", ["prisma", "migrate", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).includes("Database schema is up to date");
  } catch {
    alDia = false;
  }
  if (alDia) {
    console.log("✔ Sin migraciones pendientes: no hace falta backup previo.");
    return;
  }
  console.log("→ Hay migraciones pendientes: backup previo…");
  const b = await hacerBackup("release");
  if (!b.ok) throw new Error(`Backup previo FALLIDO (${b.error}). No se migra.`);
  console.log(`✔ Backup ${b.archivo} (${(b.tamanio / 1024).toFixed(1)} KiB)`);
  await prisma.$disconnect();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
  console.log("✔ Migraciones aplicadas");
}

main()
  .catch((e: unknown) => {
    console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
