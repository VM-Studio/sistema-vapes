-- =============================================================================
-- DEVOLUCIONES: CAMBIO POR OTRO SABOR U OTRO MODELO, CON DIFERENCIA DE PRECIO
-- =============================================================================
-- - Cada ítem guarda lo que trae el cliente (varianteId, fallado: no vuelve al
--   stock) y lo que se le entrega (varianteEntregadaId, sale del stock con
--   GARANTIA): el mismo sabor, otro sabor u otro modelo.
-- - Precios de lista por unidad de lo devuelto y lo entregado (null en las
--   devoluciones viejas, que eran siempre "el mismo sabor").
-- - La devolución guarda la diferencia calculada y la efectiva (igual o menor,
--   del mismo signo: bonificación) y el medio con que se cobró o devolvió.
-- =============================================================================

-- 1. Devolución: diferencia de precio ------------------------------------------
ALTER TABLE "Devolucion"
  ADD COLUMN "diferencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "diferenciaCalculada" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "medioPagoDiferencia" "MedioPago";

ALTER TABLE "Devolucion"
  -- Con diferencia, el medio es obligatorio; sin diferencia, no hay medio.
  ADD CONSTRAINT "Devolucion_medio_diferencia_chk"
    CHECK (("diferencia" = 0) = ("medioPagoDiferencia" IS NULL)),
  -- La efectiva es la calculada o menos (bonificación), nunca de otro signo.
  ADD CONSTRAINT "Devolucion_diferencia_chk"
    CHECK ("diferencia" = 0
      OR (sign("diferencia") = sign("diferenciaCalculada")
          AND abs("diferencia") <= abs("diferenciaCalculada")));

-- Inmutable salvo anular: también la plata.
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
      NEW."observacion", NEW."usuarioId", NEW."diferencia", NEW."diferenciaCalculada",
      NEW."medioPagoDiferencia")
     IS DISTINCT FROM
     (OLD."numero", OLD."codigo", OLD."fecha", OLD."clienteId", OLD."ventaId", OLD."depositoId",
      OLD."observacion", OLD."usuarioId", OLD."diferencia", OLD."diferenciaCalculada",
      OLD."medioPagoDiferencia") THEN
    RAISE EXCEPTION 'La devolución % no se modifica: se anula', OLD."codigo" USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Ítems: lo que se entrega y los precios -------------------------------------
ALTER TABLE "DevolucionItem"
  ADD COLUMN "precioDevuelto" DECIMAL(12,2),
  ADD COLUMN "precioEntregado" DECIMAL(12,2),
  ADD COLUMN "productoEntregadoId" TEXT,
  ADD COLUMN "varianteEntregadaId" TEXT;

-- Las devoluciones existentes entregaron el mismo sabor que se devolvió.
ALTER TABLE "DevolucionItem" DISABLE TRIGGER trg_devolucion_item_inmutable;
UPDATE "DevolucionItem"
SET "varianteEntregadaId" = "varianteId", "productoEntregadoId" = "productoId";
ALTER TABLE "DevolucionItem" ENABLE TRIGGER trg_devolucion_item_inmutable;

ALTER TABLE "DevolucionItem"
  ALTER COLUMN "varianteEntregadaId" SET NOT NULL,
  ALTER COLUMN "productoEntregadoId" SET NOT NULL,
  ADD CONSTRAINT "DevolucionItem_precios_chk"
    CHECK (("precioDevuelto" IS NULL) = ("precioEntregado" IS NULL)
      AND coalesce("precioDevuelto", 0) >= 0 AND coalesce("precioEntregado", 0) >= 0);

DROP INDEX "DevolucionItem_panelId_devolucionId_varianteId_key";
CREATE UNIQUE INDEX "DevolucionItem_devolucion_cambio_key"
  ON "DevolucionItem"("panelId", "devolucionId", "varianteId", "varianteEntregadaId");
CREATE INDEX "DevolucionItem_panelId_varianteEntregadaId_idx"
  ON "DevolucionItem"("panelId", "varianteEntregadaId");

ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_varianteEntregadaId_fkey"
  FOREIGN KEY ("varianteEntregadaId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_productoEntregadoId_fkey"
  FOREIGN KEY ("productoEntregadoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- productoEntregadoId = el producto de la variante entregada.
CREATE OR REPLACE FUNCTION trg_fn_devolucion_item_entregado_coherente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Variante"
                 WHERE "id" = NEW."varianteEntregadaId" AND "productoId" = NEW."productoEntregadoId") THEN
    RAISE EXCEPTION 'DevolucionItem.productoEntregadoId no corresponde a la variante %', NEW."varianteEntregadaId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_devolucion_item_entregado
  BEFORE INSERT OR UPDATE OF "varianteEntregadaId", "productoEntregadoId" ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_devolucion_item_entregado_coherente();

-- Lo entregado también tiene que ser del mismo panel.
DROP TRIGGER IF EXISTS trg_panel_devolucion_item ON "DevolucionItem";
CREATE TRIGGER trg_panel_devolucion_item BEFORE INSERT ON "DevolucionItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel(
    'devolucionId', 'Devolucion', 'varianteId', 'Variante', 'varianteEntregadaId', 'Variante');
