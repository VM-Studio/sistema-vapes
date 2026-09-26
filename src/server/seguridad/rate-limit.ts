import { prisma } from "@/lib/db";

/**
 * Rate limit con ventana deslizante aproximada (tabla RateLimit, ventanas de
 * 1 minuto): estimado = actual + anterior × (fracción que falta del minuto).
 * Un UPSERT por request: persistente y compartido entre instancias.
 */
const VENTANA_MS = 60_000;

export interface ResultadoRateLimit {
  permitido: boolean;
  estimado: number;
  limite: number;
  reintentarEnSegundos: number;
}

export function estimarVentanaDeslizante(
  actual: number,
  anterior: number,
  msDesdeInicio: number,
): number {
  const fraccion = Math.min(1, Math.max(0, msDesdeInicio / VENTANA_MS));
  return actual + anterior * (1 - fraccion);
}

export async function consumir(
  clave: string,
  limite: number,
  ahora = Date.now(),
): Promise<ResultadoRateLimit> {
  const inicio = Math.floor(ahora / VENTANA_MS) * VENTANA_MS;
  const ventana = new Date(inicio);
  const previa = new Date(inicio - VENTANA_MS);
  const [fila] = await prisma.$queryRaw<{ actual: number; anterior: number | null }[]>`
    WITH inc AS (
      INSERT INTO "RateLimit" ("clave", "ventana", "contador") VALUES (${clave}, ${ventana}::timestamptz AT TIME ZONE 'UTC', 1)
      ON CONFLICT ("clave", "ventana") DO UPDATE SET "contador" = "RateLimit"."contador" + 1
      RETURNING "contador"
    )
    SELECT (SELECT "contador" FROM inc) AS actual,
           (SELECT "contador" FROM "RateLimit" WHERE "clave" = ${clave} AND "ventana" = ${previa}::timestamptz AT TIME ZONE 'UTC') AS anterior
  `;
  const estimado = estimarVentanaDeslizante(fila?.actual ?? 1, fila?.anterior ?? 0, ahora - inicio);
  // Limpieza perezosa de ventanas viejas (≈ 1 de cada 500 requests).
  if (Math.random() < 0.002) {
    void prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "ventana" < (${new Date(ahora - 10 * VENTANA_MS)}::timestamptz AT TIME ZONE 'UTC')`.catch(
      () => {},
    );
  }
  return {
    permitido: estimado <= limite,
    estimado: Math.round(estimado),
    limite,
    reintentarEnSegundos: Math.ceil((inicio + VENTANA_MS - ahora) / 1000),
  };
}
