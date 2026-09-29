-- =============================================================================
-- REFORMA R5: DASHBOARD, RENDIMIENTO DEL EQUIPO Y REPORTES
--
-- - Panel.etiquetaUnidades ("Vapes vendidos" en Vapes).
-- - Usuario.comisionUnitariaPct / comisionMayoristaPct (comisión orientativa).
-- - ProveedorProductoHistorial: cada precio que tuvo un proveedor para un
--   producto (lo inserta un trigger; inmutable). Se siembra con el precio vigente.
-- - Índices para la analítica (ventas confirmadas por fecha, ítems por venta).
-- =============================================================================


-- AlterTable
ALTER TABLE "Panel" ADD COLUMN     "etiquetaUnidades" TEXT NOT NULL DEFAULT 'Unidades vendidas';

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "comisionMayoristaPct" DECIMAL(5,2),
ADD COLUMN     "comisionUnitariaPct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "ProveedorProductoHistorial" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "proveedorProductoId" TEXT NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProveedorProductoHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProveedorProductoHistorial_panelId_proveedorProductoId_crea_idx" ON "ProveedorProductoHistorial"("panelId", "proveedorProductoId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProveedorProductoHistorial" ADD CONSTRAINT "ProveedorProductoHistorial_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProveedorProductoHistorial" ADD CONSTRAINT "ProveedorProductoHistorial_proveedorProductoId_fkey" FOREIGN KEY ("proveedorProductoId") REFERENCES "ProveedorProducto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Panel" SET "etiquetaUnidades" = 'Vapes vendidos' WHERE "slug" = 'vapes';

ALTER TABLE "Usuario"
  ADD CONSTRAINT "Usuario_comision_chk" CHECK (
    ("comisionUnitariaPct" IS NULL OR "comisionUnitariaPct" BETWEEN 0 AND 100) AND
    ("comisionMayoristaPct" IS NULL OR "comisionMayoristaPct" BETWEEN 0 AND 100));
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_etiquetaUnidades_chk" CHECK (btrim("etiquetaUnidades") <> '');
ALTER TABLE "ProveedorProductoHistorial" ADD CONSTRAINT "ProveedorProductoHistorial_precio_chk" CHECK ("precio" >= 0);

CREATE TRIGGER trg_panel_pp_historial BEFORE INSERT ON "ProveedorProductoHistorial"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('proveedorProductoId', 'ProveedorProducto');
CREATE TRIGGER trg_pp_historial_inmutable BEFORE UPDATE OR DELETE ON "ProveedorProductoHistorial"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Cada alta o cambio de precio de un proveedor queda en el historial.
CREATE OR REPLACE FUNCTION trg_fn_pp_historial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."precio" IS DISTINCT FROM OLD."precio" OR NEW."moneda" IS DISTINCT FROM OLD."moneda" THEN
    INSERT INTO "ProveedorProductoHistorial" ("id", "panelId", "proveedorProductoId", "precio", "moneda", "createdAt")
    VALUES ('pph_' || md5(random()::text || clock_timestamp()::text), NEW."panelId", NEW."id", NEW."precio", NEW."moneda",
            COALESCE(NEW."actualizadoAt", CURRENT_TIMESTAMP));
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_pp_historial AFTER INSERT OR UPDATE OF "precio", "moneda" ON "ProveedorProducto"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_pp_historial();

-- Historial inicial: el precio vigente de cada proveedor/producto.
INSERT INTO "ProveedorProductoHistorial" ("id", "panelId", "proveedorProductoId", "precio", "moneda", "createdAt")
SELECT 'pph_' || pp."id", pp."panelId", pp."id", pp."precio", pp."moneda", pp."actualizadoAt"
FROM "ProveedorProducto" pp;

-- Analítica: ventas confirmadas por fecha (parcial) e ítems por venta.
CREATE INDEX IF NOT EXISTS venta_confirmada_fecha ON "Venta" ("panelId", "fecha") INCLUDE ("total", "gananciaBruta", "vendedorId", "tipo", "medioPago", "depositoId") WHERE "estado" = 'CONFIRMADA';
CREATE INDEX IF NOT EXISTS venta_item_venta ON "VentaItem" ("ventaId");
