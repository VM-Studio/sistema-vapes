# Sistema de Gestión — vapes y artefactos electrónicos

## Qué es

Sistema de gestión para un comercio de vapes con uno o más depósitos: catálogo con variantes (sabores),
stock por depósito, escáner con pistola lectora o cámara, compras a proveedores, punto de venta con pagos
partidos y cuenta corriente, caja con arqueo, gastos, reportes exportables, alertas y backups. Es una PWA:
se instala en el celular o la PC y el escáner sigue funcionando sin conexión.

Documentación relacionada:

- [docs/MANUAL-USUARIO.md](docs/MANUAL-USUARIO.md): manual para el dueño y los empleados (también se ve en `/ayuda`).
- [docs/MODELO-DATOS.md](docs/MODELO-DATOS.md): modelo de datos (DBML) e invariantes de la base.
- [docs/DEPLOY.md](docs/DEPLOY.md): puesta en producción, variables, backups y restauración.
- [CHANGELOG.md](CHANGELOG.md): historial de versiones.

## Stack

| Capa           | Tecnología                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Framework      | Next.js 15 (App Router, Server Actions, middleware en runtime Node), React 19, TypeScript estricto |
| Datos          | PostgreSQL 16 + Prisma 6 (`relationJoins`), `pg_trgm` para búsquedas                               |
| Validación     | Zod 4 (formularios, Server Actions, resultados de `$queryRaw` y variables de entorno)              |
| UI             | Tailwind CSS 4, lucide-react, Recharts                                                             |
| PWA / offline  | Serwist (service worker), IndexedDB (`idb`)                                                        |
| Escáner        | Pistola HID (detector propio), cámara con `BarcodeDetector` o `@zxing/browser`                     |
| Documentos     | pdf-lib (tickets, A4, cierres, reportes), exceljs (Excel), bwip-js (etiquetas Code128)             |
| Auth           | Propia: bcryptjs + JWT HS256 (`jose`) en cookie httpOnly, sesiones revocables en DB                |
| Archivos       | Disco local (`.storage/`) o S3 compatible (Cloudflare R2) con `@aws-sdk/client-s3`                 |
| Imágenes       | sharp (re-codificado, sin metadatos)                                                               |
| Observabilidad | pino (logs JSON con `requestId`), Sentry opcional, `/api/health`                                   |
| Tests          | Vitest (unit + integración con DB), Playwright (E2E), Lighthouse CI                                |

## Arquitectura

```mermaid
flowchart LR
  subgraph Cliente["Navegador / PWA instalada"]
    UI["React (App Router)"]
    SW["Service worker (Serwist)<br/>precache del shell · /offline"]
    IDB[("IndexedDB<br/>catálogo offline + cola de operaciones")]
    UI <--> IDB
    SW -- "Background Sync<br/>POST /api/sync" --> IDB
  end

  subgraph Next["Next.js 15"]
    MW["middleware.ts<br/>CSP con nonce · origin check<br/>rate limit · sesión revocable"]
    SA["Server Actions<br/>(actionHandler)"]
    RH["Route handlers<br/>/api/*"]
    SV["Servicios<br/>src/server/services"]
    MW --> SA & RH
    SA & RH --> SV
  end

  UI -- "HTTPS" --> MW
  SW -. "network-only para páginas y APIs" .-> MW

  SV -- "Prisma<br/>DATABASE_URL (pooler)" --> PG[("PostgreSQL<br/>triggers · CHECKs · vistas")]
  MIG["prisma migrate deploy<br/>pg_dump"] -- "DIRECT_URL" --> PG
  SV --> ST[("Storage<br/>local .storage/ o S3/R2")]
  BK["Backup diario<br/>pg_dump -Fc + verificación"] --> R2B[("Bucket de backups R2<br/>30 diarios · 12 semanales · 12 mensuales")]
  PG --> BK
  SV --> LOG["pino (JSON, requestId)"]
  SV -. "opcional" .-> SEN["Sentry"]
  CRON["Cron<br/>/api/cron/alertas · /api/cron/backup"] --> RH
```

Flujo de una request:

1. **Middleware** (`src/middleware.ts`, runtime Node): genera `requestId` y una CSP con nonce por request;
   rechaza mutaciones (`POST/PUT/PATCH/DELETE`) con `Origin` de otro sitio; aplica rate limit a `/api/*` y
   Server Actions (por usuario, o por IP sin sesión; tabla `RateLimit`); valida la sesión (JWT + fila
   `Sesion` no revocada ni vencida + usuario activo); si hay cambio de contraseña pendiente solo deja usar
   `/cuenta`; renueva el JWT de forma deslizante.
2. **Server Actions** envueltas en `actionHandler()` (siempre devuelven `{ ok, data } | { ok: false, error }`)
   y **route handlers** para descargas, PDFs, cron, sync y health.
3. **Servicios** (`src/server/services/`): la **única** capa que toca la base. Las operaciones que mueven
   stock o dinero corren dentro de `withTransaction()` (Serializable + reintento ante conflicto).
4. **PostgreSQL** hace cumplir las invariantes con CHECKs, índices parciales y triggers (ver
   [MODELO-DATOS](docs/MODELO-DATOS.md#invariantes-garantizadas-por-la-base)).

Autorización en tres capas (`src/server/auth/permissions.ts`):

1. Server Actions / route handlers: `requirePermiso()` / `requireOwner()` → `ForbiddenError` (que además
   queda en la auditoría como `ACCESO_DENEGADO`).
2. Páginas: `requirePaginaPermiso()` → redirige a `/sin-acceso`.
3. UI: `<Puede>` / `usePuede()` solo decide qué se muestra. La navegación sale de una sola fuente,
   `src/config/navigation.ts`, filtrada por permisos.

## Decisiones clave

- **Ledger de movimientos inmutable.** Todo cambio de stock es una fila de `MovimientoStock` (tipo,
  cantidad, stock anterior y posterior, costo, referencia). Triggers bloquean `UPDATE`/`DELETE`/`TRUNCATE`;
  un error se corrige con un ajuste inverso. Lo mismo para `AuditLog`, `HistorialPrecio` y `MovimientoCaja`.
- **Stock derivado.** `Stock` es un caché del ledger: solo cambia vía `registrarMovimiento()` /
  `transferirStock()` (`stock.service.ts`). La base rechaza un `UPDATE` a `Stock` sin movimiento en la misma
  transacción, un movimiento cuyo `stockAnterior` no coincide con el stock real y cualquier stock negativo.
  Otros cachés (`Cliente.saldoDeudor`, `Venta.montoPagado`, `VentaItem.cantidadDevuelta`) se verifican con
  triggers diferidos al COMMIT.
- **Documentos que no se editan.** Una venta, compra o transferencia confirmada se anula, no se borra; sus
  totales tienen que cerrar con los ítems. Los comprobantes se numeran con `SecuenciaComprobante`
  (`SELECT … FOR UPDATE`): sin huecos ni duplicados aunque cobren varias cajas a la vez.
- **Sincronización offline idempotente.** Sin red, el escáner guarda en IndexedDB ingresos, recuentos y
  transferencias con un `idOperacion` (UUID generado en el celular). Al volver la red se envían en orden a
  `POST /api/sync`, que los aplica con los mismos servicios que la app online, en una transacción que
  inserta `OperacionSincronizada` (`idOperacion` único). Reenviar devuelve el resultado guardado sin repetir
  movimientos; si una regla de negocio la rechaza (por ejemplo, no alcanza el stock), queda `RECHAZADA` con el
  motivo y el usuario decide: nada se descarta solo. Un error de infraestructura responde 5xx y el celular
  reintenta.
- **Ventas nunca offline.** Una venta necesita validar stock y registrar el pago en el momento; sin conexión
  el POS y el modo Vender lo informan y no dejan cobrar.
- **Sesiones revocables.** El JWT lleva `sid` (fila `Sesion`) y `tok` (secreto del que la base guarda el
  sha256). El middleware valida la sesión en cada request con un caché de 60 s por `sid`: revocar, dar de baja
  o cambiar la contraseña corta el acceso al instante en la misma instancia y en ≤ 60 s en las demás. Los
  permisos no van en el token: se leen de la base en cada request.
- **CSP con nonce.** `script-src 'self' 'nonce-…' 'strict-dynamic'`, sin `unsafe-inline` para scripts.
  Headers de seguridad en `next.config.ts` (HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` con cámara solo propia, COOP).
- **Reloj de negocio y zona horaria.** Los servicios fechan con `ahora()` (`src/lib/reloj.ts`); el seed demo lo
  fija para simular 90 días pasando por los servicios reales, y en producción no se puede fijar. Las columnas
  guardan UTC; todo rango de días se calcula en `Configuracion.timezone` (por defecto Buenos Aires,
  `src/lib/zona-horaria.ts`).
- **Agregados recalculados.** `ResumenDiario` guarda totales por (día, depósito) + fila consolidada. Se
  **recalcula** (no se suma un delta) al final de cada transacción que toca un día; `pnpm reportes:rebuild` lo
  reconstruye entero.
- **Entorno validado.** `src/env.ts` valida las variables con Zod al arrancar (`instrumentation.ts`): con una
  variable inválida la app no arranca y el error dice cuál. En producción rechaza el `AUTH_SECRET` de ejemplo y
  exige `CRON_SECRET` y `NEXT_PUBLIC_APP_URL`.
- **Archivos.** `StorageProvider` (`src/server/storage.ts`): local en desarrollo, S3/R2 en producción. Los
  privados se referencian como `/api/publico/archivos/<clave>` (clave con 24 bytes aleatorios; en S3 redirige
  a una URL firmada de 5 minutos). Las imágenes subidas se validan por contenido (magic bytes, no extensión),
  máximo 5 MB, y se re-codifican con sharp descartando metadatos.
- **Contraseñas.** bcrypt (12 rondas), mínimo 8 caracteres con letras y números, rechazo de las 10.000 más
  comunes. Login con rate limit persistente: 5 intentos fallidos por email cada 15 minutos.

## Cómo correr local

Requisitos: Node 20+, pnpm, Docker (para PostgreSQL) y, para backups, `postgresql-client` (mismo major que el
servidor).

```bash
pnpm install
cp .env.example .env        # revisar DATABASE_URL, DIRECT_URL y AUTH_SECRET
pnpm db:up                  # PostgreSQL 16 en Docker (usuario app/app, base gestion, puerto host 5433)
pnpm prisma migrate deploy  # o `pnpm db:migrate` si estás cambiando el schema
pnpm db:seed                # datos base + usuarios de prueba
pnpm dev                    # http://localhost:3000 (salud: /api/health)
```

- El schema declara `directUrl = env("DIRECT_URL")`: en local puede ser la misma URL que `DATABASE_URL`
  (`postgresql://app:app@localhost:5433/gestion?schema=public`).
- Si el puerto 5433 está ocupado, cambiá `DB_PORT` en `.env` (lo usa `docker-compose.yml`).
- Usuarios del seed (contraseña `Cambiar123!`, se pide cambiarla en el primer ingreso):
  `dueno1@negocio.com`, `dueno2@negocio.com` (OWNER) y `empleado@negocio.com` (EMPLEADO: ver/crear en
  VENTAS e INVENTARIO).
- `pnpm db:seed-demo` carga 90 días de operación simulada (ventas, cajas, gastos, compras) para ver el
  dashboard y los reportes con datos.
- En producción el seed está bloqueado salvo `ALLOW_SEED=true`; el primer dueño se crea con `pnpm crear-owner`.
- Para probar el escáner sin pistola: pegar `scripts/simular-pistola.js` en la consola del navegador y llamar
  `simularPistola("7790001000019")`.

### Variables de entorno

Definidas y validadas en `src/env.ts`. Detalle de producción en [docs/DEPLOY.md](docs/DEPLOY.md).

| Variable                                                                            | Uso                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Conexión de la app (en producción, el pooler en modo transaction)                         |
| `DIRECT_URL`                                                                        | Conexión directa, sin pooler: migraciones y `pg_dump`                                     |
| `AUTH_SECRET`                                                                       | Firma de las sesiones (≥ 32 caracteres)                                                   |
| `CRON_SECRET`                                                                       | `Authorization: Bearer …` de `/api/cron/*` (obligatorio en producción)                    |
| `NEXT_PUBLIC_APP_URL`                                                               | URL pública (links de WhatsApp, cookies seguras, origin check; obligatorio en producción) |
| `STORAGE_PROVIDER`                                                                  | `local` (default, carpeta `STORAGE_DIR` o `.storage/`) o `s3`                             |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Storage S3/R2 (obligatorias con `s3`)                                                     |
| `S3_PUBLIC_URL`                                                                     | Dominio público del bucket (logos, imágenes de producto)                                  |
| `S3_BACKUP_BUCKET`                                                                  | Bucket separado para backups                                                              |
| `S3_FORCE_PATH_STYLE`                                                               | `true` para MinIO local                                                                   |
| `LOG_LEVEL`                                                                         | Nivel de pino (default `info`)                                                            |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`                                              | Sentry servidor y navegador (opcionales)                                                  |
| `APP_VERSION`                                                                       | Versión informada en health, logs y Sentry (en Vercel se usa `VERCEL_GIT_COMMIT_SHA`)     |
| `RATE_LIMIT_POR_MINUTO`                                                             | Límite por usuario (default 300; sin sesión, un tercio con mínimo 30)                     |
| `ALLOW_SEED`                                                                        | Permite el seed con `NODE_ENV=production` (solo bases de prueba)                          |
| `DB_PORT`                                                                           | Puerto del host para el Postgres de `docker-compose.yml` (default 5433)                   |

## Scripts

| Script                                                          | Qué hace                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                      | Servidor de desarrollo (Turbopack)                                                                         |
| `pnpm build` / `pnpm start`                                     | Build de producción (incluye el service worker) y servidor                                                 |
| `pnpm lint`                                                     | ESLint                                                                                                     |
| `pnpm typecheck`                                                | `tsc --noEmit`                                                                                             |
| `pnpm format` / `pnpm format:check`                             | Prettier (escribir / verificar)                                                                            |
| `pnpm db:up` / `pnpm db:down`                                   | Levanta / baja el Postgres de Docker                                                                       |
| `pnpm db:migrate`                                               | `prisma migrate dev` (crear y aplicar migraciones en desarrollo)                                           |
| `pnpm db:deploy`                                                | `prisma migrate deploy` (aplicar migraciones pendientes)                                                   |
| `pnpm db:generate`                                              | `prisma generate` (también corre en `postinstall`)                                                         |
| `pnpm db:seed`                                                  | Seed idempotente (datos base y usuarios de prueba)                                                         |
| `pnpm db:reset`                                                 | Borra la base, re-aplica migraciones y corre el seed (¡solo desarrollo!)                                   |
| `pnpm db:studio`                                                | Prisma Studio                                                                                              |
| `pnpm db:seed-demo`                                             | 90 días de operación simulada                                                                              |
| `pnpm crear-owner`                                              | Crea el primer dueño en una base nueva (pide datos por consola)                                            |
| `pnpm iconos`                                                   | Genera los íconos de la PWA                                                                                |
| `pnpm reportes:rebuild`                                         | Reconstruye `ResumenDiario` entero desde el ledger                                                         |
| `pnpm explain:reportes`                                         | `EXPLAIN ANALYZE` de las consultas pesadas de reportes                                                     |
| `pnpm backup`                                                   | Backup manual: `pg_dump -Fc`, verificación, subida al bucket y rotación                                    |
| `pnpm release`                                                  | Paso de release en producción: backup verificado (si hay migraciones pendientes) + `prisma migrate deploy` |
| `pnpm storage:migrate`                                          | Copia los archivos de `.storage/` al bucket S3/R2 y verifica cada uno (`--dry-run` para simular)           |
| `pnpm restore <archivo> [--force]`                              | Restaura un backup en `RESTORE_DATABASE_URL` (nunca en la base de la app sin `--force` y confirmación)     |
| `pnpm test` / `pnpm test:unit`                                  | Vitest: proyectos `unit` e `integracion`                                                                   |
| `pnpm test:e2e`                                                 | Playwright contra el build de producción y una base aislada                                                |
| `pnpm lighthouse`                                               | Lighthouse CI sobre `/login` y `/` (requiere el build hecho)                                               |
| `pnpm test:restore`                                             | Backup + restauración en una base vacía + comparación de conteos                                           |
| `pnpm test:scripts`                                             | `test:stock` + `test:integridad` + `test:auth`                                                             |
| `pnpm test:stock`                                               | Prueba de humo del motor de stock contra la DB                                                             |
| `pnpm test:integridad`                                          | Invariantes de la base (triggers y CHECKs)                                                                 |
| `pnpm test:auth`                                                | Login, sesiones y permisos contra la DB                                                                    |
| `pnpm test:catalogo`                                            | Catálogo, variantes, precios e importación                                                                 |
| `pnpm test:compras`                                             | Compras, proveedores, recuento, códigos internos y etiquetas                                               |
| `pnpm test:ventas`                                              | Pago partido, fiado, devoluciones, anulación                                                               |
| `pnpm test:ventas:concurrencia`                                 | 10 ventas simultáneas sobre stock 5: confirman 5, numeración sin huecos                                    |
| `pnpm test:reportes`                                            | ResumenDiario, KPIs, caja/arqueo, efectivo fuera de caja, reposición                                       |
| `pnpm test:e2e:catalogo` / `:escaner` / `:ventas` / `:reportes` | Recorridos E2E por módulo (scripts con puppeteer)                                                          |
| `scripts/db-descartable.sh X`                                   | Recrea una base descartable X (migraciones + seed [+ `--demo`])                                            |

## Estructura de carpetas

```text
prisma/
  schema.prisma           Modelo de datos
  migrations/             Migraciones SQL (CHECKs, triggers, vistas incluidos)
  seed.ts, seed-demo.ts   Seed base y 90 días simulados
src/
  app/
    (auth)/login/         Inicio de sesión
    (app)/                Pantallas autenticadas: inicio (dashboard), ventas, escanear, inventario,
                          productos, movimientos, compras, caja, clientes, proveedores, reportes,
                          gastos, usuarios, configuración, cuenta, notificaciones
    api/                  Route handlers: auth, sync, catalogo/offline, cron, backups, reportes,
                          comprobantes, caja, etiquetas, exportaciones, publico/archivos, health
    offline/              Pantalla sin conexión (precacheada) con el escáner offline
    sw.ts, serwist/       Service worker (Serwist) y su ruta de servido
    manifest.ts, icons/   Manifest e íconos de la PWA
  components/             UI (ui/), layout, pwa, gráficos, reportes, catálogo, compras, clientes
  config/navigation.ts    Única fuente de la navegación
  features/
    scanner/              Pistola, cámara, resolución de códigos
    offline/              IndexedDB: catálogo, cola de operaciones, pendientes
  lib/                    Utilidades compartidas (db, fechas, zona horaria, reloj, validaciones Zod)
  server/
    services/             Lógica de negocio (única capa que toca la DB)
    auth/                 Sesiones, permisos, contraseñas, cron
    seguridad/            CSP, rate limit, validación de archivos
    reportes/             Definiciones y exportación PDF/Excel
    notificaciones/       Canales de alertas
    storage.ts, log.ts    Storage local/S3 y logger pino
  env.ts                  Variables de entorno validadas
  middleware.ts           CSP, origin check, rate limit, sesión
  instrumentation*.ts     Arranque del servidor y Sentry
scripts/                  Backup/restore, crear-owner, íconos, pruebas contra DB, E2E con puppeteer
tests/                    Vitest: unit/ e integracion/
e2e/                      Playwright
lighthouse/, lighthouserc.cjs  Lighthouse CI
docs/                     Manual, modelo de datos, deploy
```

## Tests

- **Vitest** (`pnpm test`), dos proyectos:
  - `unit` (jsdom, sin DB): detector de la pistola, catálogo y cola offline (con `fake-indexeddb`),
    seguridad (CSP, rate limit, magic bytes, contraseñas comunes), rotación de backups, zona horaria y auditoría.
  - `integracion`: motor de stock, integridad de la DB y concurrencia de ventas contra una base aislada
    (`DATABASE_URL_TEST_VITEST`, default `gestion_test_vitest` en el Postgres local; se recrea al empezar).
- **Playwright** (`pnpm test:e2e`): corre contra el **build** de producción (`pnpm build` antes) en el puerto
  3100 y una base aislada `DATABASE_URL_TEST` (default `gestion_e2e`), que el setup global recrea con
  migraciones y seed. Dos proyectos: escritorio 1440×900 y celular (Pixel 7). Flujos: login y cambio de
  contraseña, permisos, alta de producto, ingreso con escáner, venta en celular, venta sin stock,
  transferencia, cierre de caja y modo offline.
- **Lighthouse CI** (`pnpm lighthouse`, con el build hecho): `/login` y `/` autenticado en mobile, mediana de
  3 corridas. Presupuesto: Performance ≥ 80 y Accessibility ≥ 90 (error), Best Practices ≥ 90 (aviso).
  Reportes en `lighthouse/reportes/`. La instalabilidad de la PWA se verifica con
  `scripts/verificar-instalable.mjs`.
- **Restauración** (`pnpm test:restore`): hace un backup de la base de `DATABASE_URL`, lo restaura en una base
  vacía (`RESTORE_DB`, default `gestion_restore`) y compara `COUNT(*)` de todas las tablas, la suma de stock y
  la cantidad de triggers y vistas. No corre en CI por tiempo.
- Scripts contra la DB (`pnpm test:scripts`, `test:ventas`, `test:reportes`, …): ver la tabla de scripts.
