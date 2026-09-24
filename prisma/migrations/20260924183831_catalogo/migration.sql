-- CreateTable
CREATE TABLE "HistorialPrecio" (
    "id" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "precioCostoAnterior" DECIMAL(12,2) NOT NULL,
    "precioCostoNuevo" DECIMAL(12,2) NOT NULL,
    "precioVentaAnterior" DECIMAL(12,2) NOT NULL,
    "precioVentaNuevo" DECIMAL(12,2) NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialPrecio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistorialPrecio_varianteId_createdAt_idx" ON "HistorialPrecio"("varianteId", "createdAt");

-- CreateIndex
CREATE INDEX "HistorialPrecio_createdAt_idx" ON "HistorialPrecio"("createdAt");

-- CreateIndex
CREATE INDEX "HistorialPrecio_usuarioId_idx" ON "HistorialPrecio"("usuarioId");

-- AddForeignKey
ALTER TABLE "HistorialPrecio" ADD CONSTRAINT "HistorialPrecio_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialPrecio" ADD CONSTRAINT "HistorialPrecio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- A mano: catálogo e inventario.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. HistorialPrecio: inmutable + coherente
-- -----------------------------------------------------------------------------

ALTER TABLE "HistorialPrecio"
  ADD CONSTRAINT "HistorialPrecio_precios_chk" CHECK (
    "precioCostoAnterior" >= 0 AND "precioCostoNuevo" >= 0
    AND "precioVentaAnterior" >= 0 AND "precioVentaNuevo" >= 0
  ),
  -- Una fila de historial tiene que registrar un cambio real.
  ADD CONSTRAINT "HistorialPrecio_cambio_chk" CHECK (
    "precioCostoAnterior" <> "precioCostoNuevo" OR "precioVentaAnterior" <> "precioVentaNuevo"
  );

CREATE TRIGGER trg_historial_precio_inmutable
  BEFORE UPDATE OR DELETE ON "HistorialPrecio"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_historial_precio_no_truncate
  BEFORE TRUNCATE ON "HistorialPrecio"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- -----------------------------------------------------------------------------
-- 2. Ningún precio cambia sin su fila de historial (mismo patrón que Stock):
--    a) BEFORE INSERT HistorialPrecio: "anterior" = precio actual real.
--    b) AFTER INSERT: marca local a la tx con los precios nuevos.
--    c) BEFORE UPDATE Variante: si cambian precios, la marca tiene que coincidir.
--    d) Al COMMIT: toda fila de historial fue aplicada a la variante.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_precio_guc_key(p_variante_id text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'app_precio.p' || md5(p_variante_id);
$$;

CREATE OR REPLACE FUNCTION validar_historial_precio() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_costo numeric;
  v_venta numeric;
BEGIN
  SELECT "precioCosto", "precioVenta" INTO v_costo, v_venta FROM "Variante" WHERE "id" = NEW."varianteId";
  IF NEW."precioCostoAnterior" <> v_costo OR NEW."precioVentaAnterior" <> v_venta THEN
    RAISE EXCEPTION 'HistorialPrecio: los precios anteriores (% / %) no coinciden con los actuales (% / %)',
      NEW."precioCostoAnterior", NEW."precioVentaAnterior", v_costo, v_venta
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_historial_precio
  BEFORE INSERT ON "HistorialPrecio"
  FOR EACH ROW EXECUTE FUNCTION validar_historial_precio();

CREATE OR REPLACE FUNCTION autorizar_cambio_precio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    fn_precio_guc_key(NEW."varianteId"),
    NEW."precioCostoNuevo"::text || ':' || NEW."precioVentaNuevo"::text,
    true
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_autorizar_cambio_precio
  AFTER INSERT ON "HistorialPrecio"
  FOR EACH ROW EXECUTE FUNCTION autorizar_cambio_precio();

CREATE OR REPLACE FUNCTION proteger_precio_variante() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_key text := fn_precio_guc_key(NEW."id");
BEGIN
  IF NEW."precioCosto" = OLD."precioCosto" AND NEW."precioVenta" = OLD."precioVenta" THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting(v_key, true), '') <> NEW."precioCosto"::text || ':' || NEW."precioVenta"::text THEN
    RAISE EXCEPTION 'Cambio de precio de la variante % sin HistorialPrecio en la misma transacción', NEW."sku"
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Usá actualizarPrecios(): registra el historial y actualiza en la misma transacción.';
  END IF;
  PERFORM set_config(v_key, '', true); -- la marca se consume
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proteger_precio_variante
  BEFORE UPDATE OF "precioCosto", "precioVenta" ON "Variante"
  FOR EACH ROW EXECUTE FUNCTION proteger_precio_variante();

CREATE OR REPLACE FUNCTION verificar_historial_aplicado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting(fn_precio_guc_key(NEW."varianteId"), true), '') <> '' THEN
    RAISE EXCEPTION 'HistorialPrecio % no se aplicó a la variante en la misma transacción', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_historial_aplicado
  AFTER INSERT ON "HistorialPrecio"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_historial_aplicado();

-- -----------------------------------------------------------------------------
-- 3. Una variante con movimientos no cambia de producto.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION proteger_producto_de_variante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."productoId" <> OLD."productoId"
     AND EXISTS (SELECT 1 FROM "MovimientoStock" WHERE "varianteId" = OLD."id") THEN
    RAISE EXCEPTION 'La variante % tiene movimientos: no puede cambiar de producto', OLD."sku"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_variante_producto_inmutable
  BEFORE UPDATE OF "productoId" ON "Variante"
  FOR EACH ROW EXECUTE FUNCTION proteger_producto_de_variante();

-- -----------------------------------------------------------------------------
-- 4. Códigos de barras siempre en mayúsculas: la búsqueda "case-insensitive"
--    es una igualdad exacta sobre el valor normalizado (usa el índice único).
-- -----------------------------------------------------------------------------

ALTER TABLE "Variante"
  ADD CONSTRAINT "Variante_codigoBarras_mayus_chk" CHECK ("codigoBarras" = upper("codigoBarras"));
ALTER TABLE "CodigoBarrasAlternativo"
  ADD CONSTRAINT "CodigoBarrasAlternativo_codigo_mayus_chk" CHECK ("codigo" = upper("codigo"));

-- -----------------------------------------------------------------------------
-- 5. Reglas de desactivación de maestros (también las valida el servicio).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION proteger_desactivar_deposito() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_unidades integer;
BEGIN
  IF OLD."activo" AND NOT NEW."activo" THEN
    IF OLD."esPrincipal" OR NEW."esPrincipal" THEN
      RAISE EXCEPTION 'El depósito principal no se puede desactivar: marcá otro como principal primero'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM("cantidad"), 0) INTO v_unidades FROM "Stock" WHERE "depositoId" = OLD."id";
    IF v_unidades > 0 THEN
      RAISE EXCEPTION 'El depósito "%" tiene % unidades en stock: transferilas o ajustalas antes de desactivarlo',
        OLD."nombre", v_unidades
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proteger_desactivar_deposito
  BEFORE UPDATE OF "activo", "esPrincipal" ON "Deposito"
  FOR EACH ROW EXECUTE FUNCTION proteger_desactivar_deposito();

CREATE OR REPLACE FUNCTION proteger_desactivar_clasificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_productos integer;
  v_columna text := CASE TG_TABLE_NAME WHEN 'Categoria' THEN 'categoriaId' ELSE 'marcaId' END;
BEGIN
  IF OLD."activo" AND NOT NEW."activo" THEN
    EXECUTE format('SELECT COUNT(*) FROM "Producto" WHERE %I = $1 AND "activo" AND "deletedAt" IS NULL', v_columna)
      INTO v_productos USING OLD."id";
    IF v_productos > 0 THEN
      RAISE EXCEPTION '"%" tiene % producto(s) activo(s): no se puede desactivar', OLD."nombre", v_productos
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proteger_desactivar_categoria
  BEFORE UPDATE OF "activo" ON "Categoria"
  FOR EACH ROW EXECUTE FUNCTION proteger_desactivar_clasificacion();

CREATE TRIGGER trg_proteger_desactivar_marca
  BEFORE UPDATE OF "activo" ON "Marca"
  FOR EACH ROW EXECUTE FUNCTION proteger_desactivar_clasificacion();

-- -----------------------------------------------------------------------------
-- 6. Búsqueda rápida: pg_trgm + índices GIN para ILIKE '%texto%'.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "producto_nombre_trgm" ON "Producto" USING GIN ("nombre" gin_trgm_ops);
CREATE INDEX "variante_nombre_trgm" ON "Variante" USING GIN ("nombre" gin_trgm_ops);
CREATE INDEX "variante_sku_trgm"    ON "Variante" USING GIN ("sku" gin_trgm_ops);
