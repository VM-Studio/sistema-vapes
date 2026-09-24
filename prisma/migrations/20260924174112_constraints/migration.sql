-- =============================================================================
-- CONSTRAINTS — escrita a mano.
-- Todo lo que Prisma no sabe expresar: CHECKs, índices únicos parciales,
-- triggers de inmutabilidad y de consistencia del stock, funciones y vistas.
-- La app puede tener bugs; la DB no perdona.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CHECK constraints
-- -----------------------------------------------------------------------------

-- Usuario
ALTER TABLE "Usuario"
  ADD CONSTRAINT "Usuario_email_lowercase_chk" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "Usuario_nombre_chk"          CHECK (btrim("nombre") <> '');

-- Maestros: nombres no vacíos
ALTER TABLE "Deposito"  ADD CONSTRAINT "Deposito_nombre_chk"  CHECK (btrim("nombre") <> '');
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_nombre_chk" CHECK (btrim("nombre") <> '');
ALTER TABLE "Marca"     ADD CONSTRAINT "Marca_nombre_chk"     CHECK (btrim("nombre") <> '');
ALTER TABLE "Producto"  ADD CONSTRAINT "Producto_nombre_chk"  CHECK (btrim("nombre") <> '');

-- Variante
ALTER TABLE "Variante"
  ADD CONSTRAINT "Variante_nombre_chk"       CHECK (btrim("nombre") <> ''),
  ADD CONSTRAINT "Variante_sku_chk"          CHECK (btrim("sku") <> ''),
  ADD CONSTRAINT "Variante_precioCosto_chk"  CHECK ("precioCosto" >= 0),
  ADD CONSTRAINT "Variante_precioVenta_chk"  CHECK ("precioVenta" >= 0),
  ADD CONSTRAINT "Variante_stockMinimo_chk"  CHECK ("stockMinimo" >= 0),
  -- Mismo formato que el schema Zod: sin espacios, 4-64 caracteres.
  ADD CONSTRAINT "Variante_codigoBarras_chk" CHECK ("codigoBarras" IS NULL OR "codigoBarras" ~ '^[0-9A-Za-z-]{4,64}$');

ALTER TABLE "CodigoBarrasAlternativo"
  ADD CONSTRAINT "CodigoBarrasAlternativo_codigo_chk" CHECK ("codigo" ~ '^[0-9A-Za-z-]{4,64}$');

-- Stock: el stock negativo es imposible a nivel DB.
ALTER TABLE "Stock"
  ADD CONSTRAINT "Stock_cantidad_chk" CHECK ("cantidad" >= 0);

-- MovimientoStock
ALTER TABLE "MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_cantidad_chk"       CHECK ("cantidad" > 0),
  ADD CONSTRAINT "MovimientoStock_stockAnterior_chk"  CHECK ("stockAnterior" >= 0),
  ADD CONSTRAINT "MovimientoStock_stockPosterior_chk" CHECK ("stockPosterior" >= 0),
  ADD CONSTRAINT "MovimientoStock_costoUnitario_chk"  CHECK ("costoUnitario" IS NULL OR "costoUnitario" >= 0),
  ADD CONSTRAINT "MovimientoStock_referenciaTipo_chk" CHECK ("referenciaTipo" IS NULL OR "referenciaTipo" IN ('VENTA', 'COMPRA', 'TRANSFERENCIA', 'AJUSTE')),
  -- La referencia va completa o no va.
  ADD CONSTRAINT "MovimientoStock_referencia_chk"     CHECK (("referenciaTipo" IS NULL) = ("referenciaId" IS NULL));

-- Compra
ALTER TABLE "Compra"
  ADD CONSTRAINT "Compra_subtotal_chk"  CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "Compra_descuento_chk" CHECK ("descuento" >= 0),
  ADD CONSTRAINT "Compra_total_chk"     CHECK ("total" >= 0 AND "total" = "subtotal" - "descuento");

ALTER TABLE "CompraItem"
  ADD CONSTRAINT "CompraItem_cantidad_chk"      CHECK ("cantidad" > 0),
  ADD CONSTRAINT "CompraItem_costoUnitario_chk" CHECK ("costoUnitario" >= 0),
  ADD CONSTRAINT "CompraItem_subtotal_chk"      CHECK ("subtotal" = "cantidad" * "costoUnitario");

-- Venta
ALTER TABLE "Venta"
  ADD CONSTRAINT "Venta_subtotal_chk"      CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "Venta_descuento_chk"     CHECK ("descuento" >= 0),
  ADD CONSTRAINT "Venta_total_chk"         CHECK ("total" >= 0 AND "total" = "subtotal" - "descuento"),
  ADD CONSTRAINT "Venta_costoTotal_chk"    CHECK ("costoTotal" >= 0),
  ADD CONSTRAINT "Venta_gananciaBruta_chk" CHECK ("gananciaBruta" = "total" - "costoTotal"),
  -- Una venta anulada siempre registra quién y cuándo; una no anulada no.
  ADD CONSTRAINT "Venta_anulacion_chk"     CHECK (
    ("estado" = 'ANULADA') = ("anuladaAt" IS NOT NULL AND "anuladaPorId" IS NOT NULL)
  );

ALTER TABLE "VentaItem"
  ADD CONSTRAINT "VentaItem_cantidad_chk"       CHECK ("cantidad" > 0),
  ADD CONSTRAINT "VentaItem_precioUnitario_chk" CHECK ("precioUnitario" >= 0),
  ADD CONSTRAINT "VentaItem_costoUnitario_chk"  CHECK ("costoUnitario" >= 0),
  ADD CONSTRAINT "VentaItem_descuento_chk"      CHECK ("descuento" >= 0),
  ADD CONSTRAINT "VentaItem_subtotal_chk"       CHECK ("subtotal" >= 0 AND "subtotal" = "cantidad" * "precioUnitario" - "descuento");

-- Comprobante y numeración
ALTER TABLE "Comprobante"
  ADD CONSTRAINT "Comprobante_puntoVenta_chk" CHECK ("puntoVenta" > 0),
  ADD CONSTRAINT "Comprobante_numero_chk"     CHECK ("numero" > 0),
  ADD CONSTRAINT "Comprobante_total_chk"      CHECK ("total" >= 0);

ALTER TABLE "SecuenciaComprobante"
  ADD CONSTRAINT "SecuenciaComprobante_puntoVenta_chk"   CHECK ("puntoVenta" > 0),
  ADD CONSTRAINT "SecuenciaComprobante_ultimoNumero_chk" CHECK ("ultimoNumero" >= 0);

-- Transferencia
ALTER TABLE "Transferencia"
  ADD CONSTRAINT "Transferencia_depositos_chk"  CHECK ("depositoOrigenId" <> "depositoDestinoId"),
  ADD CONSTRAINT "Transferencia_completada_chk" CHECK (("estado" = 'COMPLETADA') = ("completadaAt" IS NOT NULL));

ALTER TABLE "TransferenciaItem"
  ADD CONSTRAINT "TransferenciaItem_cantidad_chk" CHECK ("cantidad" > 0);

-- Gasto
ALTER TABLE "Gasto"
  ADD CONSTRAINT "Gasto_monto_chk" CHECK ("monto" > 0);


-- -----------------------------------------------------------------------------
-- 2. Un solo depósito principal
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX "deposito_principal_unico" ON "Deposito" ("esPrincipal") WHERE "esPrincipal" = true;


-- -----------------------------------------------------------------------------
-- 3. Únicos parciales: solo entre valores no nulos y registros no borrados.
--    (Un proveedor/cliente/variante dado de baja libera su código.)
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX "variante_codigo_barras_unico" ON "Variante" ("codigoBarras")
  WHERE "codigoBarras" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "proveedor_cuit_unico" ON "Proveedor" ("cuit")
  WHERE "cuit" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "cliente_documento_unico" ON "Cliente" ("documento")
  WHERE "documento" IS NOT NULL AND "deletedAt" IS NULL;

-- Unicidad cruzada Variante.codigoBarras <-> CodigoBarrasAlternativo.codigo.
-- Un índice no puede abarcar dos tablas, así que va por trigger. El advisory
-- lock por código serializa dos inserciones concurrentes del mismo código.
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
    PERFORM pg_advisory_xact_lock(hashtext('codigo_barras:' || v_codigo));
    IF EXISTS (SELECT 1 FROM "CodigoBarrasAlternativo" c WHERE c."codigo" = v_codigo) THEN
      RAISE EXCEPTION 'El código de barras % ya está registrado como código alternativo', v_codigo
        USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    v_codigo := NEW."codigo";
    PERFORM pg_advisory_xact_lock(hashtext('codigo_barras:' || v_codigo));
    IF EXISTS (
      SELECT 1 FROM "Variante" v
      WHERE v."codigoBarras" = v_codigo AND v."deletedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'El código de barras % ya está registrado como código principal de una variante', v_codigo
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_variante_codigo_barras_unico
  BEFORE INSERT OR UPDATE OF "codigoBarras", "deletedAt" ON "Variante"
  FOR EACH ROW EXECUTE FUNCTION fn_codigo_barras_unico_global();

CREATE TRIGGER trg_codigo_alternativo_unico
  BEFORE INSERT OR UPDATE OF "codigo" ON "CodigoBarrasAlternativo"
  FOR EACH ROW EXECUTE FUNCTION fn_codigo_barras_unico_global();


-- -----------------------------------------------------------------------------
-- 4. Inmutabilidad: MovimientoStock y AuditLog no se editan ni se borran.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla "%" es inmutable: % no está permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Los errores de stock se corrigen con un movimiento de AJUSTE inverso.';
END;
$$;

CREATE TRIGGER trg_movimiento_stock_inmutable
  BEFORE UPDATE OR DELETE ON "MovimientoStock"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_movimiento_stock_no_truncate
  BEFORE TRUNCATE ON "MovimientoStock"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_audit_log_inmutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();


-- -----------------------------------------------------------------------------
-- 5. Consistencia ledger <-> Stock
--
-- a) validar_stock_movimiento (BEFORE INSERT en MovimientoStock):
--    - stockPosterior = stockAnterior ± cantidad según el tipo, y >= 0.
--    - stockAnterior coincide con el Stock actual de (variante, depósito):
--      el ledger no puede "inventar" un punto de partida.
--
-- b) autorizar_stock (AFTER INSERT en MovimientoStock): deja una marca local
--    a la transacción (set_config(..., true)) con "anterior:posterior".
--
-- c) proteger_stock (BEFORE INSERT/UPDATE/DELETE en Stock):
--    - INSERT solo con cantidad 0 (la fila se crea vacía y se llena por ledger).
--    - UPDATE de cantidad solo si hay una marca de la misma transacción que
--      coincida exactamente; la marca se consume (un movimiento = un update).
--    - DELETE prohibido. varianteId/depositoId inmutables.
--    Resultado: "nadie hace UPDATE directo a Stock" deja de ser una convención
--    y pasa a ser una garantía de la DB.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_signo_movimiento(p_tipo "TipoMovimiento") RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tipo IN ('INGRESO_COMPRA', 'INGRESO_MANUAL', 'DEVOLUCION_CLIENTE',
                    'AJUSTE_POSITIVO', 'TRANSFERENCIA_ENTRADA') THEN 1
    ELSE -1
  END;
$$;

CREATE OR REPLACE FUNCTION fn_stock_guc_key(p_variante_id text, p_deposito_id text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'app_stock.m' || md5(p_variante_id || ':' || p_deposito_id);
$$;

CREATE OR REPLACE FUNCTION validar_stock_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_esperado integer;
  v_actual   integer;
BEGIN
  v_esperado := NEW."stockAnterior" + fn_signo_movimiento(NEW."tipo") * NEW."cantidad";

  IF NEW."stockPosterior" <> v_esperado THEN
    RAISE EXCEPTION 'Movimiento inconsistente (%): stockAnterior % % cantidad % debería dar %, no %',
      NEW."tipo", NEW."stockAnterior",
      CASE WHEN fn_signo_movimiento(NEW."tipo") = 1 THEN '+' ELSE '-' END,
      NEW."cantidad", v_esperado, NEW."stockPosterior"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."stockPosterior" < 0 THEN
    RAISE EXCEPTION 'Movimiento dejaría stock negativo (%) para variante % en depósito %',
      NEW."stockPosterior", NEW."varianteId", NEW."depositoId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s."cantidad" INTO v_actual
  FROM "Stock" s
  WHERE s."varianteId" = NEW."varianteId" AND s."depositoId" = NEW."depositoId";

  IF COALESCE(v_actual, 0) <> NEW."stockAnterior" THEN
    RAISE EXCEPTION 'stockAnterior (%) no coincide con el stock actual (%) de variante % en depósito %',
      NEW."stockAnterior", COALESCE(v_actual, 0), NEW."varianteId", NEW."depositoId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_stock_movimiento
  BEFORE INSERT ON "MovimientoStock"
  FOR EACH ROW EXECUTE FUNCTION validar_stock_movimiento();

CREATE OR REPLACE FUNCTION autorizar_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    fn_stock_guc_key(NEW."varianteId", NEW."depositoId"),
    NEW."stockAnterior" || ':' || NEW."stockPosterior",
    true -- local a la transacción
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_autorizar_stock
  AFTER INSERT ON "MovimientoStock"
  FOR EACH ROW EXECUTE FUNCTION autorizar_stock();

CREATE OR REPLACE FUNCTION proteger_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_key   text;
  v_marca text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se pueden borrar filas de "Stock"'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."cantidad" <> 0 THEN
      RAISE EXCEPTION 'Las filas de "Stock" se crean con cantidad 0; el stock se carga con movimientos'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW."varianteId" <> OLD."varianteId" OR NEW."depositoId" <> OLD."depositoId" THEN
    RAISE EXCEPTION 'varianteId/depositoId de "Stock" son inmutables'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."cantidad" = OLD."cantidad" THEN
    RETURN NEW;
  END IF;

  v_key   := fn_stock_guc_key(NEW."varianteId", NEW."depositoId");
  v_marca := current_setting(v_key, true);

  IF v_marca IS NULL OR v_marca <> OLD."cantidad" || ':' || NEW."cantidad" THEN
    RAISE EXCEPTION 'UPDATE directo a "Stock" rechazado (% -> %): todo cambio de stock requiere un MovimientoStock en la misma transacción',
      OLD."cantidad", NEW."cantidad"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config(v_key, '', true); -- la marca se consume
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proteger_stock
  BEFORE INSERT OR UPDATE OR DELETE ON "Stock"
  FOR EACH ROW EXECUTE FUNCTION proteger_stock();

CREATE TRIGGER trg_stock_no_truncate
  BEFORE TRUNCATE ON "Stock"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();


-- -----------------------------------------------------------------------------
-- 6. Stock total de una variante (todos los depósitos)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_stock_por_variante(p_variante_id text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(s."cantidad"), 0)::integer
  FROM "Stock" s
  WHERE s."varianteId" = p_variante_id;
$$;


-- -----------------------------------------------------------------------------
-- 7. vw_stock_consolidado
--
-- Columnas fijas (estables para la app, tipables en TS):
--   producto_id, producto, variante_id, variante, sku, codigo_barras,
--   stock_minimo, total, por_deposito (jsonb: {"<depositoId>": cantidad})
-- + una columna por depósito (nombre del depósito), generada con
--   SUM(...) FILTER. Como los depósitos pueden crecer, la vista se regenera
--   sola cuando se crea/renombra/borra un depósito (trigger en "Deposito").
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_rebuild_vw_stock_consolidado() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(
           format('COALESCE(SUM(s."cantidad") FILTER (WHERE s."depositoId" = %L), 0)::integer AS %I',
                  d."id", d."nombre"),
           E',\n    ' ORDER BY d."esPrincipal" DESC, d."nombre")
    INTO v_cols
  FROM "Deposito" d;

  DROP VIEW IF EXISTS vw_stock_consolidado;

  EXECUTE format($v$
    CREATE VIEW vw_stock_consolidado AS
    SELECT
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
      ) AS por_deposito%s
    FROM "Variante" v
    JOIN "Producto" p ON p."id" = v."productoId"
    LEFT JOIN "Stock" s ON s."varianteId" = v."id"
    WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
    GROUP BY p."id", p."nombre", v."id", v."nombre", v."sku", v."codigoBarras", v."stockMinimo"
  $v$, CASE WHEN v_cols IS NULL THEN '' ELSE E',\n    ' || v_cols END);
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_deposito_rebuild_vista() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_rebuild_vw_stock_consolidado();
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_deposito_rebuild_vista
  AFTER INSERT OR DELETE OR UPDATE OF "nombre", "esPrincipal" ON "Deposito"
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_deposito_rebuild_vista();

SELECT fn_rebuild_vw_stock_consolidado();


-- -----------------------------------------------------------------------------
-- 8. vw_alertas_stock: variantes activas con stock total < stockMinimo.
--    Independiente de vw_stock_consolidado (esa se regenera con DROP).
-- -----------------------------------------------------------------------------

CREATE VIEW vw_alertas_stock AS
SELECT
  p."id"           AS producto_id,
  p."nombre"       AS producto,
  v."id"           AS variante_id,
  v."nombre"       AS variante,
  v."sku"          AS sku,
  v."codigoBarras" AS codigo_barras,
  v."stockMinimo"  AS stock_minimo,
  t.total          AS stock_total,
  (v."stockMinimo" - t.total) AS faltante
FROM "Variante" v
JOIN "Producto" p ON p."id" = v."productoId"
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(s."cantidad"), 0)::integer AS total
  FROM "Stock" s
  WHERE s."varianteId" = v."id"
) t
WHERE v."deletedAt" IS NULL
  AND v."activo"
  AND p."deletedAt" IS NULL
  AND p."activo"
  AND t.total < v."stockMinimo";
