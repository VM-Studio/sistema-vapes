-- =============================================================================
-- Historial de precios de proveedor independiente de la asignación.
-- Quitar un producto de un proveedor (DELETE de ProveedorProducto) fallaba por
-- la FK RESTRICT del historial. Ahora el historial guarda proveedor y producto
-- propios y, al quitarse la asignación, solo su proveedorProductoId pasa a
-- null (ON DELETE SET NULL): el historial se conserva para los reportes.
-- =============================================================================

ALTER TABLE "ProveedorProductoHistorial" DROP CONSTRAINT "ProveedorProductoHistorial_proveedorProductoId_fkey";

ALTER TABLE "ProveedorProductoHistorial" DISABLE TRIGGER trg_pp_historial_inmutable;
ALTER TABLE "ProveedorProductoHistorial"
  ADD COLUMN "proveedorId" TEXT,
  ADD COLUMN "productoId" TEXT,
  ALTER COLUMN "proveedorProductoId" DROP NOT NULL;
UPDATE "ProveedorProductoHistorial" h SET "proveedorId" = pp."proveedorId", "productoId" = pp."productoId"
FROM "ProveedorProducto" pp WHERE pp."id" = h."proveedorProductoId";
ALTER TABLE "ProveedorProductoHistorial" ENABLE TRIGGER trg_pp_historial_inmutable;

ALTER TABLE "ProveedorProductoHistorial"
  ALTER COLUMN "proveedorId" SET NOT NULL,
  ALTER COLUMN "productoId" SET NOT NULL;

CREATE INDEX "ProveedorProductoHistorial_panelId_proveedorId_productoId_c_idx"
  ON "ProveedorProductoHistorial"("panelId", "proveedorId", "productoId", "createdAt");
ALTER TABLE "ProveedorProductoHistorial" ADD CONSTRAINT "ProveedorProductoHistorial_proveedorProductoId_fkey"
  FOREIGN KEY ("proveedorProductoId") REFERENCES "ProveedorProducto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProveedorProductoHistorial" ADD CONSTRAINT "ProveedorProductoHistorial_proveedorId_fkey"
  FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorProductoHistorial" ADD CONSTRAINT "ProveedorProductoHistorial_productoId_fkey"
  FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Inmutable salvo desvincularse de la asignación borrada (SET NULL de la FK).
DROP TRIGGER trg_pp_historial_inmutable ON "ProveedorProductoHistorial";
CREATE OR REPLACE FUNCTION trg_fn_pp_historial_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."proveedorProductoId" IS NULL
     AND (to_jsonb(NEW) - 'proveedorProductoId') = (to_jsonb(OLD) - 'proveedorProductoId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El historial de precios de proveedor es inmutable' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER trg_pp_historial_inmutable BEFORE UPDATE OR DELETE ON "ProveedorProductoHistorial"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_pp_historial_inmutable();

DROP TRIGGER IF EXISTS trg_panel_pp_historial ON "ProveedorProductoHistorial";
CREATE TRIGGER trg_panel_pp_historial BEFORE INSERT ON "ProveedorProductoHistorial"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('proveedorId', 'Proveedor', 'productoId', 'Producto');

CREATE OR REPLACE FUNCTION trg_fn_pp_historial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."precio" IS DISTINCT FROM OLD."precio" OR NEW."moneda" IS DISTINCT FROM OLD."moneda" THEN
    INSERT INTO "ProveedorProductoHistorial"
      ("id", "panelId", "proveedorProductoId", "proveedorId", "productoId", "precio", "moneda", "createdAt")
    VALUES ('pph_' || md5(random()::text || clock_timestamp()::text), NEW."panelId", NEW."id",
            NEW."proveedorId", NEW."productoId", NEW."precio", NEW."moneda",
            COALESCE(NEW."actualizadoAt", CURRENT_TIMESTAMP));
  END IF;
  RETURN NULL;
END;
$$;
