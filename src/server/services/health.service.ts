import { versionApp } from "@/env";
import { prisma } from "@/lib/db";
import { obtenerStorage } from "@/server/storage";

/**
 * Healthcheck de la plataforma (Vercel / Railway): sin datos del negocio ni
 * secretos. `ok` depende de la DB (sin DB la app no sirve); storage y backup
 * se informan pero no tiran abajo el servicio.
 */
export interface HealthStatus {
  ok: boolean;
  version: string;
  uptimeS: number;
  db: { ok: boolean; latenciaMs: number | null };
  storage: { ok: boolean; proveedor: string; latenciaMs: number | null };
  backup: { ok: boolean; ultimo: string | null; horasDesde: number | null };
}

const inicio = Date.now();

async function cronometrar<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number | null }> {
  const t0 = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, mal) => setTimeout(() => mal(new Error("timeout")), 3000)),
    ]);
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch {
    return { ok: false, ms: null };
  }
}

export async function getHealth(): Promise<HealthStatus> {
  const storage = obtenerStorage();
  const [db, st, backup] = await Promise.all([
    cronometrar(() => prisma.$queryRaw`SELECT 1`),
    cronometrar(() => storage.verificar()),
    prisma.backup
      .findFirst({
        where: { ok: true },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      .catch(() => null),
  ]);
  const horas = backup
    ? Math.round(((Date.now() - backup.createdAt.getTime()) / 3600_000) * 10) / 10
    : null;
  return {
    ok: db.ok,
    version: versionApp(),
    uptimeS: Math.round((Date.now() - inicio) / 1000),
    db: { ok: db.ok, latenciaMs: db.ms },
    storage: { ok: st.ok, proveedor: storage.nombre, latenciaMs: st.ms },
    backup: {
      ok: horas !== null && horas < 36,
      ultimo: backup?.createdAt.toISOString() ?? null,
      horasDesde: horas,
    },
  };
}
