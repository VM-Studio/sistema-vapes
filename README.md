# Sistema de Gestión multipanel

## Qué es

Sistema de gestión para un negocio con varias líneas de productos que funcionan como **sistemas
independientes** (paneles): **Vapes**, **Cosmetic**, **Especiales** y los que los dueños agreguen desde la
app. Cada panel tiene su propio catálogo (producto = marca + modelo + especificación, con sus sabores),
stock por galpón y global, carga de stock escaneando con pistola lectora o cámara, proveedores con su lista
de precios, compras, ventas con cliente obligatorio, clientes, devoluciones por garantía, cotizador por unidad
y por mayor, dashboard con períodos y rendimiento del equipo, y reportes exportables (con el comparador de
proveedores). Los usuarios, la configuración general, los backups y la auditoría son globales.

Es una PWA: se instala en el celular o la PC, abre directamente el último panel usado y, sin conexión, el
escáner sigue consultando productos, precios y stock con el catálogo guardado en el dispositivo.

Documentación relacionada:

- [docs/MANUAL-USUARIO.md](docs/MANUAL-USUARIO.md): manual para dueños y empleados (también se ve en `/ayuda`).
- [docs/MODELO-DATOS.md](docs/MODELO-DATOS.md): modelo de datos (DBML) e invariantes de la base.
- [docs/DEPLOY.md](docs/DEPLOY.md): puesta en producción, variables, migración de la reforma, backups y restauración.
- [CHANGELOG.md](CHANGELOG.md): historial de versiones.

## Stack

| Capa           | Tecnología                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Framework      | Next.js 15 (App Router, Server Actions, middleware en runtime Node), React 19, TypeScript estricto |
| Datos          | PostgreSQL 16 + Prisma 6 (`relationJoins`, Client Extensions), `pg_trgm` para búsquedas            |
| Validación     | Zod 4 (formularios, Server Actions, resultados de `$queryRaw` y variables de entorno)              |
| UI             | Tailwind CSS 4, fuente Inter, lucide-react, Recharts                                               |
| PWA / offline  | Serwist (service worker), IndexedDB (`idb`) con el catálogo del panel                              |
| Escáner        | Pistola HID (detector propio), cámara con `BarcodeDetector` o `@zxing/browser`                     |
| Documentos     | pdf-lib (etiquetas), exceljs (Excel), bwip-js (etiquetas Code128)                                  |
| Auth           | Propia: bcryptjs + JWT HS256 (`jose`) en cookie httpOnly, sesiones revocables en DB                |
| Archivos       | Disco local (`.storage/`) o S3 compatible (Cloudflare R2) con `@aws-sdk/client-s3`                 |
| Imágenes       | sharp (re-codificado, sin metadatos)                                                               |
| Observabilidad | pino (logs JSON con `requestId`), `/api/health`                                                    |
| Tests          | Vitest (unit + integración con DB), Playwright (E2E)                                               |

## Arquitectura

```mermaid
flowchart LR
  subgraph Cliente["Navegador / PWA instalada"]
    UI["React (App Router)<br/>/paneles · /p/[slug]/* · globales"]
    SW["Service worker (Serwist)<br/>precache del shell · /offline"]
    IDB[("IndexedDB<br/>catálogo del panel (solo consulta)")]
    LS[("localStorage<br/>último panel usado")]
    UI <--> IDB
    UI --> LS
  end

  subgraph Next["Next.js 15"]
    MW["middleware.ts<br/>CSP con nonce · origin check · rate limit<br/>sesión revocable · resuelve el panel de /p/[slug]<br/>(x-panel-id / x-panel-slug)"]
    SA["Server Actions<br/>(actionHandler)"]
    RH["Route handlers<br/>/api/*"]
    AUTH["permissions.ts<br/>requireCtx(modulo, accion) → ctx { panelId, usuarioId }"]
    SV["Servicios de negocio<br/>src/server/services"]
    SG["Servicios globales<br/>auth · usuarios · paneles · backups · auditoría"]
    DBP["dbPara(panelId)<br/>Prisma Client Extension"]
    MW --> SA & RH
    SA & RH --> AUTH
    AUTH --> SV & SG
    SV --> DBP
  end

  UI -- "HTTPS" --> MW
  SW -. "network-only para páginas y APIs" .-> MW

  DBP -- "DATABASE_URL (pooler)" --> PG[("PostgreSQL<br/>panelId en toda tabla de negocio<br/>fn_verificar_mismo_panel · CHECKs · triggers")]
  SG -- "Prisma crudo (solo tablas globales)" --> PG
  MIG["prisma migrate deploy<br/>pg_dump"] -- "DIRECT_URL" --> PG
  SV --> ST[("Storage<br/>local .storage/ o S3/R2")]
  BK["Backup diario (GitHub Actions)<br/>pg_dump -Fc + verificación"] --> R2B[("Bucket de backups R2<br/>30 diarios · 12 semanales · 12 mensuales")]
  PG --> BK
  SV --> LOG["pino (JSON, requestId)"]
```

Flujo de una request:

1. **Middleware** (`src/middleware.ts`, runtime Node): genera `requestId` y una CSP con nonce por request;
   rechaza mutaciones (`POST/PUT/PATCH/DELETE`) con `Origin` de otro sitio; aplica rate limit a `/api/*` y
   Server Actions (por usuario, o por IP sin sesión; tabla `RateLimit`); valida la sesión (JWT + fila
   `Sesion` no revocada ni vencida + usuario activo); si hay cambio de contraseña pendiente solo deja usar
   `/cuenta`. En `/p/{slug}/*` y `/api/p/{slug}/*` **resuelve el panel**: tiene que existir, estar activo y el
   usuario tiene que acceder (dueño, o fila en `UsuarioPanel`); si no, redirige a `/paneles?aviso=sin-acceso`
   (o responde 403 en APIs y Server Actions). El panel resuelto viaja a la app en los headers `x-panel-id` y
   `x-panel-slug`, que el middleware borra antes de setearlos: lo que mande el cliente se descarta.
2. **Server Actions** envueltas en `actionHandler()` (siempre devuelven `{ ok, data } | { ok: false, error }`)
   y **route handlers** para descargas, etiquetas, catálogo offline, cron, backups y health.
3. **Autorización** (`src/server/auth/permissions.ts`): `requireCtx(modulo, accion)` verifica el permiso del
   usuario **en el panel resuelto** y arma `ctx = { panelId, usuarioId, meta }`.
4. **Servicios** (`src/server/services/`): reciben `ctx` y solo tocan la base con `dbPara(ctx.panelId)` o
   `transaccion(ctx, …)`. Las operaciones que mueven stock corren en transacción Serializable con reintento
   ante conflicto.
5. **PostgreSQL** hace cumplir las invariantes (incluido el aislamiento entre paneles) con CHECKs, índices
   parciales y triggers (ver [MODELO-DATOS](docs/MODELO-DATOS.md#invariantes-garantizadas-por-la-base)).

Autorización en tres capas:

1. Server Actions / route handlers: `requireCtx()` / `requireOwner()` → `ForbiddenError` (que además queda en
   la auditoría como `ACCESO_DENEGADO`, con el panel).
2. Páginas: `requirePaginaPanel()`, `requirePaginaPanelOwner()`, `requirePaginaOwner()` y
   `requirePaginaUsuario()` → redirigen a `/login`, `/cuenta`, `/paneles` o `/p/{slug}/sin-acceso`.
3. UI: `<Puede>` / `usePuede()` usan la misma función pura `puede(usuario, panelId, modulo, accion)`
   (`src/lib/permisos.ts`) y solo deciden qué se muestra. La navegación dentro de un panel sale de una sola
   fuente, `src/config/navigation.ts`, filtrada con los permisos del usuario en ese panel.

## Decisiones clave

- **Paneles como sistemas independientes.** Toda tabla de negocio (depósitos, categorías, marcas,
  proveedores, clientes, productos, variantes, códigos, stock, movimientos, compras, ventas, devoluciones,
  transferencias, configuración y secuencias) tiene `panelId`. Nada se comparte entre paneles: el mismo código
  de barras, SKU o teléfono de cliente puede existir en dos paneles sin conflicto. Lo global (usuarios,
  sesiones, `ConfiguracionGlobal`, backups, auditoría) queda fuera.
- **Aislamiento en tres capas.**
  1. **Aplicación**: `dbPara(panelId)` (`src/server/db/panel-scoped.ts`) es un `PrismaClient` extendido que,
     para todo modelo con `panelId`, agrega el panel al `where` de lecturas, updates y deletes (un id de otro
     panel da «no encontrado»), completa `panelId` en los creates (también en los anidados) y **lanza**
     `PanelAislamientoError` si una query trae un `panelId` distinto. `$queryRaw` / `$executeRaw` no pasan por
     la extensión: toda SQL cruda de negocio filtra por `ctx.panelId` a mano.
  2. **Base de datos**: `panelId` es `NOT NULL` con `DEFAULT current_setting('app.panel_id', true)`, una
     variable que nadie setea, así un `INSERT` que olvide el panel falla en vez de guardar datos huérfanos. El
     trigger `fn_verificar_mismo_panel` verifica que cada FK apunte a una fila del mismo panel y que `panelId`
     no cambie nunca.
  3. **Lint**: `eslint.config.mjs` prohíbe importar el cliente crudo `@/lib/db` (y crear otro `PrismaClient`)
     fuera de la capa de datos y de los servicios globales (auth, sesiones, usuarios, paneles, backups, salud,
     auditoría, identidad, exportar todo).
- **Rutas por panel.** Todo lo de negocio vive en `/p/[slug]/…` (`/p/vapes/ventas`). El slug es
  kebab-case, único, y define el prefijo de los IDs visibles (tres primeras letras: `vapes` → `VAP`). Las
  rutas globales son `/paneles`, `/usuarios`, `/configuracion`, `/cuenta` y `/ayuda`. `/` redirige a
  `/paneles`, que entra directo al panel si el usuario accede a uno solo; la PWA arranca en
  `/paneles?origen=pwa` y abre el último panel usado (guardado en `localStorage`).
- **Numeración por panel.** Ventas, compras, transferencias y devoluciones se numeran por panel con la tabla
  `Secuencia` (`siguienteNumero()` en `src/server/db/secuencia.ts`): `SELECT … FOR UPDATE` sobre la fila
  (panel, entidad) dentro de la transacción que inserta el documento, así dos ventas simultáneas del mismo
  panel nunca repiten número y si la transacción falla el número no se consume. Un trigger impide que la
  secuencia retroceda o se borre. El ID de venta visible es `VAP-000001` y el de compra `VAP-C-000001`
  (`src/lib/paneles.ts`); el prefijo de un panel nuevo no puede chocar con el de otro.
- **Catálogo: producto = marca + modelo + especificación.** La marca es obligatoria y la especificación es el
  atributo principal del panel (`Panel.etiquetaEspecificacion`: «Pitadas» en Vapes). El producto tiene **un**
  precio de venta para todos sus sabores; cada sabor (`Variante`) puede tener precio propio (`null` = el del
  producto) y guarda su `ultimoCosto`. `nombreCompleto` y `especificacionNorm` los mantiene un trigger de la
  base (renombrar la marca actualiza los nombres; «Sin marca» no aparece), así la app no puede dejarlos
  desincronizados y la unicidad (marca, modelo, especificación normalizada) no depende de mayúsculas ni
  espacios. Las reglas de precio viven en una sola función pura, `src/lib/precios.ts`, que usan el servidor y
  el cliente.
- **Costos por snapshot.** Recibir una compra actualiza `Variante.ultimoCosto`; cada venta congela ese costo
  en `VentaItem.costoUnitario` (0 si el sabor no tuvo compras). Cambiar costos o precios después no altera la
  ganancia de las ventas ya hechas.
- **Precios por proveedor.** `ProveedorProducto` guarda un precio por (proveedor, producto), en `ARS` o `USD`,
  que se pisa al editarlo o al recibir una compra con «actualizar precio» (el Dialog muestra «de $X a $Y»).
  Alimenta el costo sugerido de las compras (precio del proveedor en pesos → último costo del sabor) y la
  lista «Proveedores que lo venden» de la ficha del producto, de menor a mayor. `CompraItem` es por sabor
  pero lleva el `productoId` desnormalizado (verificado por trigger) para cruzarlo con esos precios.
- **Galpón obligatorio para cargar stock.** La carga por escaneo (`/p/{slug}/productos/cargar`) y las compras
  empiezan eligiendo el galpón con `SelectorGalpon`: el último usado viene preseleccionado pero nunca se
  confirma solo, y el escáner no hace nada hasta confirmar. El servicio (`cargarStockPorEscaneo()`) rechaza
  una carga sin depósito activo aunque no venga de la pantalla. Un código desconocido abre el alta rápida
  (`AltaRapidaSheet`), que crea el producto o le agrega el sabor si marca + modelo + especificación ya
  existen.
- **Ventas simples.** Una venta nace confirmada (sin borradores), con código `VAP-000001`, galpón, **cliente**
  (nombre + teléfono, único por panel) y **un** medio de pago (efectivo, transferencia o Binance), todos
  obligatorios en la base. Guarda precio de lista, precio cobrado (precio especial) y costo por renglón. Sin
  cuenta corriente, pagos partidos, caja ni comprobantes. No se edita: se anula (`VENTA_ANULADA` devuelve el
  stock).
- **Devoluciones por garantía.** Cliente obligatorio, venta opcional, observación (≥ 10 caracteres): se
  entrega una unidad nueva del galpón elegido (`GARANTIA`); anularla la devuelve (`GARANTIA_ANULADA`).
- **Ledger de movimientos inmutable.** Todo cambio de stock es una fila de `MovimientoStock` (tipo, cantidad,
  stock anterior y posterior, costo, referencia). Triggers bloquean `UPDATE`/`DELETE`/`TRUNCATE`; un error se
  corrige con un ajuste inverso. Lo mismo para `AuditLog`.
- **Stock derivado.** `Stock` es un caché del ledger: solo cambia vía `registrarMovimiento()` /
  `transferirStock()` (`stock.service.ts`). La base rechaza un `UPDATE` a `Stock` sin movimiento en la misma
  transacción, un movimiento cuyo `stockAnterior` no coincide con el stock real y cualquier stock negativo.
  La pantalla **Stock** tiene una pestaña por galpón (su stock, transferir a otro galpón en el acto, ajustar
  y sus movimientos) y **Global** (una columna por galpón + total y los movimientos de todos).
- **Cotizador con escalones.** El precio mayorista sale de escalones por producto (aplican a todos sus
  sabores) o de los escalones por defecto del panel (% sobre la lista, redondeado a 10 pesos), calculado por
  una función pura (`resolverPrecios()` en `precio.service.ts`) que usa el servidor. Una cotización se
  convierte en venta en una sola transacción (`convertirEnVenta()`): si falta stock no cambia nada.
- **Analítica en la base.** El dashboard (`/p/{slug}`), el rendimiento del equipo (`/p/{slug}/equipo`) y los
  reportes (`/p/{slug}/reportes`) no traen ventas a memoria: PostgreSQL agrega (`groupBy` o `$queryRaw` con
  `"panelId"` explícito y resultado validado con Zod) sobre el índice parcial de ventas confirmadas, y Node
  solo presenta. Los períodos (diario, semanal lunes–domingo, mensual o personalizado) se cortan en la hora
  de Buenos Aires y se comparan con el período anterior equivalente (`analitica.service.ts`).
- **Precios de proveedor con historia.** Cada alta o cambio de `ProveedorProducto` deja una fila en
  `ProveedorProductoHistorial` (la escribe un trigger, no la app). El comparador de proveedores convierte los
  precios en dólares con la cotización del panel (`cotizacionUsd`).
- **Comisión orientativa.** Cada usuario puede tener un % de comisión para ventas unitarias y otro para
  mayoristas: el dueño ve la comisión estimada en el rendimiento del equipo; no genera movimientos.
- **Quién ve costos.** Último costo de los sabores, costo de la venta y ganancia bruta los ven únicamente los
  dueños, en cualquier pantalla, en el dashboard, en los reportes y en las exportaciones. El rendimiento de
  otros vendedores y el comparador de proveedores son solo para dueños (un empleado con Dashboard ve «Mi
  rendimiento»). Costos y totales de compras y precios de proveedores los ven los dueños y quien tiene `ver`
  en Compras (`veCostosCompras()`); el filtro se aplica en el servidor.
- **Offline solo consulta.** El catálogo del panel (productos, códigos, precios y stock) se guarda en
  IndexedDB al entrar y cada 15 minutos con red (304 si no cambió). Sin conexión, el escáner solo consulta;
  ingresar, contar, transferir y vender necesitan señal. No hay cola offline.
- **Sesiones revocables.** El JWT lleva `sid` (fila `Sesion`) y `tok` (secreto del que la base guarda el
  sha256). El middleware valida la sesión en cada request con un caché de 60 s por `sid`: revocar, dar de baja
  o cambiar la contraseña corta el acceso al instante en la misma instancia y en ≤ 60 s en las demás. Los
  permisos y paneles no van en el token: se leen de la base.
- **CSP con nonce.** `script-src 'self' 'nonce-…' 'strict-dynamic'`, sin `unsafe-inline` para scripts.
  Headers de seguridad en `next.config.ts` (HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` con cámara solo propia, COOP).
- **Reloj de negocio y zona horaria.** Los servicios fechan con `ahora()` (`src/lib/reloj.ts`); un script de
  prueba lo puede fijar para simular días pasando por los servicios reales, y en producción no se puede fijar. Las columnas
  guardan UTC; todo rango de días se calcula en la zona horaria del negocio (`ConfiguracionGlobal.timezone`,
  por defecto Buenos Aires, `src/lib/zona-horaria.ts`).
- **Diseño.** Fondo blanco, tipografía Inter, estilo SaaS, sin modo oscuro. Cada panel tiene su color de
  acento (`Panel.colorAcento`), que tiñe el botón primario y los ítems activos.
- **Entorno validado.** `src/env.ts` valida las variables con Zod al arrancar (`instrumentation.ts`): con una
  variable inválida la app no arranca y el error dice cuál. En producción rechaza el `AUTH_SECRET` de ejemplo y
  exige `CRON_SECRET` y `NEXT_PUBLIC_APP_URL`.
- **Archivos.** `StorageProvider` (`src/server/storage.ts`): local en desarrollo, S3/R2 en producción. Los
  privados se referencian como `/api/publico/archivos/<clave>` (clave con 24 bytes aleatorios; en S3 redirige
  a una URL firmada de 5 minutos). Las imágenes subidas (logos de panel, ícono de la app) se validan por
  contenido (magic bytes, no extensión), máximo 5 MB, y se re-codifican con sharp descartando metadatos.
- **Contraseñas.** bcrypt (12 rondas), mínimo 8 caracteres con letras y números, rechazo de las 10.000 más
  comunes. Login con rate limit persistente: 5 intentos fallidos por email cada 15 minutos.

## Cómo correr local

Requisitos: Node 20+, pnpm, Docker (para PostgreSQL) y, para backups, `postgresql-client` (mismo major que el
servidor).

```bash
pnpm install
cp .env.example .env        # revisar DATABASE_URL, DIRECT_URL y AUTH_SECRET
pnpm db:up                  # PostgreSQL 16 en Docker (usuario app/app, base gestion, puerto host 5433)
pnpm db:deploy              # o `pnpm db:migrate` si estás cambiando el schema
pnpm db:seed                # paneles, depósitos, secuencias, configuración y usuarios (sin datos de negocio)
pnpm dev                    # http://localhost:3000 (salud: /api/health)
```

- El schema declara `directUrl = env("DIRECT_URL")`: en local puede ser la misma URL que `DATABASE_URL`
  (`postgresql://app:app@localhost:5433/gestion?schema=public`).
- Si el puerto 5433 está ocupado, cambiá `DB_PORT` en `.env` (lo usa `docker-compose.yml`).
- Los paneles **Vapes**, **Cosmetic** y **Especiales**, sus depósitos y sus secuencias los crea la migración
  `20260928160000_reforma_multipanel`; el seed los completa si faltan (con su logo: `/logoVape.png`,
  `/logoCosmetics.png`, `/logoEspecial.png`), junto con los depósitos (Vapes: **Ayres Plaza**, principal, y
  **Mercedes**; Cosmetic y Especiales: **Principal**), las secuencias de numeración, la configuración por
  defecto de cada panel y los usuarios. **No crea datos de negocio**: productos, marcas, categorías,
  proveedores y clientes se cargan desde la app.
- `pnpm db:limpiar-negocio` vacía los datos de negocio de todos los paneles (productos, sabores, precios y
  escalones, proveedores, clientes, ventas, compras, devoluciones, cotizaciones, transferencias, movimientos y
  stock, auditoría de los paneles) y reinicia la numeración; deja paneles, depósitos, usuarios con sus accesos,
  sesiones y configuración. Pide escribir `LIMPIAR`; con `NODE_ENV=production` o una base que no sea local se
  niega salvo `--force`.
- Los tests que necesitan un catálogo lo crean ellos mismos: `e2e/fixtures/catalogo-ejemplo.ts` (idempotente,
  con los servicios reales) y `e2e/fixtures/index.ts` (lo siembra antes de cada spec y lo limpia después).
- En producción el seed está bloqueado salvo `ALLOW_SEED=true` (y exige las variables `SEED_*`); el primer
  dueño también se puede crear con `pnpm crear-owner`.
- Para probar el escáner sin pistola: pegar `scripts/simular-pistola.js` en la consola del navegador y llamar
  `simularPistola("7790001000019")`.

### Usuarios del seed

Los emails y contraseñas iniciales salen de las variables `SEED_*`. En desarrollo, si faltan, se usan estos
valores, todos con la contraseña `Cambiar123!`. Todos tienen que cambiar la contraseña en el primer ingreso.
Re-correr el seed no pisa contraseñas ya cambiadas.

| Usuario   | Variables                                         | Email en desarrollo    | Rol      | Acceso                                                                            |
| --------- | ------------------------------------------------- | ---------------------- | -------- | --------------------------------------------------------------------------------- |
| Juan Cruz | `SEED_OWNER1_EMAIL`, `SEED_OWNER1_PASSWORD`       | `juancruz@negocio.com` | Dueño    | Todo                                                                              |
| Agustina  | `SEED_OWNER2_EMAIL`, `SEED_OWNER2_PASSWORD`       | `agustina@negocio.com` | Dueño    | Todo                                                                              |
| Trinidad  | `SEED_EMPLEADO1_EMAIL`, `SEED_EMPLEADO1_PASSWORD` | `trinidad@negocio.com` | Empleado | Solo Vapes: ver y crear en Ventas, Clientes y Cotizador; ver en Productos y Stock |

### Variables de entorno

Definidas y validadas en `src/env.ts` (las `SEED_*` las lee solo `prisma/seed.ts`). Detalle de producción en
[docs/DEPLOY.md](docs/DEPLOY.md).

| Variable                                                                            | Uso                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Conexión de la app (en producción, el pooler en modo transaction)                |
| `DIRECT_URL`                                                                        | Conexión directa, sin pooler: migraciones y `pg_dump`                            |
| `DATABASE_URL_TEST`                                                                 | Base descartable para los E2E (el nombre tiene que contener `e2e` o `test`)      |
| `AUTH_SECRET`                                                                       | Firma de las sesiones (≥ 32 caracteres)                                          |
| `CRON_SECRET`                                                                       | `Authorization: Bearer …` de `/api/cron/*` (obligatorio en producción)           |
| `NEXT_PUBLIC_APP_URL`                                                               | URL pública (cookies seguras, origin check, CSP; obligatorio en producción)      |
| `STORAGE_PROVIDER`                                                                  | `local` (default, carpeta `STORAGE_DIR` o `.storage/`) o `s3`                    |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Storage S3/R2 (obligatorias con `s3`)                                            |
| `S3_PUBLIC_URL`                                                                     | Dominio público del bucket (opcional)                                            |
| `S3_BACKUP_BUCKET`                                                                  | Bucket separado para backups                                                     |
| `S3_FORCE_PATH_STYLE`                                                               | `true` para MinIO local                                                          |
| `PG_DUMP_PATH`, `PG_RESTORE_PATH`                                                   | Rutas a `pg_dump` / `pg_restore` si no están en el `PATH`                        |
| `LOG_LEVEL`                                                                         | Nivel de pino (default `info`)                                                   |
| `APP_VERSION`                                                                       | Versión informada en health y logs (en Vercel se usa `VERCEL_GIT_COMMIT_SHA`)    |
| `RATE_LIMIT_POR_MINUTO`                                                             | Límite por usuario (default 300; sin sesión, un tercio con mínimo 30)            |
| `ALLOW_SEED`                                                                        | Permite el seed con `NODE_ENV=production` (una sola vez, a propósito)            |
| `SEED_OWNER1_*`, `SEED_OWNER2_*`, `SEED_EMPLEADO1_*`                                | Email y contraseña inicial de cada usuario del seed (obligatorias en producción) |
| `DB_PORT`                                                                           | Puerto del host para el Postgres de `docker-compose.yml` (default 5433)          |

## Scripts

| Script                                                        | Qué hace                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                    | Servidor de desarrollo (Turbopack)                                                                         |
| `pnpm build` / `pnpm start`                                   | Build de producción (incluye el service worker) y servidor                                                 |
| `pnpm lint`                                                   | ESLint (incluye la regla que prohíbe Prisma crudo en código de negocio)                                    |
| `pnpm typecheck`                                              | `tsc --noEmit`                                                                                             |
| `pnpm format` / `pnpm format:check`                           | Prettier (escribir / verificar)                                                                            |
| `pnpm db:up` / `pnpm db:down`                                 | Levanta / baja el Postgres de Docker                                                                       |
| `pnpm db:migrate`                                             | `prisma migrate dev` (crear y aplicar migraciones en desarrollo)                                           |
| `pnpm db:deploy`                                              | `prisma migrate deploy` (aplicar migraciones pendientes)                                                   |
| `pnpm db:generate`                                            | `prisma generate` (también corre en `postinstall`)                                                         |
| `pnpm db:seed`                                                | Seed idempotente: paneles, depósitos, secuencias, configuración y usuarios (sin datos de negocio)          |
| `pnpm db:reset`                                               | Borra la base, re-aplica migraciones y corre el seed (solo desarrollo)                                     |
| `pnpm db:studio`                                              | Prisma Studio                                                                                              |
| `pnpm db:limpiar-negocio [--force]`                           | Vacía los datos de negocio de todos los paneles (pide escribir LIMPIAR; `--force` fuera de local)          |
| `pnpm crear-owner`                                            | Crea el primer dueño en una base nueva (pide datos por consola; no hace nada si ya hay un dueño activo)    |
| `pnpm iconos`                                                 | Genera los íconos de la PWA                                                                                |
| `pnpm backup`                                                 | Backup manual: `pg_dump -Fc`, verificación, subida al bucket y rotación                                    |
| `pnpm release`                                                | Paso de release en producción: backup verificado (si hay migraciones pendientes) + `prisma migrate deploy` |
| `pnpm storage:migrate`                                        | Copia los archivos de `.storage/` al bucket S3/R2 y verifica cada uno (`--dry-run` para simular)           |
| `pnpm restore <archivo> [--force]`                            | Restaura un backup en `RESTORE_DATABASE_URL` (nunca en la base de la app sin `--force` y confirmación)     |
| `pnpm test` / `pnpm test:unit`                                | Vitest: proyectos `unit` e `integracion`                                                                   |
| `pnpm test:e2e`                                               | Playwright contra el build de producción y una base aislada                                                |
| `pnpm test:restore`                                           | Backup + restauración en una base vacía + comparación de conteos                                           |
| `pnpm test:scripts`                                           | `test:stock` + `test:integridad` + `test:auth`                                                             |
| `pnpm test:stock`                                             | Prueba de humo del motor de stock contra la DB                                                             |
| `pnpm test:integridad`                                        | Invariantes de la base (triggers y CHECKs, incluidos los de aislamiento entre paneles)                     |
| `pnpm test:auth`                                              | Login, sesiones y permisos contra la DB                                                                    |
| `pnpm test:ventas:concurrencia`                               | Ventas simultáneas sobre poco stock: confirman solo las que alcanzan, numeración por panel sin repetidos   |
| `pnpm test:catalogo`, `pnpm test:compras`, `pnpm test:ventas` | Servicios contra una DB recién sembrada: catálogo y carga de stock; proveedores y compras; ventas y costos |
| `pnpm test:cotizador`                                         | Escalones, cotizaciones, conversión en venta, permisos y aislamiento contra la DB                          |
| `scripts/db-descartable.sh X [--catalogo]`                    | Recrea una base descartable X (migraciones + seed [+ catálogo de ejemplo de los tests])                    |

## Estructura de carpetas

```text
prisma/
  schema.prisma           Modelo de datos (paneles + tablas de negocio con panelId)
  migrations/             Migraciones SQL (CHECKs, triggers y vistas incluidos; la reforma 2.0.0 va de
                          20260928160000_reforma_multipanel a 20261003090000_limpieza_configuracion)
  seed.ts                 Seed base (paneles, depósitos, secuencias, configuración, usuarios)
src/
  app/
    (auth)/login/         Inicio de sesión
    (app)/
      page.tsx            Redirige a /paneles
      (global)/           Fuera de los paneles: paneles (selector y «Agregar panel»), usuarios y usuarios/[id],
                          configuracion (negocio, sistemas, backups, auditoria, exportar-todo), cuenta, ayuda, sin-acceso
      p/[slug]/           Dentro de un panel: inicio (dashboard con períodos), equipo (rendimiento por vendedor), ventas, stock (pestañas por galpón y Global +
                          movimientos, transferencias), clientes, compras, productos (+ cargar, etiquetas), proveedores,
                          devoluciones, cotizador (unitaria, mayorista, detalle, configuracion), reportes (+ comparador),
                          configuracion (depositos, categorias, marcas, escaner, ventas), sin-acceso
    api/                  Route handlers: auth, p/[slug]/catalogo/offline, p/[slug]/etiquetas, p/[slug]/stock/exportar,
                          p/[slug]/reportes y p/[slug]/equipo (exportaciones),
                          cron/backup, backups/[id]/descargar, exportar-todo, publico/archivos, health
    offline/              Pantalla sin conexión (precacheada) con el escáner en modo consulta
    sw.ts, serwist/       Service worker (Serwist) y su ruta de servido
    manifest.ts, icons/   Manifest e íconos de la PWA
  components/             UI (ui/), layout (shells, sidebar, navegación mobile, contexto de panel), pwa, catálogo
                          (selector de galpón, alta rápida), compras, clientes, analitica (selector de período, KPIs, gráficos)
  config/navigation.ts    Única fuente de la navegación dentro de un panel
  features/
    scanner/              Pistola, cámara, resolución de códigos
    offline/              IndexedDB: catálogo del panel para consulta sin conexión
  lib/                    Utilidades compartidas: paneles.ts, permisos.ts y precios.ts (lógica pura), fechas, zona horaria, reloj,
                          validaciones Zod
  server/
    db/                   panel-scoped.ts (dbPara, transaccion, Ctx) y secuencia.ts (numeración por panel)
    services/             Lógica de negocio (con dbPara) y servicios globales
    auth/                 Sesiones, permisos, acceso a paneles, contraseñas, cron
    seguridad/            CSP, rate limit, validación de archivos
    reportes/             Catálogo de reportes, armado, comparador, exportación (Excel/CSV/PDF) y Exportar todo
    storage.ts, log.ts    Storage local/S3 y logger pino
  env.ts                  Variables de entorno validadas
  middleware.ts           CSP, origin check, rate limit, sesión, resolución del panel
  instrumentation.ts      Arranque del servidor (validación del entorno)
scripts/                  Backup/restore, release, crear-owner, íconos, pruebas contra DB
tests/                    Vitest: unit/ e integracion/ (incluye panel-aislamiento)
e2e/                      Playwright
docs/                     Manual, modelo de datos, deploy
```

## Tests

- **Vitest** (`pnpm test`), dos proyectos:
  - `unit` (jsdom, sin DB): detector de la pistola, seguridad (CSP, rate limit, magic bytes, contraseñas
    comunes), normalización de teléfonos, precios (precio efectivo, snapshot de costo, IDs de venta y compra),
    escalones del cotizador, períodos de la analítica, comparador de proveedores, rotación de backups y fechas.
  - `integracion`: aislamiento entre paneles (`dbPara`, triggers y `DEFAULT` de `panelId`), motor de stock,
    integridad de la DB, concurrencia de ventas y cotizador contra una base aislada (`DATABASE_URL_TEST_VITEST`, default
    `gestion_test_vitest` en el Postgres local; se recrea al empezar).
- **Playwright** (`pnpm test:e2e`): corre contra el **build** de producción (`pnpm build` antes) en el puerto
  3100 y una base aislada `DATABASE_URL_TEST` (default `gestion_e2e`), que el setup global recrea con
  migraciones y seed; cada spec que usa catálogo lo siembra en `beforeAll` y vacía los datos de negocio en
  `afterAll` (`e2e/fixtures`). Dos proyectos: escritorio 1440×900 y celular (Pixel 7). Flujos: login y cambio de
  contraseña, permisos, alta de producto (precio del producto y precio propio de un sabor), carga de stock
  escaneando (sin galpón no se carga nada, alta rápida de códigos desconocidos, stock por galpón), proveedores
  con precios, compra con costo sugerido y «recibir actualizando el precio», catálogo de la empleada (sin
  costos, sin cargar stock ni entrar a Compras), ventas, transferencia desde la fila del stock, stock por galpón
  y global (18), cotizador (19), dashboard y rendimiento del equipo (20), reportes, modo sin conexión
  (`/offline`, solo consulta), seguridad y paneles (empleada con un solo panel entra directo; dueño crea y
  desactiva un panel). `22-flujo-completo` recorre la v2 de punta a punta: cada usuario entra a sus
  sistemas; en Vapes carga stock eligiendo galpón, vende con cliente nuevo, registra una garantía, convierte
  una cotización mayorista y verifica el dashboard; repite lo esencial en Cosmetic, verifica el aislamiento
  entre paneles y que Trinidad no ve costos ni otros sistemas. Para no chocar con otra corrida:
  `E2E_PORT=31xx DATABASE_URL_TEST=postgresql://app:app@localhost:5433/gestion_e2e_x pnpm test:e2e`.
- **Restauración** (`pnpm test:restore`): hace un backup de la base de `DATABASE_URL`, lo restaura en una base
  vacía (`RESTORE_DB`, default `gestion_restore`) y compara `COUNT(*)` de todas las tablas, la suma de stock y
  la cantidad de triggers y vistas. Corre en CI después del seed.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, formato, migraciones sobre base vacía, drift entre
  `schema.prisma` y migraciones, Vitest, test de restauración, build y E2E. En `main`, además, release y
  deploy.
