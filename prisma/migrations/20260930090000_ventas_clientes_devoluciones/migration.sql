-- =============================================================================
-- REFORMA R3: VENTAS, CLIENTES, DEVOLUCIONES POR GARANTÍA
--
-- - Medios de pago: EFECTIVO, TRANSFERENCIA, BINANCE (débito, crédito,
--   Mercado Pago y "otro" pasan a TRANSFERENCIA).
-- - Venta: sin borradores; código visible por panel (VAP-000001), cliente y
--   medio de pago obligatorios, vendedor, tipo (unitaria/mayorista). El
--   redondeo pasa a formar parte del descuento (el total no cambia).
-- - VentaItem: precio de lista y precio cobrado (precio especial), producto
--   desnormalizado.
-- - Cliente: nombre + teléfono obligatorio y único por panel. Apellido se
--   suma al nombre; documento, email y dirección pasan a las notas. Los que
--   no tenían teléfono reciben uno provisorio (+54000…) marcado en las notas.
--   Las ventas sin cliente pasan a "Cliente sin datos" de su panel.
-- - Devolución por garantía: cliente obligatorio, venta opcional, ítems,
--   observación, estado; movimientos GARANTIA / GARANTIA_ANULADA.
-- =============================================================================

ALTER TYPE "TipoMovimiento" ADD VALUE IF NOT EXISTS 'GARANTIA';
ALTER TYPE "TipoMovimiento" ADD VALUE IF NOT EXISTS 'GARANTIA_ANULADA';
ALTER TYPE "TipoMovimiento" ADD VALUE IF NOT EXISTS 'VENTA_ANULADA';

CREATE TYPE "TipoVenta" AS ENUM ('UNITARIA', 'MAYORISTA');
CREATE TYPE "EstadoDevolucion" AS ENUM ('REGISTRADA', 'ANULADA');

-- Signo de cada tipo de movimiento (comparación por texto: los valores
-- nuevos del enum no se pueden castear en la misma transacción que los crea).
CREATE OR REPLACE FUNCTION fn_signo_movimiento(p_tipo "TipoMovimiento") RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tipo::text IN ('INGRESO_COMPRA', 'INGRESO_MANUAL', 'DEVOLUCION_CLIENTE', 'AJUSTE_POSITIVO',
                          'TRANSFERENCIA_ENTRADA', 'GARANTIA_ANULADA', 'VENTA_ANULADA') THEN 1
    ELSE -1
  END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Borradores de venta: desaparecen (nunca movieron stock)
-- -----------------------------------------------------------------------------

DELETE FROM "Venta" WHERE "estado" = 'BORRADOR';
SET CONSTRAINTS ALL IMMEDIATE;

-- -----------------------------------------------------------------------------
-- 2. Clientes
-- -----------------------------------------------------------------------------

ALTER TABLE "Cliente" DISABLE TRIGGER USER;

UPDATE "Cliente" SET
  "nombre" = btrim(concat_ws(' ', "nombre", "apellido")),
  "notas" = NULLIF(concat_ws(E'\n', "notas",
    CASE WHEN "documento" IS NOT NULL THEN 'Documento: ' || "documento" END,
    CASE WHEN "email" IS NOT NULL THEN 'Email: ' || "email" END,
    CASE WHEN "direccion" IS NOT NULL THEN 'Dirección: ' || "direccion" END), '');

-- Ventas sin cliente → "Cliente sin datos" de su panel.
INSERT INTO "Cliente" ("id", "panelId", "nombre", "telefono", "notas", "updatedAt")
SELECT 'cli_sin_datos_' || v."panelId", v."panelId", 'Cliente sin datos', NULL,
       'Creado al migrar: ventas anteriores a R3 sin cliente.', CURRENT_TIMESTAMP
FROM "Venta" v
WHERE v."clienteId" IS NULL
GROUP BY v."panelId";

-- Teléfono obligatorio: provisorio +54000NNNNNN (único) para los que no tenían.
WITH sin AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n
  FROM "Cliente" WHERE "telefono" IS NULL
)
UPDATE "Cliente" c
SET "telefono" = '+54000' || lpad(sin.n::text, 6, '0'),
    "notas" = concat_ws(E'\n', c."notas", 'Teléfono provisorio (el cliente no tenía teléfono cargado).')
FROM sin WHERE sin."id" = c."id";

ALTER TABLE "Cliente" ENABLE TRIGGER USER;

DROP INDEX IF EXISTS "cliente_apellido_trgm";
DROP INDEX IF EXISTS "cliente_documento_trgm";
ALTER TABLE "Cliente"
  DROP COLUMN "apellido",
  DROP COLUMN "documento",
  DROP COLUMN "email",
  DROP COLUMN "direccion",
  ALTER COLUMN "telefono" SET NOT NULL,
  ADD CONSTRAINT "Cliente_nombre_chk" CHECK (btrim("nombre") <> '');

-- -----------------------------------------------------------------------------
-- 3. Venta
-- -----------------------------------------------------------------------------

ALTER TABLE "Venta" DISABLE TRIGGER USER;

UPDATE "Venta" v SET "clienteId" = 'cli_sin_datos_' || v."panelId" WHERE v."clienteId" IS NULL;
-- El redondeo (≤ 0, a favor del cliente) se suma al descuento: el total no cambia.
UPDATE "Venta" SET "descuento" = "descuento" - "redondeo" WHERE "redondeo" <> 0;

ALTER TABLE "Venta" DROP CONSTRAINT IF EXISTS "Venta_total_chk";
ALTER TABLE "Venta" DROP CONSTRAINT IF EXISTS "Venta_redondeo_chk";
ALTER TABLE "Venta" DROP CONSTRAINT IF EXISTS "Venta_medioPago_chk";
-- Referencian el enum viejo: se recrean después del cambio de tipo.
ALTER TABLE "Venta" DROP CONSTRAINT IF EXISTS "Venta_anulacion_chk";
ALTER TABLE "Venta" DROP COLUMN "redondeo";

-- Medios de pago.
ALTER TABLE "Venta" ALTER COLUMN "medioPago" TYPE text USING "medioPago"::text;
UPDATE "Venta" SET "medioPago" = 'TRANSFERENCIA'
WHERE "medioPago" IS NULL OR "medioPago" NOT IN ('EFECTIVO', 'TRANSFERENCIA');
DROP TYPE "MedioPago";
CREATE TYPE "MedioPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'BINANCE');
ALTER TABLE "Venta" ALTER COLUMN "medioPago" TYPE "MedioPago" USING "medioPago"::"MedioPago";

-- Estado sin BORRADOR.
ALTER TABLE "Venta" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "Venta" ALTER COLUMN "estado" TYPE text USING "estado"::text;
DROP TYPE "EstadoVenta";
CREATE TYPE "EstadoVenta" AS ENUM ('CONFIRMADA', 'ANULADA');
ALTER TABLE "Venta" ALTER COLUMN "estado" TYPE "EstadoVenta" USING "estado"::"EstadoVenta";
ALTER TABLE "Venta" ALTER COLUMN "estado" SET DEFAULT 'CONFIRMADA';
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_anulacion_chk"
  CHECK (("estado" = 'ANULADA') = ("anuladaAt" IS NOT NULL AND "anuladaPorId" IS NOT NULL));

-- Vendedor (antes usuarioId), código visible y tipo.
ALTER TABLE "Venta" RENAME COLUMN "usuarioId" TO "vendedorId";
ALTER TABLE "Venta" RENAME CONSTRAINT "Venta_usuarioId_fkey" TO "Venta_vendedorId_fkey";
ALTER TABLE "Venta"
  ADD COLUMN "codigo" TEXT,
  ADD COLUMN "tipo" "TipoVenta" NOT NULL DEFAULT 'UNITARIA';
UPDATE "Venta" v SET "codigo" =
  upper(substr(regexp_replace(p."slug", '[^a-z0-9]', '', 'g'), 1, 3)) || '-' || lpad(v."numero"::text, 6, '0')
FROM "Panel" p WHERE p."id" = v."panelId";

ALTER TABLE "Venta" ENABLE TRIGGER USER;

ALTER TABLE "Venta"
  ALTER COLUMN "codigo" SET NOT NULL,
  ALTER COLUMN "clienteId" SET NOT NULL,
  ALTER COLUMN "medioPago" SET NOT NULL,
  ADD CONSTRAINT "Venta_total_chk" CHECK ("total" >= 0 AND "total" = "subtotal" - "descuento");

DROP INDEX "Venta_panelId_clienteId_estado_idx";
DROP INDEX "Venta_panelId_estado_fecha_idx";
DROP INDEX "Venta_panelId_usuarioId_fecha_idx";
CREATE INDEX "Venta_panelId_vendedorId_fecha_idx" ON "Venta"("panelId", "vendedorId", "fecha");
CREATE INDEX "Venta_panelId_clienteId_idx" ON "Venta"("panelId", "clienteId");
CREATE INDEX "Venta_panelId_tipo_fecha_idx" ON "Venta"("panelId", "tipo", "fecha");
CREATE UNIQUE INDEX "Venta_panelId_codigo_key" ON "Venta"("panelId", "codigo");

-- Una venta confirmada no se modifica: se anula (solo cambian los datos de anulación).
CREATE OR REPLACE FUNCTION trg_fn_venta_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."estado" = 'CONFIRMADA' AND NEW."estado" NOT IN ('CONFIRMADA', 'ANULADA'))
     OR (OLD."estado" = 'ANULADA' AND NEW."estado" <> 'ANULADA') THEN
    RAISE EXCEPTION 'Transición de estado inválida en la venta %: % -> %', OLD."codigo", OLD."estado", NEW."estado"
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."numero", NEW."codigo", NEW."fecha", NEW."clienteId", NEW."depositoId", NEW."vendedorId", NEW."tipo",
      NEW."medioPago", NEW."subtotal", NEW."descuento", NEW."total", NEW."costoTotal", NEW."gananciaBruta")
     IS DISTINCT FROM
     (OLD."numero", OLD."codigo", OLD."fecha", OLD."clienteId", OLD."depositoId", OLD."vendedorId", OLD."tipo",
      OLD."medioPago", OLD."subtotal", OLD."descuento", OLD."total", OLD."costoTotal", OLD."gananciaBruta") THEN
    RAISE EXCEPTION 'La venta % está %: no se modifica, se anula', OLD."codigo", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA'
     AND (NEW."anuladaPorId", NEW."anuladaAt", NEW."motivoAnulacion")
         IS DISTINCT FROM (OLD."anuladaPorId", OLD."anuladaAt", OLD."motivoAnulacion") THEN
    RAISE EXCEPTION 'Los datos de anulación de la venta % no se modifican', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verificar_totales_venta(p_venta_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_venta    "Venta"%ROWTYPE;
  v_items    integer;
  v_subtotal numeric;
  v_costo    numeric;
BEGIN
  SELECT * INTO v_venta FROM "Venta" WHERE "id" = p_venta_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COUNT(*), COALESCE(SUM("subtotal"), 0), COALESCE(SUM("cantidad" * "costoUnitario"), 0)
    INTO v_items, v_subtotal, v_costo
  FROM "VentaItem" WHERE "ventaId" = p_venta_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'La venta % no tiene ítems', v_venta."codigo" USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."subtotal" <> v_subtotal THEN
    RAISE EXCEPTION 'Venta %: subtotal % no coincide con la suma de ítems %', v_venta."codigo", v_venta."subtotal", v_subtotal
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."costoTotal" <> v_costo THEN
    RAISE EXCEPTION 'Venta %: costoTotal % no coincide con la suma de costos de ítems %', v_venta."codigo", v_venta."costoTotal", v_costo
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. VentaItem: precio de lista vs cobrado, producto desnormalizado
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "VentaItem" WHERE "descuento" <> 0) THEN
    RAISE EXCEPTION 'Hay ítems de venta con descuento por ítem: revisarlos antes de migrar (R3 no los admite).';
  END IF;
END $$;

ALTER TABLE "VentaItem" DISABLE TRIGGER USER;
ALTER TABLE "VentaItem"
  ADD COLUMN "productoId" TEXT,
  ADD COLUMN "precioLista" DECIMAL(12,2),
  ADD COLUMN "esPrecioEspecial" BOOLEAN NOT NULL DEFAULT false;
UPDATE "VentaItem" vi SET "productoId" = v."productoId", "precioLista" = vi."precioUnitario"
FROM "Variante" v WHERE v."id" = vi."varianteId";
ALTER TABLE "VentaItem" ENABLE TRIGGER USER;

ALTER TABLE "VentaItem" DROP CONSTRAINT IF EXISTS "VentaItem_subtotal_chk";
ALTER TABLE "VentaItem" DROP CONSTRAINT IF EXISTS "VentaItem_descuento_chk";
ALTER TABLE "VentaItem"
  DROP COLUMN "descuento",
  DROP COLUMN "notas",
  ALTER COLUMN "productoId" SET NOT NULL,
  ALTER COLUMN "precioLista" SET NOT NULL,
  ADD CONSTRAINT "VentaItem_precioLista_chk" CHECK ("precioLista" >= 0),
  ADD CONSTRAINT "VentaItem_subtotal_chk" CHECK ("subtotal" = "cantidad" * "precioUnitario"),
  ADD CONSTRAINT "VentaItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "VentaItem_ventaId_varianteId_key";
CREATE UNIQUE INDEX "VentaItem_panelId_ventaId_varianteId_key" ON "VentaItem"("panelId", "ventaId", "varianteId");
CREATE INDEX "VentaItem_panelId_productoId_idx" ON "VentaItem"("panelId", "productoId");

-- productoId de un ítem = el de su variante (CompraItem, VentaItem, DevolucionItem).
CREATE OR REPLACE FUNCTION trg_fn_item_producto_coherente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Variante" WHERE "id" = NEW."varianteId" AND "productoId" = NEW."productoId") THEN
    RAISE EXCEPTION '%.productoId no corresponde a la variante %', TG_TABLE_NAME, NEW."varianteId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_venta_item_producto BEFORE INSERT OR UPDATE OF "varianteId", "productoId" ON "VentaItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_item_producto_coherente();

-- -----------------------------------------------------------------------------
-- 5. Devolución por garantía
-- -----------------------------------------------------------------------------

ALTER TABLE "Devolucion" DISABLE TRIGGER USER;
ALTER TABLE "Devolucion"
  ADD COLUMN "codigo" TEXT,
  ADD COLUMN "clienteId" TEXT,
  ADD COLUMN "observacion" TEXT,
  ADD COLUMN "estado" "EstadoDevolucion" NOT NULL DEFAULT 'REGISTRADA',
  ADD COLUMN "anuladaPorId" TEXT,
  ADD COLUMN "motivoAnulacion" TEXT,
  ADD COLUMN "anuladaAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "ventaId" DROP NOT NULL;
UPDATE "Devolucion" d SET
  "clienteId" = v."clienteId",
  "observacion" = CASE WHEN length(btrim(d."motivo")) >= 10 THEN d."motivo"
                       ELSE d."motivo" || ' (registrada antes de R3)' END,
  "codigo" = upper(substr(regexp_replace(p."slug", '[^a-z0-9]', '', 'g'), 1, 3)) || '-D-' || lpad(d."numero"::text, 6, '0')
FROM "Venta" v, "Panel" p
WHERE v."id" = d."ventaId" AND p."id" = d."panelId";
ALTER TABLE "Devolucion" ENABLE TRIGGER USER;

ALTER TABLE "Devolucion"
  DROP COLUMN "motivo",
  ALTER COLUMN "codigo" SET NOT NULL,
  ALTER COLUMN "clienteId" SET NOT NULL,
  ALTER COLUMN "observacion" SET NOT NULL,
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ADD CONSTRAINT "Devolucion_observacion_chk" CHECK (length(btrim("observacion")) >= 10),
  ADD CONSTRAINT "Devolucion_anulacion_chk"
    CHECK (("estado" = 'ANULADA') = ("anuladaAt" IS NOT NULL AND "anuladaPorId" IS NOT NULL)),
  ADD CONSTRAINT "Devolucion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Devolucion_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Devolucion_panelId_codigo_key" ON "Devolucion"("panelId", "codigo");
CREATE INDEX "Devolucion_panelId_clienteId_idx" ON "Devolucion"("panelId", "clienteId");

-- Antes era inmutable del todo: ahora se puede anular (y nada más).
DROP TRIGGER IF EXISTS trg_devolucion_inmutable ON "Devolucion";
CREATE OR REPLACE FUNCTION trg_fn_devolucion_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La devolución % no se borra: se anula', OLD."codigo" USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA' THEN
    RAISE EXCEPTION 'La devolución % está anulada: no se modifica', OLD."codigo" USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."numero", NEW."codigo", NEW."fecha", NEW."clienteId", NEW."ventaId", NEW."depositoId",
      NEW."observacion", NEW."usuarioId")
     IS DISTINCT FROM
     (OLD."numero", OLD."codigo", OLD."fecha", OLD."clienteId", OLD."ventaId", OLD."depositoId",
      OLD."observacion", OLD."usuarioId") THEN
    RAISE EXCEPTION 'La devolución % no se modifica: se anula', OLD."codigo" USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_devolucion_estado BEFORE UPDATE OR DELETE ON "Devolucion"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_devolucion_estado();

DROP TRIGGER IF EXISTS trg_panel_devolucion ON "Devolucion";
CREATE TRIGGER trg_panel_devolucion BEFORE INSERT ON "Devolucion"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel(
    'clienteId', 'Cliente', 'ventaId', 'Venta', 'depositoId', 'Deposito');

CREATE TABLE "DevolucionItem" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "devolucionId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevolucionItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DevolucionItem_cantidad_chk" CHECK ("cantidad" > 0)
);
CREATE INDEX "DevolucionItem_panelId_varianteId_idx" ON "DevolucionItem"("panelId", "varianteId");
CREATE UNIQUE INDEX "DevolucionItem_panelId_devolucionId_varianteId_key" ON "DevolucionItem"("panelId", "devolucionId", "varianteId");
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_devolucionId_fkey" FOREIGN KEY ("devolucionId") REFERENCES "Devolucion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER trg_panel_devolucion_item BEFORE INSERT ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('devolucionId', 'Devolucion', 'varianteId', 'Variante');
CREATE TRIGGER trg_devolucion_item_producto BEFORE INSERT OR UPDATE OF "varianteId", "productoId" ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_item_producto_coherente();
CREATE TRIGGER trg_devolucion_item_inmutable BEFORE UPDATE OR DELETE ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- CompraItem usa la función genérica.
DROP TRIGGER IF EXISTS trg_compra_item_producto ON "CompraItem";
CREATE TRIGGER trg_compra_item_producto BEFORE INSERT OR UPDATE OF "varianteId", "productoId" ON "CompraItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_item_producto_coherente();
DROP FUNCTION IF EXISTS trg_fn_compra_item_producto();
