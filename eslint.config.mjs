import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * AISLAMIENTO ENTRE PANELES: el cliente de Prisma crudo (`@/lib/db`) solo se
 * usa en la capa de datos (src/server/db) y en los servicios GLOBALES (auth,
 * sesiones, usuarios, paneles, backups, salud, auditoría global, identidad).
 * Todo servicio de negocio usa dbPara(ctx.panelId) / transaccion(ctx, ...) de
 * @/server/db/panel-scoped. Tampoco se puede instanciar otro PrismaClient.
 */
const PRISMA_CRUDO = {
  paths: [
    {
      name: "@/lib/db",
      message:
        "Prisma crudo prohibido en código de negocio: usá dbPara(ctx.panelId) o transaccion(ctx, …) de @/server/db/panel-scoped (los tipos Tx/TransactionOptions también se exportan desde ahí).",
    },
    {
      name: "@prisma/client",
      importNames: ["PrismaClient"],
      message: "No instancies otro PrismaClient: usá dbPara(ctx.panelId).",
    },
  ],
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "test-results/**",
      "playwright-report/**",
      "verificacion/**",
      ".storage*/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/db.ts",
      "src/server/db/**",
      "src/server/auth/**",
      "src/middleware.ts",
      "src/server/seguridad/rate-limit.ts",
      "src/server/services/auth.service.ts",
      "src/server/services/sesion.service.ts",
      "src/server/services/usuario.service.ts",
      "src/server/services/panel.service.ts",
      "src/server/services/backup.service.ts",
      "src/server/services/health.service.ts",
      "src/server/services/auditoria.service.ts",
      "src/server/services/identidad.service.ts",
      "src/server/reportes/exportar-todo.ts",
    ],
    rules: { "no-restricted-imports": ["error", PRISMA_CRUDO] },
  },
];

export default eslintConfig;
