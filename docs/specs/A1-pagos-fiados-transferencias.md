# A1 — Pagos mixtos, fiados (cuenta corriente) e ingreso distribuido / transferencias con pistola

Especificación original del A1 (v2.2.0). El schema y la migración
`prisma/migrations/20261004090000_pagos_fiados_transferencias` ya están hechos
(ver notas al final).

## 2. SERVICIOS

### `venta.service.ts` — `generarVenta` (modificar)

El parámetro `medioPago` se reemplaza por `pagos: [{ medioPago, monto, referencia? }]` (mínimo 1). Reglas, dentro de la misma transacción Serializable:

- `montoPagado = Σ pagos`. Si `montoPagado > total` → `DomainError("Los pagos superan el total")` (el vuelto se calcula en UI y no se persiste).
- Si `montoPagado < total`: es **fiado** → requiere `requirePermiso(FIADOS, "crear")` (si no → `ForbiddenError("No tenés permiso para vender fiado")`); `saldoPendiente = total − montoPagado`; `estadoPago` = PENDIENTE si pagó 0, PARCIAL si pagó algo; lock de la fila del cliente (`FOR UPDATE`) y `saldoDeudor += saldoPendiente`.
- Si `montoPagado = total` → PAGADA.
- Insertar los `PagoVenta`; `medioPago` principal = el de mayor monto (null si fiado total).
- Compatibilidad: `convertirEnVenta` (cotizador) pasa `pagos` igual.

### `fiado.service.ts` (nuevo, con `ctx` y `dbPara`)

- `deudores({ q, page })` → clientes con `saldoDeudor > 0`: nombre, teléfono, saldo, cantidad de ventas pendientes, fecha del fiado más viejo y días de antigüedad.
- `cuentaCorriente(clienteId)` → movimientos ordenados por fecha: ventas fiadas (código, total, pagado en el momento, saldo), cobros (fecha, medio, monto, a qué ventas se imputó), con saldo acumulado; y la lista de ventas PENDIENTE/PARCIAL con su `saldoPendiente`.
- `registrarCobro(clienteId, { monto, medioPago, referencia?, fecha?, ventaIds? })`: `requirePermiso(FIADOS, "editar")`. Transacción: lock cliente; `monto <= saldoDeudor` (si no → `DomainError`); imputa a las ventas pendientes **de la más vieja a la más nueva** (o solo a `ventaIds` si vienen) creando un `PagoVenta` con `esCobroPosterior = true` por cada venta tocada (monto parcial en la última), actualizando `montoPagado`, `saldoPendiente`, `estadoPago` de cada venta y `saldoDeudor` del cliente. AuditLog.
- `anularCobro(pagoId, motivo)`: solo OWNER; revierte venta y cliente.
- `resumenFiados(periodo)` para el dashboard → total por cobrar hoy, fiado en el período, cobrado en el período, cantidad de deudores.
- `anularVenta` (existente) debe anular sus pagos y revertir `saldoDeudor` si estaba fiada.

### `analitica.service.ts` (modificar)

- `ventasPorMedioPago` pasa a sumar `PagoVenta` no anulados por fecha de pago (incluye cobros posteriores).
- `kpis` agrega `cobrado` (Σ pagos del período) y `porCobrar` (saldo deudor total actual). `facturado` sigue siendo Σ total de ventas (lo vendido).

### `producto.service.ts` — `cargarStockPorEscaneo` (ampliar)

Nueva firma: `{ items: [{ varianteId, distribucion: [{ depositoId, cantidad }] }], motivo? }`. Valida que cada `depositoId` sea del panel y esté activo, que cada `cantidad > 0`, y genera un INGRESO_MANUAL por (variante, depósito). La firma vieja (`depositoId` + `items`) se mantiene como caso particular (una sola entrada en `distribucion`). Devuelve resumen por depósito.

### `transferencia.service.ts` (consolidar lo existente)

- `crearYCompletarTransferencia({ depositoOrigenId, depositoDestinoId, items: [{ varianteId, cantidad }], observacion? })`: transacción Serializable → por ítem `transferirStock` (SALIDA en origen + ENTRADA en destino), genera `codigo`, estado COMPLETADA, `completadaAt`; si un ítem no tiene stock en origen, falla entera con el detalle. Genera el **remito PDF** (`generarRemito(id)`): logo del panel, código, fecha, origen → destino, usuario, tabla con **marca, modelo, especificación (pitadas), sabor, cantidad**, total de unidades, observación, y dos líneas de firma (Entrega / Recibe). Guardar en `StorageProvider` y `remitoUrl`.
- Mantener `crearTransferencia` PENDIENTE + `completarTransferencia` para el caso "la mercadería viaja y se confirma al llegar" (ya existe); la UI ofrece ambos: "Mover ahora" (default) o "Registrar envío y confirmar al recibir".
- `listar`, `obtener`, `anular` (solo PENDIENTE).

## 3. UI

### Modal de venta — Paso 4 (rediseñar el paso, mismos pasos 1–3)

- Título "¿Cómo paga?". Tres botones grandes rectangulares Efectivo / Transferencia / Binance: tocar uno = un pago por el total (comportamiento actual).
- Botón secundario **"Dividir pago"**: muestra filas _medio + monto + referencia (opcional)_; la primera fila toma el medio elegido y el total; al escribir un monto menor, la segunda fila aparece con el **restante precargado**; máximo 3 filas (un medio por fila, sin repetir). Debajo, línea de control: "Pagado $X de $Y" con el vuelto si efectivo > restante.
- Si el usuario tiene permiso FIADOS crear: switch **"Fiar el resto"** que aparece cuando lo pagado es menor al total; al activarlo, el resumen muestra "Queda pendiente $Z" en un banner gris con ícono y el nombre del cliente. Sin el permiso, si lo pagado < total el botón Confirmar queda deshabilitado con el mensaje "El pago no cubre el total".
- Pantalla de éxito: agrega "Pagado $X · Pendiente $Z" cuando corresponde.

### Módulo Fiados (`/p/[slug]/fiados`)

Permiso FIADOS ver. `StatCard`s: Por cobrar total, Deudores, Fiado este mes, Cobrado este mes. Tabla/cards de deudores (nombre, teléfono con WhatsApp, saldo en negrita, ventas pendientes, antigüedad con badge ámbar apagado si > 30 días). Ficha `/fiados/[clienteId]`: cuenta corriente (tabla con saldo acumulado), ventas pendientes con su saldo, botón primario **"Registrar cobro"** → Sheet: monto (precargado con el saldo total), medio de pago (los tres botones), referencia, fecha, y "imputar a" (default: de la más vieja a la más nueva; opción de elegir ventas). Después del cobro, botón "Enviar recibo por WhatsApp" (texto con lo cobrado y el saldo restante). En la ficha de Cliente y en el detalle de Venta, mostrar estado de pago y link a la cuenta corriente. Navegación: Fiados en "Más" / grupo Operación.

### Dashboard

KPIs agregan **Cobrado** y **Por cobrar** (OWNER y FIADOS ver); "Facturado" mantiene su definición con tooltip "Total vendido, incluye fiados". Donut de medios de pago sobre pagos reales.

### Carga de stock — Paso "Distribuir" (nuevo, entre escaneo y confirmar)

- El paso 1 (galpón) se mantiene y pasa a llamarse **"Galpón de ingreso"**: sigue siendo obligatorio y es a donde va todo por default.
- Después de escanear, al tocar "Continuar", aparece **"Distribuir entre galpones"**: tabla con una fila por sabor escaneado: producto — sabor, cantidad escaneada, y una columna por depósito del panel con input numérico (default: todo en el galpón de ingreso, el resto 0). Validación en vivo por fila: la suma debe igualar lo escaneado (si no, la fila se marca y no deja confirmar). Botones rápidos: "Todo a {galpón}" por columna, y "Repartir 50/50". En mobile, una tarjeta por sabor con los inputs de cada galpón apilados y el total de control.
- Confirmar → `cargarStockPorEscaneo` con la distribución → éxito con el resumen por galpón ("150 a Ayres Plaza · 50 a Mercedes").

### Transferencias con pistola (`/p/[slug]/stock/transferencias`)

- Listado (código, fecha, origen → destino, unidades, estado, usuario, remito) y botón primario **"Nueva transferencia"**.
- Flujo con `Stepper`: (1) **Origen y destino** con las tarjetas de galpón (dos selecciones; no pueden ser iguales), (2) **Productos**: escáner activo + cámara + buscador; cada escaneo suma 1 y muestra el stock disponible en origen; cantidad editable; filas sin stock suficiente en rojo apagado, (3) **Confirmar**: resumen con **marca, modelo, especificación, sabor y cantidad** por fila y total de unidades, observación opcional, y dos botones: **"Mover ahora"** (primario) o "Registrar envío, confirmar al recibir" (secundario). Éxito: código, resumen, botones "Ver remito (PDF)", "WhatsApp" y "Nueva transferencia".
- En la tab de cada galpón en Stock y en Global, la acción "Transferir" de la fila abre este mismo flujo con el sabor precargado.
- Detalle de transferencia con remito, movimientos generados y "Confirmar recepción" si está PENDIENTE.

## 4. VERIFICACIÓN (lo que hay que poder mostrar)

1. Venta $30.000: Efectivo $20.000 + Transferencia $10.000 → 2 `PagoVenta`, PAGADA, `medioPago` principal EFECTIVO; el donut del dashboard suma 20k y 10k por separado. Intentar pagos por $35.000 → `DomainError`.
2. Venta $30.000 fiada con $10.000 en efectivo por Juan Cruz → PARCIAL, `saldoPendiente` 20.000, `cliente.saldoDeudor` 20.000; `/fiados` lo lista con antigüedad; registrar cobro de $20.000 por Binance → PAGADA, saldo 0, `PagoVenta` con `esCobroPosterior`. Cobro mayor al saldo → error. Anular la venta fiada → pagos anulados y `saldoDeudor` revertido.
3. Cobro de $25.000 a un cliente con dos ventas pendientes (15.000 y 20.000) → la primera queda PAGADA y la segunda PARCIAL con saldo 10.000.
4. Trinidad: puede dividir pagos; no ve "Fiar el resto"; forzar `generarVenta` con pagos < total → `ForbiddenError`; no ve `/fiados`.
5. Carga de 200 unidades (varios sabores) escaneadas con galpón de ingreso Ayres Plaza → paso Distribuir: 150 Ayres Plaza / 50 Mercedes → INGRESO_MANUAL por (sabor, depósito), Global muestra 150 | 50 | 200. Fila con suma distinta a lo escaneado → bloqueada.
6. Transferencia con pistola: 20 unidades Ayres Plaza → Mercedes, "Mover ahora" → SALIDA + ENTRADA por sabor, código `VAP-T-000001`, remito PDF con marca/modelo/pitadas/sabor/cantidad y firmas; Global no cambia el total. Intentar 500 → falla entera.
7. Migración de datos: todas las ventas viejas tienen su `PagoVenta` y `estadoPago = PAGADA`; `Σ montoPagado + saldoPendiente = Σ total`.
8. Concurrencia: 10 cobros simultáneos de $1.000 a un cliente con saldo $5.000 → exactamente 5 pasan.

## 5. REGLAS DE TRABAJO

- `saldoDeudor`, `montoPagado`, `saldoPendiente` y `Stock` solo cambian dentro de la transacción que los justifica; totales siempre en servidor.
- Toda escritura de stock por `registrarMovimiento`/`transferirStock`; todo con `dbPara(ctx.panelId)` y `requirePermiso`.
- Diseño según `docs/DISENO.md`, sin colores nuevos (el segundo color de marca es naranja, solo en gráficos). Migraciones nuevas; sin TODOs.

## Notas de implementación del schema (ya aplicado)

- `PagoVenta.cobroId` (opcional) agrupa los PagoVenta de un mismo cobro imputado a varias ventas.
- Venta ANULADA: sus pagos quedan anulados y `montoPagado = 0`, `saldoPendiente = 0` (lo exige un trigger diferido).
- Triggers diferidos (al COMMIT): venta confirmada → `montoPagado = Σ pagos no anulados`; cliente → `saldoDeudor = Σ saldoPendiente` de sus ventas confirmadas; CHECK de `estadoPago` coherente con los montos. PagoVenta inmutable salvo anulación (una sola vez).
- `Transferencia.notas` pasó a `observacion`; se agregó `codigo` (VAP-T-000001, secuencia TRANSFERENCIA existente) y `remitoUrl`. `TransferenciaItem.productoId` obligatorio (trigger de coherencia con la variante).
