# Changelog

Todos los cambios importantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/).

## [2.2.0] - 2026-09-30 — Pagos mixtos, fiados, ingreso distribuido y transferencias con pistola

### Agregado

- **Pagos mixtos**: una venta se cobra con hasta tres medios (efectivo, transferencia, Binance) con
  referencia opcional; el vuelto se calcula en pantalla. Cada pago queda en `PagoVenta` (inmutable, solo
  se anula) y la venta guarda `estadoPago`, `montoPagado` y `saldoPendiente`.
- **Fiados (cuenta corriente)**: con el permiso nuevo FIADOS se puede «Fiar el resto». `/p/{slug}/fiados`
  lista deudores con antigüedad; la ficha muestra la cuenta corriente con saldo acumulado y registra
  cobros imputados de la venta más vieja a la más nueva (o a las elegidas), con recibo por WhatsApp.
  Anular una venta fiada anula sus pagos y revierte el saldo del cliente.
- **Dashboard**: KPIs Cobrado y Por cobrar; el donut de medios de pago mide lo cobrado por fecha de pago.
- **Carga de stock con paso «Distribuir entre galpones»**: lo escaneado se reparte por galpón antes de
  confirmar (un ingreso por sabor y galpón).
- **Transferencias con pistola** en `/p/{slug}/stock/transferencias`: origen y destino, escaneo con stock
  disponible, «Mover ahora» o «Registrar envío, confirmar al recibir», código `VAP-T-000001` y **remito
  PDF** con marca, modelo, especificación, sabor, cantidad y firmas.
- Verificaciones `pnpm test:fiados` y `pnpm test:transferencias`.

### Cambiado

- Favicon nuevo (osito en el aro), transparente y sin margen.
- La base verifica al cerrar cada transacción que lo pagado coincida con los pagos y que la deuda del
  cliente coincida con sus ventas pendientes.

### Corregido

- CI: tipos de imágenes versionados (`next-env.d.ts` no se sube), formato y prueba de restauración sin
  depender de un contenedor con nombre.
- Barras de acción fijas en celular sin margen lateral.

## [2.1.0] - 2026-09-29 — Rediseño

Sistema de diseño aplicado a todas las pantallas (ver `docs/DISENO.md`), assets de marca y PWA.

### Cambiado

- **Sin datos de ejemplo.** `prisma/seed.ts` crea solo la estructura: paneles (con su logo), depósitos,
  secuencias, configuración por defecto y los usuarios Juan Cruz, Agustina y Trinidad. Ya no siembra
  catálogo, proveedores, clientes ni escalones; los tests que los necesitan los crean en `e2e/fixtures/`.

### Eliminado

- El seed demo (`prisma/seed-demo.ts`, `pnpm db:seed-demo` y `scripts/db-descartable.sh … --demo`).

### Agregado

- `pnpm db:limpiar-negocio`: vacía los datos de negocio de todos los paneles y reinicia la numeración,
  preservando paneles, depósitos, usuarios, accesos, sesiones y configuración (confirmación escribiendo
  `LIMPIAR`; fuera de localhost o con `NODE_ENV=production`, solo con `--force`).

## [2.0.0] - 2026-10-02 — Reforma multipanel

La app pasa de un sistema único a **varios sistemas independientes** (paneles: Vapes, Cosmetic, Especiales y
los que se agreguen), más simple de usar y con foco en lo que el negocio hace todos los días: cargar stock con
la pistola, vender, cambiar por garantía, cotizar y mirar cómo va. Se publicó en cinco etapas (R1 a R5), que
se despliegan juntas como 2.0.0 (pasos en `docs/DEPLOY.md`, «Deploy de la v2»).

Resumen:

- **R1 — Multipanel, limpieza y rediseño**: cada panel tiene su catálogo, stock, galpones, ventas, compras,
  clientes, proveedores, configuración y numeración (`VAP-000001`); rutas `/p/{slug}/…`, permisos por panel y
  aislamiento en la aplicación, la base y el lint. Se eliminan caja, gastos, cuenta corriente, pagos
  partidos, comprobantes, notificaciones, cola offline y los reportes anteriores. Rediseño visual con el
  color de acento de cada panel.
- **R2 — Catálogo, proveedores y compras**: producto = marca + modelo + especificación con un precio para
  todos sus sabores; carga de stock escaneando con galpón obligatorio y alta rápida de códigos
  desconocidos; proveedores con lista de precios (ARS o USD); compras por sabor con costo sugerido.
- **R3 — Ventas, clientes y garantías**: venta en un modal guiado (galpón → productos → cliente → pago) con
  cliente, galpón y un medio de pago obligatorios; clientes por teléfono único; devoluciones por garantía
  que entregan una unidad nueva; stock por galpón y global.
- **R4 — Cotizador**: cotizaciones por unidad y por mayor con escalones por producto o por defecto, PDF,
  WhatsApp y conversión en venta.
- **R5 — Dashboard, equipo, reportes y cierre**: dashboard con períodos y comparación, rendimiento del
  equipo con comisión orientativa, reportes exportables, comparador de proveedores con historial de precios,
  seed demo de los tres paneles, flujo E2E completo, limpieza final y documentación.

### BREAKING

- Las migraciones de la reforma (`20260928160000_reforma_multipanel` a
  `20261003090000_limpieza_configuracion`) **borran tablas, columnas y datos** y no son compatibles hacia
  atrás: hacer y descargar un backup antes de migrar. Todo lo existente pasa al panel Vapes.
- Rutas nuevas (`/p/{slug}/…`), IDs visibles por panel, permisos por panel y venta con un único medio de pago
  (ver el detalle de R1 y R3).

### R5 — Dashboard, equipo, reportes y cierre (2026-10-02)

Migraciones `20261002090000_analitica_reportes` (historial de precios de proveedor, comisiones orientativas,
`Panel.etiquetaUnidades`, índices de analítica) y `20261003090000_limpieza_configuracion` (solo datos).

#### Added

- **Dashboard** (`/p/{slug}`): selector de período Diario / Semanal (lunes a domingo) / Mensual /
  Período (con atajos), guardado en la URL y comparado con el período anterior equivalente; KPIs de
  facturado, ganancia (dueños), unidades con la etiqueta del panel («Vapes vendidos»), clientes nuevos,
  ventas y ticket promedio; gráfico comparativo, medios de pago, unitaria vs. mayorista, galpones, compras
  vs. ventas (dueños), top de productos y sabores, alertas de stock y pendientes. Cada tarjeta carga por su
  cuenta. Todo se agrega en PostgreSQL (`analitica.service.ts`).
- **Rendimiento del equipo** (dueños): por vendedor, ventas unitarias y mayoristas, unidades, cotizaciones
  convertidas, clientes nuevos, ticket y **comisión estimada**; detalle por vendedor en
  `/p/{slug}/equipo/{usuarioId}` con exportación. Un empleado con Dashboard ve «Mi rendimiento».
- **Comisión orientativa** por usuario (`Usuario.comisionUnitariaPct` / `comisionMayoristaPct`), editable en
  `/usuarios/{id}`.
- **Reportes** (`/p/{slug}/reportes`): rendimiento de la empresa y por vendedor, ventas, stock por galpón y
  sabor, movimientos, compras y precios de proveedores, clientes y devoluciones, con filtros, gráfico y
  exportación a PDF y Excel (los de dueños no se muestran ni se exportan para empleados).
- **Comparador de proveedores** (`/p/{slug}/reportes/comparador`, dueños): del más barato al más caro con
  ahorro por unidad y última compra, productos con varios proveedores, vista matriz por marca y
  **cotización del dólar** por panel (`cotizacionUsd`) para comparar precios en USD.
- **Historial de precios de proveedor** (`ProveedorProductoHistorial`, lo escribe un trigger).
- **Seed demo de los tres paneles** (`pnpm db:seed-demo`, o `scripts/db-descartable.sh <base> --demo`): 90
  días simulados con los servicios reales; en Vapes 15 productos de 5 marcas, 3 proveedores con precios
  distintos (uno en USD) y cambios de precio, 20 compras recibidas, 300 ventas de Juan Cruz, Agustina y
  Trinidad (unitarias y mayoristas, algunas desde cotizaciones), 80 clientes, 12 garantías y 20
  cotizaciones en todos los estados; Cosmetic y Especiales en chico. Corre en menos de un minuto.
- E2E `20-dashboard` y `22-flujo-completo` (login de cada usuario, carga de stock con galpón, venta con
  cliente nuevo, garantía, cotización mayorista convertida, dashboard, Cosmetic, aislamiento entre paneles y
  Trinidad sin costos ni otros sistemas). Script `pnpm test:cotizador`.
- Documentación reescrita para la arquitectura multipanel: README, `docs/MODELO-DATOS.md` (mapa Mermaid con
  el panel al centro y DBML de R5), `docs/MANUAL-USUARIO.md` (flujos reales paso a paso) y
  `docs/DEPLOY.md` («Deploy de la v2» paso a paso).

#### Changed

- El dashboard anterior (`dashboard.service.ts`) se reemplaza por `analitica.service.ts`.
- Versión del paquete: 2.0.0.

#### Removed

- Código muerto de versiones anteriores: `sort-header`, `modulo-proximamente` (ya no queda ningún módulo «Próximamente»), `totalComprado`, `PERIODOS_DASHBOARD`, resumen y alertas de stock duplicados en
  `inventario.service`, planilla de recuento, costo promedio ponderado, validaciones de CUIT y email
  opcional, textos y comentarios de caja, gastos y comprobantes.
- Dependencias sin uso: `fake-indexeddb` y `@types/bcryptjs` (bcryptjs 3 trae sus tipos).
- Claves de configuración viejas: `ConfiguracionGlobal.moneda` y los campos de `ventas` que no son
  `redondeoVentas` (migración `20261003090000_limpieza_configuracion`).

### R4 — Cotizador unitario y mayorista (2026-10-01)

**Reforma R4: cotizador unitario y mayorista.** Migración `20261001090000_cotizador` (escalones de precio,
cotizaciones y `Venta.cotizacionId`).

#### Added

- **Cotizador** (`/p/{slug}/cotizador`): accesos «Cotizar por unidad» / «Cotizar por mayor» y listado con
  pestañas Todas | Unitarias | Mayoristas, filtros por estado, vendedor, fechas y búsqueda por código
  (`VAP-Q-000001`) o cliente, y acciones ver, duplicar, WhatsApp, PDF y convertir.
- Armado en una sola pantalla (`/cotizador/unitaria/nueva`, `/cotizador/mayorista/nueva`, edición en
  `/cotizador/{id}/editar`): cliente opcional (registrado o nombre y teléfono), validez, pistola, cámara,
  buscador y más vendidos; precios siempre calculados por el servidor; stock total informativo con «Sin stock»;
  precio manual y descuento solo con «editar»; pie fijo con total y Guardar / WhatsApp / PDF / Convertir.
- Mayorista: escalón por producto o por total, lista tachada y precio del escalón, chip «Escalón desde N u.»,
  hint «Agregá N más y baja a $X c/u», resumen de escalones y «Ver tabla de precios».
- Detalle `/cotizador/{id}`: estados Enviada / Aceptada / Rechazada, duplicar, WhatsApp, PDF y **Convertir en
  venta**: abre el modal de Ventas con ítems, precios y cliente bloqueados (solo galpón y medio de pago); si
  está vencida muestra qué precios cambian y vende a los de hoy.
- Configuración del cotizador (dueños): escalones por defecto en %, validez, modo de escalón, leyenda del PDF
  y stock visible. Ficha de producto: sección «Precios mayoristas» (dueños o «editar» en Productos).
- E2E `19-cotizador.spec.ts`.

#### Changed

- Navegación: «Cotizar por unidad», «Cotizar por mayor» y «Cotizaciones» reemplazan a las páginas
  «Próximamente» `cotizador-unitario` / `cotizador-mayorista`.

### R3 — Ventas, clientes, devoluciones por garantía y stock por galpón (2026-09-30)

**Reforma R3: ventas con cliente obligatorio, clientes por teléfono, devoluciones por garantía y stock por
galpón.** La migración `20260930090000_ventas_clientes_devoluciones` borra los borradores de venta, pasa los
medios de pago viejos a transferencia, suma el redondeo al descuento, junta apellido/documento/email/dirección
de los clientes en nombre y notas (teléfono provisorio a quien no tenía) y asigna «Cliente sin datos» a las
ventas sin cliente: hacer y descargar un backup antes de migrar.

#### Added

- **Stock por galpón y global** (`/p/{slug}/stock`): pestañas por galpón + «Global» con el estado en la URL.
  Por galpón: unidades y bajo mínimo, tabla/cards por sabor, **Transferir a {otro galpón}** (se crea y se
  completa en el acto, `transferirAhora()`) y **Ajustar**, y «Movimientos de {galpón}» filtrables por tipo y
  fechas. Global: total, tarjeta por galpón, columnas dinámicas por galpón + Total, vista por producto,
  movimientos de todos los galpones y exportar CSV (dueños).
- Lecturas en `stock.service.ts`: `stockPorDeposito`, `stockGlobal`, `movimientos` (referencia con código
  visible y link a venta, compra, devolución o transferencia) y `resumenStock`.
- Tipos de movimiento `GARANTIA`, `GARANTIA_ANULADA` y `VENTA_ANULADA` (etiqueta y signo en
  `TIPO_MOVIMIENTO_UI`, igual al motor y a `fn_signo_movimiento()`).
- Dashboard: cobrado por medio de pago y últimas ventas con código, cliente, medio y vendedor.
- Exportar todo: ventas con código, tipo, medio, cliente, vendedor y descuento; ítems con precio de lista,
  cobrado y especial; clientes con nombre, teléfono y notas; hojas de devoluciones y sus ítems.
- Seed: clientes con teléfono; seed demo con `generarVenta` (clientes nuevos en la venta, mayoristas, precio
  especial, descuento), `registrarDevolucion` y una devolución anulada.
- Tests: signos de los tipos nuevos, `VentaItem_subtotal_chk`, código de venta único, observación ≥ 10,
  cliente con teléfono obligatorio, lecturas de stock y transferencia en el acto; E2E `18-stock`.

#### Changed

- Navegación: bottom bar Inicio · Ventas · Productos · Stock · Más; sidebar Operación (Ventas, Stock,
  Productos, Devoluciones, Clientes) / Compras (Proveedores, Compras) / Análisis (cotizadores, Reportes) /
  Administración.
- E2E de transferencia y de modo sin conexión adaptados (fila del stock y `/offline`).

#### Removed

- Hub `/p/{slug}/escanear`: el escáner vive dentro de cada flujo (venta, carga de stock, compras,
  devoluciones, etiquetas). `/offline` sigue para consultar sin señal.
- Pantallas viejas de Stock: ingreso manual, ajuste/recuento y «Nueva transferencia» (se transfiere desde la
  fila).

### R2 — Catálogo, proveedores con precios y compras por sabor (2026-09-29)

**Reforma R2: catálogo simplificado, proveedores con precios y compras por sabor.** Un producto pasa a ser
marca + modelo + especificación con un precio para todos sus sabores; el stock se carga escaneando en un
galpón elegido a propósito; cada proveedor tiene su lista de precios y las compras sugieren el costo.

La migración `20260929090000_catalogo_proveedores_compras` convierte los datos existentes y borra columnas
(`Producto.descripcion`, `Producto.tieneVariantes`, `Proveedor.cuit`, `Proveedor.email`,
`Proveedor.direccion`): hacer y descargar un backup antes de migrar.

#### Added

- **Carga de stock escaneando** en `/p/{slug}/productos/cargar` (desde Productos, Escanear o la ficha del
  producto; permiso crear en Productos o en Stock): paso 1, el galpón (obligatorio, con el último usado
  preseleccionado pero sin confirmarse solo; `SelectorGalpon`); paso 2, escaneo con pistola, cámara o
  búsqueda manual (un código existente suma +1; uno desconocido abre el alta rápida); lista guardada en el
  dispositivo con «Retomar» / «Descartar»; confirmación «Cargar N unidades en {galpón}», todo en una
  transacción, con un `INGRESO_MANUAL` por sabor y el stock resultante por galpón.
- `cargarStockPorEscaneo()` rechaza una carga sin depósito activo (`SIN_GALPON`) también a nivel servicio.
- **Alta rápida** (`AltaRapidaSheet`) para códigos desconocidos en la carga de stock, en Compras y en
  Escanear: marca con autocompletar (se crea si no existe), modelo, especificación con la etiqueta del panel,
  sabor y precio. Si marca + modelo + especificación ya existe, le agrega el sabor (o el código al sabor
  existente) en vez de duplicar el producto.
- **Precios por proveedor** (`ProveedorProducto`, enum `Moneda` `ARS`/`USD`): un precio por proveedor y
  producto, editable desde la ficha del proveedor («Agregar producto que vende»), con fecha y usuario de la
  última actualización.
- Ficha del producto: **«Proveedores que lo venden»**, del más barato al más caro, con la marca «Más barato»
  (dueños y quien ve Compras).
- Compras: **costo sugerido** por sabor (precio en pesos del proveedor → último costo del sabor), escáner y
  alta rápida en la carga, y al **«Recibir mercadería»** el Dialog de precios que cambian («de $X a $Y») para
  actualizar o no el precio del proveedor.
- ID de compra visible **`VAP-C-000001`** (`formatearIdCompra`).
- Proveedores: tarjetas con WhatsApp y acordeón de productos, búsqueda por nombre, tienda o producto, y
  «Nueva compra a este proveedor».
- `src/lib/precios.ts` (`precioVentaEfectivo`, `tienePrecioPropio`, `costoParaVenta`), con tests unitarios.
- Triggers `trg_producto_derivados` (calcula `nombreCompleto` y `especificacionNorm`), `trg_marca_renombrada`
  (renombrar una marca actualiza el nombre de sus productos) y `trg_compra_item_producto`
  (`CompraItem.productoId` = producto de la variante).
- Seed: catálogo de Vapes con marca + modelo + pitadas, un sabor con precio propio y dos proveedores con su
  lista de precios (uno en dólares).
- Exportar todo: hoja «Precios de proveedores».
- E2E de carga de stock, proveedores, compras y catálogo de la empleada (sin costos, sin carga de stock ni
  Compras); `test:catalogo`, `test:compras` y `test:ventas` reescritos para el modelo actual.

#### Changed

- **Producto = marca (obligatoria) + modelo + especificación** (la etiqueta del panel: «Pitadas» en Vapes).
  `nombreCompleto` («Elf Bar BC 5000») y `especificacionNorm` los mantiene la base; la marca «Sin marca» no
  aparece en el nombre. Unicidad por (panel, marca, modelo, especificación normalizada). Categoría opcional.
  Búsqueda trigram sobre `nombreCompleto`.
- **Precio de venta único por producto** para todos sus sabores; `Variante.precioVenta` pasa a ser un precio
  propio opcional (`null` = el del producto). La UI habla de **sabores** en lugar de variantes.
- `Variante.precioCosto` pasa a ser **`ultimoCosto`** (opcional): lo actualiza recibir una compra, no se carga
  a mano, y cada venta guarda un snapshot en `VentaItem.costoUnitario` (0 si el sabor no tuvo compras).
- **Proveedores**: nombre (contacto), nombre de la tienda (obligatorio), teléfono normalizado `+54` y único por
  panel, notas.
- **Compras**: proveedor y galpón obligatorios (en tres pasos: proveedor, galpón, ítems), ítems por sabor con
  `productoId` desnormalizado, recibir actualiza el último costo de cada sabor. Costos y totales solo para
  dueños o quien tiene `ver` en Compras.
- Escanear: el modo «Ingresar» pasa a ser **«Cargar stock»** y lleva a `/productos/cargar`; «Consultar»
  muestra el sabor y, a los dueños, el último costo. Un código desconocido ofrece asociarlo a un sabor
  existente o darlo de alta con el alta rápida sin salir de la pantalla.
- Vistas `vw_stock_consolidado` y `vw_alertas_stock` con el nombre completo del producto.
- Migración de datos: productos sin marca → marca «Sin marca» de su panel; el modelo pierde el prefijo repetido
  de la marca («Elf Bar BC5000» → «BC5000»); precio del producto = el precio de sabor más frecuente (empate:
  el mayor) y los sabores con ese precio quedan sin precio propio; `precioCosto` → `ultimoCosto`; proveedores:
  el nombre también pasa a nombre de la tienda, CUIT, email y dirección pasan a las notas y los teléfonos se
  normalizan (los repetidos también van a las notas); precios de proveedor iniciales = último costo pagado en
  compras recibidas.

#### Removed

- `Producto.descripcion` y `Producto.tieneVariantes` (la regla «sin variantes = exactamente una Único»:
  ahora todo producto tiene al menos un sabor).
- `Proveedor.cuit`, `Proveedor.email` y `Proveedor.direccion` (y el índice único de CUIT).
- El ingreso por escaneo dentro de Escanear y su «Registrar como compra»: la carga va por
  `/productos/cargar` y las compras por Compras.
- La matriz de stock y el listado de variantes de la ficha del producto, reemplazados por la tabla de sabores.

### R1 — Multipanel, limpieza y rediseño (2026-09-28)

**Reforma R1: multipanel, limpieza y rediseño.** La app pasa a ser un conjunto de sistemas independientes
(paneles) y se simplifica: se eliminan los módulos de dinero (caja, gastos, cuenta corriente, pagos
partidos, comprobantes) y los reportes anteriores.

#### BREAKING

- La migración `20260928160000_reforma_multipanel` **borra tablas y columnas** y no es compatible hacia
  atrás: el código 1.x no funciona contra una base migrada y lo eliminado solo se recupera desde un backup.
  Hacer y descargar un backup antes de migrar (ver `docs/DEPLOY.md`, «Migraciones de la reforma»).
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

#### Added

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

#### Changed

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

#### Removed

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
