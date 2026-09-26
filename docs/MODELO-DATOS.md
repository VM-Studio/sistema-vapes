# Modelo de datos

Base PostgreSQL 16 manejada con Prisma 6. La fuente de verdad es `prisma/schema.prisma`; las reglas que Prisma no sabe expresar (CHECKs, índices únicos parciales, triggers, vistas) viven en las migraciones SQL de `prisma/migrations/`.

Convenciones generales:

- **IDs**: `cuid()` en texto. Los documentos que ve el usuario (ventas, compras, transferencias, devoluciones) tienen además un `numero` autoincremental.
- **Dinero**: `Decimal(12,2)` (los agregados de `ResumenDiario`, `Decimal(14,2)`). **Cantidades**: enteros.
- **Fechas**: `timestamp` en UTC sin zona. Los rangos de días se calculan en la zona horaria del negocio (`Configuracion.timezone`, por defecto `America/Argentina/Buenos_Aires`).
- **Nada se borra físicamente** en las tablas de negocio: los maestros usan soft delete (`deletedAt`) o `activo = false`, y los documentos confirmados se **anulan**.
- **Cachés verificados**: `Stock`, `Cliente.saldoDeudor`, `Venta.montoPagado` y `VentaItem.cantidadDevuelta` son derivados; la base verifica al COMMIT que coincidan con su fuente.

## Diagrama (DBML)

Se puede pegar en [dbdiagram.io](https://dbdiagram.io) para verlo como diagrama. Generado a partir de `prisma/schema.prisma`: las relaciones inversas de Prisma (listas) no aparecen porque están implícitas en los `Ref`.

```dbml
// Generado a partir de prisma/schema.prisma

Enum RolUsuario {
  OWNER
  EMPLEADO
}

Enum Modulo {
  DASHBOARD
  PRODUCTOS
  INVENTARIO
  MOVIMIENTOS
  VENTAS
  COMPRAS
  CLIENTES
  PROVEEDORES
  REPORTES
  USUARIOS
  CONFIGURACION
  FINANZAS [note: 'Costos, ganancias, valorización (se suma a REPORTES / DASHBOARD).']
  GASTOS
  CAJA
}

Enum TipoMovimiento {
  INGRESO_COMPRA
  INGRESO_MANUAL
  VENTA
  DEVOLUCION_CLIENTE
  DEVOLUCION_PROVEEDOR
  AJUSTE_POSITIVO
  AJUSTE_NEGATIVO
  TRANSFERENCIA_SALIDA
  TRANSFERENCIA_ENTRADA
}

Enum EstadoVenta {
  BORRADOR
  CONFIRMADA
  ANULADA
}

Enum EstadoCompra {
  BORRADOR
  RECIBIDA
  ANULADA
}

Enum EstadoTransferencia {
  PENDIENTE
  COMPLETADA
  ANULADA
}

Enum MedioPago {
  EFECTIVO
  TRANSFERENCIA
  DEBITO
  CREDITO
  MERCADOPAGO
  OTRO
  CREDITO_CLIENTE [note: 'Saldo a favor del cliente (devoluciones acreditadas a su cuenta).']
}

Enum EstadoPago {
  PAGADA
  PARCIAL
  PENDIENTE
}

Enum EstadoComprobante {
  EMITIDO
  ANULADO
}

Enum TipoComprobante {
  TICKET
  FACTURA_A
  FACTURA_B
  FACTURA_C
  PRESUPUESTO
}

Enum EstadoCaja {
  ABIERTA
  CERRADA
}

Enum TipoMovimientoCaja {
  APERTURA [note: 'Signo del monto: APERTURA ≥ 0, VENTA/PAGO_CLIENTE/INGRESO_EXTRA > 0, DEVOLUCION/GASTO/RETIRO < 0, CIERRE ≤ 0 (= −montoContado). CHECK en DB.']
  VENTA
  PAGO_CLIENTE
  DEVOLUCION
  GASTO
  RETIRO
  INGRESO_EXTRA
  CIERRE
}

Enum TipoNotificacion {
  STOCK_BAJO
  SIN_STOCK
  CAJA_DIFERENCIA
  TRANSFERENCIA_PENDIENTE
  DEUDA_CLIENTE
  BACKUP_FALLIDO [note: 'El backup diario falló o no corrió en 36 h.']
}

Enum AccionAuditoria {
  CREATE
  UPDATE
  DELETE
  LOGIN
  LOGOUT
  PERMISO_CAMBIADO
  ACCESO_DENEGADO [note: 'Intento de hacer algo sin permiso (Forbidden).']
  SESION_REVOCADA
}

Enum EstadoOperacionSync {
  PROCESANDO
  APLICADA
  RECHAZADA
}

Table Usuario {
  id text [pk, default: `cuid()`]
  nombre text [not null]
  email text [unique, not null, note: 'Siempre en minúsculas (CHECK en DB + toLowerCase() en Zod).']
  passwordHash text [not null]
  rol RolUsuario [not null]
  activo boolean [not null, default: true]
  debeCambiarPassword boolean [not null, default: false, note: 'true => al iniciar sesión se lo obliga a ir a /cuenta a cambiarla.']
  ultimoLogin timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp
}

Table Sesion {
  id text [pk, default: `cuid()`]
  usuarioId text [not null]
  tokenHash text [not null, note: 'sha256 del secreto aleatorio que viaja en el JWT (`tok`): un sid solo no alcanza.']
  userAgent text
  ip text
  createdAt timestamp [not null, default: `now()`]
  ultimoUso timestamp [not null, default: `now()`]
  expiraAt timestamp [not null]
  revocadaAt timestamp
  revocadaPorId text

  indexes {
    (usuarioId, revocadaAt)
    expiraAt
  }

  Note: 'Sesión de login (el JWT lleva su id como `sid`). Revocarla corta el acceso en el próximo request (el middleware la consulta con caché de 60 s).'
}

Table OperacionSincronizada {
  id text [pk, default: `cuid()`]
  idOperacion text [unique, not null]
  tipo text [not null, note: '"INGRESO" | "RECUENTO" | "TRANSFERENCIA"']
  usuarioId text [not null]
  estado EstadoOperacionSync [not null]
  payload jsonb [not null]
  resultado jsonb
  motivo text
  creadaEnCliente timestamp [not null, note: 'Cuándo se hizo en el celular (sin red).']
  createdAt timestamp [not null, default: `now()`]
  procesadaAt timestamp

  indexes {
    (usuarioId, estado)
  }

  Note: 'Operaciones hechas sin conexión (escáner) y sincronizadas después. El `idOperacion` (UUID del cliente) es único: reenviarla devuelve el resultado guardado sin repetir movimientos.'
}

Table Backup {
  id text [pk, default: `cuid()`]
  archivo text [not null, note: 'Clave en el bucket de backups (backups/backup-YYYY-MM-DD-HHmm.dump).']
  tamanio bigint
  duracionMs int [not null]
  ok boolean [not null]
  error text
  origen text [not null, default: 'cron', note: '"cron" | "manual" | "release"']
  createdAt timestamp [not null, default: `now()`]

  indexes {
    createdAt
  }

  Note: 'Registro de cada backup (pg_dump) y su verificación.'
}

Table RateLimit {
  clave text [not null]
  ventana timestamp [not null]
  contador int [not null, default: 0]

  indexes {
    (clave, ventana) [pk]
    ventana
  }

  Note: 'Rate limit con ventana deslizante aproximada (ventanas de 1 minuto).'
}

Table IntentoLogin {
  id text [pk, default: `cuid()`]
  email text [not null, note: 'Normalizado (trim + minúsculas). No es FK: se registran emails inexistentes.']
  ip text
  exitoso boolean [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (email, createdAt)
    (ip, createdAt)
  }

  Note: 'Registro de intentos de login para rate limit (persistente: sobrevive a redeploys y funciona con múltiples instancias, a diferencia de memoria).'
}

Table PermisoUsuario {
  id text [pk, default: `cuid()`]
  usuarioId text [not null]
  modulo Modulo [not null]
  puedeVer boolean [not null, default: false]
  puedeCrear boolean [not null, default: false]
  puedeEditar boolean [not null, default: false]
  puedeEliminar boolean [not null, default: false]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (usuarioId, modulo) [unique]
  }

  Note: 'Los OWNER tienen acceso total por rol y no necesitan filas acá.'
}

Table Deposito {
  id text [pk, default: `cuid()`]
  nombre text [unique, not null]
  direccion text
  activo boolean [not null, default: true]
  esPrincipal boolean [not null, default: false, note: 'Solo un depósito puede ser principal (índice único parcial en SQL).']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
}

Table Categoria {
  id text [pk, default: `cuid()`]
  nombre text [unique, not null]
  descripcion text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
}

Table Marca {
  id text [pk, default: `cuid()`]
  nombre text [unique, not null]
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
}

Table Proveedor {
  id text [pk, default: `cuid()`]
  nombre text [not null]
  cuit text [note: 'Único entre proveedores no borrados (índice único parcial en SQL).']
  telefono text
  email text
  direccion text
  notas text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp
}

Table Cliente {
  id text [pk, default: `cuid()`]
  nombre text [not null]
  apellido text
  documento text [note: 'Único entre clientes no borrados (índice único parcial en SQL).']
  telefono text
  email text
  direccion text
  notas text
  activo boolean [not null, default: true]
  limiteCredito decimal(12,2) [note: 'null = no se le vende fiado. Solo el OWNER lo edita.']
  saldoDeudor decimal(12,2) [not null, default: 0, note: 'Caché: Σ saldoPendiente de sus ventas confirmadas (verificado por trigger diferido).']
  saldoAFavor decimal(12,2) [not null, default: 0, note: 'Crédito por devoluciones acreditadas a cuenta; se usa como medio CREDITO_CLIENTE.']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    nombre [type: gin, name: 'cliente_nombre_trgm']
    apellido [type: gin, name: 'cliente_apellido_trgm']
    documento [type: gin, name: 'cliente_documento_trgm']
    telefono [type: gin, name: 'cliente_telefono_trgm']
  }
}

Table Producto {
  id text [pk, default: `cuid()`]
  nombre text [not null]
  descripcion text
  categoriaId text [not null]
  marcaId text
  tieneVariantes boolean [not null, default: false, note: 'false => existe exactamente una variante "Único".']
  imagenUrl text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (nombre, marcaId) [unique]
    categoriaId
    marcaId
    nombre [type: gin, name: 'producto_nombre_trgm']
  }
}

Table Variante {
  id text [pk, default: `cuid()`]
  productoId text [not null]
  nombre text [not null, note: 'Ej: "Mango Ice". "Único" para productos sin variantes.']
  sku text [unique, not null, note: 'Formato PRD-XXXXXX si no se provee.']
  codigoBarras text [note: 'Único (junto con CodigoBarrasAlternativo.codigo) entre variantes no borradas.']
  precioCosto decimal(12,2) [not null]
  precioVenta decimal(12,2) [not null]
  stockMinimo int [not null, default: 0]
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (productoId, nombre) [unique]
    nombre [type: gin, name: 'variante_nombre_trgm']
    sku [type: gin, name: 'variante_sku_trgm']
  }
}

Table HistorialPrecio {
  id text [pk, default: `cuid()`]
  varianteId text [not null]
  precioCostoAnterior decimal(12,2) [not null]
  precioCostoNuevo decimal(12,2) [not null]
  precioVentaAnterior decimal(12,2) [not null]
  precioVentaNuevo decimal(12,2) [not null]
  usuarioId text [not null]
  motivo text
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (varianteId, createdAt)
    createdAt
    usuarioId
  }

  Note: 'INMUTABLE. Una fila por cada cambio de precio de una variante. La DB exige que todo cambio de precio de Variante venga con su fila acá (misma tx).'
}

Table CodigoBarrasAlternativo {
  id text [pk, default: `cuid()`]
  varianteId text [not null]
  codigo text [unique, not null]
  descripcion text
  createdAt timestamp [not null, default: `now()`]

  indexes {
    varianteId
  }

  Note: 'Un mismo producto puede venir con más de un código según lote/importador.'
}

Table Stock {
  id text [pk, default: `cuid()`]
  varianteId text [not null]
  depositoId text [not null]
  cantidad int [not null, default: 0]
  updatedAt timestamp [not null]

  indexes {
    (varianteId, depositoId) [unique]
    depositoId
  }

  Note: 'Caché del ledger. NUNCA se actualiza directo: solo vía registrarMovimiento(). Un trigger rechaza cualquier cambio de cantidad sin movimiento en la misma tx.'
}

Table MovimientoStock {
  id text [pk, default: `cuid()`]
  tipo TipoMovimiento [not null]
  varianteId text [not null]
  depositoId text [not null]
  cantidad int [not null, note: 'Siempre > 0: el signo lo define el tipo.']
  stockAnterior int [not null]
  stockPosterior int [not null]
  costoUnitario decimal(12,2)
  motivo text
  referenciaTipo text [note: '"VENTA" | "COMPRA" | "TRANSFERENCIA" | "AJUSTE" (CHECK en DB).']
  referenciaId text
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (varianteId, depositoId, createdAt)
    createdAt
    (referenciaTipo, referenciaId)
    depositoId
    usuarioId
  }

  Note: 'Ledger INMUTABLE. Sin updatedAt. Los errores se corrigen con AJUSTE inverso.'
}

Table Compra {
  id text [pk, default: `cuid()`]
  numero int [unique, not null, increment]
  proveedorId text
  depositoId text [not null, note: 'Depósito donde ingresa la mercadería.']
  fecha timestamp [not null, default: `now()`]
  estado EstadoCompra [not null, default: 'BORRADOR']
  subtotal decimal(12,2) [not null]
  descuento decimal(12,2) [not null, default: 0]
  total decimal(12,2) [not null]
  notas text
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    fecha
    proveedorId
    depositoId
    usuarioId
  }
}

Table CompraItem {
  id text [pk, default: `cuid()`]
  compraId text [not null]
  varianteId text [not null]
  cantidad int [not null]
  costoUnitario decimal(12,2) [not null]
  subtotal decimal(12,2) [not null]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (compraId, varianteId) [unique]
    varianteId
  }
}

Table Venta {
  id text [pk, default: `cuid()`]
  numero int [unique, not null, increment]
  fecha timestamp [not null, default: `now()`]
  clienteId text
  depositoId text [not null, note: 'Depósito de donde sale la mercadería.']
  estado EstadoVenta [not null, default: 'BORRADOR']
  subtotal decimal(12,2) [not null]
  descuento decimal(12,2) [not null, default: 0]
  total decimal(12,2) [not null]
  costoTotal decimal(12,2) [not null, note: 'Snapshot: suma de costoUnitario * cantidad de los ítems.']
  gananciaBruta decimal(12,2) [not null, note: 'total - costoTotal (CHECK en DB).']
  medioPago MedioPago [note: 'Medio principal (el de mayor monto), informativo: la verdad son los PagoVenta.']
  estadoPago EstadoPago [not null, default: 'PENDIENTE']
  montoPagado decimal(12,2) [not null, default: 0, note: 'Σ pagos vigentes (verificado por trigger diferido).']
  saldoPendiente decimal(12,2) [not null, default: 0, note: 'total − montoPagado (lo que queda en cuenta corriente).']
  redondeo decimal(12,2) [not null, default: 0, note: 'Ajuste por redondear el total (≤ 0: siempre a favor del cliente).']
  notas text
  usuarioId text [not null]
  anuladaPorId text
  motivoAnulacion text
  anuladaAt timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    fecha
    (estado, fecha)
    (clienteId, estado)
    (depositoId, fecha)
    (usuarioId, fecha)
  }
}

Table VentaItem {
  id text [pk, default: `cuid()`]
  ventaId text [not null]
  varianteId text [not null]
  cantidad int [not null]
  precioUnitario decimal(12,2) [not null, note: 'Snapshot del precio de venta al momento de la venta.']
  costoUnitario decimal(12,2) [not null, note: 'Snapshot del costo al momento de la venta (ganancia histórica estable).']
  descuento decimal(12,2) [not null, default: 0]
  subtotal decimal(12,2) [not null, note: 'cantidad * precioUnitario - descuento (CHECK en DB).']
  cantidadDevuelta int [not null, default: 0, note: 'Caché: Σ DevolucionItem.cantidad (verificado por trigger diferido).']
  notas text [note: 'Ej: "precio modificado por Ana de $16.000 a $15.000".']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (ventaId, varianteId) [unique]
    varianteId
  }
}

Table Comprobante {
  id text [pk, default: `cuid()`]
  ventaId text [unique, not null]
  tipo TipoComprobante [not null]
  puntoVenta int [not null, default: 1]
  numero int [not null]
  fecha timestamp [not null, default: `now()`]
  razonSocial text
  cuit text
  condicionIva text
  total decimal(12,2) [not null]
  estado EstadoComprobante [not null, default: 'EMITIDO']
  anuladoAt timestamp
  pdfUrl text
  cae text [note: 'AFIP (factura electrónica): se completan al integrar WSFE. Hoy sin uso.']
  caeVencimiento timestamp
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (tipo, puntoVenta, numero) [unique]
  }

  Note: 'Facturación interna. Preparado para AFIP (cae, caeVencimiento).'
}

Table SecuenciaComprobante {
  id text [pk, default: `cuid()`]
  tipo TipoComprobante [not null]
  puntoVenta int [not null, default: 1]
  ultimoNumero int [not null, default: 0]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (tipo, puntoVenta) [unique]
  }

  Note: 'Numeración correlativa por (tipo, puntoVenta). Se toma con SELECT ... FOR UPDATE.'
}

Table Transferencia {
  id text [pk, default: `cuid()`]
  numero int [unique, not null, increment]
  depositoOrigenId text [not null]
  depositoDestinoId text [not null]
  estado EstadoTransferencia [not null, default: 'PENDIENTE']
  fecha timestamp [not null, default: `now()`]
  notas text
  usuarioId text [not null]
  completadaAt timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    fecha
    depositoOrigenId
    depositoDestinoId
    usuarioId
  }
}

Table TransferenciaItem {
  id text [pk, default: `cuid()`]
  transferenciaId text [not null]
  varianteId text [not null]
  cantidad int [not null]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (transferenciaId, varianteId) [unique]
    varianteId
  }
}

Table CategoriaGasto {
  id text [pk, default: `cuid()`]
  nombre text [unique, not null]
  activo boolean [not null, default: true]
}

Table Gasto {
  id text [pk, default: `cuid()`]
  fecha timestamp [not null, default: `now()`]
  categoriaGastoId text [not null]
  descripcion text [not null]
  monto decimal(12,2) [not null]
  medioPago MedioPago [not null]
  depositoId text [note: 'Gasto atribuible a un galpón (null = general del negocio).']
  cajaId text
  comprobanteUrl text [note: 'Foto del ticket (StorageProvider).']
  recurrente boolean [not null, default: false, note: 'Solo recordatorio: aparece en "recurrentes sin cargar" el mes siguiente.']
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    fecha
    usuarioId
    (categoriaGastoId, fecha)
    (depositoId, fecha)
    cajaId
  }

  Note: 'Para calcular ganancia neta. Soft delete. Si se pagó en efectivo desde una caja abierta, `cajaId` apunta a ella (y hay un MovimientoCaja GASTO).'
}

Table Caja {
  id text [pk, default: `cuid()`]
  depositoId text [not null]
  estado EstadoCaja [not null, default: 'ABIERTA']
  abiertaPorId text [not null]
  abiertaAt timestamp [not null, default: `now()`]
  montoInicial decimal(12,2) [not null]
  cerradaPorId text
  cerradaAt timestamp
  montoEsperado decimal(12,2) [note: 'Σ movimientos (sin el CIERRE) al momento de cerrar.']
  montoContado decimal(12,2) [note: 'Arqueo real.']
  diferencia decimal(12,2) [note: 'contado − esperado.']
  observaciones text
  requiereRevision boolean [not null, default: false, note: '|diferencia| > toleranciaArqueo.']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (depositoId, abiertaAt)
    estado
    abiertaAt
  }

  Note: 'Una sola ABIERTA por depósito (índice único parcial). Cerrada = inmutable.'
}

Table MovimientoCaja {
  id text [pk, default: `cuid()`]
  cajaId text [not null]
  tipo TipoMovimientoCaja [not null]
  monto decimal(12,2) [not null, note: 'Con signo (ver TipoMovimientoCaja).']
  referenciaTipo text [note: '"VENTA" | "PAGO" | "DEVOLUCION" | "GASTO".']
  referenciaId text
  descripcion text
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (cajaId, createdAt)
    (referenciaTipo, referenciaId)
  }

  Note: 'INMUTABLE. Solo efectivo: la caja es la caja física.'
}

Table ResumenDiario {
  id text [pk, default: `cuid()`]
  fecha date [not null]
  depositoId text
  cantidadVentas int [not null, default: 0]
  unidadesVendidas int [not null, default: 0]
  totalVentas decimal(14,2) [not null, default: 0]
  costoVentas decimal(14,2) [not null, default: 0]
  gananciaBruta decimal(14,2) [not null, default: 0, note: 'totalVentas − costoVentas.']
  totalGastos decimal(14,2) [not null, default: 0]
  gananciaNeta decimal(14,2) [not null, default: 0, note: 'gananciaBruta − (devoluciones − costoDevoluciones) − totalGastos.']
  totalPorMedioPago jsonb [not null, default: '{}', note: 'Cobrado ese día por medio: { "EFECTIVO": "1000.00", ... }.']
  devoluciones decimal(14,2) [not null, default: 0, note: 'Importe devuelto ese día.']
  costoDevoluciones decimal(14,2) [not null, default: 0, note: 'Costo de la mercadería devuelta (vuelve al stock): la devolución solo resta su margen.']
  updatedAt timestamp [not null]

  indexes {
    (fecha, depositoId) [unique]
    (depositoId, fecha)
  }

  Note: 'Agregados por día (zona horaria configurada) para que el dashboard no recorra años de ventas. depositoId null = consolidado. Se recalcula (upsert) dentro de cada transacción que afecta un día; `pnpm reportes:rebuild` la reconstruye entera. UNIQUE (fecha, depositoId) NULLS NOT DISTINCT.'
}

Table Notificacion {
  id text [pk, default: `cuid()`]
  tipo TipoNotificacion [not null]
  titulo text [not null]
  mensaje text [not null]
  datos jsonb [note: '{ clave, href, ... }. `clave` deduplica (no se repite mientras haya una sin leer).']
  leida boolean [not null, default: false]
  usuarioId text [note: 'Destinatario (null = todos los dueños).']
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (usuarioId, leida, createdAt)
    createdAt
  }
}

Table Configuracion {
  id text [pk, default: `cuid()`]
  clave text [unique, not null]
  valor jsonb [not null]
  updatedAt timestamp [not null]

  Note: 'Key-value. Claves: nombreNegocio, moneda, alertaStockMinimo, prefijoSku, escaner, ventas, timezone, exigirCajaAbierta, toleranciaArqueo, diasCobertura, rotacion, ultimasAlertas.'
}

Table AuditLog {
  id text [pk, default: `cuid()`]
  usuarioId text
  accion AccionAuditoria [not null]
  entidad text [not null, note: 'Nombre de la tabla afectada.']
  entidadId text
  datosAntes jsonb
  datosDespues jsonb
  ip text
  userAgent text
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (entidad, entidadId)
    (usuarioId, createdAt)
    createdAt
  }

  Note: 'INMUTABLE (trigger bloquea UPDATE/DELETE).'
}

Table PagoVenta {
  id text [pk, default: `cuid()`]
  ventaId text [not null]
  medioPago MedioPago [not null]
  monto decimal(12,2) [not null]
  referencia text [note: 'Nro de operación (transferencia / MercadoPago) o "Devolución #N".']
  fecha timestamp [not null, default: `now()`]
  usuarioId text [not null]
  anulado boolean [not null, default: false]
  anuladoPorId text
  anuladoAt timestamp
  motivoAnulacion text
  cajaId text [note: 'Efectivo cobrado con la caja del depósito abierta (null = fuera de caja o no efectivo).']
  createdAt timestamp [not null, default: `now()`]

  indexes {
    ventaId
    (fecha, medioPago)
    cajaId
  }

  Note: 'Un pago de una venta (pago partido y cobros posteriores de cuenta corriente). No se borra ni se edita: se anula (solo cambian los campos de anulación).'
}

Table Devolucion {
  id text [pk, default: `cuid()`]
  numero int [unique, not null, increment]
  ventaId text [not null]
  depositoId text [not null, note: 'Depósito al que vuelve la mercadería.']
  fecha timestamp [not null, default: `now()`]
  motivo text [not null]
  total decimal(12,2) [not null]
  reintegroMedioPago MedioPago
  reintegroMonto decimal(12,2) [not null, default: 0]
  aCuentaCorriente decimal(12,2) [not null, default: 0, note: 'Parte acreditada al cliente (cancela deuda y el resto queda como saldo a favor).']
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    ventaId
    fecha
    (depositoId, fecha)
  }

  Note: 'Devolución (parcial o total) de productos de una venta confirmada.'
}

Table DevolucionItem {
  id text [pk, default: `cuid()`]
  devolucionId text [not null]
  ventaItemId text [not null]
  cantidad int [not null]
  precioUnitario decimal(12,2) [not null, note: 'Snapshot del precio efectivo del ítem (con el descuento global prorrateado).']
  subtotal decimal(12,2) [not null]

  indexes {
    devolucionId
    ventaItemId
  }
}

Ref: Sesion.usuarioId > Usuario.id [delete: cascade]
Ref: Sesion.revocadaPorId > Usuario.id [delete: set null]
Ref: OperacionSincronizada.usuarioId > Usuario.id [delete: restrict]
Ref: PermisoUsuario.usuarioId > Usuario.id [delete: cascade]
Ref: Producto.categoriaId > Categoria.id [delete: restrict]
Ref: Producto.marcaId > Marca.id [delete: restrict]
Ref: Variante.productoId > Producto.id [delete: restrict]
Ref: HistorialPrecio.varianteId > Variante.id [delete: restrict]
Ref: HistorialPrecio.usuarioId > Usuario.id [delete: restrict]
Ref: CodigoBarrasAlternativo.varianteId > Variante.id [delete: restrict]
Ref: Stock.varianteId > Variante.id [delete: restrict]
Ref: Stock.depositoId > Deposito.id [delete: restrict]
Ref: MovimientoStock.varianteId > Variante.id [delete: restrict]
Ref: MovimientoStock.depositoId > Deposito.id [delete: restrict]
Ref: MovimientoStock.usuarioId > Usuario.id [delete: restrict]
Ref: Compra.proveedorId > Proveedor.id [delete: restrict]
Ref: Compra.depositoId > Deposito.id [delete: restrict]
Ref: Compra.usuarioId > Usuario.id [delete: restrict]
Ref: CompraItem.compraId > Compra.id [delete: cascade]
Ref: CompraItem.varianteId > Variante.id [delete: restrict]
Ref: Venta.clienteId > Cliente.id [delete: restrict]
Ref: Venta.depositoId > Deposito.id [delete: restrict]
Ref: Venta.usuarioId > Usuario.id [delete: restrict]
Ref: Venta.anuladaPorId > Usuario.id [delete: restrict]
Ref: VentaItem.ventaId > Venta.id [delete: cascade]
Ref: VentaItem.varianteId > Variante.id [delete: restrict]
Ref: Comprobante.ventaId - Venta.id [delete: restrict]
Ref: Transferencia.depositoOrigenId > Deposito.id [delete: restrict]
Ref: Transferencia.depositoDestinoId > Deposito.id [delete: restrict]
Ref: Transferencia.usuarioId > Usuario.id [delete: restrict]
Ref: TransferenciaItem.transferenciaId > Transferencia.id [delete: cascade]
Ref: TransferenciaItem.varianteId > Variante.id [delete: restrict]
Ref: Gasto.categoriaGastoId > CategoriaGasto.id [delete: restrict]
Ref: Gasto.depositoId > Deposito.id [delete: restrict]
Ref: Gasto.cajaId > Caja.id [delete: restrict]
Ref: Gasto.usuarioId > Usuario.id [delete: restrict]
Ref: Caja.depositoId > Deposito.id [delete: restrict]
Ref: Caja.abiertaPorId > Usuario.id [delete: restrict]
Ref: Caja.cerradaPorId > Usuario.id [delete: restrict]
Ref: MovimientoCaja.cajaId > Caja.id [delete: restrict]
Ref: MovimientoCaja.usuarioId > Usuario.id [delete: restrict]
Ref: ResumenDiario.depositoId > Deposito.id [delete: restrict]
Ref: Notificacion.usuarioId > Usuario.id [delete: cascade]
Ref: AuditLog.usuarioId > Usuario.id [delete: restrict]
Ref: PagoVenta.ventaId > Venta.id [delete: cascade]
Ref: PagoVenta.cajaId > Caja.id [delete: restrict]
Ref: PagoVenta.usuarioId > Usuario.id [delete: restrict]
Ref: PagoVenta.anuladoPorId > Usuario.id [delete: restrict]
Ref: Devolucion.ventaId > Venta.id [delete: restrict]
Ref: Devolucion.depositoId > Deposito.id [delete: restrict]
Ref: Devolucion.usuarioId > Usuario.id [delete: restrict]
Ref: DevolucionItem.devolucionId > Devolucion.id [delete: cascade]
Ref: DevolucionItem.ventaItemId > VentaItem.id [delete: restrict]
```

## Tablas por dominio

### Usuarios, sesiones y seguridad

- **Usuario**: personas que entran al sistema. `rol` es `OWNER` (dueño, acceso total) o `EMPLEADO` (acceso según `PermisoUsuario`). El email se guarda siempre en minúsculas. `debeCambiarPassword` obliga a pasar por `/cuenta` antes de usar el resto de la app (usuarios nuevos, contraseñas reseteadas y el seed). No se borra: se da de baja (`deletedAt`, `activo = false`).
- **PermisoUsuario**: una fila por (usuario, módulo) con cuatro banderas: ver, crear, editar, eliminar. Los dueños no necesitan filas. Los permisos no viajan en el token: se leen de la base en cada request, así que un cambio aplica al instante.
- **Sesion**: cada inicio de sesión. El JWT de la cookie lleva `sid` (id de esta fila) y `tok` (secreto aleatorio del que acá se guarda solo el sha256). Revocarla (`revocadaAt`, `revocadaPorId`) corta el acceso en el próximo request; el middleware cachea la validación 60 s por instancia.
- **IntentoLogin**: registro de cada intento de login (exitoso o no) para el límite de 5 fallidos por email cada 15 minutos. No es FK a `Usuario`: también se registran emails inexistentes.
- **RateLimit**: contador por clave (`u:<usuarioId>` o `ip:<ip>`) y ventana de un minuto para el rate limit general de `/api/*` y Server Actions.
- **AuditLog**: registro inmutable de quién hizo qué (altas, cambios, bajas, logins, logouts, cambios de permisos, sesiones revocadas y accesos denegados), con el antes y el después en JSON, IP y user agent. Se consulta en `/configuracion/auditoria`.

### Maestros

- **Deposito**: galpones o locales donde hay mercadería. Uno solo puede ser el principal. No se borra: se desactiva, y solo si no tiene stock y no es el principal.
- **Categoria** y **Marca**: clasificación de productos. No se pueden desactivar si tienen productos activos.
- **Proveedor**: con CUIT opcional, único entre los no borrados.
- **Cliente**: con documento opcional, único entre los no borrados. `limiteCredito` en `null` significa que no se le vende fiado. `saldoDeudor` es lo que debe (suma de saldos pendientes de sus ventas confirmadas) y `saldoAFavor` el crédito por devoluciones, que se usa como medio de pago `CREDITO_CLIENTE`.

### Catálogo

- **Producto**: nombre, categoría, marca, imagen. Todo producto tiene al menos una variante; si `tieneVariantes = false`, tiene exactamente una llamada «Único».
- **Variante**: lo que realmente se vende y se cuenta (el sabor, el color). Tiene SKU único (`{prefijoSku}-XXXXXX` si no se indica), código de barras principal, precio de costo, precio de venta y stock mínimo para las alertas.
- **CodigoBarrasAlternativo**: otros códigos que identifican a la misma variante (distintos lotes o importadores). Un código no puede repetirse entre esta tabla y `Variante.codigoBarras`.
- **HistorialPrecio**: una fila inmutable por cada cambio de costo o precio de venta, con quién y por qué. La base rechaza un cambio de precio sin su fila de historial en la misma transacción.

### Inventario

- **MovimientoStock**: el ledger. Cada entrada o salida de mercadería es una fila inmutable con tipo (`INGRESO_COMPRA`, `INGRESO_MANUAL`, `VENTA`, `DEVOLUCION_CLIENTE`, `DEVOLUCION_PROVEEDOR`, `AJUSTE_POSITIVO`, `AJUSTE_NEGATIVO`, `TRANSFERENCIA_SALIDA`, `TRANSFERENCIA_ENTRADA`), cantidad siempre positiva (el signo lo da el tipo), stock anterior y posterior, costo y referencia al documento que lo originó. Un error se corrige con un ajuste inverso, nunca editando.
- **Stock**: cantidad actual por (variante, depósito). Es un caché del ledger: solo cambia en la misma transacción que inserta el movimiento correspondiente (`registrarMovimiento()` / `transferirStock()` en `stock.service.ts`).
- **Transferencia** y **TransferenciaItem**: envío de mercadería entre depósitos. Nace `PENDIENTE`, se `COMPLETA` (genera la salida y la entrada) o se `ANULA`.
- **OperacionSincronizada**: operaciones del escáner hechas sin conexión (ingreso, recuento, transferencia) y enviadas después a `/api/sync`. `idOperacion` es el UUID generado en el celular y es único: si la misma operación llega dos veces, la segunda devuelve el resultado guardado sin repetir movimientos. Estados: `PROCESANDO`, `APLICADA`, `RECHAZADA` (con `motivo`).

Vistas SQL (no son modelos de Prisma):

- `vw_stock_consolidado`: stock por variante con una columna por depósito más un `por_deposito` en JSON. Se regenera sola cuando se crea o renombra un depósito.
- `vw_alertas_stock`: variantes activas cuyo stock total (todos los depósitos) está por debajo de su stock mínimo, con el faltante.

### Compras

- **Compra** y **CompraItem**: mercadería recibida de un proveedor en un depósito. `BORRADOR` (editable) → `RECIBIDA` (genera un `INGRESO_COMPRA` por ítem y opcionalmente actualiza costos con historial) → `ANULADA` (genera `DEVOLUCION_PROVEEDOR`). Los totales se calculan en el servidor y la base verifica que cierren con los ítems.

### Ventas, pagos y comprobantes

- **Venta**: cabecera de la venta con depósito, cliente opcional, vendedor, totales, costo congelado (`costoTotal`) y ganancia bruta. `estadoPago` (`PAGADA`, `PARCIAL`, `PENDIENTE`) y `montoPagado`/`saldoPendiente` resumen los pagos; `redondeo` es siempre cero o negativo (a favor del cliente). Una venta confirmada no se edita: se anula, registrando quién, cuándo y por qué.
- **VentaItem**: renglones con precio y costo congelados al momento de vender, descuento por ítem y `cantidadDevuelta` (caché de lo devuelto).
- **PagoVenta**: cada pago de una venta. Permite pagos partidos (varios medios) y cobros posteriores de cuenta corriente. No se borra ni se edita: se anula (solo el dueño). Si es efectivo cobrado con la caja del depósito abierta, `cajaId` apunta a ella.
- **Devolucion** y **DevolucionItem**: devolución parcial o total de una venta confirmada. La mercadería vuelve a un depósito (`DEVOLUCION_CLIENTE`) y el importe se reintegra en dinero (`reintegroMonto` + medio) y/o a la cuenta del cliente (`aCuentaCorriente`: primero cancela deuda, el resto queda como saldo a favor). Inmutables.
- **Comprobante**: comprobante interno de la venta (uno por venta). Tipos: ticket, facturas A/B/C y presupuesto. Tiene `cae` y `caeVencimiento` preparados para AFIP, hoy sin uso. `pdfUrl` apunta al PDF guardado. Se anula solo junto con su venta.
- **SecuenciaComprobante**: último número usado por (tipo, punto de venta). Se toma con `SELECT … FOR UPDATE` dentro de la transacción de la venta: numeración sin huecos ni duplicados aunque cobren varias cajas a la vez.

### Caja y gastos

- **Caja**: la caja física de efectivo de un depósito. Una sola abierta por depósito. Guarda apertura (quién, cuándo, monto inicial) y cierre (esperado, contado, diferencia, observaciones, `requiereRevision` si la diferencia supera la tolerancia configurada). Cerrada es inmutable.
- **MovimientoCaja**: cada entrada o salida de efectivo, inmutable y con signo: `APERTURA` (≥ 0), `VENTA`, `PAGO_CLIENTE`, `INGRESO_EXTRA` (> 0), `DEVOLUCION`, `GASTO`, `RETIRO` (< 0) y `CIERRE` (≤ 0, igual a menos el contado). El esperado de una caja es siempre la suma de sus movimientos.
- **CategoriaGasto** y **Gasto**: gastos del negocio (alquiler, servicios, sueldos…) con categoría, medio de pago, depósito opcional, foto del ticket (`comprobanteUrl`) y marca de recurrente (solo recordatorio). Si se pagó en efectivo con una caja abierta, `cajaId` apunta a ella y hay un `MovimientoCaja` de tipo `GASTO`. Soft delete.

### Reportes, notificaciones, configuración y backups

- **ResumenDiario**: agregados por día (en la zona horaria del negocio) y depósito, más una fila consolidada con `depositoId` nulo: cantidad de ventas, unidades, total, costo, ganancia bruta, gastos, ganancia neta, cobrado por medio de pago y devoluciones. Se **recalcula** (no se suma un delta) al final de cada transacción que toca un día. `pnpm reportes:rebuild` la reconstruye entera desde el ledger.
- **Notificacion**: alertas para la campana y `/notificaciones`: `STOCK_BAJO`, `SIN_STOCK`, `CAJA_DIFERENCIA`, `TRANSFERENCIA_PENDIENTE`, `DEUDA_CLIENTE` y `BACKUP_FALLIDO`. `usuarioId` nulo significa «todos los dueños»; `datos.clave` evita repetir una alerta mientras haya otra igual sin leer.
- **Configuracion**: pares clave-valor JSON (nombre del negocio, moneda, prefijo de SKU, parámetros del escáner, ventas y comprobante, zona horaria, caja obligatoria, tolerancia de arqueo, días de cobertura, rotación, etc.).
- **Backup**: un registro por cada backup (`pg_dump`) con el archivo en el bucket, tamaño, duración, si salió bien (verificado con `pg_restore --list`), el error y el origen (`cron`, `manual`, `release`). Inmutable.

## Invariantes garantizadas por la base

Estas reglas las hace cumplir PostgreSQL (CHECKs, índices y triggers en las migraciones), no solo el código de la app: un script, una consola SQL o un bug no pueden romperlas. Los triggers «diferidos» (`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`) verifican al COMMIT, cuando la transacción ya escribió todas sus filas.

### Inmutabilidad y borrado

- `MovimientoStock`, `AuditLog`, `HistorialPrecio` y `MovimientoCaja` son inmutables: triggers rechazan `UPDATE`, `DELETE` y `TRUNCATE`.
- `IntentoLogin` no se edita; `Backup` no se edita ni se borra; `Devolucion` y `DevolucionItem` no se editan ni se borran, y no se agregan ítems a una devolución ya registrada.
- Sin `DELETE` físico en `Usuario`, `Producto`, `Variante`, `Cliente`, `Proveedor` y `Gasto` (soft delete), `Deposito` (se desactiva), `Comprobante`, `SecuenciaComprobante`, `CategoriaGasto`, `Caja`, `PagoVenta` y `OperacionSincronizada`.
- `Venta`, `Compra` y `Transferencia` solo se borran en borrador (o transferencia pendiente): confirmadas, se anulan. Sus transiciones de estado están restringidas (por ejemplo, una venta confirmada solo puede pasar a anulada) y una vez confirmadas no se modifican sus datos ni sus ítems.

### Stock y ledger

- `Stock.cantidad ≥ 0`; `MovimientoStock.cantidad > 0`, `stockAnterior ≥ 0` y `stockPosterior ≥ 0`.
- Cada movimiento tiene que partir del stock real (`stockAnterior` = stock actual) y su aritmética tiene que cerrar según el signo del tipo; no puede dejar stock negativo.
- Un `UPDATE` a `Stock` sin su movimiento en la misma transacción es rechazado, y un movimiento que no se aplicó a `Stock` antes del COMMIT también. Las filas de `Stock` se crean en 0, no se borran y no cambian de variante ni de depósito.
- `INGRESO_COMPRA` exige costo unitario. `referenciaTipo` y `referenciaId` van juntos o no van.
- Una variante con movimientos no puede cambiar de producto.

### Catálogo

- Nombres no vacíos en usuarios, depósitos, categorías, marcas, productos y variantes.
- Precios y stock mínimo ≥ 0. Códigos de barras de 4 a 64 caracteres alfanuméricos o guiones, en mayúsculas.
- Código de barras único entre variantes no borradas **y** entre `Variante.codigoBarras` y `CodigoBarrasAlternativo.codigo` (trigger con advisory lock, porque un índice no abarca dos tablas).
- Todo producto tiene al menos una variante; uno sin variantes tiene exactamente una «Único» (diferido).
- Un cambio de precio de `Variante` exige su `HistorialPrecio` en la misma transacción, con los precios anteriores iguales a los vigentes y un cambio real.
- Un solo depósito principal (índice único parcial). No se desactiva el principal ni un depósito con stock; no se desactiva una categoría o marca con productos activos.
- CUIT de proveedor y documento de cliente únicos entre los no borrados (índices únicos parciales).

### Compras, ventas y comprobantes

- Totales: `total = subtotal − descuento` en compras; `total = subtotal − descuento + redondeo` en ventas, con `redondeo ≤ 0`; `gananciaBruta = total − costoTotal`; subtotal de cada ítem igual a cantidad × precio (menos descuento en ventas). Al COMMIT se verifica que los totales de la cabecera coincidan con la suma de ítems y que el documento tenga ítems.
- Venta anulada ⇔ tiene `anuladaAt` y `anuladaPorId`.
- Pagos: `montoPagado = Σ pagos vigentes`, `montoPagado + saldoPendiente = total` en ventas confirmadas, `estadoPago` coherente, y una venta anulada no puede tener pagos vigentes ni saldo (diferido).
- `PagoVenta.monto > 0`; un pago anulado registra quién, cuándo y por qué; un pago no se modifica salvo para anularlo.
- `Cliente.saldoDeudor = Σ saldoPendiente` de sus ventas confirmadas (diferido); `saldoDeudor`, `saldoAFavor` y `limiteCredito` no negativos.
- Devoluciones: `total = reintegroMonto + aCuentaCorriente`; reintegro en dinero ⇔ tiene medio de pago (y nunca `CREDITO_CLIENTE`); todos los ítems de la misma venta; `VentaItem.cantidadDevuelta = Σ devuelto ≤ cantidad vendida` (diferido).
- Comprobantes: solo de ventas confirmadas, con el mismo total que la venta y con un número asignado por `SecuenciaComprobante`; un comprobante emitido no se modifica salvo `pdfUrl`, CAE (una sola vez) y la anulación junto con su venta. La secuencia solo avanza. `(tipo, puntoVenta, numero)` es único.
- Transferencias: origen distinto de destino; `completadaAt` coherente con el estado; al menos un ítem.

### Caja y gastos

- Una sola caja `ABIERTA` por depósito (índice único parcial). Una caja cerrada no se modifica y no admite movimientos; los datos de apertura no cambian.
- Estado coherente: abierta sin datos de cierre; cerrada con esperado, contado y `diferencia = contado − esperado`. Al cerrar, el esperado tiene que coincidir con la suma de sus movimientos y tiene que existir el movimiento de `CIERRE` por el contado.
- Signo de cada `MovimientoCaja` según su tipo; una sola `APERTURA` y un solo `CIERRE` por caja; la apertura es igual al monto inicial.
- Solo efectivo pasa por la caja: `PagoVenta.cajaId` y `Gasto.cajaId` solo con medio `EFECTIVO`. `Gasto.monto > 0`.

### Usuarios, sesiones y sincronización

- Siempre queda al menos un dueño activo (diferido, con advisory lock para que dos dueños no se degraden mutuamente a la vez).
- Emails de `Usuario` e `IntentoLogin` en minúsculas y sin espacios.
- Un permiso de crear, editar o eliminar exige el de ver.
- Una sesión no cambia de usuario ni de token, y una revocada no se «des-revoca».
- Una `OperacionSincronizada` no cambia de id ni de usuario, y una ya aplicada no se modifica.
- `RateLimit.contador ≥ 0`.

### Reportes

- `ResumenDiario`: único por `(fecha, depositoId)` con `NULLS NOT DISTINCT`, así la fila consolidada (depósito nulo) también es única por día.
