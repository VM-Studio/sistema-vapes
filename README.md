# Sistema de Gestión — vapes y artefactos electrónicos

Next.js 15 (App Router) · TypeScript estricto · Prisma 6 + PostgreSQL 16 · Zod · Tailwind.

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # ajustar DATABASE_URL / AUTH_SECRET
pnpm db:up                  # Postgres en Docker (puerto host 5433)
pnpm prisma migrate deploy  # o `pnpm db:migrate` en desarrollo
pnpm db:seed
pnpm dev                    # http://localhost:3000/api/health
```

Usuarios de seed (password `Cambiar123!`): `dueno1@negocio.com`, `dueno2@negocio.com` (OWNER),
`empleado@negocio.com` (EMPLEADO: ver/crear en VENTAS e INVENTARIO).

## Scripts

| Script            | Qué hace                                                        |
| ----------------- | --------------------------------------------------------------- |
| `pnpm db:reset`   | Borra la DB, re-aplica migraciones y corre el seed (¡solo dev!) |
| `pnpm db:seed`    | Seed idempotente                                                |
| `pnpm test:stock` | Prueba de humo del motor de stock contra la DB                  |
| `pnpm typecheck`  | `tsc --noEmit`                                                  |

## Arquitectura de datos

- `src/server/services/` es la **única** capa que toca la DB.
- `stock.service.ts` → `registrarMovimiento()` / `transferirStock()`: única forma de mover stock.
  Siempre dentro de `withTransaction()` (Serializable + reintento ante conflicto).
- `Stock` es un caché del ledger `MovimientoStock`. La DB lo garantiza con triggers
  (ver `prisma/migrations/*_constraints/migration.sql`):
  - `MovimientoStock` y `AuditLog` son inmutables.
  - Un movimiento debe partir del stock real y su aritmética debe cerrar.
  - Un `UPDATE` a `Stock` sin movimiento en la misma transacción es rechazado.
- Vistas: `vw_stock_consolidado` (una columna por depósito, se regenera sola al
  crear/renombrar depósitos, + `por_deposito` jsonb) y `vw_alertas_stock`.
