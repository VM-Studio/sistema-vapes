# Modelo de datos

Base PostgreSQL 16 manejada con Prisma 6. La fuente de verdad es `prisma/schema.prisma`; las reglas que Prisma no sabe expresar (CHECKs, índices únicos parciales, triggers, vistas) viven en las migraciones SQL de `prisma/migrations/` (la reforma multipanel R1 es `20260928160000_reforma_multipanel`; la reforma R2 de catálogo, proveedores y compras es `20260929090000_catalogo_proveedores_compras`).

Convenciones generales:

- **Paneles**: la app son varios sistemas independientes (`Panel`: Vapes, Cosmetic, Especiales y los que se agreguen). Toda tabla de negocio tiene `panelId` y solo puede apuntar a filas de su mismo panel. Lo global (usuarios, sesiones, `ConfiguracionGlobal`, backups, rate limit, auditoría) no pertenece a ningún panel.
- **IDs**: `cuid()` en texto (los paneles, depósitos y secuencias creados por la migración tienen ids fijos: `pnl_vapes`, `pnl_cosmetic`, `pnl_especiales`). Los documentos que ve el usuario (ventas, compras, transferencias, devoluciones) tienen además un `numero` **correlativo por panel** (tabla `Secuencia`). El ID de venta visible es `{3 letras del slug}-{número con 6 dígitos}`: `VAP-000001`; el de compra lleva una `C`: `VAP-C-000001` y el de devolución una `D`: `VAP-D-000001` (`formatearIdVenta` / `formatearIdCompra` en `src/lib/paneles.ts`, `formatearIdDevolucion`). Venta y devolución guardan ese código en la columna `codigo` (única por panel).
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
  DASHBOARD [note: 'Por panel: DASHBOARD..REPORTES (PermisoUsuario con panelId). Globales (solo OWNER, sin filas de permiso): USUARIOS, CONFIGURACION.']
  PROVEEDORES
  PRODUCTOS
  STOCK
  VENTAS
  CLIENTES
  DEVOLUCIONES
  COMPRAS
  COTIZADOR
  REPORTES
  USUARIOS
  CONFIGURACION
}

Enum TipoMovimiento {
  INGRESO_COMPRA
  INGRESO_MANUAL
  VENTA
  DEVOLUCION_CLIENTE [note: 'Histórico (anulación de ventas antes de R3). Nuevas anulaciones: VENTA_ANULADA.']
  DEVOLUCION_PROVEEDOR
  AJUSTE_POSITIVO
  AJUSTE_NEGATIVO
  TRANSFERENCIA_SALIDA
  TRANSFERENCIA_ENTRADA
  GARANTIA [note: 'Egreso: la unidad nueva que se le entrega al cliente por una falla (garantía).']
  GARANTIA_ANULADA [note: 'Ingreso: se anuló una devolución por garantía.']
  VENTA_ANULADA [note: 'Ingreso: se anuló una venta (vuelve la mercadería).']
}

Enum EstadoVenta {
  CONFIRMADA
  ANULADA
}

Enum TipoVenta {
  UNITARIA
  MAYORISTA
}

Enum EstadoDevolucion {
  REGISTRADA
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
  BINANCE
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
  panelId text [not null]
  modulo Modulo [not null]
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

  Note: 'Permisos de un EMPLEADO por panel y módulo. Los OWNER tienen acceso total por rol y no necesitan filas acá (ni en UsuarioPanel).'
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

  Note: 'Paneles a los que accede un EMPLEADO (los OWNER acceden a todos sin filas).'
}

Table Panel {
  id text [pk, default: `cuid()`]
  nombre text [unique, not null]
  slug text [unique, not null, note: 'kebab-case: /p/{slug}. El prefijo del ID de venta sale de acá (VAP-000001).']
  logoUrl text
  colorAcento text [note: 'Hex (#RRGGBB): tiñe botón primario e ítems activos dentro del panel.']
  etiquetaEspecificacion text [not null, note: 'Cómo llama el panel al atributo principal de sus productos ("Pitadas", "Contenido"...).']
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
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  entidad text [not null]
  ultimoNumero int [not null, default: 0]
  updatedAt timestamp [not null]

  indexes {
    (panelId, entidad) [unique]
  }

  Note: 'Numeración correlativa por panel y entidad ("VENTA", "COMPRA", "TRANSFERENCIA", "DEVOLUCION"). Se toma con SELECT ... FOR UPDATE dentro de la transacción.'
}

Table Deposito {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  nombre text [not null]
  direccion text
  activo boolean [not null, default: true]
  esPrincipal boolean [not null, default: false, note: 'Un solo depósito principal por panel (índice único parcial en SQL).']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, nombre) [unique]
  }
}

Table Categoria {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
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
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
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
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  nombre text [not null, note: 'Persona de contacto.']
  telefono text [note: 'Normalizado ("+54" + dígitos). Único por panel entre proveedores no borrados (índice parcial en SQL).']
  nombreTienda text [not null]
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
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  proveedorId text [not null]
  productoId text [not null]
  precio decimal(12,2) [not null]
  moneda Moneda [not null, default: 'ARS']
  actualizadoAt timestamp [not null, default: `now()`]
  usuarioId text [not null, note: 'Quién fijó el precio vigente.']
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, proveedorId, productoId) [unique]
    (panelId, productoId, precio)
  }

  Note: 'Qué vende cada proveedor y a cuánto (precio de compra unitario por producto, sin importar el sabor). Se pisa al editarlo y al recibir una compra con "actualizar precio del proveedor".'
}

Table Cliente {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  nombre text [not null]
  telefono text [not null, note: 'Obligatorio, normalizado "+54" + dígitos. Único por panel entre clientes no borrados (índice único parcial en SQL + CHECK de formato).']
  notas text
  activo boolean [not null, default: true]
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]
  deletedAt timestamp

  indexes {
    (panelId, nombre)
    nombre [type: gin, name: 'cliente_nombre_trgm']
    telefono [type: gin, name: 'cliente_telefono_trgm']
  }
}

Table Producto {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  marcaId text [not null]
  nombre text [not null, note: 'El modelo (ej. "BC").']
  especificacion text [not null, default: '', note: 'El atributo principal del panel (Panel.etiquetaEspecificacion): "5000" pitadas en Vapes.']
  especificacionNorm text [not null, default: '', note: 'Mantenido por trigger: lower(especificacion) sin espacios. Compara "mismo producto".']
  nombreCompleto text [not null, default: '', note: 'Mantenido por trigger: "{Marca} {Modelo} {Especificación}" (búsquedas y toda la UI).']
  categoriaId text
  precioVenta decimal(12,2) [not null, note: 'Precio unitario de venta de todos sus sabores (salvo los que tienen precio propio).']
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

  Note: 'Producto = marca + modelo + especificación ("Elf Bar" + "BC" + "5000"). Todo producto tiene variantes (sabores); uno sin sabor tiene una sola variante "Único" que la UI no muestra como tal.'
}

Table Variante {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")', note: 'Desnormalizado (= Producto.panelId, lo verifica un trigger): buscar por código de barras dentro de un panel no necesita join.']
  productoId text [not null]
  nombre text [not null, note: 'El sabor ("Mango Ice"). "Único" para productos sin sabor.']
  sku text [not null, note: 'Formato PRD-XXXXXX si no se provee. Único por panel.']
  codigoBarras text [note: 'Único por panel (junto con CodigoBarrasAlternativo.codigo) entre variantes no borradas.']
  precioVenta decimal(12,2) [note: 'null = usa Producto.precioVenta. Solo para un sabor con precio distinto.']
  ultimoCosto decimal(12,2) [note: 'Costo de la última compra recibida (snapshot que toma cada venta).']
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

  Note: 'Variante = sabor de un producto. El stock es por variante y depósito.'
}

Table CodigoBarrasAlternativo {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  varianteId text [not null]
  codigo text [not null]
  descripcion text
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, codigo) [unique]
    varianteId
  }

  Note: 'Un mismo producto puede venir con más de un código según lote/importador.'
}

Table Stock {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  varianteId text [not null]
  depositoId text [not null]
  cantidad int [not null, default: 0]
  updatedAt timestamp [not null]

  indexes {
    (panelId, varianteId, depositoId) [unique]
    (panelId, depositoId)
  }

  Note: 'Caché del ledger. NUNCA se actualiza directo: solo vía registrarMovimiento(). Un trigger rechaza cualquier cambio de cantidad sin movimiento en la misma tx.'
}

Table MovimientoStock {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  tipo TipoMovimiento [not null]
  varianteId text [not null]
  depositoId text [not null]
  cantidad int [not null, note: 'Siempre > 0: el signo lo define el tipo.']
  stockAnterior int [not null]
  stockPosterior int [not null]
  costoUnitario decimal(12,2)
  motivo text
  referenciaTipo text [note: '"VENTA" | "COMPRA" | "TRANSFERENCIA" | "AJUSTE" | "DEVOLUCION" (CHECK en DB).']
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

  Note: 'Ledger INMUTABLE. Sin updatedAt. Los errores se corrigen con AJUSTE inverso.'
}

Table Compra {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  numero int [not null, note: 'Correlativo por panel (tabla Secuencia).']
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
    (panelId, numero) [unique]
    (panelId, fecha)
    (panelId, proveedorId)
    (panelId, depositoId)
    usuarioId
  }
}

Table CompraItem {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  compraId text [not null]
  varianteId text [not null]
  productoId text [not null]
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

  Note: 'Se compra por sabor (el stock es por sabor); productoId desnormalizado (= variante.productoId, lo verifica un trigger) para precios por proveedor.'
}

Table Venta {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  numero int [not null, note: 'Correlativo por panel (Secuencia VENTA).']
  codigo text [not null, note: 'ID de venta visible: "VAP-000001". Único por panel.']
  fecha timestamp [not null, default: `now()`]
  clienteId text [not null]
  depositoId text [not null]
  vendedorId text [not null, note: 'Quién la hizo (rendimiento por vendedor).']
  tipo TipoVenta [not null, default: 'UNITARIA']
  estado EstadoVenta [not null, default: 'CONFIRMADA']
  medioPago MedioPago [not null]
  subtotal decimal(12,2) [not null]
  descuento decimal(12,2) [not null, default: 0]
  total decimal(12,2) [not null, note: 'subtotal − descuento (CHECK en DB).']
  costoTotal decimal(12,2) [not null, note: 'Σ cantidad × costoUnitario (snapshot del último costo al vender).']
  gananciaBruta decimal(12,2) [not null, note: 'total − costoTotal (CHECK en DB).']
  notas text
  anuladaPorId text
  motivoAnulacion text
  anuladaAt timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, numero) [unique]
    (panelId, codigo) [unique]
    (panelId, fecha)
    (panelId, vendedorId, fecha)
    (panelId, clienteId)
    (panelId, tipo, fecha)
    (panelId, depositoId, fecha)
  }

  Note: 'Venta: se cobra completa en el momento con un solo medio de pago. Sin galpón, cliente o medio de pago no existe. Inmutable: se anula.'
}

Table VentaItem {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  ventaId text [not null]
  varianteId text [not null]
  productoId text [not null, note: 'Desnormalizado (= variante.productoId, lo verifica un trigger).']
  cantidad int [not null]
  precioLista decimal(12,2) [not null, note: 'precioVentaEfectivo al momento de vender.']
  precioUnitario decimal(12,2) [not null, note: 'Lo cobrado por unidad: el de lista salvo precio especial.']
  esPrecioEspecial boolean [not null, default: false]
  costoUnitario decimal(12,2) [not null, note: 'Snapshot de Variante.ultimoCosto (0 si nunca se compró).']
  subtotal decimal(12,2) [not null, note: 'cantidad × precioUnitario (CHECK en DB).']
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, ventaId, varianteId) [unique]
    (panelId, varianteId)
    (panelId, productoId)
  }
}

Table Devolucion {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  numero int [not null, note: 'Correlativo por panel (Secuencia DEVOLUCION).']
  codigo text [not null, note: 'ID visible: "VAP-D-000001". Único por panel.']
  fecha timestamp [not null, default: `now()`]
  clienteId text [not null]
  ventaId text [note: 'La venta original, si se conoce.']
  depositoId text [not null, note: 'De dónde sale la unidad nueva que se entrega.']
  observacion text [not null, note: 'Por qué se devolvió (mínimo 10 caracteres, CHECK en DB).']
  usuarioId text [not null]
  estado EstadoDevolucion [not null, default: 'REGISTRADA']
  anuladaPorId text
  motivoAnulacion text
  anuladaAt timestamp
  createdAt timestamp [not null, default: `now()`]
  updatedAt timestamp [not null]

  indexes {
    (panelId, numero) [unique]
    (panelId, codigo) [unique]
    (panelId, fecha)
    (panelId, clienteId)
    (panelId, ventaId)
  }

  Note: 'Devolución por GARANTÍA: al cliente se le entrega una unidad nueva, que sale del stock del galpón elegido (movimiento GARANTIA).'
}

Table DevolucionItem {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  devolucionId text [not null]
  varianteId text [not null]
  productoId text [not null, note: 'Desnormalizado (= variante.productoId, lo verifica un trigger).']
  cantidad int [not null]
  createdAt timestamp [not null, default: `now()`]

  indexes {
    (panelId, devolucionId, varianteId) [unique]
    (panelId, varianteId)
  }
}

Table Transferencia {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  numero int [not null, note: 'Correlativo por panel (tabla Secuencia).']
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
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
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

Table Configuracion {
  id text [pk, default: `cuid()`]
  panelId text [not null, default: 'dbgenerated("current_setting('app.panel_id'::text, true)")']
  clave text [not null]
  valor jsonb [not null]
  updatedAt timestamp [not null]

  indexes {
    (panelId, clave) [unique]
  }

  Note: 'Key-value POR PANEL. Claves: escaner, ventas, alertaStockMinimo, prefijoSku.'
}

Table ConfiguracionGlobal {
  id text [pk, default: `cuid()`]
  clave text [unique, not null]
  valor jsonb [not null]
  updatedAt timestamp [not null]

  Note: 'Key-value GLOBAL (fuera de los paneles). Claves: nombreNegocio, iconoApp, timezone.'
}

Table AuditLog {
  id text [pk, default: `cuid()`]
  panelId text
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
    (panelId, createdAt)
    createdAt
  }

  Note: 'INMUTABLE (trigger bloquea UPDATE/DELETE). panelId null = acción global (login, usuarios, configuración).'
}

Ref: Sesion.usuarioId > Usuario.id [delete: cascade]
Ref: Sesion.revocadaPorId > Usuario.id [delete: set null]
Ref: PermisoUsuario.usuarioId > Usuario.id [delete: cascade]
Ref: PermisoUsuario.panelId > Panel.id [delete: restrict]
Ref: UsuarioPanel.usuarioId > Usuario.id [delete: cascade]
Ref: UsuarioPanel.panelId > Panel.id [delete: restrict]
Ref: Secuencia.panelId > Panel.id [delete: restrict]
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
Ref: Venta.vendedorId > Usuario.id [delete: restrict]
Ref: Venta.anuladaPorId > Usuario.id [delete: restrict]
Ref: VentaItem.panelId > Panel.id [delete: restrict]
Ref: VentaItem.ventaId > Venta.id [delete: cascade]
Ref: VentaItem.varianteId > Variante.id [delete: restrict]
Ref: VentaItem.productoId > Producto.id [delete: restrict]
Ref: Devolucion.panelId > Panel.id [delete: restrict]
Ref: Devolucion.clienteId > Cliente.id [delete: restrict]
Ref: Devolucion.ventaId > Venta.id [delete: restrict]
Ref: Devolucion.depositoId > Deposito.id [delete: restrict]
Ref: Devolucion.usuarioId > Usuario.id [delete: restrict]
Ref: Devolucion.anuladaPorId > Usuario.id [delete: restrict]
Ref: DevolucionItem.panelId > Panel.id [delete: restrict]
Ref: DevolucionItem.devolucionId > Devolucion.id [delete: cascade]
Ref: DevolucionItem.varianteId > Variante.id [delete: restrict]
Ref: DevolucionItem.productoId > Producto.id [delete: restrict]
Ref: Transferencia.panelId > Panel.id [delete: restrict]
Ref: Transferencia.depositoOrigenId > Deposito.id [delete: restrict]
Ref: Transferencia.depositoDestinoId > Deposito.id [delete: restrict]
Ref: Transferencia.usuarioId > Usuario.id [delete: restrict]
Ref: TransferenciaItem.panelId > Panel.id [delete: restrict]
Ref: TransferenciaItem.transferenciaId > Transferencia.id [delete: cascade]
Ref: TransferenciaItem.varianteId > Variante.id [delete: restrict]
Ref: Configuracion.panelId > Panel.id [delete: restrict]
Ref: AuditLog.panelId > Panel.id [delete: restrict]
Ref: AuditLog.usuarioId > Usuario.id [delete: restrict]
```

## Tablas por dominio

### Paneles

- **Panel**: cada sistema independiente de la app. `slug` (kebab-case) arma las rutas `/p/{slug}` y el prefijo de los IDs visibles (tres primeras letras: `vapes` → `VAP`); la app no deja crear un panel cuyo prefijo choque con otro. `colorAcento` tiñe la interfaz dentro del panel y `etiquetaEspecificacion` es cómo el panel llama al atributo principal de sus productos («Pitadas», «Contenido», «Detalle»). No se borra: se desactiva (`activo = false`) desde `/configuracion/sistemas` y sus datos se conservan. La migración crea **Vapes** (`pnl_vapes`), **Cosmetic** (`pnl_cosmetic`) y **Especiales** (`pnl_especiales`); los dueños agregan otros desde `/paneles`, y cada uno nace con un depósito «Principal» y sus secuencias en cero.
- **Secuencia**: último número usado por (panel, entidad) para `VENTA`, `COMPRA`, `TRANSFERENCIA`, `DEVOLUCION` y `COTIZACION`. `siguienteNumero()` (`src/server/db/secuencia.ts`) la toma con `SELECT … FOR UPDATE` dentro de la transacción que inserta el documento: dos transacciones del mismo panel se serializan y nunca repiten número, y si la transacción falla el número no se consume.
- **Configuracion**: pares clave-valor JSON **por panel**: `escaner` (parámetros de la pistola), `ventas`, `cotizacion`, `alertaStockMinimo` y `prefijoSku`.
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
- **Cliente**: `nombre`, `telefono` **obligatorio** (único por panel entre los no borrados) y `notas`. El teléfono se guarda normalizado: `+54` seguido solo de dígitos (la app y la función SQL `fn_normalizar_telefono` aplican la misma regla: se quitan los no-dígitos y los ceros iniciales; si ya empieza con `54` y tiene al menos 12 dígitos se respeta el código de país). Desde R3 no hay apellido, documento, email ni dirección (la migración los pasó al nombre y a las notas; los clientes sin teléfono recibieron uno provisorio `+54000…` anotado en las notas, y las ventas sin cliente quedaron en «Cliente sin datos»).

### Catálogo

- **Producto**: **marca** (obligatoria) + **modelo** (`nombre`) + **especificación** (el atributo principal del panel, con la etiqueta `Panel.etiquetaEspecificacion`: «Pitadas» en Vapes). `nombreCompleto` («Elf Bar BC 5000») y `especificacionNorm` («5000», en minúsculas y sin espacios) los mantiene la base con el trigger `trg_producto_derivados`: la app nunca los escribe. La clave (panel, marca, modelo, `especificacionNorm`) es única. Tiene un **precio de venta único** para todos sus sabores, categoría opcional e imagen. Todo producto tiene al menos una variante; uno sin sabores tiene una sola variante «Único» que la interfaz no muestra como sabor.
- **Variante**: el **sabor**, que es lo que realmente se vende, se compra y se cuenta (el stock es por sabor y depósito). Tiene SKU único por panel (`{prefijoSku}-XXXXXX` si no se indica), código de barras principal, stock mínimo, un **precio propio** opcional (`precioVenta`: `null` = usa el del producto; `precioVentaEfectivo()` en `src/lib/precios.ts`) y `ultimoCosto`, el costo de la última compra recibida (lo actualiza `recibirCompra()`; `null` si todavía no hubo compras). El último costo solo lo ven los dueños. Repite el `panelId` de su producto (verificado por trigger) para buscar por código dentro de un panel sin join.
- **CodigoBarrasAlternativo**: otros códigos que identifican a la misma variante (distintos lotes o importadores). Dentro de un panel, un código no puede repetirse entre esta tabla y `Variante.codigoBarras`; en paneles distintos sí.

### Inventario

- **MovimientoStock**: el ledger. Cada entrada o salida de mercadería es una fila inmutable con tipo (entradas: `INGRESO_COMPRA`, `INGRESO_MANUAL`, `TRANSFERENCIA_ENTRADA`, `AJUSTE_POSITIVO`, `VENTA_ANULADA`, `GARANTIA_ANULADA` y el histórico `DEVOLUCION_CLIENTE`; salidas: `VENTA`, `GARANTIA`, `DEVOLUCION_PROVEEDOR`, `AJUSTE_NEGATIVO`, `TRANSFERENCIA_SALIDA`; el signo lo define `fn_signo_movimiento()`, espejo de `signoMovimiento()` y de `TIPO_MOVIMIENTO_UI`), cantidad siempre positiva (el signo lo da el tipo), stock anterior y posterior, costo y referencia al documento que lo originó. Un error se corrige con un ajuste inverso, nunca editando.
- **Stock**: cantidad actual por (variante, depósito). Es un caché del ledger: solo cambia en la misma transacción que inserta el movimiento correspondiente (`registrarMovimiento()` / `transferirStock()` en `stock.service.ts`). La vista **Global** de la app suma todos los depósitos del panel. La carga de stock por escaneo (`cargarStockPorEscaneo()` en `producto.service.ts`) registra un `INGRESO_MANUAL` por sabor en **un** depósito activo elegido, todo en una transacción; sin depósito el servicio la rechaza (`SIN_GALPON`) aunque la llame otro código que no sea la pantalla.
- **Transferencia** y **TransferenciaItem**: envío de mercadería entre depósitos del mismo panel. Nace `PENDIENTE`, se `COMPLETA` (genera la salida y la entrada) o se `ANULA`. «Transferir a {otro galpón}» desde la pantalla de Stock (`transferirAhora()`) la crea y la completa en la misma transacción.
- Lecturas de la pantalla Stock (`stock.service.ts`): `stockPorDeposito()`, `stockGlobal()` (sobre `vw_stock_consolidado`), `movimientos()` (ledger con referencia visible: `VAP-000001`, `VAP-C-000001`, `VAP-D-000001`, «Transferencia #N») y `resumenStock()`.

Vistas SQL (no son modelos de Prisma), ambas con `panel_id` para filtrar por panel:

- `vw_stock_consolidado`: stock por variante con el nombre completo del producto (`producto`), el total y un `por_deposito` en JSON (`{ depositoId: cantidad }`).
- `vw_alertas_stock`: variantes activas cuyo stock total (todos los depósitos del panel) está por debajo de su stock mínimo, con el faltante.

### Compras

- **Compra**: mercadería de un proveedor que entra en un galpón. Proveedor y galpón son obligatorios en la app (`proveedorId` sigue siendo nulo en la base solo para compras anteriores a R2). ID visible `VAP-C-000001`. `BORRADOR` (editable, no mueve stock) → `RECIBIDA` (un `INGRESO_COMPRA` por ítem con su costo, `Variante.ultimoCosto` = costo de la compra y, si se elige, el precio del proveedor = costo pagado) → `ANULADA` (si estaba recibida, un `DEVOLUCION_PROVEEDOR` por ítem; falla completa si ya no hay stock en el galpón; no revierte costos ni precios). Los totales se calculan en el servidor y la base verifica que cierren con los ítems. Costos y totales solo los ven los dueños o quien tiene `ver` en `COMPRAS`.
- **CompraItem**: un renglón por **sabor** (`varianteId`) con cantidad y costo unitario. Lleva `productoId` desnormalizado (igual a `variante.productoId`, verificado por trigger) para comparar con los precios de `ProveedorProducto`, que son por producto: si una compra trae varios sabores del mismo producto con costos distintos, el precio del proveedor queda con el del último ítem cargado. El costo sugerido al cargar es el precio en pesos del proveedor para el producto o, si no tiene, el `ultimoCosto` del sabor (`costoSugerido()` en `compra.service.ts`).

### Ventas y devoluciones

- **Venta**: siempre `CONFIRMADA` al crearse (no hay borradores) o `ANULADA`. Tiene `codigo` visible único por panel (`VAP-000001` = `formatearIdVenta(slug, numero)`), galpón, **cliente** y **medio de pago** obligatorios (`EFECTIVO`, `TRANSFERENCIA` o `BINANCE`), `vendedorId`, `tipo` (`UNITARIA` / `MAYORISTA`), descuento global, costo congelado (`costoTotal`) y ganancia bruta. Se cobra completa con un único medio. No se edita: se anula (quién, cuándo, por qué) y el stock vuelve con `VENTA_ANULADA`.
- **VentaItem**: un renglón por sabor con `productoId` desnormalizado (verificado por trigger), `precioLista` (el precio efectivo al vender), `precioUnitario` (lo cobrado), `esPrecioEspecial` y `costoUnitario` (snapshot de `Variante.ultimoCosto`, 0 si no hubo compras; `costoParaVenta()`). Subtotal = cantidad × precio cobrado. Costo y ganancia solo se muestran a los dueños.
- **Devolucion** (garantía): cliente obligatorio, venta opcional, galpón del que sale la **unidad nueva** que se entrega (`GARANTIA` por ítem), `observacion` de al menos 10 caracteres, código `VAP-D-000001` (secuencia `DEVOLUCION`). `REGISTRADA` → `ANULADA` (con motivo; el stock vuelve con `GARANTIA_ANULADA`); no se edita ni se borra.
- **DevolucionItem**: sabor, producto (verificado por trigger) y cantidad > 0. Inmutable.

### Cotizador

- **EscalonPrecio**: precio mayorista de un producto desde `cantidadMinima` unidades, para **todos** sus sabores (20 Mango + 35 Frutilla entran en el escalón de 50). Único por (panel, producto, cantidad mínima); `cantidadMinima > 0`, `precioUnitario > 0`. Se editan como set completo (`guardarEscalones()` en `escalon.service.ts`: mínimos distintos y precios que bajan al subir la cantidad).
- **EscalonPrecioDefault**: escalones del panel como % de descuento sobre la lista (0–100), para productos sin escalones propios activos. El precio resultante se redondea a 10 pesos.
- **Cotizacion**: código `VAP-Q-000001` (secuencia `COTIZACION`, `formatearIdCotizacion()` en `src/lib/validations/cotizacion.ts`), `tipo` `UNITARIA` / `MAYORISTA`, `validaHasta`, cliente opcional (o nombre y teléfono de alguien que todavía no es cliente), `vendedorId`, totales (`total = subtotal − descuento`, CHECK) y estado `BORRADOR` → `ENVIADA` → `ACEPTADA` / `RECHAZADA`; las borrador/enviadas pasan a `VENCIDA` al pasar la validez; `CONVERTIDA` ⇔ tiene `ventaId` (CHECK) y desde ahí no se modifica (trigger `trg_cotizacion_convertida`). No se borra físicamente.
- **CotizacionItem**: sabor, producto (verificado por trigger), cantidad, `precioLista`, `precioUnitario` cotizado (lista, escalón o manual), `escalonAplicado` y `esPrecioManual`; subtotal = cantidad × precio (CHECK).
- Motor de precios (`precio.service.ts`): unitaria = lista; mayorista = escalón por unidades del producto (`POR_PRODUCTO`) o de toda la cotización (`POR_TOTAL`), según la configuración `cotizacion` del panel (`validezDias`, `modoEscalonMayorista`, `leyenda`, `mostrarStock`). El precio manual y el descuento exigen `editar` en `COTIZADOR`.
- Convertir (`convertirEnVenta()`) crea la venta (con `Venta.cotizacionId`, precios cotizados como precio especial, tipo de la cotización) y marca la cotización `CONVERTIDA` en una sola transacción: si falta stock no cambia nada.

## Invariantes garantizadas por la base

Estas reglas las hace cumplir PostgreSQL (CHECKs, índices y triggers en las migraciones), no solo el código de la app: un script, una consola SQL o un bug no pueden romperlas. Los triggers «diferidos» (`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`) verifican al COMMIT, cuando la transacción ya escribió todas sus filas.

### Aislamiento entre paneles

- Toda tabla de negocio tiene `panelId NOT NULL` con FK a `Panel` y `DEFAULT current_setting('app.panel_id', true)`. Nadie setea esa variable, así que el default es `NULL`: un `INSERT` que olvide el panel **falla** por `NOT NULL` en vez de guardar una fila huérfana. (En la app, `dbPara(panelId)` completa el panel en cada create.)
- `fn_verificar_mismo_panel` (triggers `trg_panel_*`) verifica que cada FK apunte a una fila **del mismo panel**: producto → categoría y marca; variante → producto; precio de proveedor → proveedor y producto; código alternativo → variante; stock y movimiento → variante y depósito; compra → proveedor y depósito; ítems → su documento y su variante; venta → cliente y depósito; devolución → cliente, venta y depósito; transferencia → depósitos de origen y destino.
- `panelId` **no se puede cambiar** en ninguna tabla de negocio (el mismo trigger lo rechaza en `UPDATE`).
- Unicidades **por panel**: nombre de depósito, categoría y marca; producto por (marca, modelo, `especificacionNorm`); sabor por (producto, nombre); precio por (proveedor, producto); SKU; código alternativo; número de venta, compra, transferencia y devolución; código de venta y de devolución; clave de configuración; (panel, entidad) de secuencia. Índices únicos parciales por panel: un solo depósito principal; código de barras principal, teléfono de proveedor y teléfono de cliente entre los no borrados.
- Código de barras único dentro del panel entre `Variante.codigoBarras` y `CodigoBarrasAlternativo.codigo` (trigger con advisory lock por panel y código, porque un índice no abarca dos tablas). El mismo EAN puede existir en dos paneles.
- `PermisoUsuario.modulo` nunca es `USUARIOS` ni `CONFIGURACION` (son globales, solo para dueños).

### Paneles y numeración

- `Panel`: nombre no vacío; `slug` en kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) de 2 a 40 caracteres; `colorAcento` nulo o `#RRGGBB`; `etiquetaEspecificacion` no vacía. Un panel no se borra (solo se desactiva).
- `Secuencia`: `entidad` en `VENTA`, `COMPRA`, `TRANSFERENCIA`, `DEVOLUCION`; `ultimoNumero ≥ 0`; **solo avanza** (no retrocede ni cambia de panel o entidad) y no se borra, porque reiniciarla duplicaría IDs de venta.

### Inmutabilidad y borrado

- `MovimientoStock` y `AuditLog` son inmutables: triggers rechazan `UPDATE`, `DELETE` y `TRUNCATE`.
- `IntentoLogin` no se edita; `Backup` no se edita ni se borra; `Devolucion` no se borra y solo cambia para anularse; `DevolucionItem` es inmutable.
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

- `Cliente.telefono` es obligatorio y cumple `^\+54[0-9]{6,13}$` (CHECK `Cliente_telefono_chk`); nombre no vacío (`Cliente_nombre_chk`).
- Teléfono único por panel entre los clientes no borrados.
- `Proveedor.telefono` es nulo o cumple el mismo formato (CHECK `Proveedor_telefono_chk`) y es único por panel entre los proveedores no borrados (índice parcial `proveedor_telefono_unico`).
- `Proveedor.nombreTienda` no vacío (CHECK `Proveedor_nombreTienda_chk`).
- `ProveedorProducto.precio ≥ 0` y una sola fila por (panel, proveedor, producto).

### Compras y ventas

- Totales: `total = subtotal − descuento` en compras y ventas (`Venta_total_chk`), con `gananciaBruta = total − costoTotal`; subtotal de cada ítem igual a cantidad × precio (`VentaItem_subtotal_chk`: cantidad × precio cobrado). Al COMMIT se verifica que los totales de la cabecera coincidan con la suma de ítems y que el documento tenga ítems.
- `productoId` de `CompraItem`, `VentaItem` y `DevolucionItem` es siempre el producto de su variante (`trg_fn_item_producto_coherente`).
- Venta: cliente, galpón y medio de pago `NOT NULL`; código único por panel; confirmada solo pasa a anulada y no se modifica; anulada ⇔ tiene `anuladaAt` y `anuladaPorId`.
- Devolución: `observacion` ≥ 10 caracteres (`Devolucion_observacion_chk`); anulada ⇔ `anuladaAt` y `anuladaPorId`; cliente, venta y galpón del mismo panel.
- Transferencias: origen distinto de destino; `completadaAt` coherente con el estado; al menos un ítem.

### Usuarios y sesiones

- Siempre queda al menos un dueño activo (diferido, con advisory lock para que dos dueños no se degraden mutuamente a la vez).
- Emails de `Usuario` e `IntentoLogin` en minúsculas y sin espacios.
- Un permiso de crear, editar o eliminar exige el de ver.
- Una sesión no cambia de usuario ni de token, y una revocada no se «des-revoca».
- `RateLimit.contador ≥ 0`.
