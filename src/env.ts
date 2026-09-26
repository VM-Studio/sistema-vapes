import { z } from "zod";

/**
 * Variables de entorno validadas. `obtenerEnv()` se llama al arrancar el
 * servidor (instrumentation.ts): con una variable inválida la app NO arranca
 * y el error dice cuál y por qué. Lo que empieza con NEXT_PUBLIC_ llega al
 * navegador: ahí solo van valores públicos.
 */

const PLACEHOLDER_AUTH = "cambiar-por-un-secreto-largo-y-aleatorio-de-al-menos-32-caracteres";
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const esquema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((u) => /^postgres(ql)?:\/\//.test(u), "Tiene que ser una URL de PostgreSQL"),
    DIRECT_URL: z.string().url().optional(),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET: mínimo 32 caracteres (openssl rand -base64 32)"),
    CRON_SECRET: z
      .string()
      .min(16, "CRON_SECRET: mínimo 16 caracteres (openssl rand -hex 32)")
      .optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),

    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    STORAGE_DIR: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    /** Dominio público del bucket (logos e imágenes de producto). */
    S3_PUBLIC_URL: z.string().url().optional(),
    /** Bucket separado para backups (otra credencial en producción, ideal). */
    S3_BACKUP_BUCKET: z.string().optional(),
    /** MinIO local necesita path-style; R2 y S3 no. */
    S3_FORCE_PATH_STYLE: bool,

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    /** SHA del commit desplegado (Vercel lo inyecta como VERCEL_GIT_COMMIT_SHA). */
    APP_VERSION: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    RATE_LIMIT_POR_MINUTO: z.coerce.number().int().min(10).max(100_000).default(300),
    ALLOW_SEED: bool,
  })
  .superRefine((e, ctx) => {
    const prod = e.NODE_ENV === "production";
    const falta = (campo: string, motivo: string) =>
      ctx.addIssue({ code: "custom", path: [campo], message: motivo });
    if (prod && e.AUTH_SECRET === PLACEHOLDER_AUTH)
      falta("AUTH_SECRET", "sigue siendo el placeholder de .env.example");
    if (prod && !e.CRON_SECRET)
      falta("CRON_SECRET", "obligatorio en producción (protege /api/cron/*)");
    if (prod && !e.NEXT_PUBLIC_APP_URL)
      falta(
        "NEXT_PUBLIC_APP_URL",
        "obligatorio en producción (links de WhatsApp, cookies seguras)",
      );
    if (e.STORAGE_PROVIDER === "s3") {
      for (const c of [
        "S3_ENDPOINT",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_BUCKET",
      ] as const) {
        if (!e[c]) falta(c, "obligatorio con STORAGE_PROVIDER=s3");
      }
    }
  });

export type Env = z.output<typeof esquema>;

let cache: Env | null = null;

export function obtenerEnv(): Env {
  if (cache) return cache;
  // Una variable vacía (VAR="" como en .env.example) cuenta como no definida.
  const crudo = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    const detalle = r.error.issues
      .map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuración de entorno inválida:\n${detalle}`);
  }
  cache = r.data;
  return cache;
}

/** Versión desplegada (SHA corto) para health, Sentry y logs. */
export function versionApp(): string {
  const e = obtenerEnv();
  return (e.APP_VERSION ?? e.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 12);
}

/** Solo para tests. */
export function reiniciarEnv(): void {
  cache = null;
}
