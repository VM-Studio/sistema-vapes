import pino, { type Logger } from "pino";

/**
 * Logging estructurado. JSON en producción (lo indexa la plataforma), legible
 * en desarrollo. Nunca se loguean contraseñas, tokens, cookies ni bodies: los
 * campos sensibles se redactan aunque alguien los pase por error.
 * `logger()` dentro de un request agrega el requestId que puso el middleware.
 */
const nivel = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");

function destinoDev() {
  if (process.env.NODE_ENV === "production" || process.env.LOG_JSON === "1") return undefined;
  try {
    // pino-pretty es devDependency: en producción no existe y se usa JSON.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pretty = require("pino-pretty") as (o: object) => NodeJS.WritableStream;
    return pretty({
      colorize: true,
      sync: true,
      ignore: "pid,hostname,app",
      translateTime: "HH:MM:ss",
    });
  } catch {
    return undefined;
  }
}

export const log: Logger = pino(
  {
    level: nivel,
    base: {
      app: "gestion",
      version: (process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 12),
    },
    redact: {
      paths: [
        "password",
        "passwordActual",
        "passwordNueva",
        "confirmacion",
        "passwordHash",
        "token",
        "tok",
        "authorization",
        "cookie",
        "*.password",
        "*.passwordNueva",
        "*.token",
        "*.authorization",
        "*.cookie",
        "headers.cookie",
        "headers.authorization",
        "req.headers.cookie",
        "req.headers.authorization",
      ],
      censor: "[redactado]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  destinoDev(),
);

/** Logger global (scripts, servicios fuera de un request). */
export function logger(): Logger {
  return log;
}

/** Logger del request actual, con el requestId que puso el middleware. */
export async function loggerRequest(): Promise<Logger> {
  try {
    const { headers } = await import("next/headers");
    const id = (await headers()).get("x-request-id");
    return id ? log.child({ requestId: id }) : log;
  } catch {
    return log;
  }
}

// -----------------------------------------------------------------------------
// Métricas de negocio: duración de operaciones críticas con p50/p95 en los logs.
// -----------------------------------------------------------------------------

const muestras = new Map<string, number[]>();
const CADA = 20;

export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const i = Math.min(
    ordenados.length - 1,
    Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1),
  );
  return ordenados[i]!;
}

/** Registra una duración; cada 20 muestras loguea p50/p95 de las últimas 200. */
export function registrarDuracion(metrica: string, ms: number): void {
  const lista = muestras.get(metrica) ?? [];
  lista.push(ms);
  if (lista.length > 200) lista.shift();
  muestras.set(metrica, lista);
  log.debug({ metrica, ms: Math.round(ms) }, "duracion");
  if (lista.length % CADA === 0 || lista.length === 1) {
    log.info(
      {
        metrica,
        n: lista.length,
        p50: Math.round(percentil(lista, 50)),
        p95: Math.round(percentil(lista, 95)),
      },
      `métrica ${metrica}`,
    );
  }
}

export async function medir<T>(metrica: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    registrarDuracion(metrica, performance.now() - t0);
  }
}
