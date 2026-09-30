import type { PrismaClient } from "@prisma/client";

/**
 * Vaciado de los DATOS DE NEGOCIO de todos los paneles, dejando intacta la
 * estructura para seguir operando. Lo usan `pnpm db:limpiar-negocio`
 * (scripts/limpiar-negocio.ts) y los E2E (e2e/fixtures) para limpiar lo que
 * crearon. Solo depende de @prisma/client: se puede importar desde Playwright.
 *
 * - Tablas de negocio: TRUNCATE de la lista explícita, SIN CASCADE (si alguna
 *   tabla preservada apuntara a una de negocio, Postgres corta con error en
 *   vez de arrastrarla).
 * - AuditLog: se borra la auditoría de los paneles (panelId no nulo); la
 *   global (logins, usuarios, configuración, paneles) queda.
 * - Secuencia: vuelve a 0 (sin ventas/compras/… la numeración arranca de nuevo).
 *
 * Los triggers de inmutabilidad (MovimientoStock, Stock, AuditLog,
 * historial de precios, secuencias que solo avanzan) se desactivan DENTRO de
 * la transacción y se reactivan antes del COMMIT: si algo falla, el ROLLBACK
 * deshace también el ALTER TABLE.
 */

/** Hijas primero (el orden de las FKs; TRUNCATE de la lista entera igual lo resuelve junto). */
export const TABLAS_NEGOCIO = [
  "CotizacionItem",
  "PagoVenta",
  "VentaItem",
  "DevolucionItem",
  "CompraItem",
  "TransferenciaItem",
  "Devolucion",
  "Venta",
  "Cotizacion",
  "Compra",
  "Transferencia",
  "MovimientoStock",
  "Stock",
  "EscalonPrecio",
  "EscalonPrecioDefault",
  "ProveedorProductoHistorial",
  "ProveedorProducto",
  "CodigoBarrasAlternativo",
  "Variante",
  "Producto",
  "Marca",
  "Categoria",
  "Proveedor",
  "Cliente",
] as const;

/** Tablas que NO se tocan (salvo AuditLog: solo su parte de paneles, y Secuencia: a 0). */
export const TABLAS_PRESERVADAS = [
  "Panel",
  "Deposito",
  "Usuario",
  "UsuarioPanel",
  "PermisoUsuario",
  "Sesion",
  "Configuracion",
  "ConfiguracionGlobal",
  "Secuencia",
  "AuditLog",
  "Backup",
  "IntentoLogin",
  "RateLimit",
] as const;

const q = (tabla: string) => `"${tabla}"`;

export interface ResultadoLimpieza {
  /** Filas de auditoría de paneles borradas. */
  auditoriaBorrada: number;
  /** Secuencias que estaban en un número > 0 y volvieron a 0. */
  secuenciasReiniciadas: number;
}

type Cliente = Pick<PrismaClient, "$transaction">;

export async function limpiarNegocio(db: Cliente): Promise<ResultadoLimpieza> {
  const conTriggers = [...TABLAS_NEGOCIO, "AuditLog", "Secuencia"];
  return db.$transaction(
    async (tx) => {
      for (const t of conTriggers) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${q(t)} DISABLE TRIGGER USER`);
      }
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${TABLAS_NEGOCIO.map(q).join(", ")}`);
      const auditoriaBorrada = await tx.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "panelId" IS NOT NULL`,
      );
      const secuenciasReiniciadas = await tx.$executeRawUnsafe(
        `UPDATE "Secuencia" SET "ultimoNumero" = 0, "updatedAt" = now() WHERE "ultimoNumero" <> 0`,
      );
      for (const t of conTriggers) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${q(t)} ENABLE TRIGGER USER`);
      }
      return { auditoriaBorrada, secuenciasReiniciadas };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** COUNT(*) de cada tabla (nombre → filas). */
export async function contarFilas(
  db: Pick<PrismaClient, "$queryRawUnsafe">,
  tablas: readonly string[],
): Promise<Record<string, number>> {
  const filas: Record<string, number> = {};
  for (const t of tablas) {
    const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM ${q(t)}`);
    filas[t] = Number(r?.n ?? 0);
  }
  return filas;
}
