import { PrismaClient } from "@prisma/client";

import { URL_TEST } from "../playwright.config";

/** Acceso directo a la base de test para preparar datos y verificar resultados. */
export const db = new PrismaClient({ datasources: { db: { url: URL_TEST } } });
