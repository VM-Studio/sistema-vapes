# Deploy a producción

Stack recomendado: **Vercel** (app) + **Neon** o **Supabase** (PostgreSQL 16, con pooler) + **Cloudflare R2** (archivos y backups) + **GitHub Actions** (CI, release y backups diarios). Alternativa: **Railway** para app, base y cron en un solo lugar (ver al final).

## Entornos

| Entorno       | Base                                                         | Storage                                     | Quién despliega                                 |
| ------------- | ------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| Local         | docker compose (`gestion`)                                   | `STORAGE_PROVIDER=local`                    | `pnpm dev`                                      |
| Test / CI     | service de Postgres del workflow (se recrea en cada corrida) | local (`.storage-ci`, `.storage-e2e`)       | `.github/workflows/ci.yml`                      |
| Preview (PRs) | base **propia** de preview (branch de Neon)                  | bucket de preview                           | Vercel Preview                                  |
| Producción    | base de producción                                           | R2 (bucket de archivos + bucket de backups) | job `deploy` de `ci.yml` al hacer push a `main` |

Nunca apuntes un Preview a la base o al bucket de producción.

## Variables de entorno

Todas están en `.env.example` con su explicación; `src/env.ts` las valida al arrancar y la app no levanta si falta una obligatoria.

| Variable                                                                            | Producción                                                             |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Pooler con `app_runtime` y `pgbouncer=true&connection_limit=5`         |
| `DIRECT_URL`                                                                        | Conexión directa con `app_migraciones` (migraciones, pg_dump, restore) |
| `AUTH_SECRET`                                                                       | `openssl rand -base64 32` (≥ 32 caracteres; se rechaza el de ejemplo)  |
| `CRON_SECRET`                                                                       | `openssl rand -hex 32` (obligatorio)                                   |
| `NEXT_PUBLIC_APP_URL`                                                               | `https://tu-dominio`, sin barra final (obligatorio)                    |
| `STORAGE_PROVIDER`                                                                  | `s3`                                                                   |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Bucket de archivos de R2                                               |
| `S3_BACKUP_BUCKET`                                                                  | Bucket de backups de R2 (separado)                                     |
| `S3_PUBLIC_URL`                                                                     | Opcional                                                               |
| `LOG_LEVEL`, `APP_VERSION`, `RATE_LIMIT_POR_MINUTO`                                 | Opcionales (`info`, SHA del commit en Vercel, `300`)                   |
| `ALLOW_SEED`                                                                        | `false`, salvo la única corrida intencional del seed                   |
| `SEED_OWNER1_EMAIL`, `SEED_OWNER1_PASSWORD`                                         | Juan Cruz (dueño): solo para esa corrida del seed                      |
| `SEED_OWNER2_EMAIL`, `SEED_OWNER2_PASSWORD`                                         | Agustina (dueña)                                                       |
| `SEED_EMPLEADO1_EMAIL`, `SEED_EMPLEADO1_PASSWORD`                                   | Trinidad (empleada, solo Vapes)                                        |

Las `SEED_*` solo las lee `prisma/seed.ts`. Con `NODE_ENV=production` son **obligatorias** (si falta alguna, el seed se detiene y dice cuál); no hace falta cargarlas en Vercel: se pasan en la línea de comando de la corrida del seed. Las contraseñas son iniciales: cada usuario tiene que cambiarla en su primer ingreso, y re-correr el seed no pisa contraseñas ya cambiadas.

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
   - [ ] Variables de Production (las de la tabla de arriba, sin las `SEED_*`), con `STORAGE_PROVIDER=s3` y `NEXT_PUBLIC_APP_URL=https://tu-dominio`.
   - [ ] Dominio propio con HTTPS. Después de verificarlo, enviar el dominio a [hstspreload.org](https://hstspreload.org) (el header ya incluye `preload`).
   - [ ] Desactivar el deploy automático de Git para `main` (lo hace el job `deploy`, después del release). Los Preview pueden seguir automáticos.
   - [ ] No hay crons en Vercel (`vercel.json` no define ninguno): el único job programado es el backup, que corre en GitHub Actions.
5. **GitHub**
   - [ ] Environment `production` con los secrets: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_BACKUP_BUCKET`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; y la variable `NEXT_PUBLIC_APP_URL`.
   - [ ] Protección de `main`: requiere el check **CI** en verde.
   - [ ] Confirmar que corre `.github/workflows/backup.yml` (lanzarlo a mano con _Run workflow_ la primera vez).
6. **Primer arranque**
   - [ ] Push a `main` → CI → `pnpm release` (backup previo + `prisma migrate deploy`) → deploy. Las migraciones crean los paneles **Vapes**, **Cosmetic** y **Especiales** con sus depósitos y secuencias.
   - [ ] Crear los usuarios iniciales, una sola vez y a propósito, con la conexión directa:
     ```bash
     NODE_ENV=production ALLOW_SEED=true DATABASE_URL=<DIRECT_URL> DIRECT_URL=<DIRECT_URL> \
       SEED_OWNER1_EMAIL=... SEED_OWNER1_PASSWORD=... \
       SEED_OWNER2_EMAIL=... SEED_OWNER2_PASSWORD=... \
       SEED_EMPLEADO1_EMAIL=... SEED_EMPLEADO1_PASSWORD=... \
       pnpm db:seed
     ```
     Crea a Juan Cruz y Agustina (dueños) y a Trinidad (empleada, solo Vapes: ver y crear en Ventas, Clientes y Cotizador; ver en Productos y Stock), la configuración de cada panel, los depósitos de Vapes (**Ayres Plaza**, principal, y **Mercedes**) y un catálogo de ejemplo en Vapes. Si preferís arrancar sin datos de ejemplo, creá solo el primer dueño con `DATABASE_URL=... pnpm crear-owner` y el resto de los usuarios desde `/usuarios`.
   - [ ] Si venías usando la app con storage local: `STORAGE_PROVIDER=s3 ... pnpm storage:migrate` (copia y verifica cada archivo; las referencias de la base no cambian).
7. **Verificación**
   - [ ] `curl -s https://tu-dominio/api/health` → `ok: true`, `db.ok`, `storage.ok` con `proveedor: "s3"`.
   - [ ] `curl -sI https://tu-dominio/login` → `strict-transport-security`, `content-security-policy` con nonce, `x-frame-options: DENY`.
   - [ ] Ingresar con un dueño: aparece el selector **Sistemas** con los tres paneles. Ingresar con Trinidad: entra directo a Vapes.
   - [ ] En Chrome del celular: aparece «Instalar app»; en iPhone, Compartir → Agregar a inicio.
   - [ ] `/configuracion/backups` muestra el backup del release o del job diario.
   - [ ] **Probar una restauración** (abajo) antes de dar por terminado el deploy.

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

Aunque `app_runtime` tenga `UPDATE`/`DELETE` en general, el ledger de movimientos, las ventas confirmadas, la auditoría, las secuencias, los backups y el aislamiento entre paneles se protegen con **triggers** (ver `docs/MODELO-DATOS.md`): ni un bug de la app ni un SQL a mano con ese usuario puede reescribir la historia ni mezclar datos de dos paneles.

`DATABASE_URL` → `app_runtime` vía pooler. `DIRECT_URL` → `app_migraciones` directo. El job de backup usa `DIRECT_URL`.

## Release: migraciones

- Solo `prisma migrate deploy` (lo corre `pnpm release`). **Nunca** `migrate dev`, `db push` ni `migrate reset` contra producción.
- `pnpm release` hace backup verificado **antes** de migrar, y solo si hay migraciones pendientes. Si el backup falla, no migra.
- Las migraciones tienen que ser **compatibles hacia atrás** con la versión anterior del código (expand → deploy → contract): agregar columnas nullable o con default, completar datos, y recién en un release posterior borrar lo viejo. Así un rollback de código no necesita tocar la base. **La migración de la reforma es la excepción** (ver la sección siguiente).

## Migración de la reforma R1 (2.0.0)

La migración `20260928160000_reforma_multipanel` convierte una base de la versión 1.x al modelo multipanel. **No es compatible hacia atrás y borra datos**: después de aplicarla, el código 1.x no funciona contra la base y lo eliminado solo se recupera desde un backup.

### Antes de migrar

1. Avisar a los usuarios y elegir un horario sin ventas.
2. Hacer un backup manual y **descargarlo** (además del que hace `pnpm release`):
   ```bash
   DATABASE_URL=<DIRECT_URL> DIRECT_URL=<DIRECT_URL> pnpm backup --origen=manual
   ```
   Verificar en `/configuracion/backups` (o en el bucket) que quedó como verificado y guardar una copia fuera del bucket.
3. Si necesitás conservar algo de lo que se elimina (caja, gastos, cuentas corrientes, comprobantes), descargá antes **Exportar todo** desde la versión 1.x: la 2.0.0 ya no exporta esas tablas.
4. (Recomendado) Probar la migración sobre una copia: restaurar el backup en una base vacía con `pnpm restore` y correr `pnpm db:deploy` contra ella.

### Qué hace con los datos existentes

- **Elimina** las tablas `PagoVenta`, `MovimientoCaja`, `Gasto`, `Caja`, `CategoriaGasto`, `Comprobante`, `SecuenciaComprobante`, `DevolucionItem`, `HistorialPrecio`, `Notificacion`, `OperacionSincronizada` y `ResumenDiario`, sus enums, triggers y funciones.
- **Elimina columnas**: saldo deudor, saldo a favor y límite de crédito de `Cliente`; reintegro, total y cuenta corriente de `Devolucion`; `cantidadDevuelta` de `VentaItem`; estado de pago, monto pagado y saldo pendiente de `Venta`.
- **Ventas**: las confirmadas o anuladas sin medio de pago, o pagadas con saldo del cliente (`CREDITO_CLIENTE`), quedan con medio **`OTRO`**. El medio `CREDITO_CLIENTE` desaparece.
- **Paneles**: crea **Vapes**, **Cosmetic** y **Especiales** y pasa **todo lo existente a Vapes** (depósitos, catálogo, stock, movimientos, compras, ventas, devoluciones, transferencias, clientes, proveedores y configuración). El ledger y los documentos no se reescriben: la columna `panelId` se agrega con valor por defecto.
- **Depósitos**: en Vapes, **«Galpón 1» pasa a llamarse «Ayres Plaza»** y **«Galpón 2» pasa a «Mercedes»** (solo si tenían exactamente esos nombres). Cosmetic y Especiales reciben un depósito «Principal».
- **Numeración**: la de Vapes continúa desde el número más alto de cada documento (la próxima venta es la siguiente a la última); Cosmetic y Especiales arrancan en cero.
- **Configuración**: `nombreNegocio`, `iconoApp`, `timezone` y `moneda` pasan a `ConfiguracionGlobal`; `escaner`, `ventas`, `alertaStockMinimo` y `prefijoSku` quedan como configuración de Vapes; el resto de las claves (caja, reportes, comprobantes) se descarta.
- **Clientes**: los teléfonos se normalizan a `+54` + dígitos. Si dos clientes quedan con el mismo teléfono, lo conserva el más antiguo y en los demás pasa a las **notas** («Teléfono (repetido con otro cliente): …»).
- **Usuarios y permisos**: los empleados existentes quedan con acceso a Vapes. Los permisos de Inventario y Movimientos se fusionan en **Stock**; los de Finanzas, Gastos, Caja, Usuarios y Configuración se eliminan (los globales quedan solo para dueños).
- **Vistas**: `vw_stock_consolidado` y `vw_alertas_stock` se recrean con `panel_id`.

### Después de migrar

- Verificar `/api/health`, entrar con un dueño y revisar en Vapes el stock de un par de productos y la última venta (su ID ahora es `VAP-…`).
- Revisar el acceso por panel y los permisos de cada empleado en `/usuarios/[id]`.
- Si el seed se había corrido en la 1.x con los usuarios anteriores, los usuarios nuevos (Juan Cruz, Agustina, Trinidad) se crean con una corrida del seed con las variables `SEED_*` (ver el checklist), o a mano desde `/usuarios`.
- Si algo salió mal: restaurar el backup previo y promover el deploy 1.x (ver [Rollback](#rollback)).

## Backups

- **Diario 04:00 AR**: `.github/workflows/backup.yml` → `pnpm backup --origen=cron` (pg_dump `-Fc` + `pg_restore --list` + subida a R2 + rotación 30 diarios / 12 semanales / 12 mensuales + fila en `Backup`).
- **Alternativas**: Railway cron con `pnpm backup`; o cualquier cron HTTP contra `POST /api/cron/backup` con `Authorization: Bearer $CRON_SECRET` en un runtime **que tenga `pg_dump`** (no sirve en Vercel Functions).
- **Si un backup falla**: queda una fila con `ok = false` y el error, visible como **Falló** en `/configuracion/backups`; el servidor escribe un log de nivel error (`backup FALLIDO`); el job de GitHub queda en rojo (y GitHub avisa por email a quien lo tenga configurado). `/api/health` informa `backup.ok` (`false` si no hubo un backup correcto en las últimas 36 h), `backup.ultimo` y `backup.horasDesde`: conviene apuntar un monitor externo de uptime a ese endpoint.
- **Descarga**: `/configuracion/backups` (solo dueños; link firmado de 15 minutos).
- **Probar la restauración** (mensual, y siempre después del primer deploy y de la migración de la reforma):
  ```bash
  DATABASE_URL=<directa, prod o copia> pnpm test:restore
  ```
  Hace un backup, lo restaura en una base vacía y compara `COUNT(*)` de **todas** las tablas, `SUM(Stock.cantidad)`, triggers y vistas. Tiene que terminar en `RESTAURACIÓN VERIFICADA`.

## Rollback

| Qué salió mal                                       | Qué hacer                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El código nuevo tiene un bug, la base está bien     | Vercel → Deployments → el deploy anterior → **Promote to Production** (instantáneo). Como las migraciones son compatibles hacia atrás, el código anterior funciona con la base nueva. **No aplica a la 1.x después de la reforma**: volver a la 1.x exige restaurar el backup previo a la migración (fila siguiente).                                                                                                                                                |
| La migración falló a mitad de camino                | El deploy no se publicó (el job `deploy` corta). Revisar el error con `prisma migrate status`; corregir con una migración nueva o `prisma migrate resolve --rolled-back <migración>` después de revertir a mano lo aplicado (o restaurar el backup del release).                                                                                                                                                                                                     |
| Datos dañados (migración errónea, borrado)          | Restaurar el backup previo al release (`origen: release` en `/configuracion/backups`):<br>1. Poner la app en mantenimiento (pausar el deploy o apuntar el dominio a una página estática).<br>2. `RESTORE_DATABASE_URL=<DIRECT_URL de producción> pnpm restore backups/backup-AAAA-MM-DD-HHmm.dump --force` (pide confirmación escribiendo el nombre de la base).<br>3. Promover el deploy anterior.<br>4. Verificar `/api/health` y el stock de un par de productos. |
| El service worker nuevo rompe algo en los celulares | Promover el deploy anterior: el SW se sirve con `no-cache`, los clientes lo toman en la próxima navegación y el aviso «Hay una versión nueva» los lleva a la anterior.                                                                                                                                                                                                                                                                                               |

## Alternativa: Railway

- Servicio **web**: `pnpm build` / `pnpm start` (Railway define `PORT`). Imagen con `postgresql-client-16` (Nixpacks: `NIXPACKS_APT_PKGS=postgresql-client-16`), así `pnpm backup` funciona en el mismo entorno.
- Servicio **Postgres 16** de Railway: `DATABASE_URL` privado; `DIRECT_URL` igual (sin pooler externo, `connection_limit=10`).
- **Pre-deploy command**: `pnpm release`.
- **Cron job**: `0 7 * * *` → `pnpm backup --origen=cron`.
