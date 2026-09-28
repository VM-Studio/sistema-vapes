-- =============================================================================
-- REFORMA R1: MULTIPANEL + LIMPIEZA DE MÓDULOS
--
-- 1. Se eliminan: caja y arqueos, gastos, cuenta corriente y saldos de clientes,
--    pagos partidos (PagoVenta), comprobantes y su numeración, devoluciones con
--    reintegro (DevolucionItem y campos económicos de Devolucion), historial de
--    precios, notificaciones, ResumenDiario y la cola offline (OperacionSincronizada).
-- 2. Tabla Panel ("Vapes", "Cosmetic", "Especiales") y panelId en toda tabla de
--    negocio. Todo lo existente pasa a Vapes; sus depósitos se renombran
--    ("Galpón 1" → "Ayres Plaza", "Galpón 2" → "Mercedes").
-- 3. Unicidades, índices y numeración (tabla Secuencia) por panel.
-- 4. Acceso de usuarios por panel (UsuarioPanel) y permisos por panel.
-- 5. La DB garantiza el aislamiento: cada fila solo puede apuntar a filas de su
--    mismo panel y panelId no cambia nunca (fn_verificar_mismo_panel).
--
-- Los panelId se agregan con DEFAULT constante (id de Vapes): Postgres no
-- reescribe ni dispara triggers de fila, así el ledger y los documentos
-- inmutables no se "modifican". Después el DEFAULT pasa a
-- current_setting('app.panel_id') (nadie lo setea: un INSERT sin panel falla).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Triggers, funciones y vistas que dependen de lo que se elimina
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS vw_stock_consolidado;
DROP VIEW IF EXISTS vw_alertas_stock;

DROP FUNCTION IF EXISTS trg_fn_verificar_ventas() CASCADE;
DROP FUNCTION IF EXISTS fn_verificar_pagos_venta(text) CASCADE;
DROP FUNCTION IF EXISTS fn_verificar_saldo_cliente(text) CASCADE;
DROP FUNCTION IF EXISTS fn_verificar_devolucion(text) CASCADE;
DROP FUNCTION IF EXISTS fn_verificar_devuelto(text) CASCADE;
DROP FUNCTION IF EXISTS trg_fn_pago_venta() CASCADE;
DROP FUNCTION IF EXISTS trg_fn_comprobante() CASCADE;
DROP FUNCTION IF EXISTS trg_fn_secuencia_avanza() CASCADE;
DROP FUNCTION IF EXISTS trg_fn_caja() CASCADE;
DROP FUNCTION IF EXISTS trg_fn_movimiento_caja_nuevo() CASCADE;
DROP FUNCTION IF EXISTS trg_fn_devolucion_item_nuevo() CASCADE;
DROP FUNCTION IF EXISTS trg_fn_operacion_sync() CASCADE;
DROP FUNCTION IF EXISTS validar_historial_precio() CASCADE;
DROP FUNCTION IF EXISTS autorizar_cambio_precio() CASCADE;
DROP FUNCTION IF EXISTS proteger_precio_variante() CASCADE;
DROP FUNCTION IF EXISTS verificar_historial_aplicado() CASCADE;
DROP FUNCTION IF EXISTS fn_precio_guc_key(text) CASCADE;
DROP FUNCTION IF EXISTS trg_fn_deposito_rebuild_vista() CASCADE;
DROP FUNCTION IF EXISTS fn_rebuild_vw_stock_consolidado() CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Tablas eliminadas
-- -----------------------------------------------------------------------------

DROP TABLE "PagoVenta";
DROP TABLE "MovimientoCaja";
DROP TABLE "Gasto";
DROP TABLE "Caja";
DROP TABLE "CategoriaGasto";
DROP TABLE "Comprobante";
DROP TABLE "SecuenciaComprobante";
DROP TABLE "DevolucionItem";
DROP TABLE "HistorialPrecio";
DROP TABLE "Notificacion";
DROP TABLE "OperacionSincronizada";
DROP TABLE "ResumenDiario";

-- Columnas eliminadas (sus CHECK se van con ellas).
ALTER TABLE "Cliente"
  DROP COLUMN "limiteCredito",
  DROP COLUMN "saldoAFavor",
  DROP COLUMN "saldoDeudor";

ALTER TABLE "Devolucion"
  DROP COLUMN "aCuentaCorriente",
  DROP COLUMN "reintegroMedioPago",
  DROP COLUMN "reintegroMonto",
  DROP COLUMN "total";

ALTER TABLE "VentaItem" DROP COLUMN "cantidadDevuelta";

-- Una venta confirmada se cobra completa con un único medio: las que estaban
-- (total o parcialmente) en cuenta corriente o con saldo a favor quedan "OTRO".
ALTER TABLE "Venta" DISABLE TRIGGER trg_venta_estado;
UPDATE "Venta" SET "medioPago" = 'OTRO'
WHERE "estado" <> 'BORRADOR' AND ("medioPago" IS NULL OR "medioPago" = 'CREDITO_CLIENTE');
UPDATE "Venta" SET "medioPago" = NULL WHERE "medioPago" = 'CREDITO_CLIENTE';
-- Los triggers diferidos (totales) se verifican ya: un ALTER TABLE no admite eventos pendientes.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "Venta" ENABLE TRIGGER trg_venta_estado;

ALTER TABLE "Venta"
  DROP COLUMN "estadoPago",
  DROP COLUMN "montoPagado",
  DROP COLUMN "saldoPendiente";

-- -----------------------------------------------------------------------------
-- 3. Enums
-- -----------------------------------------------------------------------------

DROP TYPE "EstadoCaja";
DROP TYPE "EstadoComprobante";
DROP TYPE "EstadoOperacionSync";
DROP TYPE "EstadoPago";
DROP TYPE "TipoComprobante";
DROP TYPE "TipoMovimientoCaja";
DROP TYPE "TipoNotificacion";

CREATE TYPE "MedioPago_new" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'DEBITO', 'CREDITO', 'MERCADOPAGO', 'OTRO');
ALTER TABLE "Venta" ALTER COLUMN "medioPago" TYPE "MedioPago_new" USING ("medioPago"::text::"MedioPago_new");
ALTER TYPE "MedioPago" RENAME TO "MedioPago_old";
ALTER TYPE "MedioPago_new" RENAME TO "MedioPago";
DROP TYPE "MedioPago_old";

-- -----------------------------------------------------------------------------
-- 4. Paneles
-- -----------------------------------------------------------------------------

CREATE TABLE "Panel" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "colorAcento" TEXT,
    "etiquetaEspecificacion" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Panel_nombre_key" ON "Panel"("nombre");
CREATE UNIQUE INDEX "Panel_slug_key" ON "Panel"("slug");
CREATE INDEX "Panel_activo_orden_idx" ON "Panel"("activo", "orden");

ALTER TABLE "Panel"
  ADD CONSTRAINT "Panel_nombre_chk" CHECK (btrim("nombre") <> ''),
  ADD CONSTRAINT "Panel_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") BETWEEN 2 AND 40),
  ADD CONSTRAINT "Panel_colorAcento_chk" CHECK ("colorAcento" IS NULL OR "colorAcento" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "Panel_etiqueta_chk" CHECK (btrim("etiquetaEspecificacion") <> '');

CREATE TRIGGER trg_panel_no_delete BEFORE DELETE ON "Panel"
  FOR EACH ROW EXECUTE FUNCTION prevent_delete('desactivalo (activo = false)');

INSERT INTO "Panel" ("id", "nombre", "slug", "logoUrl", "etiquetaEspecificacion", "orden", "updatedAt") VALUES
  ('pnl_vapes',      'Vapes',      'vapes',      '/logoVapes.png',     'Pitadas',   1, CURRENT_TIMESTAMP),
  ('pnl_cosmetic',   'Cosmetic',   'cosmetic',   '/logoCosmetics.png', 'Contenido', 2, CURRENT_TIMESTAMP),
  ('pnl_especiales', 'Especiales', 'especiales', '/logoEspecial.png',  'Detalle',   3, CURRENT_TIMESTAMP);

-- -----------------------------------------------------------------------------
-- 5. panelId en las tablas de negocio (todo lo existente → Vapes)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Deposito', 'Categoria', 'Marca', 'Proveedor', 'Cliente', 'Producto', 'Variante',
    'CodigoBarrasAlternativo', 'Stock', 'MovimientoStock', 'Compra', 'CompraItem',
    'Venta', 'VentaItem', 'Devolucion', 'Transferencia', 'TransferenciaItem', 'Configuracion'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "panelId" TEXT NOT NULL DEFAULT %L', t, 'pnl_vapes');
    EXECUTE format($f$ALTER TABLE %I ALTER COLUMN "panelId" SET DEFAULT current_setting('app.panel_id'::text, true)$f$, t);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
      t, t || '_panelId_fkey');
  END LOOP;
END $$;

ALTER TABLE "AuditLog" ADD COLUMN "panelId" TEXT;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_panelId_fkey"
  FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Numeración: deja de ser autoincrement global (pasa a Secuencia por panel).
ALTER TABLE "Venta"         ALTER COLUMN "numero" DROP DEFAULT;
ALTER TABLE "Compra"        ALTER COLUMN "numero" DROP DEFAULT;
ALTER TABLE "Transferencia" ALTER COLUMN "numero" DROP DEFAULT;
ALTER TABLE "Devolucion"    ALTER COLUMN "numero" DROP DEFAULT;
DROP SEQUENCE "Venta_numero_seq";
DROP SEQUENCE "Compra_numero_seq";
DROP SEQUENCE "Transferencia_numero_seq";
DROP SEQUENCE "Devolucion_numero_seq";

-- -----------------------------------------------------------------------------
-- 6. Índices: unicidades y búsquedas por panel
-- -----------------------------------------------------------------------------

DROP INDEX "Categoria_nombre_key";
DROP INDEX "CodigoBarrasAlternativo_codigo_key";
DROP INDEX "Compra_depositoId_idx";
DROP INDEX "Compra_fecha_idx";
DROP INDEX "Compra_numero_key";
DROP INDEX "Compra_proveedorId_idx";
DROP INDEX "CompraItem_varianteId_idx";
DROP INDEX "Configuracion_clave_key";
DROP INDEX "Deposito_nombre_key";
DROP INDEX "Devolucion_depositoId_fecha_idx";
DROP INDEX "Devolucion_fecha_idx";
DROP INDEX "Devolucion_numero_key";
DROP INDEX "Devolucion_ventaId_idx";
DROP INDEX "Marca_nombre_key";
DROP INDEX "MovimientoStock_createdAt_idx";
DROP INDEX "MovimientoStock_depositoId_idx";
DROP INDEX "MovimientoStock_varianteId_depositoId_createdAt_idx";
DROP INDEX "PermisoUsuario_usuarioId_modulo_key";
DROP INDEX "Producto_categoriaId_idx";
DROP INDEX "Producto_marcaId_idx";
DROP INDEX "Producto_nombre_marcaId_key";
DROP INDEX "Stock_depositoId_idx";
DROP INDEX "Stock_varianteId_depositoId_key";
DROP INDEX "Transferencia_fecha_idx";
DROP INDEX "Transferencia_numero_key";
DROP INDEX "TransferenciaItem_varianteId_idx";
DROP INDEX "Variante_sku_key";
DROP INDEX "Venta_clienteId_estado_idx";
DROP INDEX "Venta_depositoId_fecha_idx";
DROP INDEX "Venta_estado_fecha_idx";
DROP INDEX "Venta_fecha_idx";
DROP INDEX "Venta_numero_key";
DROP INDEX "Venta_usuarioId_fecha_idx";
DROP INDEX "VentaItem_varianteId_idx";
DROP INDEX deposito_principal_unico;
DROP INDEX variante_codigo_barras_unico;
DROP INDEX proveedor_cuit_unico;
DROP INDEX cliente_documento_unico;

CREATE INDEX "AuditLog_panelId_createdAt_idx" ON "AuditLog"("panelId", "createdAt");
CREATE UNIQUE INDEX "Categoria_panelId_nombre_key" ON "Categoria"("panelId", "nombre");
CREATE INDEX "Cliente_panelId_nombre_idx" ON "Cliente"("panelId", "nombre");
CREATE UNIQUE INDEX "CodigoBarrasAlternativo_panelId_codigo_key" ON "CodigoBarrasAlternativo"("panelId", "codigo");
CREATE INDEX "Compra_panelId_fecha_idx" ON "Compra"("panelId", "fecha");
CREATE INDEX "Compra_panelId_proveedorId_idx" ON "Compra"("panelId", "proveedorId");
CREATE INDEX "Compra_panelId_depositoId_idx" ON "Compra"("panelId", "depositoId");
CREATE UNIQUE INDEX "Compra_panelId_numero_key" ON "Compra"("panelId", "numero");
CREATE INDEX "CompraItem_panelId_varianteId_idx" ON "CompraItem"("panelId", "varianteId");
CREATE UNIQUE INDEX "Configuracion_panelId_clave_key" ON "Configuracion"("panelId", "clave");
CREATE UNIQUE INDEX "Deposito_panelId_nombre_key" ON "Deposito"("panelId", "nombre");
CREATE INDEX "Devolucion_panelId_ventaId_idx" ON "Devolucion"("panelId", "ventaId");
CREATE INDEX "Devolucion_panelId_fecha_idx" ON "Devolucion"("panelId", "fecha");
CREATE UNIQUE INDEX "Devolucion_panelId_numero_key" ON "Devolucion"("panelId", "numero");
CREATE UNIQUE INDEX "Marca_panelId_nombre_key" ON "Marca"("panelId", "nombre");
CREATE INDEX "MovimientoStock_panelId_varianteId_depositoId_createdAt_idx" ON "MovimientoStock"("panelId", "varianteId", "depositoId", "createdAt");
CREATE INDEX "MovimientoStock_panelId_createdAt_idx" ON "MovimientoStock"("panelId", "createdAt");
CREATE INDEX "MovimientoStock_panelId_depositoId_createdAt_idx" ON "MovimientoStock"("panelId", "depositoId", "createdAt");
CREATE INDEX "Producto_panelId_categoriaId_idx" ON "Producto"("panelId", "categoriaId");
CREATE INDEX "Producto_panelId_marcaId_idx" ON "Producto"("panelId", "marcaId");
CREATE UNIQUE INDEX "Producto_panelId_nombre_marcaId_key" ON "Producto"("panelId", "nombre", "marcaId");
CREATE INDEX "Proveedor_panelId_nombre_idx" ON "Proveedor"("panelId", "nombre");
CREATE INDEX "Stock_panelId_depositoId_idx" ON "Stock"("panelId", "depositoId");
CREATE UNIQUE INDEX "Stock_panelId_varianteId_depositoId_key" ON "Stock"("panelId", "varianteId", "depositoId");
CREATE INDEX "Transferencia_panelId_fecha_idx" ON "Transferencia"("panelId", "fecha");
CREATE INDEX "Transferencia_panelId_estado_idx" ON "Transferencia"("panelId", "estado");
CREATE UNIQUE INDEX "Transferencia_panelId_numero_key" ON "Transferencia"("panelId", "numero");
CREATE INDEX "TransferenciaItem_panelId_varianteId_idx" ON "TransferenciaItem"("panelId", "varianteId");
CREATE UNIQUE INDEX "Variante_panelId_sku_key" ON "Variante"("panelId", "sku");
CREATE INDEX "Venta_panelId_fecha_idx" ON "Venta"("panelId", "fecha");
CREATE INDEX "Venta_panelId_estado_fecha_idx" ON "Venta"("panelId", "estado", "fecha");
CREATE INDEX "Venta_panelId_clienteId_estado_idx" ON "Venta"("panelId", "clienteId", "estado");
CREATE INDEX "Venta_panelId_depositoId_fecha_idx" ON "Venta"("panelId", "depositoId", "fecha");
CREATE INDEX "Venta_panelId_usuarioId_fecha_idx" ON "Venta"("panelId", "usuarioId", "fecha");
CREATE UNIQUE INDEX "Venta_panelId_numero_key" ON "Venta"("panelId", "numero");
CREATE INDEX "VentaItem_panelId_varianteId_idx" ON "VentaItem"("panelId", "varianteId");

-- Únicos parciales por panel (entre filas vigentes).
CREATE UNIQUE INDEX deposito_principal_unico ON "Deposito" ("panelId") WHERE "esPrincipal" = true;
CREATE UNIQUE INDEX variante_codigo_barras_unico ON "Variante" ("panelId", "codigoBarras")
  WHERE "codigoBarras" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX proveedor_cuit_unico ON "Proveedor" ("panelId", "cuit")
  WHERE "cuit" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX cliente_documento_unico ON "Cliente" ("panelId", "documento")
  WHERE "documento" IS NOT NULL AND "deletedAt" IS NULL;

-- -----------------------------------------------------------------------------
-- 7. Datos: depósitos, secuencias, configuración
-- -----------------------------------------------------------------------------

UPDATE "Deposito" SET "nombre" = 'Ayres Plaza' WHERE "panelId" = 'pnl_vapes' AND "nombre" = 'Galpón 1';
UPDATE "Deposito" SET "nombre" = 'Mercedes'    WHERE "panelId" = 'pnl_vapes' AND "nombre" = 'Galpón 2';

INSERT INTO "Deposito" ("id", "panelId", "nombre", "esPrincipal", "updatedAt") VALUES
  ('dep_cosmetic_principal',   'pnl_cosmetic',   'Principal', true, CURRENT_TIMESTAMP),
  ('dep_especiales_principal', 'pnl_especiales', 'Principal', true, CURRENT_TIMESTAMP);

CREATE TABLE "Secuencia" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "entidad" TEXT NOT NULL,
    "ultimoNumero" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Secuencia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Secuencia_panelId_entidad_key" ON "Secuencia"("panelId", "entidad");
ALTER TABLE "Secuencia" ADD CONSTRAINT "Secuencia_panelId_fkey"
  FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Secuencia"
  ADD CONSTRAINT "Secuencia_entidad_chk" CHECK ("entidad" IN ('VENTA', 'COMPRA', 'TRANSFERENCIA', 'DEVOLUCION')),
  ADD CONSTRAINT "Secuencia_ultimoNumero_chk" CHECK ("ultimoNumero" >= 0);

INSERT INTO "Secuencia" ("id", "panelId", "entidad", "ultimoNumero", "updatedAt")
SELECT 'sec_' || p."id" || '_' || lower(e.entidad), p."id", e.entidad,
       CASE WHEN p."id" = 'pnl_vapes' THEN e.ultimo ELSE 0 END, CURRENT_TIMESTAMP
FROM "Panel" p
CROSS JOIN (VALUES
  ('VENTA',         (SELECT COALESCE(MAX("numero"), 0) FROM "Venta")),
  ('COMPRA',        (SELECT COALESCE(MAX("numero"), 0) FROM "Compra")),
  ('TRANSFERENCIA', (SELECT COALESCE(MAX("numero"), 0) FROM "Transferencia")),
  ('DEVOLUCION',    (SELECT COALESCE(MAX("numero"), 0) FROM "Devolucion"))
) AS e(entidad, ultimo);

-- La numeración solo avanza y no se borra (reiniciarla duplicaría IDs de venta).
CREATE OR REPLACE FUNCTION trg_fn_secuencia_avanza() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ultimoNumero" < OLD."ultimoNumero"
     OR (NEW."panelId", NEW."entidad") IS DISTINCT FROM (OLD."panelId", OLD."entidad") THEN
    RAISE EXCEPTION 'La secuencia % del panel % solo puede avanzar', OLD."entidad", OLD."panelId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_secuencia_avanza BEFORE UPDATE ON "Secuencia"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_secuencia_avanza();
CREATE TRIGGER trg_secuencia_no_delete BEFORE DELETE ON "Secuencia"
  FOR EACH ROW EXECUTE FUNCTION prevent_delete('reiniciaría la numeración');

CREATE TABLE "ConfiguracionGlobal" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionGlobal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConfiguracionGlobal_clave_key" ON "ConfiguracionGlobal"("clave");

-- Claves globales → ConfiguracionGlobal; las de módulos eliminados se descartan.
INSERT INTO "ConfiguracionGlobal" ("id", "clave", "valor", "updatedAt")
SELECT "id", "clave", "valor", "updatedAt" FROM "Configuracion"
WHERE "clave" IN ('nombreNegocio', 'iconoApp', 'timezone', 'moneda');
DELETE FROM "Configuracion"
WHERE "clave" NOT IN ('escaner', 'ventas', 'alertaStockMinimo', 'prefijoSku');

-- -----------------------------------------------------------------------------
-- 8. Clientes: teléfono normalizado (+54 + dígitos) y único por panel
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_normalizar_telefono(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN d LIKE '54%' AND length(d) >= 12 THEN '+' || d
    ELSE '+54' || d
  END
  FROM (SELECT ltrim(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '0') AS d) x
$$;

SET CONSTRAINTS ALL IMMEDIATE;
UPDATE "Cliente" SET "telefono" = fn_normalizar_telefono("telefono") WHERE "telefono" IS NOT NULL;

-- Duplicados previos: el teléfono queda en el cliente más antiguo; en los demás
-- pasa a las notas (no se pierde el dato, pero deja de chocar).
WITH dup AS (
  SELECT "id", "telefono",
         row_number() OVER (PARTITION BY "panelId", "telefono" ORDER BY "createdAt", "id") AS n
  FROM "Cliente"
  WHERE "telefono" IS NOT NULL AND "deletedAt" IS NULL
)
UPDATE "Cliente" c
SET "notas" = concat_ws(E'\n', c."notas", 'Teléfono (repetido con otro cliente): ' || dup."telefono"),
    "telefono" = NULL
FROM dup
WHERE dup."id" = c."id" AND dup.n > 1;

CREATE UNIQUE INDEX cliente_telefono_unico ON "Cliente" ("panelId", "telefono")
  WHERE "telefono" IS NOT NULL AND "deletedAt" IS NULL;
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_telefono_chk"
  CHECK ("telefono" IS NULL OR "telefono" ~ '^\+54[0-9]{6,13}$');

-- -----------------------------------------------------------------------------
-- 9. Ventas: medio de pago único y obligatorio al confirmar
-- -----------------------------------------------------------------------------

ALTER TABLE "Venta" ADD CONSTRAINT "Venta_medioPago_chk"
  CHECK ("estado" = 'BORRADOR' OR "medioPago" IS NOT NULL);

-- Ítems de una venta confirmada: inmutables (ya no hay caché de devoluciones).
CREATE OR REPLACE FUNCTION trg_fn_venta_item_editable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fila   record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_estado text;
  v_numero integer;
BEGIN
  SELECT "estado"::text, "numero" INTO v_estado, v_numero FROM "Venta" WHERE "id" = v_fila."ventaId";

  IF v_estado IS NULL OR v_estado = 'BORRADOR'
     OR current_setting(fn_doc_guc_key('Venta', v_fila."ventaId"), true) = '1' THEN
    RETURN v_fila;
  END IF;

  RAISE EXCEPTION 'Los ítems de Venta #% (estado %) no se pueden modificar', v_numero, v_estado
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Usuarios: acceso y permisos por panel
-- -----------------------------------------------------------------------------

CREATE TABLE "UsuarioPanel" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsuarioPanel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UsuarioPanel_panelId_idx" ON "UsuarioPanel"("panelId");
CREATE UNIQUE INDEX "UsuarioPanel_usuarioId_panelId_key" ON "UsuarioPanel"("usuarioId", "panelId");
ALTER TABLE "UsuarioPanel" ADD CONSTRAINT "UsuarioPanel_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsuarioPanel" ADD CONSTRAINT "UsuarioPanel_panelId_fkey"
  FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los empleados existentes trabajaban sobre lo que ahora es Vapes.
INSERT INTO "UsuarioPanel" ("id", "usuarioId", "panelId")
SELECT 'up_' || "id", "id", 'pnl_vapes' FROM "Usuario" WHERE "rol" = 'EMPLEADO';

-- Módulos: INVENTARIO + MOVIMIENTOS → STOCK; FINANZAS/GASTOS/CAJA desaparecen;
-- USUARIOS/CONFIGURACION son globales (solo OWNER): sin filas de permiso.
ALTER TABLE "PermisoUsuario" ALTER COLUMN "modulo" TYPE text USING "modulo"::text;
ALTER TABLE "PermisoUsuario" ADD COLUMN "panelId" TEXT NOT NULL DEFAULT 'pnl_vapes';
ALTER TABLE "PermisoUsuario" ALTER COLUMN "panelId" DROP DEFAULT;

INSERT INTO "PermisoUsuario" ("id", "usuarioId", "panelId", "modulo", "puedeVer", "puedeCrear",
                              "puedeEditar", "puedeEliminar", "updatedAt")
SELECT 'perm_stock_' || "usuarioId", "usuarioId", 'pnl_vapes', 'STOCK',
       bool_or("puedeVer"), bool_or("puedeCrear"), bool_or("puedeEditar"), bool_or("puedeEliminar"),
       CURRENT_TIMESTAMP
FROM "PermisoUsuario"
WHERE "modulo" IN ('INVENTARIO', 'MOVIMIENTOS')
GROUP BY "usuarioId";

DELETE FROM "PermisoUsuario"
WHERE "modulo" IN ('INVENTARIO', 'MOVIMIENTOS', 'FINANZAS', 'GASTOS', 'CAJA', 'USUARIOS', 'CONFIGURACION');

CREATE TYPE "Modulo_new" AS ENUM ('DASHBOARD', 'PROVEEDORES', 'PRODUCTOS', 'STOCK', 'VENTAS', 'CLIENTES',
  'DEVOLUCIONES', 'COMPRAS', 'COTIZADOR', 'REPORTES', 'USUARIOS', 'CONFIGURACION');
ALTER TABLE "PermisoUsuario" ALTER COLUMN "modulo" TYPE "Modulo_new" USING ("modulo"::"Modulo_new");
DROP TYPE "Modulo";
ALTER TYPE "Modulo_new" RENAME TO "Modulo";

CREATE INDEX "PermisoUsuario_panelId_idx" ON "PermisoUsuario"("panelId");
CREATE UNIQUE INDEX "PermisoUsuario_usuarioId_panelId_modulo_key" ON "PermisoUsuario"("usuarioId", "panelId", "modulo");
ALTER TABLE "PermisoUsuario" ADD CONSTRAINT "PermisoUsuario_panelId_fkey"
  FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermisoUsuario" ADD CONSTRAINT "PermisoUsuario_modulo_de_panel_chk"
  CHECK ("modulo" NOT IN ('USUARIOS', 'CONFIGURACION'));

-- -----------------------------------------------------------------------------
-- 11. Aislamiento entre paneles en la DB
-- -----------------------------------------------------------------------------

-- Argumentos: pares (columna FK, tabla referenciada). Verifica que cada fila
-- referenciada sea del mismo panel y que panelId no cambie.
CREATE OR REPLACE FUNCTION fn_verificar_mismo_panel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i       integer := 0;
  v_ref   text;
  v_panel text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."panelId" IS DISTINCT FROM OLD."panelId" THEN
    RAISE EXCEPTION '%.panelId no se puede cambiar', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  WHILE i < TG_NARGS LOOP
    EXECUTE format('SELECT ($1).%I::text', TG_ARGV[i]) INTO v_ref USING NEW;
    IF v_ref IS NOT NULL THEN
      EXECUTE format('SELECT "panelId" FROM %I WHERE "id" = $1', TG_ARGV[i + 1]) INTO v_panel USING v_ref;
      IF v_panel IS DISTINCT FROM NEW."panelId" THEN
        RAISE EXCEPTION '%.% apunta a un % de otro panel (%, esperado %)',
          TG_TABLE_NAME, TG_ARGV[i], TG_ARGV[i + 1], v_panel, NEW."panelId"
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_panel_deposito BEFORE UPDATE OF "panelId" ON "Deposito"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_categoria BEFORE UPDATE OF "panelId" ON "Categoria"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_marca BEFORE UPDATE OF "panelId" ON "Marca"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_proveedor BEFORE UPDATE OF "panelId" ON "Proveedor"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_cliente BEFORE UPDATE OF "panelId" ON "Cliente"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_configuracion BEFORE UPDATE OF "panelId" ON "Configuracion"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_producto BEFORE INSERT OR UPDATE OF "panelId", "categoriaId", "marcaId" ON "Producto"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('categoriaId', 'Categoria', 'marcaId', 'Marca');
CREATE TRIGGER trg_panel_variante BEFORE INSERT OR UPDATE OF "panelId", "productoId" ON "Variante"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('productoId', 'Producto');
CREATE TRIGGER trg_panel_codigo_alternativo BEFORE INSERT OR UPDATE OF "panelId", "varianteId" ON "CodigoBarrasAlternativo"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('varianteId', 'Variante');
CREATE TRIGGER trg_panel_stock BEFORE INSERT OR UPDATE OF "panelId", "varianteId", "depositoId" ON "Stock"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('varianteId', 'Variante', 'depositoId', 'Deposito');
CREATE TRIGGER trg_panel_movimiento BEFORE INSERT ON "MovimientoStock"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('varianteId', 'Variante', 'depositoId', 'Deposito');
CREATE TRIGGER trg_panel_compra BEFORE INSERT OR UPDATE OF "panelId", "proveedorId", "depositoId" ON "Compra"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('proveedorId', 'Proveedor', 'depositoId', 'Deposito');
CREATE TRIGGER trg_panel_compra_item BEFORE INSERT OR UPDATE OF "panelId", "compraId", "varianteId" ON "CompraItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('compraId', 'Compra', 'varianteId', 'Variante');
CREATE TRIGGER trg_panel_venta BEFORE INSERT OR UPDATE OF "panelId", "clienteId", "depositoId" ON "Venta"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('clienteId', 'Cliente', 'depositoId', 'Deposito');
CREATE TRIGGER trg_panel_venta_item BEFORE INSERT OR UPDATE OF "panelId", "ventaId", "varianteId" ON "VentaItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('ventaId', 'Venta', 'varianteId', 'Variante');
CREATE TRIGGER trg_panel_devolucion BEFORE INSERT ON "Devolucion"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('ventaId', 'Venta', 'depositoId', 'Deposito');
CREATE TRIGGER trg_panel_transferencia BEFORE INSERT OR UPDATE OF "panelId", "depositoOrigenId", "depositoDestinoId" ON "Transferencia"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('depositoOrigenId', 'Deposito', 'depositoDestinoId', 'Deposito');
CREATE TRIGGER trg_panel_transferencia_item BEFORE INSERT OR UPDATE OF "panelId", "transferenciaId", "varianteId" ON "TransferenciaItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('transferenciaId', 'Transferencia', 'varianteId', 'Variante');

-- Código de barras: único por panel entre principales y alternativos (el mismo
-- EAN puede existir en dos paneles sin conflicto).
CREATE OR REPLACE FUNCTION fn_codigo_barras_unico_global() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_codigo text;
BEGIN
  IF TG_TABLE_NAME = 'Variante' THEN
    IF NEW."codigoBarras" IS NULL OR NEW."deletedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    v_codigo := NEW."codigoBarras";
    PERFORM pg_advisory_xact_lock(hashtext('codigo_barras:' || NEW."panelId" || ':' || v_codigo));
    IF EXISTS (SELECT 1 FROM "CodigoBarrasAlternativo" c
               WHERE c."panelId" = NEW."panelId" AND c."codigo" = v_codigo) THEN
      RAISE EXCEPTION 'El código de barras % ya está registrado como código alternativo', v_codigo
        USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    v_codigo := NEW."codigo";
    PERFORM pg_advisory_xact_lock(hashtext('codigo_barras:' || NEW."panelId" || ':' || v_codigo));
    IF EXISTS (
      SELECT 1 FROM "Variante" v
      WHERE v."panelId" = NEW."panelId" AND v."codigoBarras" = v_codigo AND v."deletedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'El código de barras % ya está registrado como código principal de una variante', v_codigo
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Vistas (con panel_id; el consolidado ya no pivotea depósitos en columnas)
-- -----------------------------------------------------------------------------

CREATE VIEW vw_stock_consolidado AS
SELECT
  v."panelId"       AS panel_id,
  p."id"            AS producto_id,
  p."nombre"        AS producto,
  v."id"            AS variante_id,
  v."nombre"        AS variante,
  v."sku"           AS sku,
  v."codigoBarras"  AS codigo_barras,
  v."stockMinimo"   AS stock_minimo,
  COALESCE(SUM(s."cantidad"), 0)::integer AS total,
  COALESCE(
    jsonb_object_agg(s."depositoId", s."cantidad") FILTER (WHERE s."depositoId" IS NOT NULL),
    '{}'::jsonb
  ) AS por_deposito
FROM "Variante" v
JOIN "Producto" p ON p."id" = v."productoId"
LEFT JOIN "Stock" s ON s."varianteId" = v."id"
WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
GROUP BY v."panelId", p."id", p."nombre", v."id", v."nombre", v."sku", v."codigoBarras", v."stockMinimo";

CREATE VIEW vw_alertas_stock AS
SELECT
  v."panelId"      AS panel_id,
  p."id"           AS producto_id,
  p."nombre"       AS producto,
  v."id"           AS variante_id,
  v."nombre"       AS variante,
  v."sku",
  v."codigoBarras" AS codigo_barras,
  v."stockMinimo"  AS stock_minimo,
  t.total          AS stock_total,
  v."stockMinimo" - t.total AS faltante
FROM "Variante" v
JOIN "Producto" p ON p."id" = v."productoId"
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(s."cantidad"), 0)::integer AS total FROM "Stock" s WHERE s."varianteId" = v."id"
) t
WHERE v."deletedAt" IS NULL AND v."activo" AND p."deletedAt" IS NULL AND p."activo"
  AND t.total < v."stockMinimo";
