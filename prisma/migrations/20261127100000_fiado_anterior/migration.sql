-- =============================================================================
-- v2.14.0 — Fiados anteriores al sistema (carga manual de deudas viejas).
--
-- FiadoAnterior: lo que un cliente ya debía antes de usar el sistema. No es
-- una venta (no mueve stock, no es vendido ni ganancia): solo suma a la deuda
-- del cliente y se cobra como un fiado (PagoFiadoAnterior, mismo cobroId que
-- los PagoVenta del mismo cobro).
-- Cliente.saldoDeudor pasa a ser Σ saldo de sus ventas confirmadas
--   + Σ saldo de sus fiados anteriores vigentes (trigger diferido).
-- =============================================================================

-- CreateEnum
CREATE TYPE "EstadoFiadoAnterior" AS ENUM ('VIGENTE', 'ANULADO');


-- CreateTable
CREATE TABLE "FiadoAnterior" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "concepto" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "montoPagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoPendiente" DECIMAL(12,2) NOT NULL,
    "tipoCambioUsdt" DECIMAL(14,2) NOT NULL,
    "tipoCambioUsd" DECIMAL(14,2) NOT NULL,
    "estado" "EstadoFiadoAnterior" NOT NULL DEFAULT 'VIGENTE',
    "usuarioId" TEXT NOT NULL,
    "anuladoPorId" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiadoAnterior_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoFiadoAnterior" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "fiadoId" TEXT NOT NULL,
    "medioPago" "MedioPago" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referencia" TEXT,
    "cobroId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "anuladoPorId" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoFiadoAnterior_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiadoAnterior_panelId_clienteId_idx" ON "FiadoAnterior"("panelId", "clienteId");

-- CreateIndex
CREATE INDEX "FiadoAnterior_panelId_estado_saldoPendiente_idx" ON "FiadoAnterior"("panelId", "estado", "saldoPendiente");

-- CreateIndex
CREATE UNIQUE INDEX "FiadoAnterior_panelId_numero_key" ON "FiadoAnterior"("panelId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "FiadoAnterior_panelId_codigo_key" ON "FiadoAnterior"("panelId", "codigo");

-- CreateIndex
CREATE INDEX "PagoFiadoAnterior_panelId_fiadoId_idx" ON "PagoFiadoAnterior"("panelId", "fiadoId");

-- CreateIndex
CREATE INDEX "PagoFiadoAnterior_panelId_cobroId_idx" ON "PagoFiadoAnterior"("panelId", "cobroId");

-- CreateIndex
CREATE INDEX "PagoFiadoAnterior_panelId_fecha_idx" ON "PagoFiadoAnterior"("panelId", "fecha");

-- AddForeignKey
ALTER TABLE "FiadoAnterior" ADD CONSTRAINT "FiadoAnterior_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiadoAnterior" ADD CONSTRAINT "FiadoAnterior_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiadoAnterior" ADD CONSTRAINT "FiadoAnterior_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiadoAnterior" ADD CONSTRAINT "FiadoAnterior_anuladoPorId_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiadoAnterior" ADD CONSTRAINT "PagoFiadoAnterior_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiadoAnterior" ADD CONSTRAINT "PagoFiadoAnterior_fiadoId_fkey" FOREIGN KEY ("fiadoId") REFERENCES "FiadoAnterior"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiadoAnterior" ADD CONSTRAINT "PagoFiadoAnterior_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiadoAnterior" ADD CONSTRAINT "PagoFiadoAnterior_anuladoPorId_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Reglas
-- -----------------------------------------------------------------------------

ALTER TABLE "FiadoAnterior"
  ADD CONSTRAINT "FiadoAnterior_montos_chk" CHECK (
    "monto" > 0 AND "montoPagado" >= 0 AND "saldoPendiente" >= 0
    AND (
      ("estado" = 'VIGENTE' AND "montoPagado" + "saldoPendiente" = "monto")
      OR ("estado" = 'ANULADO' AND "montoPagado" = 0 AND "saldoPendiente" = 0
          AND "anuladoAt" IS NOT NULL AND "anuladoPorId" IS NOT NULL)
    )
  ),
  ADD CONSTRAINT "FiadoAnterior_cotizaciones_chk" CHECK ("tipoCambioUsdt" > 0 AND "tipoCambioUsd" > 0);

ALTER TABLE "PagoFiadoAnterior"
  ADD CONSTRAINT "PagoFiadoAnterior_monto_chk" CHECK ("monto" > 0),
  ADD CONSTRAINT "PagoFiadoAnterior_anulacion_chk" CHECK (
    NOT "anulado" OR ("anuladoAt" IS NOT NULL AND "anuladoPorId" IS NOT NULL)
  );

-- panelId inmutable y referencias del mismo panel.
CREATE TRIGGER trg_panel_fiado_anterior BEFORE INSERT OR UPDATE OF "panelId", "clienteId" ON "FiadoAnterior"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('clienteId', 'Cliente');
CREATE TRIGGER trg_panel_pago_fiado_anterior BEFORE INSERT OR UPDATE OF "panelId", "fiadoId" ON "PagoFiadoAnterior"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('fiadoId', 'FiadoAnterior');

-- El fiado anterior no se borra ni se le cambian los datos: solo saldos y anulación.
CREATE OR REPLACE FUNCTION trg_fn_fiado_anterior_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los fiados anteriores no se borran: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."id", NEW."numero", NEW."codigo", NEW."clienteId", NEW."fecha", NEW."concepto", NEW."monto",
      NEW."tipoCambioUsdt", NEW."tipoCambioUsd", NEW."usuarioId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."numero", OLD."codigo", OLD."clienteId", OLD."fecha", OLD."concepto", OLD."monto",
      OLD."tipoCambioUsdt", OLD."tipoCambioUsd", OLD."usuarioId", OLD."createdAt") THEN
    RAISE EXCEPTION 'El fiado anterior % no se modifica: se anula', OLD."codigo" USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADO' THEN
    RAISE EXCEPTION 'El fiado anterior % ya está anulado', OLD."codigo" USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_fiado_anterior_inmutable BEFORE UPDATE OR DELETE ON "FiadoAnterior"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_fiado_anterior_inmutable();

-- Los pagos tampoco: solo se anulan (una vez).
CREATE OR REPLACE FUNCTION trg_fn_pago_fiado_anterior_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los pagos no se borran: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."id", NEW."panelId", NEW."fiadoId", NEW."medioPago", NEW."monto", NEW."referencia",
      NEW."cobroId", NEW."fecha", NEW."usuarioId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."panelId", OLD."fiadoId", OLD."medioPago", OLD."monto", OLD."referencia",
      OLD."cobroId", OLD."fecha", OLD."usuarioId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Los pagos no se modifican: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."anulado" THEN
    RAISE EXCEPTION 'El pago ya está anulado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pago_fiado_anterior_inmutable BEFORE UPDATE OR DELETE ON "PagoFiadoAnterior"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_pago_fiado_anterior_inmutable();

-- -----------------------------------------------------------------------------
-- Coherencia al COMMIT
-- -----------------------------------------------------------------------------

-- Fiado anterior vigente: montoPagado = Σ pagos no anulados. Anulado: sin pagos vigentes.
CREATE OR REPLACE FUNCTION fn_verificar_pagos_fiado_anterior(p_fiado_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_fiado  "FiadoAnterior"%ROWTYPE;
  v_pagado numeric;
BEGIN
  SELECT * INTO v_fiado FROM "FiadoAnterior" WHERE "id" = p_fiado_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM("monto"), 0) INTO v_pagado
  FROM "PagoFiadoAnterior" WHERE "fiadoId" = p_fiado_id AND NOT "anulado";
  IF v_fiado."estado" = 'VIGENTE' AND v_fiado."montoPagado" <> v_pagado THEN
    RAISE EXCEPTION 'Fiado anterior %: montoPagado % no coincide con la suma de pagos %', v_fiado."codigo", v_fiado."montoPagado", v_pagado
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_fiado."estado" = 'ANULADO' AND v_pagado <> 0 THEN
    RAISE EXCEPTION 'Fiado anterior % anulado: tiene cobros vigentes', v_fiado."codigo"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Cliente: saldoDeudor = Σ saldo de ventas confirmadas + Σ saldo de fiados anteriores vigentes.
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
  SELECT
    COALESCE((SELECT SUM("saldoPendiente") FROM "Venta"
              WHERE "clienteId" = p_cliente_id AND "estado" = 'CONFIRMADA'), 0)
    + COALESCE((SELECT SUM("saldoPendiente") FROM "FiadoAnterior"
              WHERE "clienteId" = p_cliente_id AND "estado" = 'VIGENTE'), 0)
  INTO v_suma;
  IF v_saldo <> v_suma THEN
    RAISE EXCEPTION 'Cliente %: saldoDeudor % no coincide con el saldo pendiente de sus ventas y fiados anteriores %', p_cliente_id, v_saldo, v_suma
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_verificar_fiado_anterior() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fila record := COALESCE(NEW, OLD);
  v_cliente text;
BEGIN
  IF TG_TABLE_NAME = 'FiadoAnterior' THEN
    PERFORM fn_verificar_pagos_fiado_anterior(v_fila."id");
    PERFORM fn_verificar_saldo_cliente(v_fila."clienteId");
  ELSE
    PERFORM fn_verificar_pagos_fiado_anterior(v_fila."fiadoId");
    SELECT "clienteId" INTO v_cliente FROM "FiadoAnterior" WHERE "id" = v_fila."fiadoId";
    PERFORM fn_verificar_saldo_cliente(v_cliente);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_fiado_anterior_cuenta_corriente
  AFTER INSERT OR UPDATE ON "FiadoAnterior"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_fiado_anterior();
CREATE CONSTRAINT TRIGGER trg_pago_fiado_anterior_cuenta_corriente
  AFTER INSERT OR UPDATE ON "PagoFiadoAnterior"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_fiado_anterior();

-- Numeración por panel (VAP-FA-000001) ------------------------------------------
ALTER TABLE "Secuencia" DROP CONSTRAINT "Secuencia_entidad_chk";
ALTER TABLE "Secuencia" ADD CONSTRAINT "Secuencia_entidad_chk"
  CHECK ("entidad" IN ('VENTA', 'COMPRA', 'TRANSFERENCIA', 'DEVOLUCION', 'COTIZACION', 'FACTURA', 'FIADO_ANTERIOR'));
INSERT INTO "Secuencia" ("id", "panelId", "entidad", "ultimoNumero", "updatedAt")
SELECT 'sec_' || p."id" || '_fiado_anterior', p."id", 'FIADO_ANTERIOR', 0, CURRENT_TIMESTAMP
FROM "Panel" p
ON CONFLICT ("panelId", "entidad") DO NOTHING;
