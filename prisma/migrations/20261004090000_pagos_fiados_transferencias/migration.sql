-- =============================================================================
-- A1: PAGOS MIXTOS, FIADOS (CUENTA CORRIENTE) Y TRANSFERENCIAS CON CÓDIGO/REMITO
--
-- - PagoVenta: los pagos de cada venta (mixtos al vender y cobros posteriores
--   de fiados). Inmutables salvo los campos de anulación.
-- - Venta: medioPago pasa a "medio principal" (nullable), estadoPago,
--   montoPagado y saldoPendiente (confirmada: pagado + pendiente = total).
-- - Cliente.saldoDeudor: caché de Σ saldoPendiente de sus ventas confirmadas.
-- - Migración de datos: cada venta confirmada existente recibe un PagoVenta
--   por el total con su medio de pago y queda PAGADA.
-- - Transferencia: código visible (VAP-T-000001), remito PDF, observación
--   (antes "notas"). TransferenciaItem: productoId desnormalizado.
-- - Módulo FIADOS (crear = vender fiado, ver = cuenta corriente, editar = cobros).
-- =============================================================================

CREATE TYPE "EstadoPago" AS ENUM ('PAGADA', 'PARCIAL', 'PENDIENTE');
ALTER TYPE "Modulo" ADD VALUE IF NOT EXISTS 'FIADOS';

-- -----------------------------------------------------------------------------
-- 1. Cliente: saldo deudor
-- -----------------------------------------------------------------------------

ALTER TABLE "Cliente" ADD COLUMN "saldoDeudor" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_saldoDeudor_chk" CHECK ("saldoDeudor" >= 0);
CREATE INDEX "Cliente_panelId_saldoDeudor_idx" ON "Cliente"("panelId", "saldoDeudor");

-- -----------------------------------------------------------------------------
-- 2. Venta: estado de pago
-- -----------------------------------------------------------------------------

ALTER TABLE "Venta"
  ADD COLUMN "estadoPago" "EstadoPago" NOT NULL DEFAULT 'PAGADA',
  ADD COLUMN "montoPagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "saldoPendiente" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ALTER COLUMN "medioPago" DROP NOT NULL;

-- Datos: las ventas confirmadas existentes se pagaron completas al vender.
ALTER TABLE "Venta" DISABLE TRIGGER USER;
UPDATE "Venta" SET "montoPagado" = "total", "saldoPendiente" = 0, "estadoPago" = 'PAGADA'
WHERE "estado" = 'CONFIRMADA';
ALTER TABLE "Venta" ENABLE TRIGGER USER;

ALTER TABLE "Venta"
  ADD CONSTRAINT "Venta_montoPagado_chk" CHECK ("montoPagado" >= 0),
  ADD CONSTRAINT "Venta_saldoPendiente_chk" CHECK ("saldoPendiente" >= 0),
  ADD CONSTRAINT "Venta_pagos_total_chk"
    CHECK ("estado" <> 'CONFIRMADA' OR "montoPagado" + "saldoPendiente" = "total"),
  ADD CONSTRAINT "Venta_estadoPago_chk" CHECK (
    "estado" <> 'CONFIRMADA'
    OR ("estadoPago" = 'PAGADA' AND "saldoPendiente" = 0)
    OR ("estadoPago" = 'PARCIAL' AND "saldoPendiente" > 0 AND "montoPagado" > 0)
    OR ("estadoPago" = 'PENDIENTE' AND "saldoPendiente" > 0 AND "montoPagado" = 0)
  );
CREATE INDEX "Venta_panelId_estadoPago_idx" ON "Venta"("panelId", "estadoPago");

-- -----------------------------------------------------------------------------
-- 3. PagoVenta
-- -----------------------------------------------------------------------------

CREATE TABLE "PagoVenta" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "ventaId" TEXT NOT NULL,
    "medioPago" "MedioPago" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referencia" TEXT,
    "esCobroPosterior" BOOLEAN NOT NULL DEFAULT false,
    "cobroId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "anuladoPorId" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoVenta_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PagoVenta_monto_chk" CHECK ("monto" > 0),
    CONSTRAINT "PagoVenta_anulacion_chk"
      CHECK ("anulado" = ("anuladoAt" IS NOT NULL AND "anuladoPorId" IS NOT NULL))
);

CREATE INDEX "PagoVenta_panelId_ventaId_idx" ON "PagoVenta"("panelId", "ventaId");
CREATE INDEX "PagoVenta_panelId_fecha_medioPago_idx" ON "PagoVenta"("panelId", "fecha", "medioPago");
CREATE INDEX "PagoVenta_panelId_cobroId_idx" ON "PagoVenta"("panelId", "cobroId");

ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_anuladoPorId_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Datos: un pago por el total para cada venta confirmada existente.
INSERT INTO "PagoVenta" ("id", "panelId", "ventaId", "medioPago", "monto", "fecha", "usuarioId", "createdAt")
SELECT 'pag_mig_' || v."id", v."panelId", v."id", v."medioPago", v."total", v."fecha", v."vendedorId", v."createdAt"
FROM "Venta" v
WHERE v."estado" = 'CONFIRMADA' AND v."total" > 0;

-- Inmutable: solo se pueden cambiar los datos de anulación, y una sola vez.
CREATE OR REPLACE FUNCTION trg_fn_pago_venta_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Solo por la cascada de la venta (las ventas no se borran: prevent_delete_documento).
    RETURN OLD;
  END IF;
  IF (NEW."id", NEW."panelId", NEW."ventaId", NEW."medioPago", NEW."monto", NEW."referencia",
      NEW."esCobroPosterior", NEW."cobroId", NEW."fecha", NEW."usuarioId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."panelId", OLD."ventaId", OLD."medioPago", OLD."monto", OLD."referencia",
      OLD."esCobroPosterior", OLD."cobroId", OLD."fecha", OLD."usuarioId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Los pagos no se modifican: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."anulado" THEN
    RAISE EXCEPTION 'El pago ya está anulado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pago_venta_inmutable BEFORE UPDATE OR DELETE ON "PagoVenta"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_pago_venta_inmutable();

CREATE TRIGGER trg_panel_pago_venta BEFORE INSERT OR UPDATE OF "panelId", "ventaId" ON "PagoVenta"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('ventaId', 'Venta');

-- Coherencia al cerrar la transacción:
--   venta confirmada → montoPagado = Σ pagos no anulados;
--   venta anulada    → ningún pago vigente y montos en 0.
CREATE OR REPLACE FUNCTION fn_verificar_pagos_venta(p_venta_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_venta  "Venta"%ROWTYPE;
  v_pagado numeric;
BEGIN
  SELECT * INTO v_venta FROM "Venta" WHERE "id" = p_venta_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM("monto"), 0) INTO v_pagado
  FROM "PagoVenta" WHERE "ventaId" = p_venta_id AND NOT "anulado";
  IF v_venta."estado" = 'CONFIRMADA' AND v_venta."montoPagado" <> v_pagado THEN
    RAISE EXCEPTION 'Venta %: montoPagado % no coincide con la suma de pagos %', v_venta."codigo", v_venta."montoPagado", v_pagado
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."estado" = 'ANULADA' AND (v_pagado <> 0 OR v_venta."saldoPendiente" <> 0) THEN
    RAISE EXCEPTION 'Venta % anulada: sus pagos y su saldo pendiente tienen que quedar anulados', v_venta."codigo"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Cliente: saldoDeudor = Σ saldoPendiente de sus ventas confirmadas.
CREATE OR REPLACE FUNCTION fn_verificar_saldo_cliente(p_cliente_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_saldo numeric;
  v_suma  numeric;
BEGIN
  SELECT "saldoDeudor" INTO v_saldo FROM "Cliente" WHERE "id" = p_cliente_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM("saldoPendiente"), 0) INTO v_suma
  FROM "Venta" WHERE "clienteId" = p_cliente_id AND "estado" = 'CONFIRMADA';
  IF v_saldo <> v_suma THEN
    RAISE EXCEPTION 'Cliente %: saldoDeudor % no coincide con el saldo pendiente de sus ventas %', p_cliente_id, v_saldo, v_suma
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_verificar_cuenta_corriente() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fila record := COALESCE(NEW, OLD);
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Venta' THEN
      PERFORM fn_verificar_pagos_venta(v_fila."id");
      PERFORM fn_verificar_saldo_cliente(v_fila."clienteId");
    WHEN 'PagoVenta' THEN
      PERFORM fn_verificar_pagos_venta(v_fila."ventaId");
    WHEN 'Cliente' THEN
      PERFORM fn_verificar_saldo_cliente(v_fila."id");
  END CASE;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_venta_cuenta_corriente
  AFTER INSERT OR UPDATE OF "estado", "montoPagado", "saldoPendiente", "clienteId" ON "Venta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_cuenta_corriente();
CREATE CONSTRAINT TRIGGER trg_pago_venta_cuenta_corriente AFTER INSERT OR UPDATE ON "PagoVenta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_cuenta_corriente();
CREATE CONSTRAINT TRIGGER trg_cliente_cuenta_corriente AFTER UPDATE OF "saldoDeudor" ON "Cliente"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_cuenta_corriente();

-- -----------------------------------------------------------------------------
-- 4. Transferencias: código, remito, observación, productoId
-- -----------------------------------------------------------------------------

ALTER TABLE "Transferencia" DISABLE TRIGGER USER;
ALTER TABLE "TransferenciaItem" DISABLE TRIGGER USER;

ALTER TABLE "Transferencia" RENAME COLUMN "notas" TO "observacion";
ALTER TABLE "Transferencia"
  ADD COLUMN "codigo" TEXT,
  ADD COLUMN "remitoUrl" TEXT;
UPDATE "Transferencia" t SET "codigo" =
  upper(substr(regexp_replace(p."slug", '[^a-z0-9]', '', 'g'), 1, 3)) || '-T-' || lpad(t."numero"::text, 6, '0')
FROM "Panel" p WHERE p."id" = t."panelId";

ALTER TABLE "TransferenciaItem" ADD COLUMN "productoId" TEXT;
UPDATE "TransferenciaItem" ti SET "productoId" = v."productoId"
FROM "Variante" v WHERE v."id" = ti."varianteId";

ALTER TABLE "Transferencia" ENABLE TRIGGER USER;
ALTER TABLE "TransferenciaItem" ENABLE TRIGGER USER;

ALTER TABLE "Transferencia" ALTER COLUMN "codigo" SET NOT NULL;
CREATE UNIQUE INDEX "Transferencia_panelId_codigo_key" ON "Transferencia"("panelId", "codigo");
ALTER TABLE "TransferenciaItem" ALTER COLUMN "productoId" SET NOT NULL;
ALTER TABLE "TransferenciaItem" ADD CONSTRAINT "TransferenciaItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER trg_transferencia_item_producto BEFORE INSERT OR UPDATE OF "varianteId", "productoId" ON "TransferenciaItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_item_producto_coherente();
