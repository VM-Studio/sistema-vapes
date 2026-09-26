import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { TipoNotificacion } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";

import { obtenerEnv } from "@/env";
import { prisma } from "@/lib/db";
import { ZONA_DEFAULT } from "@/lib/zona-horaria";
import { log } from "@/server/log";
import { obtenerStorageBackups } from "@/server/storage";

/**
 * BACKUPS de la base de datos.
 *
 *  1. `pg_dump -Fc` (formato custom: ya va comprimido y se restaura por partes)
 *     contra la conexión DIRECTA (DIRECT_URL): pg_dump no funciona a través de
 *     un pooler en modo transaction.
 *  2. Verificación: `pg_restore --list` sobre el archivo generado. Si no lista
 *     el contenido (archivo corrupto o truncado), el backup es FALLIDO.
 *  3. Subida al bucket de backups (separado del de archivos) como
 *     `backups/backup-YYYY-MM-DD-HHmm.dump` (hora argentina).
 *  4. Rotación: diarios 30 días, semanales 12 semanas (el último de cada
 *     semana), mensuales 12 meses (el último de cada mes).
 *  5. Registro en la tabla Backup (ok, tamaño, duración, error).
 * Un backup que nunca se restauró no es un backup: ver scripts/test-restore.ts.
 */

export const PREFIJO = "backups/";
const PG_DUMP = () => process.env.PG_DUMP_PATH ?? "pg_dump";
const PG_RESTORE = () => process.env.PG_RESTORE_PATH ?? "pg_restore";

interface ResultadoComando {
  codigo: number;
  stdout: string;
  stderr: string;
}

export function ejecutar(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<ResultadoComando> {
  return new Promise((ok, mal) => {
    const p = spawn(bin, args, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", (e: NodeJS.ErrnoException) =>
      mal(
        e.code === "ENOENT"
          ? new Error(
              `No se encontró «${bin}»: instalá postgresql-client (misma versión mayor que el servidor).`,
            )
          : e,
      ),
    );
    p.on("close", (codigo) => ok({ codigo: codigo ?? 1, stdout, stderr }));
  });
}

/** URL para herramientas de Postgres: sin los parámetros que solo entiende Prisma. */
export function urlParaPgTools(url: string): string {
  const u = new URL(url);
  for (const p of [
    "schema",
    "connection_limit",
    "pool_timeout",
    "pgbouncer",
    "statement_cache_size",
  ])
    u.searchParams.delete(p);
  return u.toString();
}

export function nombreBackup(fecha: Date, tz = ZONA_DEFAULT): string {
  return `${PREFIJO}backup-${formatInTimeZone(fecha, tz, "yyyy-MM-dd-HHmm")}.dump`;
}

/** Fecha (día) de un backup a partir de su nombre. */
export function fechaDeBackup(clave: string): string | null {
  return clave.match(/backup-(\d{4}-\d{2}-\d{2})-\d{4}\.dump$/)?.[1] ?? null;
}

/**
 * Qué backups conservar: diarios de los últimos 30 días, el más nuevo de cada
 * semana ISO de las últimas 12 semanas y el más nuevo de cada mes de los
 * últimos 12 meses. Función pura (testeable).
 */
export function clavesAConservar(claves: string[], hoy: string): Set<string> {
  const dia = (d: string) => new Date(`${d}T12:00:00Z`).getTime();
  const edadDias = (d: string) => Math.floor((dia(hoy) - dia(d)) / 86_400_000);
  const semanaIso = (d: string) => {
    const f = new Date(`${d}T12:00:00Z`);
    const jueves = new Date(f);
    jueves.setUTCDate(f.getUTCDate() + 3 - ((f.getUTCDay() + 6) % 7));
    const primerJueves = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 4));
    const n =
      1 +
      Math.round(
        ((jueves.getTime() - primerJueves.getTime()) / 86_400_000 -
          3 +
          ((primerJueves.getUTCDay() + 6) % 7)) /
          7,
      );
    return `${jueves.getUTCFullYear()}-W${String(n).padStart(2, "0")}`;
  };
  const conFecha = claves
    .map((c) => ({ c, d: fechaDeBackup(c) }))
    .filter((x): x is { c: string; d: string } => x.d !== null)
    .sort((a, b) => b.c.localeCompare(a.c)); // más nuevo primero
  const conservar = new Set<string>();
  const semanas = new Set<string>();
  const meses = new Set<string>();
  for (const { c, d } of conFecha) {
    const edad = edadDias(d);
    if (edad < 30) conservar.add(c);
    const s = semanaIso(d);
    if (edad < 12 * 7 && !semanas.has(s)) {
      semanas.add(s);
      conservar.add(c);
    }
    const m = d.slice(0, 7);
    if (edad < 366 && !meses.has(m)) {
      meses.add(m);
      conservar.add(c);
    }
  }
  return conservar;
}

export async function rotarBackups(hoy: string): Promise<{ borrados: string[] }> {
  const storage = obtenerStorageBackups();
  const claves = (await storage.listar(PREFIJO))
    .map((o) => o.clave)
    .filter((c) => fechaDeBackup(c));
  const conservar = clavesAConservar(claves, hoy);
  const borrados = claves.filter((c) => !conservar.has(c));
  for (const c of borrados) await storage.eliminar(c);
  return { borrados };
}

export interface ResultadoBackup {
  ok: boolean;
  archivo: string;
  tamanio: number;
  duracionMs: number;
  entradas: number;
  borrados: string[];
  error?: string;
}

/** pg_restore --list: si el archivo no se puede leer entero, falla. */
export async function verificarDump(archivoLocal: string): Promise<number> {
  const r = await ejecutar(PG_RESTORE(), ["--list", archivoLocal]);
  if (r.codigo !== 0) throw new Error(`pg_restore --list falló: ${r.stderr.trim().slice(0, 500)}`);
  const entradas = r.stdout.split("\n").filter((l) => /^\d+;/.test(l)).length;
  if (entradas === 0 || !/TABLE DATA/.test(r.stdout))
    throw new Error("El backup no contiene datos de tablas");
  return entradas;
}

export async function hacerBackup(
  origen: "cron" | "manual" | "release" = "cron",
): Promise<ResultadoBackup> {
  const env = obtenerEnv();
  const t0 = Date.now();
  const archivo = nombreBackup(new Date());
  const dir = await mkdtemp(path.join(tmpdir(), "backup-"));
  const local = path.join(dir, path.basename(archivo));
  try {
    const url = urlParaPgTools(env.DIRECT_URL ?? env.DATABASE_URL);
    const r = await ejecutar(PG_DUMP(), [
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-privileges",
      `--file=${local}`,
      `--dbname=${url}`,
    ]);
    if (r.codigo !== 0) throw new Error(`pg_dump falló: ${r.stderr.trim().slice(0, 500)}`);
    const entradas = await verificarDump(local);
    const tamanio = (await stat(local)).size;
    await obtenerStorageBackups().guardar(
      archivo,
      new Uint8Array(await readFile(local)),
      "application/octet-stream",
    );
    const { borrados } = await rotarBackups(
      formatInTimeZone(new Date(), ZONA_DEFAULT, "yyyy-MM-dd"),
    );
    const resultado: ResultadoBackup = {
      ok: true,
      archivo,
      tamanio,
      duracionMs: Date.now() - t0,
      entradas,
      borrados,
    };
    await prisma.backup.create({
      data: {
        archivo,
        tamanio: BigInt(tamanio),
        duracionMs: resultado.duracionMs,
        ok: true,
        origen,
      },
    });
    log.info(
      { archivo, tamanio, entradas, borrados: borrados.length, ms: resultado.duracionMs },
      "backup OK",
    );
    return resultado;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const duracionMs = Date.now() - t0;
    await prisma.backup
      .create({ data: { archivo, duracionMs, ok: false, error: error.slice(0, 2000), origen } })
      .catch((e2: unknown) => log.error({ err: e2 }, "no se pudo registrar el backup fallido"));
    log.error({ archivo, error }, "backup FALLIDO");
    await avisarBackupFallido(
      `El backup ${path.basename(archivo)} falló: ${error.slice(0, 200)}`,
    ).catch(() => {});
    return { ok: false, archivo, tamanio: 0, duracionMs, entradas: 0, borrados: [], error };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function avisarBackupFallido(mensaje: string): Promise<void> {
  const { notificar } = await import("@/server/services/notificacion.service");
  await notificar({
    tipo: TipoNotificacion.BACKUP_FALLIDO,
    titulo: "Backup de la base de datos",
    mensaje,
    clave: `backup:${new Date().toISOString().slice(0, 10)}`,
    href: "/configuracion/backups",
  });
}

/** Para el job diario de alertas: ¿hubo un backup OK en las últimas 36 h? */
export async function verificarBackupReciente(): Promise<{ ok: boolean; ultimo: Date | null }> {
  const ultimo = await prisma.backup.findFirst({
    where: { ok: true },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const ok = ultimo !== null && Date.now() - ultimo.createdAt.getTime() < 36 * 3600_000;
  if (!ok)
    await avisarBackupFallido(
      ultimo
        ? `No hay un backup correcto desde ${formatInTimeZone(ultimo.createdAt, ZONA_DEFAULT, "dd/MM HH:mm")}.`
        : "Todavía no se hizo ningún backup.",
    );
  return { ok, ultimo: ultimo?.createdAt ?? null };
}

export async function listarBackups(limite = 60) {
  const filas = await prisma.backup.findMany({ orderBy: { createdAt: "desc" }, take: limite });
  return filas.map((b) => ({ ...b, tamanio: b.tamanio === null ? null : Number(b.tamanio) }));
}

/** Link de descarga temporal (15 min). En local, la ruta autenticada de la app. */
export async function urlDescargaBackup(id: string): Promise<string | null> {
  const b = await prisma.backup.findUnique({ where: { id } });
  if (!b?.ok) return null;
  const storage = obtenerStorageBackups();
  if (!(await storage.existe(b.archivo))) return null; // ya rotado
  if (storage.nombre === "s3")
    return storage.urlFirmada(b.archivo, 15 * 60, path.basename(b.archivo));
  return `/api/backups/${b.id}/descargar`;
}

export async function leerBackupLocal(id: string) {
  const b = await prisma.backup.findUnique({ where: { id } });
  if (!b?.ok) return null;
  const f = await obtenerStorageBackups().leer(b.archivo);
  return f ? { nombre: path.basename(b.archivo), datos: f.datos } : null;
}
