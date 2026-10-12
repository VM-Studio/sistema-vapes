-- =============================================================================
-- MEDIOS DE PAGO POR PANEL, MERCADO LIBRE Y PRECIO DE VENTA ML
-- =============================================================================
-- - MedioPago.MERCADO_LIBRE. Qué medios ofrece cada panel (y en qué orden) vive
--   en su configuración de ventas: Configuracion("ventas").mediosPago. Default
--   EFECTIVO, TRANSFERENCIA, BINANCE; Cosmetic cobra por Mercado Libre en vez de Binance.
-- - Precio Mercado Libre: Producto.precioVentaML (todos sus sabores) y
--   Variante.precioVentaML (override del sabor). null = no tiene precio ML.
-- - Cotizacion.aPrecioML: cotización por unidad a precio Mercado Libre.
-- - VentaItem.origenPrecio: de dónde salió el precio cobrado (LISTA, ML,
--   ESPECIAL, COTIZACION). Backfill: COTIZACION si la venta vino de una
--   cotización; ESPECIAL si tuvo precio especial; LISTA el resto.
-- (El valor nuevo del enum no se usa en esta misma transacción.)
-- =============================================================================

CREATE TYPE "OrigenPrecio" AS ENUM ('LISTA', 'ML', 'ESPECIAL', 'COTIZACION');

ALTER TYPE "MedioPago" ADD VALUE 'MERCADO_LIBRE';

ALTER TABLE "Producto" ADD COLUMN "precioVentaML" DECIMAL(12,2);
ALTER TABLE "Variante" ADD COLUMN "precioVentaML" DECIMAL(12,2);

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_precioVentaML_chk"
  CHECK ("precioVentaML" IS NULL OR "precioVentaML" >= 0);
ALTER TABLE "Variante" ADD CONSTRAINT "Variante_precioVentaML_chk"
  CHECK ("precioVentaML" IS NULL OR "precioVentaML" >= 0);

ALTER TABLE "VentaItem" ADD COLUMN "origenPrecio" "OrigenPrecio" NOT NULL DEFAULT 'LISTA';

-- Cotización por unidad a precio Mercado Libre.
ALTER TABLE "Cotizacion" ADD COLUMN "aPrecioML" BOOLEAN NOT NULL DEFAULT false;

-- Backfill de ítems de ventas ya confirmadas: son inmutables (trigger), así que
-- el trigger de edición se suspende solo para esta corrección de datos.
ALTER TABLE "VentaItem" DISABLE TRIGGER trg_venta_item_editable;
UPDATE "VentaItem" vi
SET "origenPrecio" = CASE WHEN v."cotizacionId" IS NOT NULL THEN 'COTIZACION'::"OrigenPrecio"
                          ELSE 'ESPECIAL'::"OrigenPrecio" END
FROM "Venta" v
WHERE v."id" = vi."ventaId" AND (v."cotizacionId" IS NOT NULL OR vi."esPrecioEspecial");
-- El UPDATE deja eventos de triggers diferidos pendientes y Postgres no permite
-- otro ALTER TABLE sobre "VentaItem" hasta que se disparen: se fuerzan ahora.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "VentaItem" ENABLE TRIGGER trg_venta_item_editable;

-- Cosmetic: Efectivo, Transferencia y Mercado Libre (si todavía no eligió sus medios).
INSERT INTO "Configuracion" ("id", "panelId", "clave", "valor", "updatedAt")
SELECT 'cfg_' || p."id" || '_ventas', p."id", 'ventas',
       '{"redondeoVentas": 0, "mediosPago": ["EFECTIVO", "TRANSFERENCIA", "MERCADO_LIBRE"]}'::jsonb,
       CURRENT_TIMESTAMP
FROM "Panel" p
WHERE p."slug" = 'cosmetic'
ON CONFLICT ("panelId", "clave") DO UPDATE
SET "valor" = "Configuracion"."valor" || '{"mediosPago": ["EFECTIVO", "TRANSFERENCIA", "MERCADO_LIBRE"]}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT ("Configuracion"."valor" ? 'mediosPago');

-- Ajuste de 20261012140000_clientes_nuevos_vendedor: el chequeo de la venta de
-- alta solo mira "creadoEnVentaId". Un cambio de "panelId" ya lo rechaza
-- trg_panel_cliente con su propio mensaje ("no se puede cambiar"), y este
-- trigger (alfabéticamente anterior) lo tapaba con otro error.
DROP TRIGGER trg_cliente_creado_en_venta ON "Cliente";
CREATE TRIGGER trg_cliente_creado_en_venta
  BEFORE INSERT OR UPDATE OF "creadoEnVentaId" ON "Cliente"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_cliente_creado_en_venta();
