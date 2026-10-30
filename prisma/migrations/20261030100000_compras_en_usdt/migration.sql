-- Compras en USDT (pedido de los dueños, 2026-10-30): la moneda principal de
-- Compras pasa a ser USDT.
-- - Compra.costosEnUsdt: lo cargado (costo de cada ítem y gastos extras) está
--   en USDT y el costo final se calcula en USDT; los pesos se derivan UNA vez
--   con Compra.tipoCambioUSDT (snapshot). Las compras anteriores quedan en
--   false: siguen calculándose en pesos como siempre (sus USDT son ≈).
-- - Compra.tipoCambioUSD: snapshot del dólar blue (venta) al cargarla, para
--   mostrar el costo final por unidad también en dólares.
-- - GastoCompra.montoUSDT: el gasto tal como se cargó (en compras en USDT,
--   monto = ROUND(montoUSDT × tipoCambioUSDT, 2)). Inmutable como el resto.
-- - CompraItem.costoUnitarioUSDT ya existía (trazabilidad): en compras en USDT
--   es lo cargado y es obligatorio.

ALTER TABLE "Compra" ADD COLUMN "costosEnUsdt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Compra" ADD COLUMN "tipoCambioUSD" DECIMAL(14,2);
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_tipoCambioUSD_positivo"
  CHECK ("tipoCambioUSD" IS NULL OR "tipoCambioUSD" > 0);
-- En USDT sin cotización no se pueden derivar los pesos.
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_costosEnUsdt_con_cotizacion"
  CHECK (NOT "costosEnUsdt" OR "tipoCambioUSDT" IS NOT NULL);

ALTER TABLE "GastoCompra" ADD COLUMN "montoUSDT" DECIMAL(12,2);
ALTER TABLE "GastoCompra" ADD CONSTRAINT "GastoCompra_montoUSDT_positivo"
  CHECK ("montoUSDT" IS NULL OR "montoUSDT" > 0);

-- El gasto sigue sin modificarse: se suma montoUSDT a las columnas congeladas.
CREATE OR REPLACE FUNCTION trg_fn_gasto_compra_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los gastos de una compra no se borran: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."id", NEW."panelId", NEW."compraId", NEW."motivo", NEW."monto", NEW."montoUSDT",
      NEW."fecha", NEW."usuarioId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."panelId", OLD."compraId", OLD."motivo", OLD."monto", OLD."montoUSDT",
      OLD."fecha", OLD."usuarioId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Los gastos de una compra no se modifican: se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."anulado" THEN
    RAISE EXCEPTION 'El gasto ya está anulado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
