-- Bloque 3 (A2): los proveedores cotizan en USDT.
-- - Moneda: USD pasa a USDT. RENAME VALUE cambia el enum en el catálogo, sin
--   reescribir filas: ProveedorProducto y su historial (inmutable por trigger)
--   quedan en USDT sin UPDATE.
-- - Precio de proveedor nuevo: USDT por defecto.
-- - Compra.tipoCambioUSDT y CompraItem.costoUnitarioUSDT: snapshot de la
--   cotización con la que se pasaron a pesos los precios en USDT.
-- - Se elimina la cotización del dólar por panel (clave "cotizacionUsd"): el
--   comparador usa la cotización USDT global (TipoCambio).

ALTER TYPE "Moneda" RENAME VALUE 'USD' TO 'USDT';

ALTER TABLE "ProveedorProducto" ALTER COLUMN "moneda" SET DEFAULT 'USDT';

ALTER TABLE "Compra" ADD COLUMN "tipoCambioUSDT" DECIMAL(14,2);
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_tipoCambioUSDT_positivo"
  CHECK ("tipoCambioUSDT" IS NULL OR "tipoCambioUSDT" > 0);

ALTER TABLE "CompraItem" ADD COLUMN "costoUnitarioUSDT" DECIMAL(12,2);
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_costoUnitarioUSDT_no_negativo"
  CHECK ("costoUnitarioUSDT" IS NULL OR "costoUnitarioUSDT" >= 0);

DELETE FROM "Configuracion" WHERE "clave" = 'cotizacionUsd';
