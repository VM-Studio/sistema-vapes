-- =============================================================================
-- INTEGRIDAD — escrita a mano (segunda pasada de revisión).
-- Lleva a la DB reglas del diseño que hasta ahora solo vivían en la app:
--   1. Nunca DELETE físico de datos de negocio.
--   2. Todo producto tiene al menos una variante ("Único" si no tiene variantes).
--   3. Ledger -> Stock: todo movimiento se aplica al caché en la misma tx.
--   4. Documentos confirmados (venta/compra/transferencia) no se editan: se anulan.
--      Totales de venta/compra = suma de sus ítems (snapshot consistente).
--   5. Comprobantes inmutables y numerados desde SecuenciaComprobante.
--   6. Correcciones: CHECK de Transferencia anulada, costo en INGRESO_COMPRA,
--      largo del nombre de depósito (es nombre de columna en la vista).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Sin DELETE físico
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se pueden borrar filas de "%": %', TG_TABLE_NAME, TG_ARGV[0]
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_usuario_no_delete   BEFORE DELETE ON "Usuario"   FOR EACH ROW EXECUTE FUNCTION prevent_delete('usá soft delete (deletedAt)');
CREATE TRIGGER trg_producto_no_delete  BEFORE DELETE ON "Producto"  FOR EACH ROW EXECUTE FUNCTION prevent_delete('usá soft delete (deletedAt)');
CREATE TRIGGER trg_variante_no_delete  BEFORE DELETE ON "Variante"  FOR EACH ROW EXECUTE FUNCTION prevent_delete('usá soft delete (deletedAt)');
CREATE TRIGGER trg_cliente_no_delete   BEFORE DELETE ON "Cliente"   FOR EACH ROW EXECUTE FUNCTION prevent_delete('usá soft delete (deletedAt)');
CREATE TRIGGER trg_proveedor_no_delete BEFORE DELETE ON "Proveedor" FOR EACH ROW EXECUTE FUNCTION prevent_delete('usá soft delete (deletedAt)');
CREATE TRIGGER trg_gasto_no_delete     BEFORE DELETE ON "Gasto"     FOR EACH ROW EXECUTE FUNCTION prevent_delete('usá soft delete (deletedAt)');
CREATE TRIGGER trg_deposito_no_delete  BEFORE DELETE ON "Deposito"  FOR EACH ROW EXECUTE FUNCTION prevent_delete('desactivalo (activo = false)');
CREATE TRIGGER trg_comprobante_no_delete BEFORE DELETE ON "Comprobante" FOR EACH ROW EXECUTE FUNCTION prevent_delete('los comprobantes emitidos son definitivos');
CREATE TRIGGER trg_secuencia_no_delete BEFORE DELETE ON "SecuenciaComprobante" FOR EACH ROW EXECUTE FUNCTION prevent_delete('reiniciaría la numeración');

-- Venta / Compra / Transferencia: solo se borran en borrador.
CREATE OR REPLACE FUNCTION prevent_delete_documento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."estado"::text NOT IN ('BORRADOR', 'PENDIENTE') THEN
    RAISE EXCEPTION 'No se puede borrar % #% en estado %: anulalo', TG_TABLE_NAME, OLD."numero", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_venta_no_delete         BEFORE DELETE ON "Venta"         FOR EACH ROW EXECUTE FUNCTION prevent_delete_documento();
CREATE TRIGGER trg_compra_no_delete        BEFORE DELETE ON "Compra"        FOR EACH ROW EXECUTE FUNCTION prevent_delete_documento();
CREATE TRIGGER trg_transferencia_no_delete BEFORE DELETE ON "Transferencia" FOR EACH ROW EXECUTE FUNCTION prevent_delete_documento();


-- -----------------------------------------------------------------------------
-- 2. Producto <-> Variantes (verificación diferida al COMMIT, para permitir
--    crear el producto y sus variantes en la misma transacción).
--    - Producto vivo => al menos una variante viva.
--    - tieneVariantes = false => exactamente una variante viva, llamada "Único".
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_verificar_variantes_producto(p_producto_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_producto "Producto"%ROWTYPE;
  v_cantidad integer;
  v_nombre   text;
BEGIN
  SELECT * INTO v_producto FROM "Producto" WHERE "id" = p_producto_id;
  IF NOT FOUND OR v_producto."deletedAt" IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*), MIN("nombre") INTO v_cantidad, v_nombre
  FROM "Variante"
  WHERE "productoId" = p_producto_id AND "deletedAt" IS NULL;

  IF v_cantidad = 0 THEN
    RAISE EXCEPTION 'El producto "%" debe tener al menos una variante', v_producto."nombre"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_producto."tieneVariantes" AND (v_cantidad <> 1 OR v_nombre <> 'Único') THEN
    RAISE EXCEPTION 'El producto "%" no tiene variantes: debe tener exactamente una variante "Único" (tiene %)',
      v_producto."nombre", v_cantidad
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_verificar_variantes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Producto' THEN
    PERFORM fn_verificar_variantes_producto(NEW."id");
  ELSE
    PERFORM fn_verificar_variantes_producto(NEW."productoId");
    IF TG_OP = 'UPDATE' AND OLD."productoId" <> NEW."productoId" THEN
      PERFORM fn_verificar_variantes_producto(OLD."productoId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_producto_variantes
  AFTER INSERT OR UPDATE OF "tieneVariantes", "deletedAt" ON "Producto"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_variantes();

CREATE CONSTRAINT TRIGGER trg_variante_producto
  AFTER INSERT OR UPDATE OF "productoId", "nombre", "deletedAt" ON "Variante"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_variantes();


-- -----------------------------------------------------------------------------
-- 3. Ledger -> Stock
--    La migración anterior garantiza: Stock no cambia sin movimiento.
--    Esto garantiza lo inverso: ningún movimiento queda sin aplicar.
--    a) No se puede insertar un movimiento si el anterior del mismo
--       (variante, depósito) en esta tx todavía no se aplicó a Stock.
--    b) Al COMMIT, todo movimiento de la tx debe haberse aplicado.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validar_stock_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_esperado integer;
  v_actual   integer;
BEGIN
  IF COALESCE(current_setting(fn_stock_guc_key(NEW."varianteId", NEW."depositoId"), true), '') <> '' THEN
    RAISE EXCEPTION 'Hay un movimiento previo de variante % en depósito % sin aplicar a "Stock" en esta transacción',
      NEW."varianteId", NEW."depositoId"
      USING ERRCODE = 'check_violation';
  END IF;

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

CREATE OR REPLACE FUNCTION verificar_movimiento_aplicado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting(fn_stock_guc_key(NEW."varianteId", NEW."depositoId"), true), '') <> '' THEN
    RAISE EXCEPTION 'MovimientoStock % no se aplicó a "Stock" en la misma transacción', NEW."id"
      USING ERRCODE = 'check_violation',
            HINT = 'Usá registrarMovimiento(): inserta el movimiento y actualiza Stock atómicamente.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_movimiento_aplicado
  AFTER INSERT ON "MovimientoStock"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_movimiento_aplicado();


-- -----------------------------------------------------------------------------
-- 4. Documentos: Venta, Compra, Transferencia
-- -----------------------------------------------------------------------------

-- 4a. Marca local a la tx: "este documento se creó en esta transacción".
--     Permite crear un documento ya confirmado con sus ítems en una sola tx,
--     sin abrir la puerta a editar ítems de documentos confirmados antes.
CREATE OR REPLACE FUNCTION fn_doc_guc_key(p_tabla text, p_id text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'app_doc.d' || md5(p_tabla || ':' || p_id);
$$;

CREATE OR REPLACE FUNCTION trg_fn_marcar_documento_nuevo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(fn_doc_guc_key(TG_TABLE_NAME, NEW."id"), '1', true);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_venta_nueva         AFTER INSERT ON "Venta"         FOR EACH ROW EXECUTE FUNCTION trg_fn_marcar_documento_nuevo();
CREATE TRIGGER trg_compra_nueva        AFTER INSERT ON "Compra"        FOR EACH ROW EXECUTE FUNCTION trg_fn_marcar_documento_nuevo();
CREATE TRIGGER trg_transferencia_nueva AFTER INSERT ON "Transferencia" FOR EACH ROW EXECUTE FUNCTION trg_fn_marcar_documento_nuevo();

-- 4b. Ítems: solo se tocan si el documento está en borrador o se creó en esta tx.
CREATE OR REPLACE FUNCTION trg_fn_items_editables() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tabla  text := TG_ARGV[0];  -- tabla padre
  v_fk     text := TG_ARGV[1];  -- columna FK en el ítem
  v_editable_estado text := TG_ARGV[2];
  v_fila   record;
  v_padre  text;
  v_estado text;
  v_numero integer;
BEGIN
  v_fila  := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_padre := to_jsonb(v_fila) ->> v_fk;

  EXECUTE format('SELECT "estado"::text, "numero" FROM %I WHERE "id" = $1', v_tabla)
    INTO v_estado, v_numero USING v_padre;

  -- Padre inexistente: borrado en cascada de un borrador (ya validado) o FK inválida (la FK falla).
  IF v_estado IS NULL OR v_estado = v_editable_estado
     OR current_setting(fn_doc_guc_key(v_tabla, v_padre), true) = '1' THEN
    RETURN v_fila;
  END IF;

  RAISE EXCEPTION 'Los ítems de % #% (estado %) no se pueden modificar', v_tabla, v_numero, v_estado
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_venta_item_editable BEFORE INSERT OR UPDATE OR DELETE ON "VentaItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_items_editables('Venta', 'ventaId', 'BORRADOR');
CREATE TRIGGER trg_compra_item_editable BEFORE INSERT OR UPDATE OR DELETE ON "CompraItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_items_editables('Compra', 'compraId', 'BORRADOR');
CREATE TRIGGER trg_transferencia_item_editable BEFORE INSERT OR UPDATE OR DELETE ON "TransferenciaItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_items_editables('Transferencia', 'transferenciaId', 'PENDIENTE');

-- 4c. Máquinas de estado + congelamiento de documentos no-borrador.
CREATE OR REPLACE FUNCTION trg_fn_venta_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."estado" = 'BORRADOR' THEN
    RETURN NEW;
  END IF;

  IF (OLD."estado" = 'CONFIRMADA' AND NEW."estado" NOT IN ('CONFIRMADA', 'ANULADA'))
     OR (OLD."estado" = 'ANULADA' AND NEW."estado" <> 'ANULADA') THEN
    RAISE EXCEPTION 'Transición de estado inválida en Venta #%: % -> %', OLD."numero", OLD."estado", NEW."estado"
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW."numero", NEW."fecha", NEW."clienteId", NEW."depositoId", NEW."subtotal", NEW."descuento",
      NEW."total", NEW."costoTotal", NEW."gananciaBruta", NEW."medioPago", NEW."usuarioId")
     IS DISTINCT FROM
     (OLD."numero", OLD."fecha", OLD."clienteId", OLD."depositoId", OLD."subtotal", OLD."descuento",
      OLD."total", OLD."costoTotal", OLD."gananciaBruta", OLD."medioPago", OLD."usuarioId") THEN
    RAISE EXCEPTION 'La Venta #% está %: no se modifica, se anula', OLD."numero", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."estado" = 'ANULADA'
     AND (NEW."anuladaPorId", NEW."anuladaAt", NEW."motivoAnulacion")
         IS DISTINCT FROM (OLD."anuladaPorId", OLD."anuladaAt", OLD."motivoAnulacion") THEN
    RAISE EXCEPTION 'Los datos de anulación de la Venta #% no se modifican', OLD."numero"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_venta_estado BEFORE UPDATE ON "Venta"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_venta_estado();

CREATE OR REPLACE FUNCTION trg_fn_compra_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."estado" = 'BORRADOR' THEN
    RETURN NEW;
  END IF;

  IF (OLD."estado" = 'RECIBIDA' AND NEW."estado" NOT IN ('RECIBIDA', 'ANULADA'))
     OR (OLD."estado" = 'ANULADA' AND NEW."estado" <> 'ANULADA') THEN
    RAISE EXCEPTION 'Transición de estado inválida en Compra #%: % -> %', OLD."numero", OLD."estado", NEW."estado"
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW."numero", NEW."proveedorId", NEW."depositoId", NEW."fecha", NEW."subtotal",
      NEW."descuento", NEW."total", NEW."usuarioId")
     IS DISTINCT FROM
     (OLD."numero", OLD."proveedorId", OLD."depositoId", OLD."fecha", OLD."subtotal",
      OLD."descuento", OLD."total", OLD."usuarioId") THEN
    RAISE EXCEPTION 'La Compra #% está %: no se modifica, se anula', OLD."numero", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_compra_estado BEFORE UPDATE ON "Compra"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_compra_estado();

CREATE OR REPLACE FUNCTION trg_fn_transferencia_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."estado" = 'PENDIENTE' THEN
    RETURN NEW;
  END IF;

  IF (OLD."estado" = 'COMPLETADA' AND NEW."estado" NOT IN ('COMPLETADA', 'ANULADA'))
     OR (OLD."estado" = 'ANULADA' AND NEW."estado" <> 'ANULADA') THEN
    RAISE EXCEPTION 'Transición de estado inválida en Transferencia #%: % -> %', OLD."numero", OLD."estado", NEW."estado"
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW."numero", NEW."depositoOrigenId", NEW."depositoDestinoId", NEW."fecha", NEW."usuarioId", NEW."completadaAt")
     IS DISTINCT FROM
     (OLD."numero", OLD."depositoOrigenId", OLD."depositoDestinoId", OLD."fecha", OLD."usuarioId", OLD."completadaAt") THEN
    RAISE EXCEPTION 'La Transferencia #% está %: no se modifica, se anula', OLD."numero", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transferencia_estado BEFORE UPDATE ON "Transferencia"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_transferencia_estado();

-- Corrección: una transferencia COMPLETADA y luego ANULADA conserva completadaAt.
ALTER TABLE "Transferencia" DROP CONSTRAINT "Transferencia_completada_chk";
ALTER TABLE "Transferencia"
  ADD CONSTRAINT "Transferencia_completada_chk" CHECK (
    ("estado" <> 'COMPLETADA' OR "completadaAt" IS NOT NULL)
    AND ("estado" <> 'PENDIENTE' OR "completadaAt" IS NULL)
  );

-- 4d. Totales = suma de ítems (diferido: se valida al COMMIT, con todo cargado).
--     Aplica a documentos fuera de borrador: el snapshot de ganancia cierra.
CREATE OR REPLACE FUNCTION fn_verificar_totales_venta(p_venta_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_venta    "Venta"%ROWTYPE;
  v_items    integer;
  v_subtotal numeric;
  v_costo    numeric;
BEGIN
  SELECT * INTO v_venta FROM "Venta" WHERE "id" = p_venta_id;
  IF NOT FOUND OR v_venta."estado" = 'BORRADOR' THEN
    RETURN;
  END IF;

  SELECT COUNT(*), COALESCE(SUM("subtotal"), 0), COALESCE(SUM("cantidad" * "costoUnitario"), 0)
    INTO v_items, v_subtotal, v_costo
  FROM "VentaItem" WHERE "ventaId" = p_venta_id;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'La Venta #% no tiene ítems', v_venta."numero" USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."subtotal" <> v_subtotal THEN
    RAISE EXCEPTION 'Venta #%: subtotal % no coincide con la suma de ítems %', v_venta."numero", v_venta."subtotal", v_subtotal
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."costoTotal" <> v_costo THEN
    RAISE EXCEPTION 'Venta #%: costoTotal % no coincide con la suma de costos de ítems %', v_venta."numero", v_venta."costoTotal", v_costo
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verificar_totales_compra(p_compra_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_compra   "Compra"%ROWTYPE;
  v_items    integer;
  v_subtotal numeric;
BEGIN
  SELECT * INTO v_compra FROM "Compra" WHERE "id" = p_compra_id;
  IF NOT FOUND OR v_compra."estado" = 'BORRADOR' THEN
    RETURN;
  END IF;

  SELECT COUNT(*), COALESCE(SUM("subtotal"), 0) INTO v_items, v_subtotal
  FROM "CompraItem" WHERE "compraId" = p_compra_id;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'La Compra #% no tiene ítems', v_compra."numero" USING ERRCODE = 'check_violation';
  END IF;
  IF v_compra."subtotal" <> v_subtotal THEN
    RAISE EXCEPTION 'Compra #%: subtotal % no coincide con la suma de ítems %', v_compra."numero", v_compra."subtotal", v_subtotal
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verificar_items_transferencia(p_transferencia_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_estado text;
  v_numero integer;
BEGIN
  SELECT "estado"::text, "numero" INTO v_estado, v_numero FROM "Transferencia" WHERE "id" = p_transferencia_id;
  IF v_estado IS NULL OR v_estado = 'PENDIENTE' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "TransferenciaItem" WHERE "transferenciaId" = p_transferencia_id) THEN
    RAISE EXCEPTION 'La Transferencia #% no tiene ítems', v_numero USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_verificar_totales() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fila record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Venta'             THEN PERFORM fn_verificar_totales_venta(v_fila."id");
    WHEN 'VentaItem'         THEN PERFORM fn_verificar_totales_venta(to_jsonb(v_fila) ->> 'ventaId');
    WHEN 'Compra'            THEN PERFORM fn_verificar_totales_compra(v_fila."id");
    WHEN 'CompraItem'        THEN PERFORM fn_verificar_totales_compra(to_jsonb(v_fila) ->> 'compraId');
    WHEN 'Transferencia'     THEN PERFORM fn_verificar_items_transferencia(v_fila."id");
    WHEN 'TransferenciaItem' THEN PERFORM fn_verificar_items_transferencia(to_jsonb(v_fila) ->> 'transferenciaId');
  END CASE;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_venta_totales AFTER INSERT OR UPDATE ON "Venta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_totales();
CREATE CONSTRAINT TRIGGER trg_venta_item_totales AFTER INSERT OR UPDATE OR DELETE ON "VentaItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_totales();
CREATE CONSTRAINT TRIGGER trg_compra_totales AFTER INSERT OR UPDATE ON "Compra"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_totales();
CREATE CONSTRAINT TRIGGER trg_compra_item_totales AFTER INSERT OR UPDATE OR DELETE ON "CompraItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_totales();
CREATE CONSTRAINT TRIGGER trg_transferencia_items AFTER INSERT OR UPDATE ON "Transferencia"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_totales();
CREATE CONSTRAINT TRIGGER trg_transferencia_item_items AFTER INSERT OR UPDATE OR DELETE ON "TransferenciaItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_totales();


-- -----------------------------------------------------------------------------
-- 5. Comprobantes
--    - Solo de ventas CONFIRMADAS y por el total de la venta.
--    - El número debe haber salido de SecuenciaComprobante (no se "adelanta").
--    - Emitido, es inmutable salvo pdfUrl y el CAE (que solo se asigna una vez).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_fn_comprobante() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estado text;
  v_total  numeric;
  v_ultimo integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "estado"::text, "total" INTO v_estado, v_total FROM "Venta" WHERE "id" = NEW."ventaId";
    IF v_estado IS DISTINCT FROM 'CONFIRMADA' THEN
      RAISE EXCEPTION 'Solo se emiten comprobantes de ventas confirmadas (estado: %)', COALESCE(v_estado, 'inexistente')
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."total" <> v_total THEN
      RAISE EXCEPTION 'El total del comprobante (%) no coincide con el de la venta (%)', NEW."total", v_total
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT "ultimoNumero" INTO v_ultimo
    FROM "SecuenciaComprobante"
    WHERE "tipo" = NEW."tipo" AND "puntoVenta" = NEW."puntoVenta";
    IF v_ultimo IS NULL OR NEW."numero" > v_ultimo THEN
      RAISE EXCEPTION 'El número % de % (PV %) no fue asignado por SecuenciaComprobante', NEW."numero", NEW."tipo", NEW."puntoVenta"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (NEW."ventaId", NEW."tipo", NEW."puntoVenta", NEW."numero", NEW."fecha", NEW."razonSocial",
      NEW."cuit", NEW."condicionIva", NEW."total", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."ventaId", OLD."tipo", OLD."puntoVenta", OLD."numero", OLD."fecha", OLD."razonSocial",
      OLD."cuit", OLD."condicionIva", OLD."total", OLD."createdAt") THEN
    RAISE EXCEPTION 'Un comprobante emitido no se modifica (solo pdfUrl y CAE)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."cae" IS NOT NULL
     AND (NEW."cae", NEW."caeVencimiento") IS DISTINCT FROM (OLD."cae", OLD."caeVencimiento") THEN
    RAISE EXCEPTION 'El CAE ya fue asignado y no se modifica'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comprobante BEFORE INSERT OR UPDATE ON "Comprobante"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_comprobante();

-- La secuencia solo avanza (retroceder permitiría números duplicados/huecos).
CREATE OR REPLACE FUNCTION trg_fn_secuencia_avanza() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ultimoNumero" < OLD."ultimoNumero"
     OR (NEW."tipo", NEW."puntoVenta") IS DISTINCT FROM (OLD."tipo", OLD."puntoVenta") THEN
    RAISE EXCEPTION 'SecuenciaComprobante solo puede avanzar (% -> %)', OLD."ultimoNumero", NEW."ultimoNumero"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_secuencia_avanza BEFORE UPDATE ON "SecuenciaComprobante"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_secuencia_avanza();


-- -----------------------------------------------------------------------------
-- 6. Correcciones menores
-- -----------------------------------------------------------------------------

-- Un ingreso por compra siempre registra a qué costo entró la mercadería.
ALTER TABLE "MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_costo_compra_chk" CHECK ("tipo" <> 'INGRESO_COMPRA' OR "costoUnitario" IS NOT NULL);

-- El nombre del depósito es nombre de columna en vw_stock_consolidado:
-- Postgres trunca identificadores a 63 bytes (dos nombres largos colisionarían).
ALTER TABLE "Deposito"
  ADD CONSTRAINT "Deposito_nombre_largo_chk" CHECK (octet_length("nombre") <= 63);
