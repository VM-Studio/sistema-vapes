# Modelo de datos

Base PostgreSQL 16 manejada con Prisma 6. La fuente de verdad es `prisma/schema.prisma`; las reglas que Prisma no sabe expresar (CHECKs, índices únicos parciales, triggers, vistas) viven en las migraciones SQL de `prisma/migrations/` (la reforma multipanel R1 es `20260928160000_reforma_multipanel`; la reforma R2 de catálogo, proveedores y compras es `20260929090000_catalogo_proveedores_compras`).

Convenciones generales:

- **Paneles**: la app son varios sistemas independientes (`Panel`: Vapes, Cosmetic, Especiales y los que se agreguen). Toda tabla de negocio tiene `panelId` y solo puede apuntar a filas de su mismo panel. Lo global (usuarios, sesiones, `ConfiguracionGlobal`, backups, rate limit, auditoría) no pertenece a ningún panel.
- **IDs**: `cuid()` en texto (los paneles, depósitos y secuencias creados por la migración tienen ids fijos: `pnl_vapes`, `pnl_cosmetic`, `pnl_especiales`). Los documentos que ve el usuario (ventas, compras, transferencias, devoluciones) tienen además un `numero` **correlativo por panel** (tabla `Secuencia`). El ID de venta visible es `{3 letras del slug}-{número con 6 dígitos}`: `VAP-000001`; el de compra lleva una `C`: `VAP-C-000001` (`formatearIdVenta` / `formatearIdCompra` en `src/lib/paneles.ts`).
- **Dinero**: `Decimal(12,2)`, en pesos salvo `ProveedorProducto.precio`, que lleva su `moneda` (`ARS` o `USD`). **Cantidades**: enteros.
- **Fechas**: `timestamp` en UTC sin zona. Los rangos de días se calculan en la zona horaria del negocio (`ConfiguracionGlobal.timezone`, por defecto `America/Argentina/Buenos_Aires`).
- **Nada se borra físicamente** en las tablas de negocio: los maestros usan soft delete (`deletedAt`) o `activo = false` (también los paneles), y los documentos confirmados se **anulan**.
- **Caché verificado**: `Stock` es derivado del ledger `MovimientoStock`; la base verifica que solo cambie junto con su movimiento.

## Diagrama (DBML)

Se puede pegar en [dbdiagram.io](https://dbdiagram.io) para verlo como diagrama. Generado a partir de `prisma/schema.prisma`: las relaciones inversas de Prisma (listas) no aparecen porque están implícitas en los `Ref`. `panelId` con `default: \`current_setting('app.panel_id', true)\`` es la red de seguridad del aislamiento (ver invariantes).

```dbml
// Generado a partir de prisma/schema.prisma

Enum RolUsuario {
  OWNER
  EMPLEADO
}

Enum Modulo {
  DASHBOARD
  PROVEEDORES
  PRODUCTOS
  STOCK
  VENTAS
  CLIENTES
  DEVOLUCIONES
  COMPRAS
  COTIZADOR
  REPORTES
  USUARIOS [note: 'Global, solo OWNER: sin filas de permiso']
  CONFIGURACION [note: 'Global, solo OWNER: sin filas de permiso']
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

Enum Moneda {
  ARS
  USD
}

Enum MedioPago {
  EFECTIVO
  TRANSFERENCIA
  DEBITO
  CREDITO
  MERCADOPAGO
  OTRO
}

Enum AccionAuditoria {
  CREATE
  UPDATE
  DELETE
  LOGIN
  LOGOUT
  PERMISO_CAMBIADO
  ACCESO_DENEGADO
  SESION_REVOCADA
}

// ---------------------------------------------------------------------------
// Usuarios, sesiones y seguridad (globales)
// ---------------------------------------------------------------------------

Table Usuario {
  id text [pk, default: `cuid()`]
  nombre text [not null]
  email text [not null, unique, note: 'Siempre en minúsculas (CHECK)']
  passwordHash text [not null]
  rol RolUsuario [not null]
  activo boolean [not null, default: true]
  debeCambiarPassword boolean [not null, default: false]
  ultimoLogin timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp
}

Table Sesion {
  id text [pk, default: `cuid()`, note: 'Viaja en el JWT como sid']
  usuarioId text [not null]
  tokenHash text [not null, note: 'sha256 del secreto tok del JWT']
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
}

Table PermisoUsuario {
  id text [pk, default: `cuid()`]
  usuarioId text [not null]
  panelId text [not null]
  modulo Modulo [not null, note: 'Nunca USUARIOS ni CONFIGURACION (CHECK)']
  puedeVer boolean [not null, default: false]
  puedeCrear boolean [not null, default: false]
  puedeEditar boolean [not null, default: false]
  puedeEliminar boolean [not null, default: false]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (usuarioId, panelId, modulo) [unique]
    panelId
  }
}

Table UsuarioPanel {
  id text [pk, default: `cuid()`]
  usuarioId text [not null]
  panelId text [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (usuarioId, panelId) [unique]
    panelId
  }
  Note: 'Paneles a los que accede un EMPLEADO. Los OWNER acceden a todos sin filas.'
}

Table IntentoLogin {
  id text [pk, default: `cuid()`]
  email text [not null, note: 'Normalizado; no es FK (se registran emails inexistentes)']
  ip text
  exitoso boolean [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (email, createdAt)
    (ip, createdAt)
  }
}

Table RateLimit {
  clave text [not null, note: 'u:<usuarioId> o ip:<ip>']
  ventana timestamp [not null, note: 'Ventana de 1 minuto']
  contador int [not null, default: 0]

  indexes {
    (clave, ventana) [pk]
    ventana
  }
}

Table Backup {
  id text [pk, default: `cuid()`]
  archivo text [not null, note: 'backups/backup-YYYY-MM-DD-HHmm.dump']
  tamanio bigint
  duracionMs int [not null]
  ok boolean [not null]
  error text
  origen text [not null, default: 'cron', note: 'cron | manual | release']
  createdAt timestamp [not null, default: `now()`]

  indexes {
    createdAt
  }
}

// ---------------------------------------------------------------------------
// Paneles, numeración y configuración
// ---------------------------------------------------------------------------

Table Panel {
  id text [pk, default: `cuid()`]
  nombre text [not null, unique]
  slug text [not null, unique, note: 'kebab-case, 2 a 40: /p/{slug}; prefijo del ID de venta']
  logoUrl text
  colorAcento text [note: '#RRGGBB']
  etiquetaEspecificacion text [not null, note: 'Pitadas, Contenido, Detalle…']
  orden int [not null, default: 0]
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (activo, orden)
  }
}

Table Secuencia {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  entidad text [not null, note: 'VENTA | COMPRA | TRANSFERENCIA | DEVOLUCION']
  ultimoNumero int [not null, default: 0]
  updatedAt timestamp [not null]

  indexes {
    (panelId, entidad) [unique]
  }
}

Table Configuracion {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  clave text [not null, note: 'escaner, ventas, alertaStockMinimo, prefijoSku']
  valor jsonb [not null]
  updatedAt timestamp [not null]

  indexes {
    (panelId, clave) [unique]
  }
}

Table ConfiguracionGlobal {
  id text [pk, default: `cuid()`]
  clave text [not null, unique, note: 'nombreNegocio, iconoApp, timezone, moneda']
  valor jsonb [not null]
  updatedAt timestamp [not null]
}

Table AuditLog {
  id text [pk, default: `cuid()`]
  panelId text [note: 'null = acción global (login, usuarios, configuración)']
  usuarioId text
  accion AccionAuditoria [not null]
  entidad text [not null]
  entidadId text
  datosAntes jsonb
  datosDespues jsonb
  ip text
  userAgent text
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (entidad, entidadId)
    (usuarioId, createdAt)
    (panelId, createdAt)
    createdAt
  }
}

// ---------------------------------------------------------------------------
// Maestros (por panel)
// ---------------------------------------------------------------------------

Table Deposito {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  nombre text [not null]
  direccion text
  activo boolean [not null, default: true]
  esPrincipal boolean [not null, default: false, note: 'Uno solo por panel (único parcial)']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, nombre) [unique]
  }
}

Table Categoria {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  nombre text [not null]
  descripcion text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, nombre) [unique]
  }
}

Table Marca {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  nombre text [not null]
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, nombre) [unique]
  }
}

Table Proveedor {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  nombre text [not null, note: 'Persona de contacto']
  telefono text [note: '+54 + dígitos (CHECK); único por panel entre no borrados (único parcial)']
  nombreTienda text [not null, note: 'No vacío (CHECK)']
  notas text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (panelId, nombre)
    (panelId, nombreTienda)
  }
}

Table ProveedorProducto {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  proveedorId text [not null]
  productoId text [not null]
  precio decimal(12,2) [not null, note: 'Precio de compra unitario del producto (cualquier sabor); ≥ 0 (CHECK)']
  moneda Moneda [not null, default: 'ARS']
  actualizadoAt timestamp [not null, default: `now()`]
  usuarioId text [not null, note: 'Quién fijó el precio vigente']
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, proveedorId, productoId) [unique]
    (panelId, productoId, precio) [note: 'Proveedores de un producto, de menor a mayor']
  }
  Note: 'Qué vende cada proveedor y a cuánto. Se pisa al editarlo o al recibir una compra con "actualizar precio".'
}

Table Cliente {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  nombre text [not null]
  apellido text
  documento text [note: 'Único por panel entre no borrados (único parcial)']
  telefono text [note: '+54 + dígitos (CHECK); único por panel entre no borrados']
  email text
  direccion text
  notas text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (panelId, nombre)
    nombre [type: gin, name: 'cliente_nombre_trgm']
    apellido [type: gin, name: 'cliente_apellido_trgm']
    documento [type: gin, name: 'cliente_documento_trgm']
    telefono [type: gin, name: 'cliente_telefono_trgm']
  }
}

// ---------------------------------------------------------------------------
// Catálogo (por panel)
// ---------------------------------------------------------------------------

Table Producto {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  marcaId text [not null]
  nombre text [not null, note: 'El modelo ("BC")']
  especificacion text [not null, default: '', note: 'Atributo principal del panel (Panel.etiquetaEspecificacion): "5000" pitadas en Vapes']
  especificacionNorm text [not null, default: '', note: 'Trigger: lower(especificacion) sin espacios']
  nombreCompleto text [not null, default: '', note: 'Trigger: "{Marca} {Modelo} {Especificación}" (sin "Sin marca")']
  categoriaId text
  precioVenta decimal(12,2) [not null, note: 'Precio de todos sus sabores salvo los que tienen precio propio; ≥ 0 (CHECK)']
  imagenUrl text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (panelId, marcaId, nombre, especificacionNorm) [unique]
    (panelId, categoriaId)
    (panelId, marcaId)
    nombreCompleto [type: gin, name: 'producto_nombre_completo_trgm']
  }
  Note: 'Producto = marca + modelo + especificación. Tiene al menos una variante (sabor).'
}

Table Variante {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`, note: '= Producto.panelId (trigger)']
  productoId text [not null]
  nombre text [not null, note: 'El sabor ("Mango Ice"); "Único" en un producto sin sabor']
  sku text [not null]
  codigoBarras text [note: 'Único por panel entre no borradas y frente a los alternativos']
  precioVenta decimal(12,2) [note: 'Precio propio; null = usa Producto.precioVenta']
  ultimoCosto decimal(12,2) [note: 'Costo de la última compra recibida; null = sin compras']
  stockMinimo int [not null, default: 0]
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (panelId, sku) [unique]
    (panelId, productoId, nombre) [unique]
    nombre [type: gin, name: 'variante_nombre_trgm']
    sku [type: gin, name: 'variante_sku_trgm']
  }
}

Table CodigoBarrasAlternativo {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  varianteId text [not null]
  codigo text [not null]
  descripcion text
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, codigo) [unique]
    varianteId
  }
}

// ---------------------------------------------------------------------------
// Inventario (por panel)
// ---------------------------------------------------------------------------

Table Stock {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  varianteId text [not null]
  depositoId text [not null]
  cantidad int [not null, default: 0]
  updatedAt timestamp [not null]

  indexes {
    (panelId, varianteId, depositoId) [unique]
    (panelId, depositoId)
  }
  Note: 'Caché del ledger: solo cambia vía registrarMovimiento()'
}

Table MovimientoStock {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  tipo TipoMovimiento [not null]
  varianteId text [not null]
  depositoId text [not null]
  cantidad int [not null, note: 'Siempre > 0: el signo lo define el tipo']
  stockAnterior int [not null]
  stockPosterior int [not null]
  costoUnitario decimal(12,2)
  motivo text
  referenciaTipo text [note: 'VENTA | COMPRA | TRANSFERENCIA | AJUSTE | DEVOLUCION']
  referenciaId text
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, varianteId, depositoId, createdAt)
    (panelId, createdAt)
    (panelId, depositoId, createdAt)
    (referenciaTipo, referenciaId)
    usuarioId
  }
  Note: 'Ledger INMUTABLE'
}

Table Transferencia {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  numero int [not null, note: 'Correlativo por panel (Secuencia)']
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
    (panelId, numero) [unique]
    (panelId, fecha)
    (panelId, estado)
    depositoOrigenId
    depositoDestinoId
    usuarioId
  }
}

Table TransferenciaItem {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  transferenciaId text [not null]
  varianteId text [not null]
  cantidad int [not null]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (transferenciaId, varianteId) [unique]
    (panelId, varianteId)
  }
}

// ---------------------------------------------------------------------------
// Compras (por panel)
// ---------------------------------------------------------------------------

Table Compra {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  numero int [not null, note: 'Correlativo por panel (Secuencia); ID visible VAP-C-000001']
  proveedorId text [note: 'Obligatorio en la app; nulo solo en compras anteriores a R2']
  depositoId text [not null, note: 'Galpón donde entra la mercadería']
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
    (panelId, numero) [unique]
    (panelId, fecha)
    (panelId, proveedorId)
    (panelId, depositoId)
    usuarioId
  }
}

Table CompraItem {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  compraId text [not null]
  varianteId text [not null, note: 'Se compra por sabor']
  productoId text [not null, note: '= variante.productoId (trigger)']
  cantidad int [not null]
  costoUnitario decimal(12,2) [not null]
  subtotal decimal(12,2) [not null]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (compraId, varianteId) [unique]
    (panelId, varianteId)
    (panelId, productoId)
  }
}

// ---------------------------------------------------------------------------
// Ventas (por panel): se cobran completas con un único medio de pago
// ---------------------------------------------------------------------------

Table Venta {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  numero int [not null, note: 'Correlativo por panel; ID visible VAP-000001']
  fecha timestamp [not null, default: `now()`]
  clienteId text
  depositoId text [not null]
  estado EstadoVenta [not null, default: 'BORRADOR']
  subtotal decimal(12,2) [not null]
  descuento decimal(12,2) [not null, default: 0]
  total decimal(12,2) [not null]
  costoTotal decimal(12,2) [not null, note: 'Snapshot: Σ costoUnitario × cantidad']
  gananciaBruta decimal(12,2) [not null, note: 'total − costoTotal (CHECK)']
  medioPago MedioPago [note: 'Obligatorio salvo en BORRADOR (CHECK)']
  redondeo decimal(12,2) [not null, default: 0, note: '≤ 0: a favor del cliente']
  notas text
  usuarioId text [not null]
  anuladaPorId text
  motivoAnulacion text
  anuladaAt timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, numero) [unique]
    (panelId, fecha)
    (panelId, estado, fecha)
    (panelId, clienteId, estado)
    (panelId, depositoId, fecha)
    (panelId, usuarioId, fecha)
  }
}

Table VentaItem {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  ventaId text [not null]
  varianteId text [not null]
  cantidad int [not null]
  precioUnitario decimal(12,2) [not null, note: 'Snapshot del precio de venta']
  costoUnitario decimal(12,2) [not null, note: 'Snapshot de Variante.ultimoCosto al vender (0 si no hubo compras)']
  descuento decimal(12,2) [not null, default: 0]
  subtotal decimal(12,2) [not null, note: 'cantidad × precioUnitario − descuento (CHECK)']
  notas text
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (ventaId, varianteId) [unique]
    (panelId, varianteId)
  }
}

Table Devolucion {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: `current_setting('app.panel_id', true)`]
  numero int [not null, note: 'Correlativo por panel (Secuencia)']
  ventaId text [not null]
  depositoId text [not null]
  fecha timestamp [not null, default: `now()`]
  motivo text [not null]
  usuarioId text [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, numero) [unique]
    (panelId, ventaId)
    (panelId, fecha)
  }
  Note: 'Sin campos económicos (devoluciones por garantía, próximamente). Inmutable.'
}

// ---------------------------------------------------------------------------
// Relaciones
// ---------------------------------------------------------------------------

Ref: Sesion.usuarioId > Usuario.id [delete: cascade]
Ref: Sesion.revocadaPorId > Usuario.id [delete: set null]
Ref: PermisoUsuario.usuarioId > Usuario.id [delete: cascade]
Ref: PermisoUsuario.panelId > Panel.id [delete: restrict]
Ref: UsuarioPanel.usuarioId > Usuario.id [delete: cascade]
Ref: UsuarioPanel.panelId > Panel.id [delete: restrict]

Ref: Secuencia.panelId > Panel.id [delete: restrict]
Ref: Configuracion.panelId > Panel.id [delete: restrict]
Ref: AuditLog.panelId > Panel.id [delete: restrict]
Ref: AuditLog.usuarioId > Usuario.id [delete: restrict]

Ref: Deposito.panelId > Panel.id [delete: restrict]
Ref: Categoria.panelId > Panel.id [delete: restrict]
Ref: Marca.panelId > Panel.id [delete: restrict]
Ref: Proveedor.panelId > Panel.id [delete: restrict]
Ref: ProveedorProducto.panelId > Panel.id [delete: restrict]
Ref: ProveedorProducto.proveedorId > Proveedor.id [delete: restrict]
Ref: ProveedorProducto.productoId > Producto.id [delete: restrict]
Ref: ProveedorProducto.usuarioId > Usuario.id [delete: restrict]
Ref: Cliente.panelId > Panel.id [delete: restrict]

Ref: Producto.panelId > Panel.id [delete: restrict]
Ref: Producto.categoriaId > Categoria.id [delete: restrict]
Ref: Producto.marcaId > Marca.id [delete: restrict]
Ref: Variante.panelId > Panel.id [delete: restrict]
Ref: Variante.productoId > Producto.id [delete: restrict]
Ref: CodigoBarrasAlternativo.panelId > Panel.id [delete: restrict]
Ref: CodigoBarrasAlternativo.varianteId > Variante.id [delete: restrict]

Ref: Stock.panelId > Panel.id [delete: restrict]
Ref: Stock.varianteId > Variante.id [delete: restrict]
Ref: Stock.depositoId > Deposito.id [delete: restrict]
Ref: MovimientoStock.panelId > Panel.id [delete: restrict]
Ref: MovimientoStock.varianteId > Variante.id [delete: restrict]
Ref: MovimientoStock.depositoId > Deposito.id [delete: restrict]
Ref: MovimientoStock.usuarioId > Usuario.id [delete: restrict]

Ref: Transferencia.panelId > Panel.id [delete: restrict]
Ref: Transferencia.depositoOrigenId > Deposito.id [delete: restrict]
Ref: Transferencia.depositoDestinoId > Deposito.id [delete: restrict]
Ref: Transferencia.usuarioId > Usuario.id [delete: restrict]
Ref: TransferenciaItem.panelId > Panel.id [delete: restrict]
Ref: TransferenciaItem.transferenciaId > Transferencia.id [delete: cascade]
Ref: TransferenciaItem.varianteId > Variante.id [delete: restrict]

Ref: Compra.panelId > Panel.id [delete: restrict]
Ref: Compra.proveedorId > Proveedor.id [delete: restrict]
Ref: Compra.depositoId > Deposito.id [delete: restrict]
Ref: Compra.usuarioId > Usuario.id [delete: restrict]
Ref: CompraItem.panelId > Panel.id [delete: restrict]
Ref: CompraItem.compraId > Compra.id [delete: cascade]
Ref: CompraItem.varianteId > Variante.id [delete: restrict]
Ref: CompraItem.productoId > Producto.id [delete: restrict]

Ref: Venta.panelId > Panel.id [delete: restrict]
Ref: Venta.clienteId > Cliente.id [delete: restrict]
Ref: Venta.depositoId > Deposito.id [delete: restrict]
Ref: Venta.usuarioId > Usuario.id [delete: restrict]
Ref: Venta.anuladaPorId > Usuario.id [delete: restrict]
Ref: VentaItem.panelId > Panel.id [delete: restrict]
Ref: VentaItem.ventaId > Venta.id [delete: cascade]
Ref: VentaItem.varianteId > Variante.id [delete: restrict]

Ref: Devolucion.panelId > Panel.id [delete: restrict]
Ref: Devolucion.ventaId > Venta.id [delete: restrict]
Ref: Devolucion.depositoId > Deposito.id [delete: restrict]
Ref: Devolucion.usuarioId > Usuario.id [delete: restrict]
```

## Tablas por dominio

### Paneles

- **Panel**: cada sistema independiente de la app. `slug` (kebab-case) arma las rutas `/p/{slug}` y el prefijo de los IDs visibles (tres primeras letras: `vapes` → `VAP`); la app no deja crear un panel cuyo prefijo choque con otro. `colorAcento` tiñe la interfaz dentro del panel y `etiquetaEspecificacion` es cómo el panel llama al atributo principal de sus productos («Pitadas», «Contenido», «Detalle»). No se borra: se desactiva (`activo = false`) desde `/configuracion/sistemas` y sus datos se conservan. La migración crea **Vapes** (`pnl_vapes`), **Cosmetic** (`pnl_cosmetic`) y **Especiales** (`pnl_especiales`); los dueños agregan otros desde `/paneles`, y cada uno nace con un depósito «Principal» y sus secuencias en cero.
- **Secuencia**: último número usado por (panel, entidad) para `VENTA`, `COMPRA`, `TRANSFERENCIA` y `DEVOLUCION`. `siguienteNumero()` (`src/server/db/secuencia.ts`) la toma con `SELECT … FOR UPDATE` dentro de la transacción que inserta el documento: dos transacciones del mismo panel se serializan y nunca repiten número, y si la transacción falla el número no se consume.
- **Configuracion**: pares clave-valor JSON **por panel**: `escaner` (parámetros de la pistola), `ventas` (redondeo), `alertaStockMinimo` y `prefijoSku`.
- **ConfiguracionGlobal**: pares clave-valor JSON que valen para toda la app: `nombreNegocio`, `iconoApp`, `timezone` y `moneda`.

### Usuarios, sesiones y seguridad

- **Usuario**: personas que entran al sistema. `rol` es `OWNER` (dueño: acceso total a todos los paneles y a lo global) o `EMPLEADO` (acceso según `UsuarioPanel` y `PermisoUsuario`). El email se guarda siempre en minúsculas. `debeCambiarPassword` obliga a pasar por `/cuenta` antes de usar el resto de la app (usuarios nuevos, contraseñas reseteadas y el seed). No se borra: se da de baja (`deletedAt`, `activo = false`).
- **UsuarioPanel**: paneles a los que accede un empleado. Sin fila, el empleado no entra a ese panel (el middleware lo manda a `/paneles`).
- **PermisoUsuario**: una fila por (usuario, panel, módulo) con cuatro banderas: ver, crear, editar, eliminar. Solo módulos de panel (`DASHBOARD` … `REPORTES`); `USUARIOS` y `CONFIGURACION` son exclusivos de los dueños y no tienen filas. Los dueños no necesitan filas. Los permisos no viajan en el token: se leen de la base, así que un cambio aplica al instante.
- **Sesion**: cada inicio de sesión. El JWT de la cookie lleva `sid` (id de esta fila) y `tok` (secreto aleatorio del que acá se guarda solo el sha256). Revocarla (`revocadaAt`, `revocadaPorId`) corta el acceso en el próximo request; el middleware cachea la validación 60 s por instancia.
- **IntentoLogin**: registro de cada intento de login (exitoso o no) para el límite de 5 fallidos por email cada 15 minutos. No es FK a `Usuario`: también se registran emails inexistentes.
- **RateLimit**: contador por clave (`u:<usuarioId>` o `ip:<ip>`) y ventana de un minuto para el rate limit general de `/api/*` y Server Actions.
- **AuditLog**: registro inmutable de quién hizo qué (altas, cambios, bajas, logins, logouts, cambios de permisos, sesiones revocadas y accesos denegados), con el antes y el después en JSON, IP, user agent y el panel donde ocurrió (`null` para acciones globales). Se consulta en `/configuracion/auditoria`.
- **Backup**: un registro por cada backup (`pg_dump`) con el archivo en el bucket, tamaño, duración, si salió bien (verificado con `pg_restore --list`), el error y el origen (`cron`, `manual`, `release`). Inmutable. Se ve en `/configuracion/backups` y alimenta `backup` de `/api/health`.

### Maestros

- **Deposito**: locales o galpones de un panel. Uno solo por panel puede ser el principal. En Vapes: **Ayres Plaza** (principal) y **Mercedes**. No se borra: se desactiva, y solo si no tiene stock y no es el principal.
- **Categoria** y **Marca**: clasificación de productos, con nombre único por panel. No se pueden desactivar si tienen productos activos. La marca es obligatoria en todo producto (la categoría no); el alta de productos crea la marca si no existe. Renombrar una marca recalcula el `nombreCompleto` de sus productos (trigger `trg_marca_renombrada`). La marca «Sin marca» (creada por la migración R2 para los productos que no tenían) no aparece en el nombre completo.
- **Proveedor**: `nombre` es la persona de contacto y `nombreTienda` (obligatorio) el comercio. Teléfono opcional, normalizado igual que el de los clientes (`+54` + dígitos) y único por panel entre los no borrados. `notas` libres (la migración R2 pasó ahí el CUIT, el email y la dirección, que dejaron de ser columnas, y los teléfonos repetidos). Un proveedor inactivo no aparece para compras nuevas; no se desactiva si tiene compras en borrador.
- **ProveedorProducto**: qué productos vende cada proveedor y a cuánto: un `precio` por (proveedor, producto), sin importar el sabor, con su `moneda` (`ARS` o `USD`), cuándo se actualizó y quién lo fijó. Se pisa al editarlo desde la ficha del proveedor o al recibir una compra con «actualizar precio del proveedor» (no guarda historial: el cambio queda en la auditoría). La ficha del producto lista los proveedores de menor a mayor precio (índice `(panelId, productoId, precio)`). Precios y montos comprados solo los ven los dueños o quien tiene `ver` en `COMPRAS` (`veCostosCompras()` en `proveedor.service.ts`).
- **Cliente**: datos de contacto. Documento y teléfono opcionales, cada uno único por panel entre los no borrados. El teléfono se guarda normalizado: `+54` seguido solo de dígitos (la app y la función SQL `fn_normalizar_telefono` aplican la misma regla: se quitan los no-dígitos y los ceros iniciales; si ya empieza con `54` y tiene al menos 12 dígitos se respeta el código de país).

### Catálogo

- **Producto**: **marca** (obligatoria) + **modelo** (`nombre`) + **especificación** (el atributo principal del panel, con la etiqueta `Panel.etiquetaEspecificacion`: «Pitadas» en Vapes). `nombreCompleto` («Elf Bar BC 5000») y `especificacionNorm` («5000», en minúsculas y sin espacios) los mantiene la base con el trigger `trg_producto_derivados`: la app nunca los escribe. La clave (panel, marca, modelo, `especificacionNorm`) es única. Tiene un **precio de venta único** para todos sus sabores, categoría opcional e imagen. Todo producto tiene al menos una variante; uno sin sabores tiene una sola variante «Único» que la interfaz no muestra como sabor.
- **Variante**: el **sabor**, que es lo que realmente se vende, se compra y se cuenta (el stock es por sabor y depósito). Tiene SKU único por panel (`{prefijoSku}-XXXXXX` si no se indica), código de barras principal, stock mínimo, un **precio propio** opcional (`precioVenta`: `null` = usa el del producto; `precioVentaEfectivo()` en `src/lib/precios.ts`) y `ultimoCosto`, el costo de la última compra recibida (lo actualiza `recibirCompra()`; `null` si todavía no hubo compras). El último costo solo lo ven los dueños. Repite el `panelId` de su producto (verificado por trigger) para buscar por código dentro de un panel sin join.
- **CodigoBarrasAlternativo**: otros códigos que identifican a la misma variante (distintos lotes o importadores). Dentro de un panel, un código no puede repetirse entre esta tabla y `Variante.codigoBarras`; en paneles distintos sí.

### Inventario

- **MovimientoStock**: el ledger. Cada entrada o salida de mercadería es una fila inmutable con tipo (`INGRESO_COMPRA`, `INGRESO_MANUAL`, `VENTA`, `DEVOLUCION_CLIENTE`, `DEVOLUCION_PROVEEDOR`, `AJUSTE_POSITIVO`, `AJUSTE_NEGATIVO`, `TRANSFERENCIA_SALIDA`, `TRANSFERENCIA_ENTRADA`), cantidad siempre positiva (el signo lo da el tipo), stock anterior y posterior, costo y referencia al documento que lo originó. Un error se corrige con un ajuste inverso, nunca editando.
- **Stock**: cantidad actual por (variante, depósito). Es un caché del ledger: solo cambia en la misma transacción que inserta el movimiento correspondiente (`registrarMovimiento()` / `transferirStock()` en `stock.service.ts`). La vista **Global** de la app suma todos los depósitos del panel. La carga de stock por escaneo (`cargarStockPorEscaneo()` en `producto.service.ts`) registra un `INGRESO_MANUAL` por sabor en **un** depósito activo elegido, todo en una transacción; sin depósito el servicio la rechaza (`SIN_GALPON`) aunque la llame otro código que no sea la pantalla.
- **Transferencia** y **TransferenciaItem**: envío de mercadería entre depósitos del mismo panel. Nace `PENDIENTE`, se `COMPLETA` (genera la salida y la entrada) o se `ANULA`.

Vistas SQL (no son modelos de Prisma), ambas con `panel_id` para filtrar por panel:

- `vw_stock_consolidado`: stock por variante con el nombre completo del producto (`producto`), el total y un `por_deposito` en JSON (`{ depositoId: cantidad }`).
- `vw_alertas_stock`: variantes activas cuyo stock total (todos los depósitos del panel) está por debajo de su stock mínimo, con el faltante.

### Compras

- **Compra**: mercadería de un proveedor que entra en un galpón. Proveedor y galpón son obligatorios en la app (`proveedorId` sigue siendo nulo en la base solo para compras anteriores a R2). ID visible `VAP-C-000001`. `BORRADOR` (editable, no mueve stock) → `RECIBIDA` (un `INGRESO_COMPRA` por ítem con su costo, `Variante.ultimoCosto` = costo de la compra y, si se elige, el precio del proveedor = costo pagado) → `ANULADA` (si estaba recibida, un `DEVOLUCION_PROVEEDOR` por ítem; falla completa si ya no hay stock en el galpón; no revierte costos ni precios). Los totales se calculan en el servidor y la base verifica que cierren con los ítems. Costos y totales solo los ven los dueños o quien tiene `ver` en `COMPRAS`.
- **CompraItem**: un renglón por **sabor** (`varianteId`) con cantidad y costo unitario. Lleva `productoId` desnormalizado (igual a `variante.productoId`, verificado por trigger) para comparar con los precios de `ProveedorProducto`, que son por producto: si una compra trae varios sabores del mismo producto con costos distintos, el precio del proveedor queda con el del último ítem cargado. El costo sugerido al cargar es el precio en pesos del proveedor para el producto o, si no tiene, el `ultimoCosto` del sabor (`costoSugerido()` en `compra.service.ts`).

### Ventas y devoluciones

- **Venta**: cabecera con depósito, cliente opcional, vendedor, totales, costo congelado (`costoTotal`) y ganancia bruta. Se cobra **completa con un único medio de pago** (`medioPago`, obligatorio al confirmar). `redondeo` es siempre cero o negativo (a favor del cliente). Una venta confirmada no se edita: se anula, registrando quién, cuándo y por qué, y el stock vuelve al depósito.
- **VentaItem**: renglones con precio y costo congelados al momento de vender y descuento por ítem. El precio es el efectivo del sabor (propio o del producto); el costo es un **snapshot** de `Variante.ultimoCosto` (0 si el sabor no tuvo compras; `costoParaVenta()` en `src/lib/precios.ts`), así la ganancia de una venta no cambia con compras posteriores. Costo y ganancia solo se muestran a los dueños.
- **Devolucion**: devolución vinculada a una venta, con depósito de reingreso, motivo y número correlativo por panel. No tiene campos económicos: queda reservada para las devoluciones por garantía (módulo en preparación). Inmutable.

## Invariantes garantizadas por la base

Estas reglas las hace cumplir PostgreSQL (CHECKs, índices y triggers en las migraciones), no solo el código de la app: un script, una consola SQL o un bug no pueden romperlas. Los triggers «diferidos» (`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`) verifican al COMMIT, cuando la transacción ya escribió todas sus filas.

### Aislamiento entre paneles

- Toda tabla de negocio tiene `panelId NOT NULL` con FK a `Panel` y `DEFAULT current_setting('app.panel_id', true)`. Nadie setea esa variable, así que el default es `NULL`: un `INSERT` que olvide el panel **falla** por `NOT NULL` en vez de guardar una fila huérfana. (En la app, `dbPara(panelId)` completa el panel en cada create.)
- `fn_verificar_mismo_panel` (triggers `trg_panel_*`) verifica que cada FK apunte a una fila **del mismo panel**: producto → categoría y marca; variante → producto; precio de proveedor → proveedor y producto; código alternativo → variante; stock y movimiento → variante y depósito; compra → proveedor y depósito; ítems → su documento y su variante; venta → cliente y depósito; devolución → venta y depósito; transferencia → depósitos de origen y destino.
- `panelId` **no se puede cambiar** en ninguna tabla de negocio (el mismo trigger lo rechaza en `UPDATE`).
- Unicidades **por panel**: nombre de depósito, categoría y marca; producto por (marca, modelo, `especificacionNorm`); sabor por (producto, nombre); precio por (proveedor, producto); SKU; código alternativo; número de venta, compra, transferencia y devolución; clave de configuración; (panel, entidad) de secuencia. Índices únicos parciales por panel: un solo depósito principal; código de barras principal, teléfono de proveedor, documento y teléfono de cliente entre los no borrados.
- Código de barras único dentro del panel entre `Variante.codigoBarras` y `CodigoBarrasAlternativo.codigo` (trigger con advisory lock por panel y código, porque un índice no abarca dos tablas). El mismo EAN puede existir en dos paneles.
- `PermisoUsuario.modulo` nunca es `USUARIOS` ni `CONFIGURACION` (son globales, solo para dueños).

### Paneles y numeración

- `Panel`: nombre no vacío; `slug` en kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) de 2 a 40 caracteres; `colorAcento` nulo o `#RRGGBB`; `etiquetaEspecificacion` no vacía. Un panel no se borra (solo se desactiva).
- `Secuencia`: `entidad` en `VENTA`, `COMPRA`, `TRANSFERENCIA`, `DEVOLUCION`; `ultimoNumero ≥ 0`; **solo avanza** (no retrocede ni cambia de panel o entidad) y no se borra, porque reiniciarla duplicaría IDs de venta.

### Inmutabilidad y borrado

- `MovimientoStock` y `AuditLog` son inmutables: triggers rechazan `UPDATE`, `DELETE` y `TRUNCATE`.
- `IntentoLogin` no se edita; `Backup` no se edita ni se borra; `Devolucion` no se edita ni se borra.
- Sin `DELETE` físico en `Usuario`, `Producto`, `Variante`, `Cliente` y `Proveedor` (soft delete), `Deposito` y `Panel` (se desactivan) y `Secuencia`.
- `Venta`, `Compra` y `Transferencia` solo se borran en borrador (o transferencia pendiente): confirmadas, se anulan. Sus transiciones de estado están restringidas (por ejemplo, una venta confirmada solo puede pasar a anulada) y una vez confirmadas no se modifican sus datos ni sus ítems (los ítems de una venta confirmada son inmutables).

### Stock y ledger

- `Stock.cantidad ≥ 0`; `MovimientoStock.cantidad > 0`, `stockAnterior ≥ 0` y `stockPosterior ≥ 0`.
- Cada movimiento tiene que partir del stock real (`stockAnterior` = stock actual) y su aritmética tiene que cerrar según el signo del tipo; no puede dejar stock negativo.
- Un `UPDATE` a `Stock` sin su movimiento en la misma transacción es rechazado, y un movimiento que no se aplicó a `Stock` antes del COMMIT también. Las filas de `Stock` se crean en 0, no se borran y no cambian de variante ni de depósito.
- `INGRESO_COMPRA` exige costo unitario. `referenciaTipo` y `referenciaId` van juntos o no van.
- Una variante con movimientos no puede cambiar de producto.

### Catálogo

- Nombres no vacíos en usuarios, depósitos, categorías, marcas, productos y variantes.
- Precios y stock mínimo ≥ 0: `Producto.precioVenta` (obligatorio), `Variante.precioVenta` y `Variante.ultimoCosto` (nulos o ≥ 0), `ProveedorProducto.precio`. Códigos de barras de 4 a 64 caracteres alfanuméricos o guiones.
- Todo producto no borrado tiene al menos una variante (sabor) no borrada (trigger diferido `trg_producto_variantes`).
- Todo producto tiene marca (`marcaId NOT NULL`); la categoría es opcional.
- `nombreCompleto` y `especificacionNorm` los calcula la base en cada `INSERT`/`UPDATE` de `Producto` (trigger `trg_producto_derivados`, que además colapsa espacios en modelo y especificación) y se recalculan al renombrar la marca (`trg_marca_renombrada`); la marca «Sin marca» no aparece en el nombre. Lo que la app mande en esas columnas se pisa.
- No se desactiva el depósito principal ni un depósito con stock; no se desactiva una categoría o marca con productos activos.

### Clientes y proveedores

- `Cliente.telefono` es nulo o cumple `^\+54[0-9]{6,13}$` (CHECK `Cliente_telefono_chk`).
- Teléfono y documento únicos por panel entre los clientes no borrados.
- `Proveedor.telefono` es nulo o cumple el mismo formato (CHECK `Proveedor_telefono_chk`) y es único por panel entre los proveedores no borrados (índice parcial `proveedor_telefono_unico`).
- `Proveedor.nombreTienda` no vacío (CHECK `Proveedor_nombreTienda_chk`).
- `ProveedorProducto.precio ≥ 0` y una sola fila por (panel, proveedor, producto).

### Compras y ventas

- Totales: `total = subtotal − descuento` en compras; en ventas, `total = subtotal − descuento + redondeo` con `redondeo ≤ 0` y `gananciaBruta = total − costoTotal`; subtotal de cada ítem igual a cantidad × precio (menos descuento en ventas). Al COMMIT se verifica que los totales de la cabecera coincidan con la suma de ítems y que el documento tenga ítems.
- `CompraItem.productoId` es siempre el producto de su variante (trigger `trg_compra_item_producto`).
- Una venta que no está en borrador tiene medio de pago (CHECK `Venta_medioPago_chk`).
- Venta anulada ⇔ tiene `anuladaAt` y `anuladaPorId`.
- Transferencias: origen distinto de destino; `completadaAt` coherente con el estado; al menos un ítem.

### Usuarios y sesiones

- Siempre queda al menos un dueño activo (diferido, con advisory lock para que dos dueños no se degraden mutuamente a la vez).
- Emails de `Usuario` e `IntentoLogin` en minúsculas y sin espacios.
- Un permiso de crear, editar o eliminar exige el de ver.
- Una sesión no cambia de usuario ni de token, y una revocada no se «des-revoca».
- `RateLimit.contador ≥ 0`.
