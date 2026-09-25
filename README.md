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

| Script                          | Qué hace                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm db:reset`                 | Borra la DB, re-aplica migraciones y corre el seed (¡solo dev!)              |
| `pnpm db:seed`                  | Seed idempotente                                                             |
| `pnpm test:stock`               | Prueba de humo del motor de stock contra la DB                               |
| `pnpm typecheck`                | `tsc --noEmit`                                                               |
| `pnpm test:unit`                | Vitest: detector de la pistola (`useBarcodeScanner`)                         |
| `pnpm test:compras`             | Compras, proveedores, recuento, códigos internos y etiquetas (DB)            |
| `pnpm test:ventas`              | Ventas: pago partido, fiado, devoluciones, anulación (DB)                    |
| `pnpm test:ventas:concurrencia` | 10 ventas simultáneas sobre stock 5: 5 confirman, numeración sin huecos      |
| `pnpm test:e2e:ventas`          | E2E del POS, cobro, clientes y comprobantes                                  |
| `pnpm test:e2e:escaner`         | E2E del escáner (pistola + cámara falsa), compras y etiquetas                |
| `pnpm db:seed-demo`             | 90 días de operación simulada (ventas, cajas, gastos, compras)               |
| `pnpm reportes:rebuild`         | Reconstruye `ResumenDiario` entero desde el ledger (recuperación)            |
| `pnpm test:reportes`            | ResumenDiario, KPIs, caja/arqueo, efectivo fuera de caja, reposición         |
| `pnpm explain:reportes`         | `EXPLAIN ANALYZE` de la serie temporal y el ranking (con `PRISMA_LOG=query`) |
| `pnpm test:e2e:reportes`        | E2E de dashboard, reportes, exportaciones, gastos, caja y permisos           |
| `scripts/db-descartable.sh X`   | Recrea una base descartable X (migraciones + seed [+ `--demo`])              |

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

## Escáner, compras y etiquetas

- **Pistola** (USB/Bluetooth en modo teclado): un solo listener global (`ScannerProvider`, fase de captura).
  Detecta ráfagas por velocidad (≥ 4 caracteres a < 50 ms, con Enter/Tab; parámetros en
  `/configuracion/escaner`, con «Probar pistola»). Mide con `KeyboardEvent.timeStamp` y, con la ráfaga ya
  confirmada, tolera hipos de hasta 3×: no se parte el código aunque el celular esté ocupado. Si el foco
  estaba en un input, el input queda como estaba; si era una persona tipeando, no se pierde nada.
  Cada pantalla consume con `useBarcodeScanner` / `useEscanerVariantes` (el último montado gana).
- **Cámara**: `BarcodeDetector` nativo o `@zxing/browser`; se libera al cerrar, al ocultar la pestaña y al desmontar.
- **Hub `/escanear`** (botón central de la barra inferior): Consultar · Ingresar · Contar · Transferir
  (Vender, en la próxima etapa). Carrito persistido; código desconocido → asociarlo o crear el producto y volver.
- **Compras** (`/compras`): borrador → recibir (INGRESO_COMPRA por ítem, opcional actualizar costos con
  historial) → anular (DEVOLUCION_PROVEEDOR). Totales calculados en el servidor. **Proveedores** con CUIT validado.
- **Etiquetas** (`/productos/etiquetas`): Code128 en PDF (A4 65/hoja, 3×8, 2×7, rollo 50×30). A lo que no tiene
  código se le asigna uno interno `{prefijo}{7 dígitos}{verificador}`.
- Para probar sin pistola: pegar `scripts/simular-pistola.js` en la consola y llamar `simularPistola("7790001000019")`.

## Ventas, clientes y comprobantes

- **POS** (`/ventas/nueva`, el botón «Ventas» de la barra inferior): pistola siempre activa, cámara,
  buscador, grilla de los 12 más vendidos, carrito persistido y cobro con pagos partidos, vuelto,
  redondeo (siempre a favor del cliente), descuento y fiado (con permiso «editar»). Escritorio: cobro
  inline, `F2` buscar, `F9` cobrar.
- **Confirmar una venta** es una transacción Serializable: descuenta stock (VENTA por ítem), congela el
  costo, registra los pagos, actualiza la cuenta corriente y numera el comprobante con la secuencia
  bloqueada (`FOR UPDATE`): sin huecos ni duplicados aunque cobren varias cajas a la vez.
- **Invariantes verificadas por la DB al COMMIT**: `montoPagado = Σ pagos vigentes`,
  `montoPagado + saldoPendiente = total`, `Cliente.saldoDeudor = Σ saldos pendientes`,
  `cantidadDevuelta = Σ devuelto ≤ vendido`. Los pagos no se borran: se anulan (solo el dueño).
- **Devoluciones** parciales con reintegro en dinero o a la cuenta del cliente (cancela deuda; el resto
  queda como saldo a favor, usable como medio de pago). **Anular** revierte stock, pagos y comprobante.
- **Comprobantes**: ticket 80 mm y A4 (pdf-lib). El ticket se guarda con una URL pública inadivinable
  (`/api/publico/archivos/...`) para mandarlo por WhatsApp. `StorageProvider` (`src/server/storage.ts`)
  es local en desarrollo (`.storage/`) y se reemplaza por S3/R2 en producción. AFIP: ver el comentario
  en `comprobante.service.ts` (no integrado).
- Para el Prompt 6, `venta.service.ts` expone `resumenVentas`, `ventasPorDia`, `topVariantes` y
  `ventasPorVendedor` (SQL agregado, sin traer ventas a memoria).

## Dashboard, reportes, gastos y caja

- **Permisos nuevos**: `FINANZAS` (solo «ver»: costos, ganancias, valorización), `GASTOS`, `CAJA`.
  Con `REPORTES` sin `FINANZAS` se ven los reportes 1, 3, 4, 6 y 10 **sin** columnas de costo ni
  ganancia; los reportes de dinero (y sus exportaciones) devuelven 403. Sin `REPORTES`, un empleado
  ve en el inicio solo **sus** ventas.
- **Zona horaria**: `Configuracion.timezone` (default Buenos Aires). Todo rango es de días completos
  en esa zona (`src/lib/zona-horaria.ts`, `date-fns-tz`); las columnas guardan UTC sin zona.
- **`ResumenDiario`**: agregados por (día, depósito) + fila consolidada (`depositoId` NULL, único
  `NULLS NOT DISTINCT`). Se **recalcula** (no delta) con una sola consulta set-based al final de
  cada transacción que toca un día: confirmar/anular venta, cobrar/anular pago, devolver, gastos.
  `pnpm reportes:rebuild` la reconstruye.
- **`reporte.service.ts`**: todas las consultas agregan en PostgreSQL (o leen `ResumenDiario`), con
  el resultado de `$queryRaw` validado con Zod. Reutiliza `ventasPorVendedor` y `topVariantes`.
- **Reportes** (`/reportes`): cada uno arma un `DocumentoReporte` que se dibuja igual en pantalla,
  PDF (pdf-lib, A4 vertical/apaisado) y Excel (exceljs en streaming). Resumen mensual con botón de
  WhatsApp (PDF con URL privada).
- **Caja** (`/caja`): una abierta por depósito (índice único parcial). Solo efectivo; cada cobro,
  devolución, anulación o gasto en efectivo deja su `MovimientoCaja` (inmutable) en la misma
  transacción. El esperado sale siempre de sumar movimientos; la DB verifica el cierre. No sale de
  la caja más efectivo del que hay. Sin caja abierta, el efectivo queda «fuera de caja» (visible en
  reportes) salvo `exigirCajaAbierta`. Arqueo con contador de billetes, PDF «Z» y WhatsApp.
- **Gastos** (`/gastos`): categorías, foto del ticket (StorageProvider), depósito, recurrentes
  (recordatorio, no se cargan solos).
- **Alertas**: `GET /api/cron/alertas` con `Authorization: Bearer $CRON_SECRET` (ver `vercel.json`).
  Crea `Notificacion` por destinatario (campana + `/notificaciones`). Canales en
  `src/server/notificaciones/canales.ts`: in-app implementado; WhatsApp y email, stubs documentados.
- **Reloj de negocio** (`src/lib/reloj.ts`): los servicios fechan con `ahora()`; el seed demo lo fija
  para simular 90 días pasando por los servicios reales. En producción no se puede fijar.
