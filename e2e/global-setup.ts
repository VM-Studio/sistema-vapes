import { execSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { URL_TEST } from "../playwright.config";

/**
 * Base de test desde cero: DROP/CREATE, migraciones (migrate deploy, igual que
 * producción) y seed base. Los dueños (Juan Cruz, Agustina) y Trinidad quedan
 * con una contraseña conocida y sin el cambio obligatorio (el flujo de cambio
 * se prueba con usuarios propios).
 */
export const PASSWORD_DUENO = "DuenoE2E2026";
export const PASSWORD_TRINIDAD = "TrinidadE2E2026";

export async function prepararBaseDeTest(url: string = URL_TEST) {
  const URL_TEST_LOCAL = url;
  const u = new URL(URL_TEST_LOCAL);
  const base = u.pathname.slice(1);
  if (!/e2e|test/.test(base))
    throw new Error(`DATABASE_URL_TEST tiene que ser una base de prueba (${base})`);
  const admin = new URL(URL_TEST_LOCAL);
  admin.pathname = "/postgres";
  admin.search = "";
  const pg = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  await pg.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
  await pg.$executeRawUnsafe(`CREATE DATABASE "${base}"`);
  await pg.$disconnect();
  const env = {
    ...process.env,
    DATABASE_URL: URL_TEST_LOCAL,
    DIRECT_URL: URL_TEST_LOCAL,
    PRISMA_LOG: "silent",
  };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url: URL_TEST_LOCAL } } });
  await db.usuario.updateMany({
    where: { rol: "OWNER" },
    data: { passwordHash: await bcrypt.hash(PASSWORD_DUENO, 12), debeCambiarPassword: false },
  });
  await db.usuario.updateMany({
    where: { nombre: "Trinidad" },
    data: { passwordHash: await bcrypt.hash(PASSWORD_TRINIDAD, 12), debeCambiarPassword: false },
  });
  await db.$disconnect();
  execSync("rm -rf .storage-e2e");
}

/** Playwright levanta el webServer ANTES que el globalSetup: la base se prepara en el comando del servidor. */
export default async function globalSetup() {}

if (process.argv[1]?.endsWith("global-setup.ts")) {
  prepararBaseDeTest().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
