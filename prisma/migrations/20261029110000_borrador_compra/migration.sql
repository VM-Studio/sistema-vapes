-- Borrador de «Nueva compra»: lo que se va cargando se guarda solo (proveedor,
-- galpón, ítems, notas, comisión) para retomarlo aunque se cierre la pantalla.
-- Al confirmar la compra se borra. No mueve stock ni costos.
CREATE TABLE "BorradorCompra" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "usuarioId" TEXT NOT NULL,
    "proveedorId" TEXT,
    "datos" JSONB NOT NULL,
    "items" INTEGER NOT NULL DEFAULT 0,
    "unidades" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BorradorCompra_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BorradorCompra_panelId_updatedAt_idx" ON "BorradorCompra"("panelId", "updatedAt");

ALTER TABLE "BorradorCompra" ADD CONSTRAINT "BorradorCompra_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BorradorCompra" ADD CONSTRAINT "BorradorCompra_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BorradorCompra" ADD CONSTRAINT "BorradorCompra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BorradorCompra"
  ADD CONSTRAINT "BorradorCompra_resumen_chk" CHECK ("items" >= 0 AND "unidades" >= 0);

-- panelId inmutable y el proveedor del mismo panel.
CREATE TRIGGER trg_panel_borrador_compra BEFORE INSERT OR UPDATE OF "panelId", "proveedorId" ON "BorradorCompra"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('proveedorId', 'Proveedor');
