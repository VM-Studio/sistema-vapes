/**
 * pnpm restore <archivo> [--force]
 *
 * Descarga un backup del bucket (clave "backups/backup-….dump", solo el nombre,
 * o una ruta local a un .dump) y lo restaura en RESTORE_DATABASE_URL.
 * NUNCA sobre la base de la app (DATABASE_URL / DIRECT_URL) salvo con --force
 * Y escribiendo el nombre de la base para confirmar.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
  ejecutar,
  PREFIJO,
  urlParaPgTools,
  verificarDump,
} from "../src/server/services/backup.service";
import { obtenerStorageBackups } from "../src/server/storage";

const destinoDe = (u: string) => {
  const x = new URL(u);
  return `${x.hostname}:${x.port || 5432}${x.pathname}`;
};

async function main() {
  const archivo = process.argv[2];
  const force = process.argv.includes("--force");
  if (!archivo || archivo.startsWith("--"))
    throw new Error("Uso: pnpm restore <archivo> [--force]");
  const destino = process.env.RESTORE_DATABASE_URL;
  if (!destino) throw new Error("Falta RESTORE_DATABASE_URL (la base donde restaurar).");

  const produccion = [process.env.DATABASE_URL, process.env.DIRECT_URL]
    .filter(Boolean)
    .map((u) => destinoDe(u!));
  if (produccion.includes(destinoDe(destino))) {
    if (!force)
      throw new Error(
        "RESTORE_DATABASE_URL es la base de la app. Si de verdad querés pisarla: --force.",
      );
    const nombre = new URL(destino).pathname.slice(1);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const resp = await rl.question(
      `⚠ Vas a REEMPLAZAR los datos de «${nombre}» con ${archivo}. Escribí el nombre de la base para confirmar: `,
    );
    rl.close();
    if (resp.trim() !== nombre) throw new Error("Confirmación incorrecta: no se restauró nada.");
  }

  const dir = await mkdtemp(path.join(tmpdir(), "restore-"));
  try {
    let local = archivo;
    if (!existsSync(archivo)) {
      const clave = archivo.startsWith(PREFIJO) ? archivo : `${PREFIJO}${archivo}`;
      const f = await obtenerStorageBackups().leer(clave);
      if (!f) throw new Error(`No existe ${clave} en el bucket de backups.`);
      local = path.join(dir, path.basename(clave));
      await writeFile(local, f.datos);
    }
    const entradas = await verificarDump(local);
    console.log(
      `Backup válido (${entradas} entradas, ${((await readFile(local)).length / 1024).toFixed(1)} KiB). Restaurando en ${destinoDe(destino)}…`,
    );
    const t0 = Date.now();
    const r = await ejecutar(process.env.PG_RESTORE_PATH ?? "pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      `--dbname=${urlParaPgTools(destino)}`,
      local,
    ]);
    if (r.codigo !== 0) throw new Error(`pg_restore falló: ${r.stderr.trim().slice(0, 1000)}`);
    console.log(`✔ Restaurado en ${Date.now() - t0} ms.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
