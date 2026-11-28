-- =============================================================================
-- v2.14.0 — Ubicaciones de productos y «¿La retira una moto?».
--
-- Ubicacion: los lugares del galpón que arman los dueños (estante, fila…);
-- Producto.ubicacionId: dónde está guardado ese modelo. Charly lo ve al escanear.
-- Venta.retiraMoto: la retira un Uber Moto (lo marca quien vende); Charly ve
-- «Pedido que lo retira una moto».
-- =============================================================================

ALTER TABLE "Producto" ADD COLUMN "ubicacionId" TEXT;
ALTER TABLE "Venta" ADD COLUMN "retiraMoto" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Ubicacion" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ubicacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ubicacion_panelId_orden_idx" ON "Ubicacion"("panelId", "orden");
CREATE UNIQUE INDEX "Ubicacion_panelId_nombre_key" ON "Ubicacion"("panelId", "nombre");

ALTER TABLE "Ubicacion" ADD CONSTRAINT "Ubicacion_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_ubicacionId_fkey" FOREIGN KEY ("ubicacionId") REFERENCES "Ubicacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Ubicacion" ADD CONSTRAINT "Ubicacion_nombre_chk" CHECK (length(btrim("nombre")) BETWEEN 1 AND 80);

-- panelId inmutable; la ubicación de un producto es de su mismo panel.
CREATE TRIGGER trg_panel_ubicacion BEFORE UPDATE OF "panelId" ON "Ubicacion"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_producto_ubicacion BEFORE INSERT OR UPDATE OF "ubicacionId" ON "Producto"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('ubicacionId', 'Ubicacion');
