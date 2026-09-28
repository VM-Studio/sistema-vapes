-- =============================================================================
-- REFORMA R4: COTIZADOR UNITARIO Y MAYORISTA POR ESCALONES
--
-- EscalonPrecio (precio mayorista por producto desde N unidades, para todos
-- sus sabores), EscalonPrecioDefault (descuento % del panel para productos
-- sin escalones propios), Cotizacion/CotizacionItem (código VAP-Q-000001,
-- secuencia COTIZACION) y Venta.cotizacionId (trazabilidad de la conversión).
-- =============================================================================


-- CreateEnum
CREATE TYPE "TipoCotizacion" AS ENUM ('UNITARIA', 'MAYORISTA');

-- CreateEnum
CREATE TYPE "EstadoCotizacion" AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA');

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "cotizacionId" TEXT;

-- CreateTable
CREATE TABLE "EscalonPrecio" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "productoId" TEXT NOT NULL,
    "cantidadMinima" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EscalonPrecio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalonPrecioDefault" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "cantidadMinima" INTEGER NOT NULL,
    "porcentajeDescuento" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EscalonPrecioDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotizacion" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoCotizacion" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validaHasta" TIMESTAMP(3) NOT NULL,
    "clienteId" TEXT,
    "clienteNombre" TEXT,
    "clienteTelefono" TEXT,
    "vendedorId" TEXT NOT NULL,
    "estado" "EstadoCotizacion" NOT NULL DEFAULT 'BORRADOR',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "notas" TEXT,
    "motivoRechazo" TEXT,
    "ventaId" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotizacionItem" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "cotizacionId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioLista" DECIMAL(12,2) NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "escalonAplicado" INTEGER,
    "esPrecioManual" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CotizacionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscalonPrecio_panelId_productoId_cantidadMinima_key" ON "EscalonPrecio"("panelId", "productoId", "cantidadMinima");

-- CreateIndex
CREATE UNIQUE INDEX "EscalonPrecioDefault_panelId_cantidadMinima_key" ON "EscalonPrecioDefault"("panelId", "cantidadMinima");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_ventaId_key" ON "Cotizacion"("ventaId");

-- CreateIndex
CREATE INDEX "Cotizacion_panelId_fecha_idx" ON "Cotizacion"("panelId", "fecha");

-- CreateIndex
CREATE INDEX "Cotizacion_panelId_vendedorId_idx" ON "Cotizacion"("panelId", "vendedorId");

-- CreateIndex
CREATE INDEX "Cotizacion_panelId_estado_idx" ON "Cotizacion"("panelId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_panelId_numero_key" ON "Cotizacion"("panelId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_panelId_codigo_key" ON "Cotizacion"("panelId", "codigo");

-- CreateIndex
CREATE INDEX "CotizacionItem_panelId_varianteId_idx" ON "CotizacionItem"("panelId", "varianteId");

-- CreateIndex
CREATE UNIQUE INDEX "CotizacionItem_panelId_cotizacionId_varianteId_key" ON "CotizacionItem"("panelId", "cotizacionId", "varianteId");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_cotizacionId_key" ON "Venta"("cotizacionId");

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalonPrecio" ADD CONSTRAINT "EscalonPrecio_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalonPrecio" ADD CONSTRAINT "EscalonPrecio_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalonPrecioDefault" ADD CONSTRAINT "EscalonPrecioDefault_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Invariantes
-- -----------------------------------------------------------------------------

ALTER TABLE "EscalonPrecio"
  ADD CONSTRAINT "EscalonPrecio_cantidadMinima_chk" CHECK ("cantidadMinima" > 0),
  ADD CONSTRAINT "EscalonPrecio_precioUnitario_chk" CHECK ("precioUnitario" > 0);
ALTER TABLE "EscalonPrecioDefault"
  ADD CONSTRAINT "EscalonPrecioDefault_cantidadMinima_chk" CHECK ("cantidadMinima" > 0),
  ADD CONSTRAINT "EscalonPrecioDefault_porcentaje_chk" CHECK ("porcentajeDescuento" >= 0 AND "porcentajeDescuento" <= 100);
ALTER TABLE "Cotizacion"
  ADD CONSTRAINT "Cotizacion_totales_chk" CHECK ("subtotal" >= 0 AND "descuento" >= 0 AND "total" >= 0 AND "total" = "subtotal" - "descuento"),
  ADD CONSTRAINT "Cotizacion_validez_chk" CHECK ("validaHasta" >= "fecha"),
  ADD CONSTRAINT "Cotizacion_convertida_chk" CHECK (("estado" = 'CONVERTIDA') = ("ventaId" IS NOT NULL));
ALTER TABLE "CotizacionItem"
  ADD CONSTRAINT "CotizacionItem_cantidad_chk" CHECK ("cantidad" > 0),
  ADD CONSTRAINT "CotizacionItem_precios_chk" CHECK ("precioLista" >= 0 AND "precioUnitario" >= 0),
  ADD CONSTRAINT "CotizacionItem_subtotal_chk" CHECK ("subtotal" = "cantidad" * "precioUnitario");

-- Aislamiento entre paneles y productoId coherente con la variante.
CREATE TRIGGER trg_panel_escalon BEFORE INSERT OR UPDATE OF "panelId", "productoId" ON "EscalonPrecio"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('productoId', 'Producto');
CREATE TRIGGER trg_panel_escalon_default BEFORE UPDATE OF "panelId" ON "EscalonPrecioDefault"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_cotizacion BEFORE INSERT OR UPDATE OF "panelId", "clienteId", "ventaId" ON "Cotizacion"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('clienteId', 'Cliente', 'ventaId', 'Venta');
CREATE TRIGGER trg_panel_cotizacion_item BEFORE INSERT OR UPDATE OF "panelId", "cotizacionId", "varianteId" ON "CotizacionItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('cotizacionId', 'Cotizacion', 'varianteId', 'Variante');
CREATE TRIGGER trg_cotizacion_item_producto BEFORE INSERT OR UPDATE OF "varianteId", "productoId" ON "CotizacionItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_item_producto_coherente();
DROP TRIGGER IF EXISTS trg_panel_venta ON "Venta";
CREATE TRIGGER trg_panel_venta BEFORE INSERT OR UPDATE OF "panelId", "clienteId", "depositoId", "cotizacionId" ON "Venta"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('clienteId', 'Cliente', 'depositoId', 'Deposito', 'cotizacionId', 'Cotizacion');

-- Una cotización convertida no se toca más.
CREATE OR REPLACE FUNCTION trg_fn_cotizacion_convertida() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las cotizaciones no se borran (se usa deletedAt)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'CONVERTIDA' THEN
    RAISE EXCEPTION 'La cotización % ya fue convertida en venta: no se modifica', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_cotizacion_convertida BEFORE UPDATE OR DELETE ON "Cotizacion"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_cotizacion_convertida();

-- -----------------------------------------------------------------------------
-- Numeración: secuencia COTIZACION por panel
-- -----------------------------------------------------------------------------

ALTER TABLE "Secuencia" DROP CONSTRAINT "Secuencia_entidad_chk";
ALTER TABLE "Secuencia" ADD CONSTRAINT "Secuencia_entidad_chk"
  CHECK ("entidad" IN ('VENTA', 'COMPRA', 'TRANSFERENCIA', 'DEVOLUCION', 'COTIZACION'));
INSERT INTO "Secuencia" ("id", "panelId", "entidad", "ultimoNumero", "updatedAt")
SELECT 'sec_' || p."id" || '_cotizacion', p."id", 'COTIZACION', 0, CURRENT_TIMESTAMP
FROM "Panel" p
ON CONFLICT ("panelId", "entidad") DO NOTHING;
