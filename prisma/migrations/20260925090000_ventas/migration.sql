-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PAGADA', 'PARCIAL', 'PENDIENTE');

-- CreateEnum
CREATE TYPE "EstadoComprobante" AS ENUM ('EMITIDO', 'ANULADO');

-- AlterEnum
ALTER TYPE "MedioPago" ADD VALUE 'CREDITO_CLIENTE';

-- DropIndex
DROP INDEX "Venta_clienteId_idx";

-- DropIndex
DROP INDEX "Venta_depositoId_idx";

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "limiteCredito" DECIMAL(12,2),
ADD COLUMN     "saldoAFavor" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "saldoDeudor" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Comprobante" ADD COLUMN     "anuladoAt" TIMESTAMP(3),
ADD COLUMN     "estado" "EstadoComprobante" NOT NULL DEFAULT 'EMITIDO';

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "estadoPago" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "montoPagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "redondeo" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "saldoPendiente" DECIMAL(12,2) NOT NULL DEFAULT 0,
ALTER COLUMN "medioPago" DROP NOT NULL;

-- AlterTable
ALTER TABLE "VentaItem" ADD COLUMN     "cantidadDevuelta" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notas" TEXT;

-- CreateTable
CREATE TABLE "PagoVenta" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "medioPago" "MedioPago" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referencia" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "anuladoPorId" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Devolucion" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "ventaId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "reintegroMedioPago" "MedioPago",
    "reintegroMonto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "aCuentaCorriente" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Devolucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevolucionItem" (
    "id" TEXT NOT NULL,
    "devolucionId" TEXT NOT NULL,
    "ventaItemId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "DevolucionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PagoVenta_ventaId_idx" ON "PagoVenta"("ventaId");

-- CreateIndex
CREATE INDEX "PagoVenta_fecha_medioPago_idx" ON "PagoVenta"("fecha", "medioPago");

-- CreateIndex
CREATE UNIQUE INDEX "Devolucion_numero_key" ON "Devolucion"("numero");

-- CreateIndex
CREATE INDEX "Devolucion_ventaId_idx" ON "Devolucion"("ventaId");

-- CreateIndex
CREATE INDEX "Devolucion_fecha_idx" ON "Devolucion"("fecha");

-- CreateIndex
CREATE INDEX "DevolucionItem_devolucionId_idx" ON "DevolucionItem"("devolucionId");

-- CreateIndex
CREATE INDEX "DevolucionItem_ventaItemId_idx" ON "DevolucionItem"("ventaItemId");

-- CreateIndex
CREATE INDEX "cliente_nombre_trgm" ON "Cliente" USING GIN ("nombre" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "cliente_apellido_trgm" ON "Cliente" USING GIN ("apellido" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "cliente_documento_trgm" ON "Cliente" USING GIN ("documento" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "cliente_telefono_trgm" ON "Cliente" USING GIN ("telefono" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Venta_clienteId_estado_idx" ON "Venta"("clienteId", "estado");

-- CreateIndex
CREATE INDEX "Venta_depositoId_fecha_idx" ON "Venta"("depositoId", "fecha");

-- AddForeignKey
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_anuladoPorId_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_devolucionId_fkey" FOREIGN KEY ("devolucionId") REFERENCES "Devolucion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_ventaItemId_fkey" FOREIGN KEY ("ventaItemId") REFERENCES "VentaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Ventas: pagos partidos, cuenta corriente, redondeo y devoluciones.
-- Garantías en la DB (además del servicio):
--   1. total = subtotal − descuento + redondeo (redondeo ≤ 0: a favor del cliente).
--   2. Venta confirmada: montoPagado = Σ pagos vigentes; montoPagado + saldoPendiente = total;
--      estadoPago coherente. Borrador: sin pagos. Anulada: sin pagos vigentes ni saldo.
--   3. Cliente.saldoDeudor = Σ saldoPendiente de sus ventas confirmadas.
--   4. PagoVenta: no se borra; solo se anula (una vez) y no cambian sus montos.
--   5. Devolucion / DevolucionItem: inmutables; los ítems solo en la tx que crea la devolución;
--      total = Σ ítems = reintegro + a cuenta; VentaItem.cantidadDevuelta = Σ devuelto ≤ cantidad.
-- Las verificaciones 2, 3 y 5 son triggers DIFERIDOS (al COMMIT): el servicio puede
-- escribir en cualquier orden dentro de la transacción, pero no puede cerrarla inconsistente.
-- (Nota: "Σ devuelto ≤ vendido" es una restricción entre filas, no expresable como CHECK
--  simple; la garantiza el trigger diferido sobre el caché cantidadDevuelta + su CHECK.)
-- =============================================================================

-- Datos previos: una venta confirmada antes de este cambio se considera cobrada
-- en su único medio de pago (antes no existía el fiado).
INSERT INTO "PagoVenta" ("id", "ventaId", "medioPago", "monto", "fecha", "usuarioId")
SELECT gen_random_uuid()::text, v."id", COALESCE(v."medioPago", 'EFECTIVO'), v."total", v."fecha", v."usuarioId"
FROM "Venta" v
WHERE v."estado" = 'CONFIRMADA' AND v."total" > 0;
UPDATE "Venta" SET "montoPagado" = "total", "saldoPendiente" = 0, "estadoPago" = 'PAGADA'
WHERE "estado" = 'CONFIRMADA';

-- 1. CHECKs -------------------------------------------------------------------
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_total_chk";
ALTER TABLE "Venta"
  ADD CONSTRAINT "Venta_total_chk"     CHECK ("total" >= 0 AND "total" = "subtotal" - "descuento" + "redondeo"),
  ADD CONSTRAINT "Venta_redondeo_chk"  CHECK ("redondeo" <= 0),
  ADD CONSTRAINT "Venta_pagos_chk"     CHECK (
    "montoPagado" >= 0 AND "saldoPendiente" >= 0
    AND ("estado" <> 'CONFIRMADA' OR "montoPagado" + "saldoPendiente" = "total")
  );

ALTER TABLE "VentaItem"
  ADD CONSTRAINT "VentaItem_cantidadDevuelta_chk" CHECK ("cantidadDevuelta" >= 0 AND "cantidadDevuelta" <= "cantidad");

ALTER TABLE "Cliente"
  ADD CONSTRAINT "Cliente_saldoDeudor_chk"   CHECK ("saldoDeudor" >= 0),
  ADD CONSTRAINT "Cliente_saldoAFavor_chk"   CHECK ("saldoAFavor" >= 0),
  ADD CONSTRAINT "Cliente_limiteCredito_chk" CHECK ("limiteCredito" IS NULL OR "limiteCredito" >= 0);

ALTER TABLE "PagoVenta"
  ADD CONSTRAINT "PagoVenta_monto_chk"    CHECK ("monto" > 0),
  ADD CONSTRAINT "PagoVenta_anulado_chk"  CHECK (
    "anulado" = ("anuladoAt" IS NOT NULL AND "anuladoPorId" IS NOT NULL AND "motivoAnulacion" IS NOT NULL)
  );

ALTER TABLE "Devolucion"
  ADD CONSTRAINT "Devolucion_motivo_chk"  CHECK (length(btrim("motivo")) > 0),
  ADD CONSTRAINT "Devolucion_montos_chk"  CHECK (
    "total" > 0 AND "reintegroMonto" >= 0 AND "aCuentaCorriente" >= 0
    AND "total" = "reintegroMonto" + "aCuentaCorriente"
  ),
  -- Reintegro en dinero ⇔ tiene medio (y no puede ser "crédito del cliente": eso es aCuentaCorriente).
  ADD CONSTRAINT "Devolucion_reintegro_chk" CHECK (
    ("reintegroMonto" > 0) = ("reintegroMedioPago" IS NOT NULL)
    AND ("reintegroMedioPago" IS NULL OR "reintegroMedioPago"::text <> 'CREDITO_CLIENTE')
  );

ALTER TABLE "DevolucionItem"
  ADD CONSTRAINT "DevolucionItem_cantidad_chk" CHECK ("cantidad" > 0),
  ADD CONSTRAINT "DevolucionItem_subtotal_chk" CHECK ("precioUnitario" >= 0 AND "subtotal" = "cantidad" * "precioUnitario");

ALTER TABLE "Comprobante"
  ADD CONSTRAINT "Comprobante_anulado_chk" CHECK (("estado" = 'ANULADO') = ("anuladoAt" IS NOT NULL));

-- Los movimientos de una devolución parcial apuntan a su Devolucion.
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_referenciaTipo_chk";
ALTER TABLE "MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_referenciaTipo_chk" CHECK (
    "referenciaTipo" IS NULL OR "referenciaTipo" IN ('VENTA', 'COMPRA', 'TRANSFERENCIA', 'AJUSTE', 'DEVOLUCION')
  );

-- 2. Venta congelada: ahora también el redondeo ---------------------------------
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
      NEW."redondeo", NEW."total", NEW."costoTotal", NEW."gananciaBruta", NEW."medioPago", NEW."usuarioId")
     IS DISTINCT FROM
     (OLD."numero", OLD."fecha", OLD."clienteId", OLD."depositoId", OLD."subtotal", OLD."descuento",
      OLD."redondeo", OLD."total", OLD."costoTotal", OLD."gananciaBruta", OLD."medioPago", OLD."usuarioId") THEN
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

-- 3. VentaItem de una venta confirmada: solo puede cambiar cantidadDevuelta ---------
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

  IF TG_OP = 'UPDATE' AND v_estado = 'CONFIRMADA'
     AND (to_jsonb(NEW) - 'cantidadDevuelta' - 'updatedAt') = (to_jsonb(OLD) - 'cantidadDevuelta' - 'updatedAt') THEN
    RETURN NEW;  -- devolución: solo avanza el caché (lo verifica el trigger diferido)
  END IF;

  RAISE EXCEPTION 'Los ítems de Venta #% (estado %) no se pueden modificar', v_numero, v_estado
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER trg_venta_item_editable ON "VentaItem";
CREATE TRIGGER trg_venta_item_editable BEFORE INSERT OR UPDATE OR DELETE ON "VentaItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_venta_item_editable();

-- 4. PagoVenta: sin DELETE; UPDATE solo para anular (una vez) -------------------
CREATE TRIGGER trg_pago_venta_no_delete BEFORE DELETE ON "PagoVenta"
  FOR EACH ROW EXECUTE FUNCTION prevent_delete('los pagos no se borran: anulalos');

CREATE OR REPLACE FUNCTION trg_fn_pago_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'anulado' - 'anuladoPorId' - 'anuladoAt' - 'motivoAnulacion')
     IS DISTINCT FROM (to_jsonb(OLD) - 'anulado' - 'anuladoPorId' - 'anuladoAt' - 'motivoAnulacion') THEN
    RAISE EXCEPTION 'Un pago registrado no se modifica: se anula'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."anulado" THEN
    RAISE EXCEPTION 'El pago ya está anulado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pago_venta BEFORE UPDATE ON "PagoVenta"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_pago_venta();

-- 5. Devoluciones: inmutables; ítems solo en la tx que crea la devolución --------
CREATE TRIGGER trg_devolucion_inmutable BEFORE UPDATE OR DELETE ON "Devolucion"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_devolucion_item_inmutable BEFORE UPDATE OR DELETE ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_devolucion_nueva AFTER INSERT ON "Devolucion"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_marcar_documento_nuevo();

CREATE OR REPLACE FUNCTION trg_fn_devolucion_item_nuevo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting(fn_doc_guc_key('Devolucion', NEW."devolucionId"), true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'No se agregan ítems a una devolución ya registrada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_devolucion_item_nuevo BEFORE INSERT ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_devolucion_item_nuevo();

-- 6. Comprobante: EMITIDO → ANULADO (una sola vez) --------------------------------
CREATE OR REPLACE FUNCTION trg_fn_comprobante() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estado text;
  v_total  numeric;
  v_ultimo integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."estado" <> 'EMITIDO' THEN
      RAISE EXCEPTION 'Un comprobante se emite en estado EMITIDO' USING ERRCODE = 'check_violation';
    END IF;
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
    RAISE EXCEPTION 'Un comprobante emitido no se modifica (solo pdfUrl, CAE y anulación)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADO' AND (NEW."estado", NEW."anuladoAt") IS DISTINCT FROM (OLD."estado", OLD."anuladoAt") THEN
    RAISE EXCEPTION 'El comprobante ya está anulado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."estado" = 'ANULADO' AND OLD."estado" = 'EMITIDO' THEN
    SELECT "estado"::text INTO v_estado FROM "Venta" WHERE "id" = NEW."ventaId";
    IF v_estado <> 'ANULADA' THEN
      RAISE EXCEPTION 'Un comprobante se anula junto con su venta' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD."cae" IS NOT NULL
     AND (NEW."cae", NEW."caeVencimiento") IS DISTINCT FROM (OLD."cae", OLD."caeVencimiento") THEN
    RAISE EXCEPTION 'El CAE ya fue asignado y no se modifica'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- 7. Verificaciones diferidas (al COMMIT) -----------------------------------------
CREATE OR REPLACE FUNCTION fn_verificar_pagos_venta(p_venta_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v "Venta"%ROWTYPE;
  v_pagado numeric;
  v_esperado text;
BEGIN
  SELECT * INTO v FROM "Venta" WHERE "id" = p_venta_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM("monto"), 0) INTO v_pagado
  FROM "PagoVenta" WHERE "ventaId" = p_venta_id AND NOT "anulado";

  IF v."estado" <> 'CONFIRMADA' THEN
    IF v_pagado <> 0 OR v."montoPagado" <> 0 OR v."saldoPendiente" <> 0 THEN
      RAISE EXCEPTION 'Venta #% (%): no puede tener pagos vigentes ni saldo', v."numero", v."estado"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  IF v."montoPagado" <> v_pagado THEN
    RAISE EXCEPTION 'Venta #%: montoPagado % no coincide con la suma de pagos %', v."numero", v."montoPagado", v_pagado
      USING ERRCODE = 'check_violation';
  END IF;
  v_esperado := CASE WHEN v."saldoPendiente" = 0 THEN 'PAGADA' WHEN v."montoPagado" > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END;
  IF v."estadoPago"::text <> v_esperado THEN
    RAISE EXCEPTION 'Venta #%: estadoPago % debería ser %', v."numero", v."estadoPago", v_esperado
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verificar_saldo_cliente(p_cliente_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_cache numeric;
  v_real  numeric;
BEGIN
  IF p_cliente_id IS NULL THEN RETURN; END IF;
  SELECT "saldoDeudor" INTO v_cache FROM "Cliente" WHERE "id" = p_cliente_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(SUM("saldoPendiente"), 0) INTO v_real
  FROM "Venta" WHERE "clienteId" = p_cliente_id AND "estado" = 'CONFIRMADA';
  IF v_cache <> v_real THEN
    RAISE EXCEPTION 'Saldo deudor del cliente (%) no coincide con sus ventas pendientes (%)', v_cache, v_real
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verificar_devolucion(p_devolucion_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  d "Devolucion"%ROWTYPE;
  v_items integer;
  v_total numeric;
  v_ajenos integer;
BEGIN
  SELECT * INTO d FROM "Devolucion" WHERE "id" = p_devolucion_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COUNT(*), COALESCE(SUM(di."subtotal"), 0), COUNT(*) FILTER (WHERE vi."ventaId" <> d."ventaId")
    INTO v_items, v_total, v_ajenos
  FROM "DevolucionItem" di JOIN "VentaItem" vi ON vi."id" = di."ventaItemId"
  WHERE di."devolucionId" = p_devolucion_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'La Devolución #% no tiene ítems', d."numero" USING ERRCODE = 'check_violation';
  END IF;
  IF v_ajenos > 0 THEN
    RAISE EXCEPTION 'La Devolución #% tiene ítems de otra venta', d."numero" USING ERRCODE = 'check_violation';
  END IF;
  IF d."total" <> v_total THEN
    RAISE EXCEPTION 'Devolución #%: total % no coincide con la suma de ítems %', d."numero", d."total", v_total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verificar_devuelto(p_venta_item_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_cache integer;
  v_real  integer;
BEGIN
  SELECT "cantidadDevuelta" INTO v_cache FROM "VentaItem" WHERE "id" = p_venta_item_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(SUM("cantidad"), 0) INTO v_real FROM "DevolucionItem" WHERE "ventaItemId" = p_venta_item_id;
  IF v_cache <> v_real THEN
    RAISE EXCEPTION 'cantidadDevuelta (%) no coincide con lo devuelto (%)', v_cache, v_real
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_verificar_ventas() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Venta' THEN
      PERFORM fn_verificar_pagos_venta(f."id");
      PERFORM fn_verificar_saldo_cliente(f."clienteId");
    WHEN 'PagoVenta' THEN
      PERFORM fn_verificar_pagos_venta(f."ventaId");
    WHEN 'Cliente' THEN
      PERFORM fn_verificar_saldo_cliente(f."id");
    WHEN 'Devolucion' THEN
      PERFORM fn_verificar_devolucion(f."id");
    WHEN 'DevolucionItem' THEN
      PERFORM fn_verificar_devolucion(f."devolucionId");
      PERFORM fn_verificar_devuelto(f."ventaItemId");
    WHEN 'VentaItem' THEN
      PERFORM fn_verificar_devuelto(f."id");
  END CASE;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_venta_pagos AFTER INSERT OR UPDATE ON "Venta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_ventas();
CREATE CONSTRAINT TRIGGER trg_pago_venta_verificar AFTER INSERT OR UPDATE ON "PagoVenta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_ventas();
CREATE CONSTRAINT TRIGGER trg_cliente_saldo AFTER UPDATE OF "saldoDeudor" ON "Cliente"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_ventas();
CREATE CONSTRAINT TRIGGER trg_devolucion_verificar AFTER INSERT ON "Devolucion"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_ventas();
CREATE CONSTRAINT TRIGGER trg_devolucion_item_verificar AFTER INSERT ON "DevolucionItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_ventas();
CREATE CONSTRAINT TRIGGER trg_venta_item_devuelto AFTER UPDATE OF "cantidadDevuelta" ON "VentaItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_ventas();

