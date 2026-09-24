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

Usuarios de seed (password `Cambiar123!`, se pide cambiarla en el primer ingreso): `dueno1@negocio.com`, `dueno2@negocio.com` (OWNER),
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
- Documentos: una venta/compra/transferencia confirmada no se edita ni se borra, se anula;
  sus totales tienen que cerrar con los ítems (verificado al COMMIT).
- Sin DELETE físico en maestros (soft delete). Todo producto tiene ≥1 variante.
- Comprobantes: numeración con `siguienteNumeroComprobante()` (`SELECT … FOR UPDATE`), inmutables.
- Vistas: `vw_stock_consolidado` (una columna por depósito, se regenera sola al
  crear/renombrar depósitos, + `por_deposito` jsonb) y `vw_alertas_stock`.

## Auth y permisos

- Login propio (sin NextAuth): `POST /api/auth/login` → JWT HS256 (`sub`, `rol`, `iat`, `exp`) en la
  cookie `session` (httpOnly, sameSite lax, 7 días, renovación deslizante en el middleware).
- Los permisos **no** van en el token: se leen de la DB en cada request (un cambio aplica al instante).
- Rate limit persistente: 5 intentos fallidos por email cada 15 min (tabla `IntentoLogin`).
- `src/middleware.ts` (runtime Node) verifica en cada request que el usuario siga activo.
- Tres capas de autorización (`src/server/auth/permissions.ts`):
  1. Server Actions / Route Handlers: `requirePermiso()` / `requireOwner()` → `ForbiddenError`.
  2. Páginas: `requirePaginaPermiso()` → redirige a `/sin-acceso`.
  3. UI: `<Puede>` / `usePuede()` con el usuario que manda el servidor (solo qué se muestra).
- Server Actions envueltas en `actionHandler()`: siempre devuelven `{ ok, data } | { ok: false, error }`.
- Navegación: una sola fuente, `src/config/navigation.ts`, filtrada por permisos.

## Catálogo, inventario y movimientos

- **Productos** (`/productos`): variantes (sabores) con SKU autogenerado (`{prefijoSku}-XXXXXX`), código de
  barras principal + alternativos (únicos entre ambas tablas), importación/exportación CSV (todo o nada),
  aumento masivo con historial. `buscarPorCodigo()` (lo usará el escáner) resuelve en **una** query.
- **Precios**: todo cambio queda en `HistorialPrecio` (inmutable); la DB rechaza un cambio de precio sin historial.
- **Inventario** (`/inventario`): consolidado por depósito desde `vw_stock_consolidado`; valorización solo para OWNER.
- **Movimientos** (`/movimientos`): ledger, ingreso manual, ajuste simple / recuento y transferencias
  (pendiente → completar/anular). El stock solo cambia vía `registrarMovimiento` / `transferirStock`.
- **Configuración**: depósitos (principal único, no se desactivan con stock), categorías y marcas.
- Búsqueda `ILIKE '%texto%'` acelerada con `pg_trgm` (índices GIN declarados en el schema).
