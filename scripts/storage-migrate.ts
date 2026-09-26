/**
 * pnpm storage:migrate — copia los archivos de la carpeta local (STORAGE_DIR,
 * por defecto .storage/) al bucket S3/R2 configurado (STORAGE_PROVIDER=s3).
 *
 * Las referencias guardadas en la DB (`/api/publico/archivos/<clave>`) NO
 * cambian: la misma clave pasa a resolverse contra el bucket. Por eso no se
 * reescribe ninguna fila.
 *
 * Idempotente: si el objeto ya está en el bucket con el mismo tamaño, se salta.
 * Cada archivo subido se verifica leyéndolo de vuelta (tamaño idéntico).
 * Los backups de la base (backups-db/) no se copian: van a su propio bucket.
 * Uso: STORAGE_PROVIDER=s3 S3_...=... pnpm storage:migrate [--origen=.storage] [--dry-run]
 */
import path from "node:path";

import { obtenerEnv } from "../src/env";
import { obtenerStorage, StorageLocal, esClaveValida } from "../src/server/storage";

async function main() {
  const env = obtenerEnv();
  if (env.STORAGE_PROVIDER !== "s3")
    throw new Error("Configurá STORAGE_PROVIDER=s3 y las variables S3_* del destino.");
  const origenArg = process.argv.find((a) => a.startsWith("--origen="))?.split("=")[1];
  const seco = process.argv.includes("--dry-run");
  const origen = new StorageLocal(path.resolve(origenArg ?? env.STORAGE_DIR ?? ".storage"));
  const destino = obtenerStorage();
  await destino.verificar();

  const archivos = (await origen.listar("")).filter((a) => !a.clave.startsWith("backups-db/"));
  let subidos = 0;
  let salteados = 0;
  const invalidos: string[] = [];
  for (const a of archivos) {
    if (!esClaveValida(a.clave)) {
      invalidos.push(a.clave);
      continue;
    }
    const remoto = await destino.leer(a.clave).catch(() => null);
    if (remoto && remoto.datos.byteLength === a.tamanio) {
      salteados++;
      continue;
    }
    if (seco) {
      console.log(`[dry-run] subiría ${a.clave} (${a.tamanio} B)`);
      continue;
    }
    const local = await origen.leer(a.clave);
    if (!local) throw new Error(`No se pudo leer ${a.clave}`);
    await destino.guardar(a.clave, local.datos, local.tipo);
    const verif = await destino.leer(a.clave);
    if (!verif || verif.datos.byteLength !== local.datos.byteLength)
      throw new Error(`Verificación fallida para ${a.clave}: el tamaño en el bucket no coincide`);
    subidos++;
    console.log(`✔ ${a.clave} (${a.tamanio} B)`);
  }
  console.log(
    `\n${archivos.length} archivos · ${subidos} subidos y verificados · ${salteados} ya estaban · ${invalidos.length} ignorados`,
  );
  if (invalidos.length)
    console.log(`Ignorados (nombre no válido para el storage): ${invalidos.join(", ")}`);
}

main().catch((e: unknown) => {
  console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
