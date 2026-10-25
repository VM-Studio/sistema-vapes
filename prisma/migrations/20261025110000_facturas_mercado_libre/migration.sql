-- =============================================================================
-- FACTURAS DE VENTAS MERCADO LIBRE (por panel)
-- =============================================================================
-- Las ventas cobradas por Mercado Libre (medio principal) se facturan en ARCA,
-- por fuera del sistema. Facturas → «Ventas Mercado Libre» lista cada venta ML
-- confirmada: sin fila en "FacturaMercadoLibre" = pendiente de cargar; con
-- fila = cargada (fecha de la factura, archivo opcional PDF/imagen, quién).
-- Una carga por venta (único por ventaId). Solo se agrega: no se modifica ni
-- se borra (trigger).
-- Las ventas por Mercado Libre pasan a llevar el precio de cada ítem cargado a
-- mano (VentaItem.origenPrecio = 'ML'): no requiere cambios de esquema.
-- =============================================================================

-- CreateTable
CREATE TABLE "FacturaMercadoLibre" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "ventaId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "archivoUrl" TEXT,
    "archivoTipo" TEXT,
    "archivoNombre" TEXT,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaMercadoLibre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacturaMercadoLibre_ventaId_key" ON "FacturaMercadoLibre"("ventaId");

-- CreateIndex
CREATE INDEX "FacturaMercadoLibre_panelId_fecha_idx" ON "FacturaMercadoLibre"("panelId", "fecha");

-- AddForeignKey
ALTER TABLE "FacturaMercadoLibre" ADD CONSTRAINT "FacturaMercadoLibre_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaMercadoLibre" ADD CONSTRAINT "FacturaMercadoLibre_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaMercadoLibre" ADD CONSTRAINT "FacturaMercadoLibre_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks ------------------------------------------------------------------------
ALTER TABLE "FacturaMercadoLibre"
  ADD CONSTRAINT "FacturaMercadoLibre_archivo_chk" CHECK (
    ("archivoUrl" IS NULL) = ("archivoTipo" IS NULL)
    AND ("archivoTipo" IS NULL
         OR "archivoTipo" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')));

-- Aislamiento: la venta es del mismo panel.
CREATE TRIGGER trg_panel_factura_ml BEFORE INSERT OR UPDATE OF "panelId", "ventaId" ON "FacturaMercadoLibre"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('ventaId', 'Venta');

-- Solo ventas CONFIRMADAS cobradas por Mercado Libre.
CREATE OR REPLACE FUNCTION trg_fn_factura_ml_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Venta" v
    WHERE v."id" = NEW."ventaId" AND v."medioPago" = 'MERCADO_LIBRE' AND v."estado" = 'CONFIRMADA'
  ) THEN
    RAISE EXCEPTION 'La venta % no es una venta confirmada cobrada por Mercado Libre', NEW."ventaId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_factura_ml_venta BEFORE INSERT ON "FacturaMercadoLibre"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_factura_ml_venta();

-- Solo se agrega: una carga no se modifica ni se borra.
CREATE OR REPLACE FUNCTION trg_fn_factura_ml_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La carga de la factura Mercado Libre no se modifica'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER trg_factura_ml_inmutable BEFORE UPDATE OR DELETE ON "FacturaMercadoLibre"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_factura_ml_inmutable();
