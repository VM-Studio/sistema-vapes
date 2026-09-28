# Changelog

Todos los cambios importantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/).

## [2.0.0] - 2026-09-28

**Reforma R1: multipanel, limpieza y rediseño.** La app pasa a ser un conjunto de sistemas independientes
(paneles) y se simplifica: se eliminan los módulos de dinero (caja, gastos, cuenta corriente, pagos
partidos, comprobantes) y los reportes anteriores.

### BREAKING

- La migración `20260928160000_reforma_multipanel` **borra tablas y columnas** y no es compatible hacia
  atrás: el código 1.x no funciona contra una base migrada y lo eliminado solo se recupera desde un backup.
  Hacer y descargar un backup antes de migrar (ver `docs/DEPLOY.md`, «Migración de la reforma R1»).
- Todos los datos existentes pasan al panel **Vapes**; sus depósitos «Galpón 1» y «Galpón 2» se renombran
  **Ayres Plaza** y **Mercedes**.
- Las rutas de negocio pasan de `/{modulo}` a `/p/{slug}/{modulo}` (por ejemplo, `/p/vapes/ventas/nueva`);
  `/` redirige a `/paneles`. Los links y accesos guardados a las rutas anteriores dejan de funcionar.
- La numeración de ventas, compras, transferencias y devoluciones es **por panel** y el ID de venta visible
  pasa a ser `VAP-000001`.
- Permisos: son **por panel**; `INVENTARIO` y `MOVIMIENTOS` se fusionan en `STOCK`; desaparecen `FINANZAS`,
  `GASTOS` y `CAJA`; `USUARIOS` y `CONFIGURACION` quedan solo para dueños.
- Una venta se cobra completa con un único medio de pago; el medio `CREDITO_CLIENTE` desaparece y las ventas
  que lo usaban quedan con `OTRO`.
- `/api/sync` y la cola offline se eliminan: sin conexión solo se consulta.
- Variables de entorno: se quitan `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN`; se agregan `SEED_OWNER1_*`,
  `SEED_OWNER2_*` y `SEED_EMPLEADO1_*` (obligatorias para correr el seed en producción).

### Added

- **Paneles** (`Panel`): Vapes, Cosmetic y Especiales, cada uno con sus propios productos, variantes, códigos,
  stock, depósitos, ventas, clientes, compras, proveedores, configuración y numeración. Logo, color de acento
  y nombre del atributo principal de los productos («Pitadas», «Contenido», «Detalle») por panel.
- Selector de sistemas `/paneles` después del login, con ventas de hoy y alertas de stock por panel; entra
  directo si el usuario accede a un solo panel. «Cambiar de sistema» desde el menú lateral y el menú de cuenta.
  La PWA arranca en el último panel usado.
- «Agregar panel» en `/paneles` (solo dueños): nombre, dirección (slug), atributo principal, color y logo; el
  panel nace con un depósito «Principal» y sus secuencias. Desactivación de paneles en
  `/configuracion/sistemas` (sus datos se conservan).
- **Aislamiento entre paneles en tres capas**: `dbPara(panelId)` (Prisma Client Extension que filtra e inyecta
  `panelId` y lanza `PanelAislamientoError` ante un panel ajeno); en la base, `panelId` con
  `DEFAULT current_setting('app.panel_id', true)` (un `INSERT` sin panel falla) y el trigger
  `fn_verificar_mismo_panel` (cada FK apunta a su mismo panel y `panelId` no cambia); y una regla de ESLint
  que prohíbe el cliente de Prisma crudo en código de negocio.
- El middleware resuelve el panel de `/p/{slug}` (existe, activo y el usuario accede) y lo pasa a la app en
  `x-panel-id` / `x-panel-slug`; `requireCtx(modulo, accion)` arma el `ctx { panelId, usuarioId }` de los
  servicios.
- Tabla `Secuencia`: numeración correlativa por panel y entidad con `SELECT … FOR UPDATE`, que solo avanza y
  no se borra.
- Acceso de usuarios por panel (`UsuarioPanel`) y grilla módulo × acción por panel en `/usuarios/[id]`, junto
  con las sesiones activas del usuario y «Cerrar sesiones».
- Ajustes del panel en `/p/{slug}/configuracion` (solo dueños): depósitos, categorías, marcas, escáner y
  «Ventas y catálogo» (redondeo, prefijo de SKU, alerta de stock mínimo).
- `ConfiguracionGlobal` para lo que vale en toda la app (nombre del negocio, ícono, zona horaria, moneda).
- Vista **Global** de Stock y de movimientos, que consolida todos los depósitos del panel.
- Nuevos módulos en el menú, en preparación: Devoluciones (por garantía), Cotizador unitario, Cotizador
  mayorista y Reportes.
- Clientes: teléfono normalizado a `+54` + dígitos y único por panel (CHECK e índice único parcial).
- Usuarios iniciales del seed desde variables de entorno: dueños Juan Cruz y Agustina, empleada Trinidad
  (solo Vapes: ver y crear en Ventas, Clientes y Cotizador; ver en Productos y Stock), con cambio de
  contraseña obligatorio. En desarrollo, por defecto `juancruz@`, `agustina@` y `trinidad@negocio.com`.
- Tests de integración de aislamiento entre paneles y E2E de paneles.

### Changed

- Rediseño: fondo blanco, tipografía Inter, estilo SaaS, sin modo oscuro, color de acento por panel.
- Navegación dentro del panel agrupada en Operación, Catálogo, Cotizadores y Administración; barra inferior
  mobile con Inicio, Ventas, Productos y Stock.
- Ventas: se cobran completas con un único medio de pago (obligatorio al confirmar, verificado por la base);
  los ítems de una venta confirmada son inmutables; anular devuelve el stock.
- Inicio del panel: ventas de hoy, 7 días y mes, top 5 del mes, stock bajo y últimas ventas, calculados sobre
  las ventas (sin tablas de resumen). Costos y ganancias solo los ven los dueños, en todas las pantallas.
- Escáner sin conexión: solo consulta, con el catálogo del panel guardado en IndexedDB. Ingresar, contar,
  transferir y vender necesitan conexión.
- Unicidades por panel: nombres de depósito, categoría y marca, SKU, códigos de barras, CUIT, documento,
  producto por nombre y marca, números de documento. El mismo código de barras puede existir en dos paneles.
- Vistas `vw_stock_consolidado` (ahora con `por_deposito` en JSON en lugar de una columna por depósito) y
  `vw_alertas_stock`, ambas con `panel_id`.
- Configuración global (`/configuracion`) reducida a Negocio y app, Sistemas, Backups, Auditoría y Exportar
  todo; la auditoría registra el panel de cada acción.
- Backups: un fallo queda registrado en `/configuracion/backups`, en el log de errores y en `/api/health`.

### Removed

- Caja y arqueos, gastos y sus categorías.
- Cuenta corriente, ventas fiadas, saldos de clientes y pagos partidos (`PagoVenta`).
- Comprobantes (ticket y A4), su numeración, campos para AFIP y envío por WhatsApp.
- Devoluciones con reintegro de dinero (`DevolucionItem` y campos económicos de `Devolucion`).
- Notificaciones, campana y cron de alertas (`/api/cron/alertas`).
- `ResumenDiario`, los once reportes anteriores, finanzas, rotación, valorización de inventario y cuentas por
  cobrar.
- Importación y exportación CSV de productos, aumento masivo de precios e historial de precios.
- Cola offline, Background Sync, `OperacionSincronizada` y `/api/sync`.
- Sentry y Lighthouse CI.
- Scripts `reportes:rebuild`, `explain:reportes`, `test:reportes`, `lighthouse` y los E2E con puppeteer
  (`test:e2e:*`); E2E de cierre de caja.

## [1.0.0] - 2026-09-26

Primera versión para producción. Reúne el trabajo de las siete etapas de desarrollo.

### Added

#### Etapa 1: setup y capa de datos con motor de stock

- Setup inicial: Next.js 15 (App Router), TypeScript estricto, Prisma 6 + PostgreSQL 16, Zod y Tailwind;
  PostgreSQL local en Docker (puerto 5433).
- Ledger inmutable `MovimientoStock` y `Stock` como caché derivado: `registrarMovimiento()` y
  `transferirStock()` son la única forma de mover stock, dentro de transacciones Serializable con reintento.
- Integridad reforzada en la base: CHECKs, índices únicos parciales, triggers de inmutabilidad, verificación
  de aritmética y de stock real en cada movimiento, rechazo de `UPDATE` a `Stock` sin movimiento, sin `DELETE`
  físico de maestros (soft delete) ni de documentos confirmados, totales verificados al COMMIT.
- Numeración de comprobantes con `SecuenciaComprobante` (`SELECT … FOR UPDATE`), sin huecos ni duplicados.
- Vistas `vw_stock_consolidado` (se regenera al crear o renombrar depósitos) y `vw_alertas_stock`.

#### Etapa 2: autenticación, permisos y layout PWA

- Login propio con bcrypt y JWT HS256 en cookie httpOnly (7 días, renovación deslizante).
- Rate limit persistente de login: 5 intentos fallidos por email cada 15 minutos.
- Cambio de contraseña obligatorio en el primer ingreso y después de un reseteo.
- Roles OWNER y EMPLEADO; permisos por módulo (ver, crear, editar, eliminar) leídos de la base en cada
  request; autorización en Server Actions, páginas y UI. Siempre queda al menos un dueño activo.
- Gestión de usuarios: alta con contraseña temporal, permisos, reseteo y baja.
- Layout responsive: sidebar en escritorio, barra inferior y menú «Más» en el celular, navegación desde una
  sola fuente filtrada por permisos.
- Auditoría inmutable (`AuditLog`) de altas, cambios, bajas, logins y cambios de permisos.

#### Etapa 3: catálogo, variantes, depósitos, inventario y movimientos

- Productos con variantes (sabores), SKU autogenerado, código de barras principal y alternativos únicos entre
  ambas tablas, imagen.
- Historial de precios inmutable: la base rechaza un cambio de precio sin su registro.
- Importación y exportación CSV del catálogo (todo o nada) y aumento masivo de precios con previsualización.
- Depósitos (uno principal, no se desactivan con stock), categorías y marcas.
- Inventario consolidado por depósito con valorización para el dueño.
- Movimientos: historial, ingreso manual, ajuste simple, recuento y transferencias entre depósitos
  (pendiente → completar / anular).
- Búsqueda acelerada con `pg_trgm`.

#### Etapa 4: escáner, compras, proveedores y etiquetas

- Pistola lectora USB/Bluetooth en modo teclado con un listener global que detecta ráfagas por velocidad;
  parámetros configurables y «Probar pistola» en `/configuracion/escaner`.
- Escaneo por cámara con `BarcodeDetector` nativo o `@zxing/browser`.
- Hub `/escanear` con modos Consultar, Ingresar, Contar y Transferir, carrito persistido y alta o asociación de
  códigos desconocidos.
- Compras: borrador → recibir (ingreso de stock y actualización opcional de costos) → anular (devolución al
  proveedor).
- Proveedores con CUIT validado.
- Etiquetas Code128 en PDF (A4 65 por hoja, 3×8, 2×7, rollo 50×30) y códigos internos para productos sin
  código de fábrica.

#### Etapa 5: ventas, pagos, cuenta corriente, devoluciones y comprobantes

- Punto de venta con pistola siempre activa, cámara, buscador, grilla de más vendidos y carrito persistido;
  atajos `F2` y `F9` en escritorio.
- Cobro con pagos partidos, vuelto, descuento, redondeo a favor del cliente y venta fiada con límite de
  crédito.
- Confirmación de venta en una transacción Serializable: descuenta stock, congela costos, registra pagos,
  actualiza la cuenta corriente y numera el comprobante.
- Clientes con cuenta corriente, saldo deudor y saldo a favor (usable como medio de pago).
- Devoluciones parciales con reintegro en dinero o a la cuenta del cliente; anulación de ventas y de pagos.
- Invariantes de pagos, saldos y devoluciones verificadas por la base al COMMIT.
- Comprobantes en ticket 80 mm y A4 (pdf-lib) con URL inadivinable para enviarlos por WhatsApp. Campos de CAE
  preparados para AFIP (sin integrar).
- Prueba de concurrencia: 10 ventas simultáneas sobre stock 5 confirman exactamente 5.

#### Etapa 6: dashboard, reportes, gastos, caja y alertas

- Permisos `FINANZAS`, `GASTOS` y `CAJA`; los reportes de dinero requieren `FINANZAS`.
- Zona horaria del negocio configurable; rangos de días completos en esa zona.
- `ResumenDiario` por día y depósito, recalculado en cada transacción y reconstruible con
  `pnpm reportes:rebuild`.
- Dashboard con indicadores, gráficos y tarjetas según permisos; un empleado sin reportes ve solo sus ventas.
- Once reportes con salida idéntica en pantalla, PDF y Excel; resumen mensual para compartir por WhatsApp.
- Caja por depósito: apertura, ingresos extra, retiros, movimientos automáticos de efectivo, arqueo con
  contador de billetes, cierre verificado por la base, PDF «Z» y WhatsApp.
- Gastos con categorías, foto del ticket, depósito y recordatorio de recurrentes.
- Alertas diarias (`/api/cron/alertas`): stock bajo y sin stock con sugerencia de reposición, cajas con
  diferencia, transferencias demoradas y deudas viejas; campana y `/notificaciones`.
- Reloj de negocio fijable para el seed demo de 90 días (`pnpm db:seed-demo`).

#### Etapa 7: producción — PWA offline

- Service worker con Serwist: precache del shell, páginas y APIs siempre por red (nunca se guarda HTML
  autenticado), pantalla `/offline` con escáner, caché de imágenes y PDFs, aviso de versión nueva que nunca
  interrumpe una venta.
- Catálogo del escáner en IndexedDB, descargado al iniciar sesión y cada 15 minutos (con respuesta 304 si no
  cambió).
- Cola offline de ingresos, recuentos y transferencias, enviada con Background Sync (y polling en iOS) a
  `POST /api/sync`, idempotente por `idOperacion` (`OperacionSincronizada`). Las rechazadas quedan visibles con
  el motivo para reintentar o descartar.
- Las ventas quedan explícitamente fuera del modo offline.
- Indicador de red con contador de pendientes y rechazadas.
- Aviso propio de instalación (desde el segundo login) con instrucciones para iPhone; ícono de la app
  configurable desde `/configuracion/negocio`.

#### Etapa 7: producción — infraestructura, seguridad y calidad

- Storage intercambiable: disco local en desarrollo, S3 compatible (Cloudflare R2) en producción, con URLs
  firmadas.
- Backups diarios con `pg_dump -Fc` por la conexión directa, verificación con `pg_restore --list`, bucket
  separado, rotación (30 diarios, 12 semanales, 12 mensuales), registro en la tabla `Backup`, alerta si falla o
  no corre en 36 h, descarga desde `/configuracion/backups`, `pnpm backup`, `pnpm restore` y prueba de
  restauración `pnpm test:restore`.
- Exportación completa de los datos del negocio a Excel (`/configuracion/exportar-todo`).
- Auditoría consultable en `/configuracion/auditoria`, incluidos los accesos denegados y las sesiones revocadas.
- Sesiones revocables: `sid` en el JWT validado contra la tabla `Sesion` con caché de 60 s; «Cerrar sesión en
  todos los dispositivos» en `/cuenta` y «Cerrar sus sesiones» en `/usuarios`.
- Hardening: variables de entorno validadas con Zod al arrancar, CSP estricta con nonce por request, headers
  de seguridad (HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP), rechazo
  de mutaciones de otro origen, rate limit general por usuario o IP, rechazo de las 10.000 contraseñas más
  comunes, uploads validados por magic bytes y re-codificados con sharp sin metadatos.
- Observabilidad: logs JSON con pino y `requestId` por request, Sentry opcional (servidor y navegador, con
  datos sensibles limpiados), `/api/health` con estado de base, storage y último backup, métricas p50/p95 de
  operaciones críticas en los logs.
- `pnpm crear-owner` para crear el primer dueño; el seed queda bloqueado en producción salvo `ALLOW_SEED=true`.
- Tests: Vitest (unit e integración con base aislada), E2E con Playwright contra el build de producción en
  escritorio y celular (login, permisos, productos, escáner, ventas, transferencias, caja y offline),
  Lighthouse CI con presupuesto de Performance ≥ 80 y Accessibility ≥ 90.
- CI/CD con GitHub Actions.
- Documentación: README técnico, manual de usuario, modelo de datos y guía de deploy.
