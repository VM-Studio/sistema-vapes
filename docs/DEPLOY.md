# Deploy a producción

Stack recomendado: **Vercel** (app) + **Neon** o **Supabase** (PostgreSQL 16, con pooler) + **Cloudflare R2** (archivos y backups) + **GitHub Actions** (CI, release y backups diarios). Alternativa: **Railway** para app, base y cron en un solo lugar (ver al final).

## Entornos

| Entorno       | Base                                                         | Storage                                     | Quién despliega                                 |
| ------------- | ------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| Local         | docker compose (`gestion`)                                   | `STORAGE_PROVIDER=local`                    | `pnpm dev`                                      |
| Test / CI     | service de Postgres del workflow (se recrea en cada corrida) | local (`.storage-e2e`)                      | `.github/workflows/ci.yml`                      |
| Preview (PRs) | base **propia** de preview (branch de Neon)                  | bucket de preview                           | Vercel Preview                                  |
| Producción    | base de producción                                           | R2 (bucket de archivos + bucket de backups) | job `deploy` de `ci.yml` al hacer push a `main` |

Nunca apuntes un Preview a la base o al bucket de producción.

## Checklist del primer deploy

1. **Base de datos**
   - [ ] Crear el proyecto de Postgres 16 (Neon/Supabase) en una región cercana a la de Vercel (`gru1`, São Paulo).
   - [ ] Crear los usuarios con permisos mínimos (SQL de abajo).
   - [ ] `DATABASE_URL` = URL del **pooler** con `app_runtime` y `pgbouncer=true&connection_limit=5`.
   - [ ] `DIRECT_URL` = URL **directa** con `app_migraciones` (migraciones, pg_dump, pg_restore).
2. **Cloudflare R2**
   - [ ] Bucket `gestion-archivos` (privado) y bucket `gestion-backups` (privado, separado).
   - [ ] Token API con permiso _Object Read & Write_ sobre los dos buckets → `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
   - [ ] `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`, `S3_REGION=auto`.
   - [ ] (Opcional) regla de ciclo de vida en `gestion-backups` que borre objetos de más de 400 días, como red de seguridad de la rotación.
3. **Secretos** (`openssl rand -base64 32` / `openssl rand -hex 32`)
   - [ ] `AUTH_SECRET` (≥ 32 caracteres), `CRON_SECRET`.
4. **Vercel**
   - [ ] Importar el repo. Framework: Next.js. Build: `pnpm build`.
   - [ ] Variables de Production (todas las de `.env.example` marcadas _prod_), con `STORAGE_PROVIDER=s3` y `NEXT_PUBLIC_APP_URL=https://tu-dominio`.
   - [ ] Dominio propio con HTTPS. Después de verificarlo, enviar el dominio a [hstspreload.org](https://hstspreload.org) (el header ya incluye `preload`).
   - [ ] Desactivar el deploy automático de Git para `main` (lo hace el job `deploy`, después del release). Los Preview pueden seguir automáticos.
   - [ ] Cron de alertas: ya está en `vercel.json` (`/api/cron/alertas`, 10:00 UTC = 07:00 AR). Vercel manda `Authorization: Bearer $CRON_SECRET`.
5. **GitHub**
   - [ ] Environment `production` con los secrets: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_BACKUP_BUCKET`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; y la variable `NEXT_PUBLIC_APP_URL`.
   - [ ] Protección de `main`: requiere el check **CI** en verde.
   - [ ] Confirmar que corre `.github/workflows/backup.yml` (lanzarlo a mano con _Run workflow_ la primera vez).
6. **Primer arranque**
   - [ ] Push a `main` → CI → `pnpm release` (backup previo + `prisma migrate deploy`) → deploy.
   - [ ] Crear el dueño: `DATABASE_URL=... pnpm crear-owner` (pide email, nombre y contraseña; **no** uses el seed en producción). Si igual querés cargar los datos base del seed, una sola vez y a propósito: `ALLOW_SEED=true pnpm db:seed`.
   - [ ] Si venías usando la app con storage local: `STORAGE_PROVIDER=s3 ... pnpm storage:migrate` (copia y verifica cada archivo; las referencias de la base no cambian).
7. **Verificación**
   - [ ] `curl -s https://tu-dominio/api/health` → `ok: true`, `db.ok`, `storage.ok` con `proveedor: "s3"`.
   - [ ] `curl -sI https://tu-dominio/login` → `strict-transport-security`, `content-security-policy` con nonce, `x-frame-options: DENY`.
   - [ ] En Chrome del celular: aparece "Instalar app"; en iPhone, Compartir → Agregar a inicio.
   - [ ] `/configuracion/backups` muestra el backup del release o del job diario.
   - [ ] **Probar una restauración** (abajo) antes de dar por terminado el deploy.
   - [ ] (Opcional) `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` y forzar un error para ver que llega sin datos personales.

## Usuarios de base con permisos mínimos

La app **no** usa el superusuario. Ejecutar como owner de la base (en Neon: el rol que crea el proyecto):

```sql
-- Migraciones, pg_dump y pg_restore: dueño del schema.
CREATE ROLE app_migraciones LOGIN PASSWORD '<secreto-1>';
-- Runtime de la app: solo datos (sin DDL, sin DROP, sin superusuario).
CREATE ROLE app_runtime LOGIN PASSWORD '<secreto-2>' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE gestion TO app_migraciones, app_runtime;
ALTER SCHEMA public OWNER TO app_migraciones;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;

-- Lo que creen las migraciones (hechas por app_migraciones) queda accesible para el runtime.
ALTER DEFAULT PRIVILEGES FOR ROLE app_migraciones IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migraciones IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migraciones IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;

-- Si las tablas ya existían (base migrada antes de crear los roles):
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
```

Aunque `app_runtime` tenga `UPDATE`/`DELETE` en general, el ledger de movimientos, las ventas confirmadas, la auditoría y los backups se protegen con **triggers** (ver `docs/MODELO-DATOS.md`): ni un bug de la app ni un SQL a mano con ese usuario puede reescribir la historia.

`DATABASE_URL` → `app_runtime` vía pooler. `DIRECT_URL` → `app_migraciones` directo. El job de backup usa `DIRECT_URL`.

## Release: migraciones

- Solo `prisma migrate deploy` (lo corre `pnpm release`). **Nunca** `migrate dev`, `db push` ni `migrate reset` contra producción.
- `pnpm release` hace backup verificado **antes** de migrar, y solo si hay migraciones pendientes. Si el backup falla, no migra.
- Las migraciones tienen que ser **compatibles hacia atrás** con la versión anterior del código (expand → deploy → contract): agregar columnas nullable o con default, completar datos, y recién en un release posterior borrar lo viejo. Así un rollback de código no necesita tocar la base.

## Backups

- **Diario 04:00 AR**: `.github/workflows/backup.yml` → `pnpm backup` (pg_dump `-Fc` + `pg_restore --list` + subida a R2 + rotación 30 diarios / 12 semanales / 12 mensuales + fila en `Backup`).
- **Alternativas**: Railway cron con `pnpm backup`; o cualquier cron HTTP contra `POST /api/cron/backup` con `Authorization: Bearer $CRON_SECRET` en un runtime **que tenga `pg_dump`** (no sirve en Vercel Functions).
- **Alerta**: si un backup falla, o no hubo uno correcto en 36 h (lo revisa `/api/cron/alertas`), los dueños reciben una notificación. `/api/health` también informa `backup.horasDesde`.
- **Descarga**: `/configuracion/backups` (solo dueños; link firmado de 15 minutos).
- **Probar la restauración** (mensual, y siempre después del primer deploy):
  ```bash
  DATABASE_URL=<directa, prod o copia> pnpm test:restore
  ```
  Hace un backup, lo restaura en una base vacía y compara `COUNT(*)` de **todas** las tablas, `SUM(Stock.cantidad)`, triggers y vistas. Tiene que terminar en `RESTAURACIÓN VERIFICADA`.

## Rollback

| Qué salió mal                                       | Qué hacer                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El código nuevo tiene un bug, la base está bien     | Vercel → Deployments → el deploy anterior → **Promote to Production** (instantáneo). Como las migraciones son compatibles hacia atrás, el código anterior funciona con la base nueva.                                                                                                                                                                                                                                                                                |
| La migración falló a mitad de camino                | El deploy no se publicó (el job `deploy` corta). Revisar el error con `prisma migrate status`; corregir con una migración nueva o `prisma migrate resolve --rolled-back <migración>` después de revertir a mano lo aplicado.                                                                                                                                                                                                                                         |
| Datos dañados (migración errónea, borrado)          | Restaurar el backup previo al release (`origen: release` en `/configuracion/backups`):<br>1. Poner la app en mantenimiento (pausar el deploy o apuntar el dominio a una página estática).<br>2. `RESTORE_DATABASE_URL=<DIRECT_URL de producción> pnpm restore backups/backup-AAAA-MM-DD-HHmm.dump --force` (pide confirmación escribiendo el nombre de la base).<br>3. Promover el deploy anterior.<br>4. Verificar `/api/health` y el stock de un par de productos. |
| El service worker nuevo rompe algo en los celulares | Promover el deploy anterior: el SW se sirve con `no-cache`, los clientes lo toman en la próxima navegación y el aviso "Hay una versión nueva" los lleva a la anterior.                                                                                                                                                                                                                                                                                               |

## Alternativa: Railway

- Servicio **web**: `pnpm build` / `pnpm start` (Railway define `PORT`). Imagen con `postgresql-client-16` (Nixpacks: `NIXPACKS_APT_PKGS=postgresql-client-16`), así `pnpm backup` funciona en el mismo entorno.
- Servicio **Postgres 16** de Railway: `DATABASE_URL` privado; `DIRECT_URL` igual (sin pooler externo, `connection_limit=10`).
- **Pre-deploy command**: `pnpm release`.
- **Cron jobs**: `0 7 * * *` → `pnpm backup --origen=cron`; `0 10 * * *` → `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" $NEXT_PUBLIC_APP_URL/api/cron/alertas`.
