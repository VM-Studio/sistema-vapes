-- Bloque 6 (A2): comisión del pasista, gastos extras y costo unitario final.
--
-- - Compra: % y monto de la comisión del pasista, Σ gastos extras, costo final
--   total (= total + comisión + gastos), unidades y costo final por unidad.
-- - CompraItem.costoUnitarioFinal = costo + (comisión + gastos) ÷ unidades
--   (prorrateo POR UNIDAD: ver calcularCostosFinales en src/lib/costos-compra.ts).
-- - GastoCompra: gastos de la compra; solo se anulan (trigger).
-- - CostoVarianteHistorial: cada cambio de Variante.ultimoCosto (inmutable).
-- - Lo único que cambia de un ítem en una compra RECIBIDA es costoUnitarioFinal:
--   el trigger de ítems no editables pasa a ignorar esa columna (y updatedAt).
-- CreateEnum
CREATE TYPE "OrigenCostoVariante" AS ENUM ('COMPRA_RECIBIDA', 'COSTOS_FINALES_COMPRA', 'INGRESO_MANUAL');

-- AlterTable
ALTER TABLE "Compra" ADD COLUMN     "comisionPasistaMonto" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "comisionPasistaPorcentaje" DECIMAL(5,2),
ADD COLUMN     "costoFinalTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "costoUnitarioFinalPromedio" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gastosExtrasTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unidadesTotal" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CompraItem" ADD COLUMN     "costoUnitarioFinal" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "GastoCompra" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "compraId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "anuladoPorId" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "motivoAnulacion" TEXT,

    CONSTRAINT "GastoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostoVarianteHistorial" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "varianteId" TEXT NOT NULL,
    "costoAnterior" DECIMAL(12,2),
    "costoNuevo" DECIMAL(12,2) NOT NULL,
    "origen" "OrigenCostoVariante" NOT NULL,
    "compraId" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostoVarianteHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GastoCompra_panelId_compraId_idx" ON "GastoCompra"("panelId", "compraId");

-- CreateIndex
CREATE INDEX "CostoVarianteHistorial_panelId_varianteId_createdAt_idx" ON "CostoVarianteHistorial"("panelId", "varianteId", "createdAt");

-- CreateIndex
CREATE INDEX "CostoVarianteHistorial_compraId_idx" ON "CostoVarianteHistorial"("compraId");

-- AddForeignKey
ALTER TABLE "GastoCompra" ADD CONSTRAINT "GastoCompra_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoCompra" ADD CONSTRAINT "GastoCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoCompra" ADD CONSTRAINT "GastoCompra_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoCompra" ADD CONSTRAINT "GastoCompra_anuladoPorId_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoVarianteHistorial" ADD CONSTRAINT "CostoVarianteHistorial_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoVarianteHistorial" ADD CONSTRAINT "CostoVarianteHistorial_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoVarianteHistorial" ADD CONSTRAINT "CostoVarianteHistorial_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoVarianteHistorial" ADD CONSTRAINT "CostoVarianteHistorial_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Backfill: las compras existentes no tienen comisión ni gastos.
-- -----------------------------------------------------------------------------
ALTER TABLE "CompraItem" DISABLE TRIGGER USER;
UPDATE "CompraItem" SET "costoUnitarioFinal" = "costoUnitario";
ALTER TABLE "CompraItem" ENABLE TRIGGER USER;
ALTER TABLE "CompraItem" ALTER COLUMN "costoUnitarioFinal" SET NOT NULL;

ALTER TABLE "Compra" DISABLE TRIGGER USER;
UPDATE "Compra" c SET
  "unidadesTotal" = u.unidades,
  "costoFinalTotal" = c."total",
  "costoUnitarioFinalPromedio" = CASE WHEN u.unidades > 0 THEN ROUND(c."total" / u.unidades, 2) ELSE 0 END
FROM (
  SELECT co."id", COALESCE(SUM(ci."cantidad"), 0)::int AS unidades
  FROM "Compra" co LEFT JOIN "CompraItem" ci ON ci."compraId" = co."id"
  GROUP BY co."id"
) u
WHERE u."id" = c."id";
ALTER TABLE "Compra" ENABLE TRIGGER USER;

-- -----------------------------------------------------------------------------
-- CHECKs
-- -----------------------------------------------------------------------------
ALTER TABLE "Compra"
  ADD CONSTRAINT "Compra_comisionPasistaPorcentaje_chk"
    CHECK ("comisionPasistaPorcentaje" IS NULL OR ("comisionPasistaPorcentaje" > 0 AND "comisionPasistaPorcentaje" <= 100)),
  ADD CONSTRAINT "Compra_comisionPasistaMonto_chk"
    CHECK (("comisionPasistaPorcentaje" IS NULL AND "comisionPasistaMonto" = 0)
        OR ("comisionPasistaPorcentaje" IS NOT NULL
            AND "comisionPasistaMonto" = ROUND("total" * "comisionPasistaPorcentaje" / 100, 2))),
  ADD CONSTRAINT "Compra_gastosExtrasTotal_chk" CHECK ("gastosExtrasTotal" >= 0),
  ADD CONSTRAINT "Compra_costoFinalTotal_chk"
    CHECK ("costoFinalTotal" = "total" + "comisionPasistaMonto" + "gastosExtrasTotal"),
  ADD CONSTRAINT "Compra_unidadesTotal_chk" CHECK ("unidadesTotal" >= 0),
  ADD CONSTRAINT "Compra_costoUnitarioFinalPromedio_chk"
    CHECK ("costoUnitarioFinalPromedio" = CASE WHEN "unidadesTotal" > 0
                                               THEN ROUND("costoFinalTotal" / "unidadesTotal", 2) ELSE 0 END);

ALTER TABLE "CompraItem"
  ADD CONSTRAINT "CompraItem_costoUnitarioFinal_chk" CHECK ("costoUnitarioFinal" >= "costoUnitario");

ALTER TABLE "GastoCompra"
  ADD CONSTRAINT "GastoCompra_monto_chk" CHECK ("monto" > 0),
  ADD CONSTRAINT "GastoCompra_motivo_chk" CHECK (length(btrim("motivo")) > 0),
  ADD CONSTRAINT "GastoCompra_anulacion_chk"
    CHECK (("anulado" AND "anuladoPorId" IS NOT NULL AND "anuladoAt" IS NOT NULL AND "motivoAnulacion" IS NOT NULL)
        OR (NOT "anulado" AND "anuladoPorId" IS NULL AND "anuladoAt" IS NULL AND "motivoAnulacion" IS NULL));

ALTER TABLE "CostoVarianteHistorial"
  ADD CONSTRAINT "CostoVarianteHistorial_costo_chk"
    CHECK ("costoNuevo" >= 0 AND ("costoAnterior" IS NULL OR "costoAnterior" >= 0));

-- -----------------------------------------------------------------------------
-- Ítems de compras no-borrador: congelados salvo costoUnitarioFinal (y updatedAt).
-- -----------------------------------------------------------------------------
DROP TRIGGER trg_compra_item_editable ON "CompraItem";
CREATE TRIGGER trg_compra_item_editable BEFORE INSERT OR DELETE ON "CompraItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_items_editables('Compra', 'compraId', 'BORRADOR');
-- Lista explícita de columnas: una columna nueva de CompraItem que deba quedar
-- congelada en compras recibidas tiene que sumarse acá.
CREATE TRIGGER trg_compra_item_editable_update
  BEFORE UPDATE OF "id", "panelId", "compraId", "varianteId", "productoId", "cantidad",
                   "costoUnitario", "costoUnitarioUSDT", "subtotal", "createdAt" ON "CompraItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_items_editables('Compra', 'compraId', 'BORRADOR');

-- -----------------------------------------------------------------------------
-- GastoCompra: solo se anula (una vez); nunca se borra. Mismo panel que la compra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_gasto_compra_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los gastos de una compra no se borran: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."id", NEW."panelId", NEW."compraId", NEW."motivo", NEW."monto", NEW."fecha",
      NEW."usuarioId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."panelId", OLD."compraId", OLD."motivo", OLD."monto", OLD."fecha",
      OLD."usuarioId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Los gastos de una compra no se modifican: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."anulado" THEN
    RAISE EXCEPTION 'El gasto ya está anulado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_gasto_compra_inmutable BEFORE UPDATE OR DELETE ON "GastoCompra"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_gasto_compra_inmutable();
CREATE TRIGGER trg_gasto_compra_no_truncate BEFORE TRUNCATE ON "GastoCompra"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_panel_gasto_compra BEFORE INSERT OR UPDATE OF "panelId", "compraId" ON "GastoCompra"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('compraId', 'Compra');

-- -----------------------------------------------------------------------------
-- CostoVarianteHistorial: inmutable, mismo panel que el sabor.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_costo_variante_historial_inmutable BEFORE UPDATE OR DELETE ON "CostoVarianteHistorial"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_costo_variante_historial_no_truncate BEFORE TRUNCATE ON "CostoVarianteHistorial"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_panel_costo_variante_historial BEFORE INSERT ON "CostoVarianteHistorial"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('varianteId', 'Variante');

-- -----------------------------------------------------------------------------
-- Coherencia al cerrar la transacción: unidades = Σ ítems y gastos = Σ gastos vigentes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_verificar_costos_compra(p_compra_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_compra   "Compra"%ROWTYPE;
  v_unidades integer;
  v_gastos   numeric;
BEGIN
  SELECT * INTO v_compra FROM "Compra" WHERE "id" = p_compra_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM("cantidad"), 0) INTO v_unidades FROM "CompraItem" WHERE "compraId" = p_compra_id;
  SELECT COALESCE(SUM("monto"), 0) INTO v_gastos FROM "GastoCompra"
    WHERE "compraId" = p_compra_id AND NOT "anulado";
  IF v_compra."unidadesTotal" <> v_unidades THEN
    RAISE EXCEPTION 'Compra #%: unidadesTotal % no coincide con la suma de ítems %',
      v_compra."numero", v_compra."unidadesTotal", v_unidades USING ERRCODE = 'check_violation';
  END IF;
  IF v_compra."gastosExtrasTotal" <> v_gastos THEN
    RAISE EXCEPTION 'Compra #%: gastosExtrasTotal % no coincide con la suma de gastos %',
      v_compra."numero", v_compra."gastosExtrasTotal", v_gastos USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_verificar_costos_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fila record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF TG_TABLE_NAME = 'Compra' THEN
    PERFORM fn_verificar_costos_compra(v_fila."id");
  ELSE
    PERFORM fn_verificar_costos_compra(to_jsonb(v_fila) ->> 'compraId');
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_compra_costos AFTER INSERT OR UPDATE ON "Compra"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_costos_compra();
CREATE CONSTRAINT TRIGGER trg_compra_item_costos AFTER INSERT OR UPDATE OR DELETE ON "CompraItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_costos_compra();
CREATE CONSTRAINT TRIGGER trg_gasto_compra_costos AFTER INSERT OR UPDATE ON "GastoCompra"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_costos_compra();
