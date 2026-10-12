-- =============================================================================
-- FACTURAS (por panel)
-- =============================================================================
-- Registro de las facturas que se emiten por fuera (AFIP: A, B, C con su número
-- externo) y de los comprobantes internos que genera el sistema, vinculados a
-- ventas. Numeración propia por panel (Secuencia FACTURA → COS-F-000001).
-- Una venta tiene a lo sumo una factura EMITIDA (las anuladas quedan de
-- historial). Inmutables: una EMITIDA solo puede anularse, sumar su PDF o su
-- número externo; nunca se borran.
-- Cosmetic queda con la facturación habilitada.
-- =============================================================================

-- CreateEnum
CREATE TYPE "TipoFactura" AS ENUM ('A', 'B', 'C', 'COMPROBANTE_INTERNO');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('EMITIDA', 'ANULADA');

-- CreateEnum
CREATE TYPE "CondicionIva" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL');

-- AlterEnum
ALTER TYPE "Modulo" ADD VALUE 'FACTURAS';

-- CreateTable
CREATE TABLE "Factura" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoFactura" NOT NULL,
    "puntoVenta" INTEGER NOT NULL DEFAULT 1,
    "numeroExterno" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "ventaId" TEXT,
    "clienteId" TEXT NOT NULL,
    "razonSocial" TEXT,
    "cuit" TEXT,
    "condicionIva" "CondicionIva",
    "domicilio" TEXT,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "alicuotaIva" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'EMITIDA',
    "archivoUrl" TEXT,
    "observacion" TEXT,
    "usuarioId" TEXT NOT NULL,
    "anuladaPorId" TEXT,
    "anuladaAt" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacturaItem" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "facturaId" TEXT NOT NULL,
    "varianteId" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Factura_panelId_fecha_idx" ON "Factura"("panelId", "fecha");

-- CreateIndex
CREATE INDEX "Factura_panelId_clienteId_idx" ON "Factura"("panelId", "clienteId");

-- CreateIndex
CREATE INDEX "Factura_ventaId_idx" ON "Factura"("ventaId");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_panelId_numero_key" ON "Factura"("panelId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_panelId_codigo_key" ON "Factura"("panelId", "codigo");

-- CreateIndex
CREATE INDEX "FacturaItem_facturaId_idx" ON "FacturaItem"("facturaId");

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaItem" ADD CONSTRAINT "FacturaItem_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaItem" ADD CONSTRAINT "FacturaItem_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "Factura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaItem" ADD CONSTRAINT "FacturaItem_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks ------------------------------------------------------------------------
ALTER TABLE "Factura"
  ADD CONSTRAINT "Factura_numero_chk"     CHECK ("numero" > 0),
  ADD CONSTRAINT "Factura_puntoVenta_chk" CHECK ("puntoVenta" > 0 AND "puntoVenta" < 100000),
  ADD CONSTRAINT "Factura_cuit_chk"       CHECK ("cuit" IS NULL OR "cuit" ~ '^[0-9]{11}$'),
  ADD CONSTRAINT "Factura_importes_chk"   CHECK (
    "descuento" >= 0 AND "subtotal" >= 0 AND "iva" >= 0 AND "total" >= 0
    AND "alicuotaIva" >= 0 AND "alicuotaIva" <= 100
    AND "total" = "subtotal" + "iva"),
  ADD CONSTRAINT "Factura_anulacion_chk"  CHECK (
    ("estado" = 'ANULADA') = ("anuladaAt" IS NOT NULL AND "anuladaPorId" IS NOT NULL));
ALTER TABLE "FacturaItem"
  ADD CONSTRAINT "FacturaItem_cantidad_chk" CHECK ("cantidad" > 0),
  ADD CONSTRAINT "FacturaItem_importes_chk" CHECK (
    "precioUnitario" >= 0 AND "subtotal" = "cantidad" * "precioUnitario");

-- Una sola factura EMITIDA por venta.
CREATE UNIQUE INDEX "factura_venta_emitida_unica" ON "Factura" ("ventaId")
  WHERE "ventaId" IS NOT NULL AND "estado" = 'EMITIDA';

-- Aislamiento: la venta, el cliente y la variante son del mismo panel.
CREATE TRIGGER trg_panel_factura BEFORE INSERT OR UPDATE OF "panelId", "ventaId", "clienteId" ON "Factura"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('ventaId', 'Venta', 'clienteId', 'Cliente');
CREATE TRIGGER trg_panel_factura_item BEFORE INSERT OR UPDATE OF "panelId", "facturaId", "varianteId" ON "FacturaItem"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('facturaId', 'Factura', 'varianteId', 'Variante');

-- La factura de una venta es de su mismo cliente.
CREATE OR REPLACE FUNCTION trg_fn_factura_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ventaId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Venta" v WHERE v."id" = NEW."ventaId" AND v."clienteId" = NEW."clienteId"
  ) THEN
    RAISE EXCEPTION 'La factura % no es del cliente de su venta', NEW."codigo"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_factura_venta BEFORE INSERT OR UPDATE OF "ventaId", "clienteId" ON "Factura"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_factura_venta();

-- Inmutabilidad: EMITIDA → ANULADA (una vez), PDF y número externo; nada más.
CREATE OR REPLACE FUNCTION trg_fn_factura_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La factura % no se borra: se anula', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA' AND NEW IS DISTINCT FROM OLD THEN
    IF (NEW."archivoUrl", NEW."numeroExterno", NEW."estado", NEW."anuladaPorId", NEW."anuladaAt",
        NEW."motivoAnulacion") IS DISTINCT FROM
       (OLD."archivoUrl", OLD."numeroExterno", OLD."estado", OLD."anuladaPorId", OLD."anuladaAt",
        OLD."motivoAnulacion") THEN
      RAISE EXCEPTION 'La factura % está anulada: no se modifica', OLD."codigo"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF (NEW."numero", NEW."codigo", NEW."tipo", NEW."puntoVenta", NEW."fecha", NEW."ventaId",
      NEW."clienteId", NEW."razonSocial", NEW."cuit", NEW."condicionIva", NEW."domicilio",
      NEW."descuento", NEW."subtotal", NEW."alicuotaIva", NEW."iva", NEW."total",
      NEW."usuarioId", NEW."observacion", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."numero", OLD."codigo", OLD."tipo", OLD."puntoVenta", OLD."fecha", OLD."ventaId",
      OLD."clienteId", OLD."razonSocial", OLD."cuit", OLD."condicionIva", OLD."domicilio",
      OLD."descuento", OLD."subtotal", OLD."alicuotaIva", OLD."iva", OLD."total",
      OLD."usuarioId", OLD."observacion", OLD."createdAt") THEN
    RAISE EXCEPTION 'La factura % está emitida: no se modifica, se anula', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_factura_inmutable BEFORE UPDATE OR DELETE ON "Factura"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_factura_inmutable();

CREATE OR REPLACE FUNCTION trg_fn_factura_item_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los ítems de una factura no se modifican'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER trg_factura_item_inmutable BEFORE UPDATE OR DELETE ON "FacturaItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_factura_item_inmutable();

-- Numeración por panel ------------------------------------------------------------
ALTER TABLE "Secuencia" DROP CONSTRAINT "Secuencia_entidad_chk";
ALTER TABLE "Secuencia" ADD CONSTRAINT "Secuencia_entidad_chk"
  CHECK ("entidad" IN ('VENTA', 'COMPRA', 'TRANSFERENCIA', 'DEVOLUCION', 'COTIZACION', 'FACTURA'));
INSERT INTO "Secuencia" ("id", "panelId", "entidad", "ultimoNumero", "updatedAt")
SELECT 'sec_' || p."id" || '_factura', p."id", 'FACTURA', 0, CURRENT_TIMESTAMP
FROM "Panel" p
ON CONFLICT ("panelId", "entidad") DO NOTHING;

-- Cosmetic factura (los demás paneles la activan en Ajustes → Facturación).
INSERT INTO "Configuracion" ("id", "panelId", "clave", "valor", "updatedAt")
SELECT 'cfg_' || p."id" || '_facturacion', p."id", 'facturacion',
       '{"habilitada": true, "puntoVenta": 1, "alicuotaIva": 21}'::jsonb, CURRENT_TIMESTAMP
FROM "Panel" p
WHERE p."slug" = 'cosmetic'
ON CONFLICT ("panelId", "clave") DO NOTHING;
