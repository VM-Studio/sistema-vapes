-- =============================================================================
-- v2.10.0 — USDT, moneda principal del sistema (ganancia y costos en USDT).
--
-- Regla: los COSTOS son en USDT (las compras se cargan en USDT y el costo que
-- se tipea al cargar stock también). Los PRECIOS de venta y lo cobrado siguen
-- en pesos. Cada venta guarda la cotización USDT y la del dólar blue del
-- momento (snapshot): su total en USDT y su ganancia en USDT quedan fijos
-- aunque después se mueva el cambio.
--
--   Venta.totalUsdt       = ROUND(total ÷ tipoCambioUsdt, 2)                (CHECK)
--   VentaItem.costoUnitario (pesos) = ROUND(costoUnitarioUsdt × tipoCambioUsdt, 2) (trigger)
--   Venta.costoTotalUsdt  = Σ cantidad × costoUnitarioUsdt                   (trigger)
--   Venta.gananciaUsdt    = totalUsdt − costoTotalUsdt                       (CHECK)
--   (en pesos, como siempre: costoTotal = Σ, gananciaBruta = total − costoTotal)
--
-- Datos existentes (el dueño confirmó que TODOS los costos que cargó son USDT;
-- ver pg_temp.costo_a_usdt para los que no pueden serlo):
-- - Variante.ultimoCosto → ultimoCostoUsdt. El costo que vino de una compra
--   recibida estaba en pesos (costo final en pesos de la compra): se pasa a
--   USDT con la cotización de esa compra. El tipeado a mano ya era USDT.
-- - VentaItem: el snapshot de costo se interpreta igual (por el historial de
--   costos del sabor al momento de la venta) y la venta se recalcula entera.
-- - MovimientoStock.costoUnitario → costoUnitarioUsdt, mismo criterio.
-- - CostoVarianteHistorial queda en USDT (costoAnterior = el nuevo de la fila previa).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Funciones auxiliares de la migración (se borran al final)
-- -----------------------------------------------------------------------------

-- Cotización (pesos por unidad) de VENTA vigente en un momento: la última
-- obtenida hasta ese momento; si no había ninguna todavía, la primera posterior.
CREATE FUNCTION pg_temp.cotizacion_en(p_moneda "MonedaCambio", p_fecha timestamp) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT "valor" FROM "TipoCambio"
      WHERE "moneda" = p_moneda AND "tipo" = 'VENTA' AND "obtenidoAt" <= p_fecha
      ORDER BY "obtenidoAt" DESC, "id" DESC LIMIT 1),
    (SELECT "valor" FROM "TipoCambio"
      WHERE "moneda" = p_moneda AND "tipo" = 'VENTA'
      ORDER BY "obtenidoAt" ASC, "id" ASC LIMIT 1)
  )
$$;

-- Cotización USDT de una compra: su snapshot o, si no tiene (o es absurda:
-- menos de $ 100 por USDT, p. ej. 1 cargado a mano), la de su fecha.
CREATE FUNCTION pg_temp.cotizacion_compra(p_compra text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    CASE WHEN c."tipoCambioUSDT" >= 100 THEN c."tipoCambioUSDT" END,
    pg_temp.cotizacion_en('USDT', c."fecha"))
  FROM "Compra" c WHERE c."id" = p_compra
$$;

-- Un costo de sabor (como estaba guardado) → USDT. Si en el historial del
-- sabor, hasta `p_fecha`, ese valor salió de una compra recibida, estaba en
-- pesos: ÷ cotización de esa compra. Si no (carga manual o sin historial), ya
-- era USDT (lo tipeó el dueño en USDT).
CREATE FUNCTION pg_temp.costo_a_usdt(p_variante text, p_costo numeric, p_fecha timestamp) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_origen "OrigenCostoVariante";
  v_compra text;
BEGIN
  IF p_costo IS NULL OR p_costo = 0 THEN
    RETURN p_costo;
  END IF;
  SELECT h."origen", h."compraId" INTO v_origen, v_compra
  FROM "CostoVarianteHistorial" h
  WHERE h."varianteId" = p_variante AND h."costoNuevo" = p_costo AND h."createdAt" <= p_fecha
  ORDER BY h."createdAt" DESC, h."id" DESC
  LIMIT 1;
  IF v_origen IN ('COMPRA_RECIBIDA', 'COSTOS_FINALES_COMPRA') AND v_compra IS NOT NULL THEN
    RETURN ROUND(p_costo / pg_temp.cotizacion_compra(v_compra), 2);
  END IF;
  -- Sin compra que lo explique: un costo de 500 o más no puede ser USDT (un
  -- sabor no cuesta 500 USDT): es un costo en pesos (de antes del vaciado de
  -- datos del 2026-11-07, que borró el historial, o tipeado en pesos): ÷ la cotización de su momento.
  IF p_costo >= 500 THEN
    RETURN ROUND(p_costo / pg_temp.cotizacion_en('USDT', p_fecha), 2);
  END IF;
  RETURN p_costo;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Venta") AND pg_temp.cotizacion_en('USDT', now()::timestamp) IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna cotización USDT guardada: no se pueden pasar las ventas a USDT.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Venta") AND pg_temp.cotizacion_en('USD_BLUE', now()::timestamp) IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna cotización del dólar blue guardada: no se pueden pasar las ventas a USDT.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas
-- -----------------------------------------------------------------------------

ALTER TABLE "Venta"
  ADD COLUMN "tipoCambioUsdt" DECIMAL(14,2),
  ADD COLUMN "tipoCambioUsd"  DECIMAL(14,2),
  ADD COLUMN "totalUsdt"      DECIMAL(12,2),
  ADD COLUMN "costoTotalUsdt" DECIMAL(12,2),
  ADD COLUMN "gananciaUsdt"   DECIMAL(12,2);

ALTER TABLE "VentaItem" ADD COLUMN "costoUnitarioUsdt" DECIMAL(12,2);

ALTER TABLE "MovimientoStock" ADD COLUMN "costoUnitarioUsdt" DECIMAL(12,2);

ALTER TABLE "Variante" ADD COLUMN "ultimoCostoUsdt" DECIMAL(12,2);

ALTER TABLE "Venta" DISABLE TRIGGER USER;
ALTER TABLE "VentaItem" DISABLE TRIGGER USER;
ALTER TABLE "MovimientoStock" DISABLE TRIGGER USER;
ALTER TABLE "CostoVarianteHistorial" DISABLE TRIGGER USER;

-- -----------------------------------------------------------------------------
-- 2. Datos (todo calculado con el historial ORIGINAL, en pesos donde lo era)
-- -----------------------------------------------------------------------------

-- 2a. Cotizaciones de cada venta (las de su momento).
UPDATE "Venta" SET
  "tipoCambioUsdt" = pg_temp.cotizacion_en('USDT', "fecha"),
  "tipoCambioUsd"  = pg_temp.cotizacion_en('USD_BLUE', "fecha");

-- 2b. Costo de cada ítem en USDT y su equivalente en pesos a la cotización de la venta.
UPDATE "VentaItem" vi SET
  "costoUnitarioUsdt" = pg_temp.costo_a_usdt(vi."varianteId", vi."costoUnitario", v."fecha")
FROM "Venta" v WHERE v."id" = vi."ventaId";
UPDATE "VentaItem" vi SET
  "costoUnitario" = ROUND(vi."costoUnitarioUsdt" * v."tipoCambioUsdt", 2)
FROM "Venta" v WHERE v."id" = vi."ventaId";

-- 2c. Totales de cada venta.
UPDATE "Venta" v SET
  "costoTotal"     = s.costo,
  "gananciaBruta"  = v."total" - s.costo,
  "totalUsdt"      = ROUND(v."total" / v."tipoCambioUsdt", 2),
  "costoTotalUsdt" = s.costo_usdt,
  "gananciaUsdt"   = ROUND(v."total" / v."tipoCambioUsdt", 2) - s.costo_usdt
FROM (
  SELECT "ventaId",
         SUM("cantidad" * "costoUnitario") AS costo,
         SUM("cantidad" * "costoUnitarioUsdt") AS costo_usdt
  FROM "VentaItem" GROUP BY "ventaId"
) s
WHERE s."ventaId" = v."id";

-- 2d. Movimientos de stock: el costo en USDT.
--   Ventas / anulaciones: el del ítem de la venta.
UPDATE "MovimientoStock" m SET "costoUnitarioUsdt" = vi."costoUnitarioUsdt"
FROM "VentaItem" vi
WHERE m."referenciaTipo" = 'VENTA' AND vi."ventaId" = m."referenciaId"
  AND vi."varianteId" = m."varianteId" AND m."costoUnitario" IS NOT NULL;
--   Compras (ingreso y devolución al proveedor): el costo base del ítem en USDT.
UPDATE "MovimientoStock" m SET "costoUnitarioUsdt" = COALESCE(
    CASE WHEN m."costoUnitario" = ci."costoUnitario" THEN ci."costoUnitarioUSDT" END,
    ROUND(m."costoUnitario" / pg_temp.cotizacion_compra(ci."compraId"), 2))
FROM "CompraItem" ci
WHERE m."referenciaTipo" = 'COMPRA' AND ci."compraId" = m."referenciaId"
  AND ci."varianteId" = m."varianteId" AND m."costoUnitario" IS NOT NULL;
--   El resto (carga manual, ajustes): por el historial del sabor.
UPDATE "MovimientoStock" m
SET "costoUnitarioUsdt" = pg_temp.costo_a_usdt(m."varianteId", m."costoUnitario", m."createdAt")
WHERE m."costoUnitario" IS NOT NULL AND m."costoUnitarioUsdt" IS NULL;

-- 2e. Último costo de cada sabor.
UPDATE "Variante" SET "ultimoCostoUsdt" = pg_temp.costo_a_usdt("id", "ultimoCosto", now()::timestamp)
WHERE "ultimoCosto" IS NOT NULL;

-- 2f. Historial de costos en USDT (al final: los pasos anteriores leen el original).
UPDATE "CostoVarianteHistorial" h SET "costoNuevo" = ROUND(h."costoNuevo" / pg_temp.cotizacion_compra(h."compraId"), 2)
WHERE h."origen" IN ('COMPRA_RECIBIDA', 'COSTOS_FINALES_COMPRA') AND h."compraId" IS NOT NULL;
UPDATE "CostoVarianteHistorial" h SET "costoAnterior" = p.anterior
FROM (
  SELECT "id", LAG("costoNuevo") OVER (PARTITION BY "varianteId" ORDER BY "createdAt", "id") AS anterior
  FROM "CostoVarianteHistorial"
) p
WHERE p."id" = h."id" AND p.anterior IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Columnas viejas fuera, obligatorias y reglas
-- -----------------------------------------------------------------------------

ALTER TABLE "Variante" DROP CONSTRAINT "Variante_ultimoCosto_chk";
ALTER TABLE "Variante" DROP COLUMN "ultimoCosto";
ALTER TABLE "Variante" ADD CONSTRAINT "Variante_ultimoCostoUsdt_chk" CHECK ("ultimoCostoUsdt" >= 0);

ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_costo_compra_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_costoUnitario_chk";
ALTER TABLE "MovimientoStock" DROP COLUMN "costoUnitario";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_costoUnitarioUsdt_chk"
  CHECK ("costoUnitarioUsdt" IS NULL OR "costoUnitarioUsdt" >= 0);
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_costo_compra_chk"
  CHECK ("tipo" <> 'INGRESO_COMPRA' OR "costoUnitarioUsdt" IS NOT NULL);

ALTER TABLE "VentaItem" ALTER COLUMN "costoUnitarioUsdt" SET NOT NULL;
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_costoUnitarioUsdt_chk" CHECK ("costoUnitarioUsdt" >= 0);

ALTER TABLE "Venta"
  ALTER COLUMN "tipoCambioUsdt" SET NOT NULL,
  ALTER COLUMN "tipoCambioUsd"  SET NOT NULL,
  ALTER COLUMN "totalUsdt"      SET NOT NULL,
  ALTER COLUMN "costoTotalUsdt" SET NOT NULL,
  ALTER COLUMN "gananciaUsdt"   SET NOT NULL;
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_tipoCambio_chk" CHECK ("tipoCambioUsdt" > 0 AND "tipoCambioUsd" > 0);
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_totalUsdt_chk" CHECK ("totalUsdt" = ROUND("total" / "tipoCambioUsdt", 2));
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_costoTotalUsdt_chk" CHECK ("costoTotalUsdt" >= 0);
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_gananciaUsdt_chk" CHECK ("gananciaUsdt" = "totalUsdt" - "costoTotalUsdt");

-- Índice de las sumas del período (reemplaza al de pesos).
DROP INDEX IF EXISTS venta_confirmada_fecha;
CREATE INDEX venta_confirmada_fecha ON "Venta" ("panelId", "fecha")
  INCLUDE ("total", "gananciaBruta", "totalUsdt", "gananciaUsdt", "tipoCambioUsd", "vendedorId", "tipo", "medioPago", "depositoId")
  WHERE "estado" = 'CONFIRMADA';

-- Totales de la venta (trigger diferido): además de pesos, el costo en USDT y
-- que cada costo en pesos sea el de USDT a la cotización de la venta.
CREATE OR REPLACE FUNCTION fn_verificar_totales_venta(p_venta_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_venta      "Venta"%ROWTYPE;
  v_items      integer;
  v_subtotal   numeric;
  v_costo      numeric;
  v_costo_usdt numeric;
  v_mal        integer;
BEGIN
  SELECT * INTO v_venta FROM "Venta" WHERE "id" = p_venta_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COUNT(*), COALESCE(SUM("subtotal"), 0), COALESCE(SUM("cantidad" * "costoUnitario"), 0),
         COALESCE(SUM("cantidad" * "costoUnitarioUsdt"), 0),
         COUNT(*) FILTER (WHERE "costoUnitario" <> ROUND("costoUnitarioUsdt" * v_venta."tipoCambioUsdt", 2))
    INTO v_items, v_subtotal, v_costo, v_costo_usdt, v_mal
  FROM "VentaItem" WHERE "ventaId" = p_venta_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'La venta % no tiene ítems', v_venta."codigo" USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."subtotal" <> v_subtotal THEN
    RAISE EXCEPTION 'Venta %: subtotal % no coincide con la suma de ítems %', v_venta."codigo", v_venta."subtotal", v_subtotal
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."costoTotal" <> v_costo THEN
    RAISE EXCEPTION 'Venta %: costoTotal % no coincide con la suma de costos de ítems %', v_venta."codigo", v_venta."costoTotal", v_costo
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_venta."costoTotalUsdt" <> v_costo_usdt THEN
    RAISE EXCEPTION 'Venta %: costoTotalUsdt % no coincide con la suma de costos de ítems %', v_venta."codigo", v_venta."costoTotalUsdt", v_costo_usdt
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_mal > 0 THEN
    RAISE EXCEPTION 'Venta %: hay costos en pesos que no son el costo en USDT × la cotización de la venta', v_venta."codigo"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Inmutabilidad: las columnas en USDT tampoco se modifican.
CREATE OR REPLACE FUNCTION trg_fn_venta_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."estado" = 'CONFIRMADA' AND NEW."estado" NOT IN ('CONFIRMADA', 'ANULADA'))
     OR (OLD."estado" = 'ANULADA' AND NEW."estado" <> 'ANULADA') THEN
    RAISE EXCEPTION 'Transición de estado inválida en la venta %: % -> %', OLD."codigo", OLD."estado", NEW."estado"
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."numero", NEW."codigo", NEW."fecha", NEW."clienteId", NEW."depositoId", NEW."vendedorId", NEW."tipo",
      NEW."medioPago", NEW."subtotal", NEW."descuento", NEW."total", NEW."costoTotal", NEW."gananciaBruta",
      NEW."clienteNuevo", NEW."tipoCambioUsdt", NEW."tipoCambioUsd", NEW."totalUsdt", NEW."costoTotalUsdt",
      NEW."gananciaUsdt")
     IS DISTINCT FROM
     (OLD."numero", OLD."codigo", OLD."fecha", OLD."clienteId", OLD."depositoId", OLD."vendedorId", OLD."tipo",
      OLD."medioPago", OLD."subtotal", OLD."descuento", OLD."total", OLD."costoTotal", OLD."gananciaBruta",
      OLD."clienteNuevo", OLD."tipoCambioUsdt", OLD."tipoCambioUsd", OLD."totalUsdt", OLD."costoTotalUsdt",
      OLD."gananciaUsdt") THEN
    RAISE EXCEPTION 'La venta % está %: no se modifica, se anula', OLD."codigo", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA'
     AND (NEW."anuladaPorId", NEW."anuladaAt", NEW."motivoAnulacion")
         IS DISTINCT FROM (OLD."anuladaPorId", OLD."anuladaAt", OLD."motivoAnulacion") THEN
    RAISE EXCEPTION 'Los datos de anulación de la venta % no se modifican', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."retiradaAt" IS NOT NULL
     AND (NEW."retiradaAt", NEW."retiradaPorId") IS DISTINCT FROM (OLD."retiradaAt", OLD."retiradaPorId") THEN
    RAISE EXCEPTION 'La venta % ya está retirada: el retiro no se modifica', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA' AND OLD."retiradaAt" IS NULL AND NEW."retiradaAt" IS NOT NULL THEN
    RAISE EXCEPTION 'La venta % está anulada: no se puede marcar como retirada', OLD."codigo"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "Venta" ENABLE TRIGGER USER;
ALTER TABLE "VentaItem" ENABLE TRIGGER USER;
ALTER TABLE "MovimientoStock" ENABLE TRIGGER USER;
ALTER TABLE "CostoVarianteHistorial" ENABLE TRIGGER USER;

-- Comprobación final: todas las ventas cierran (mismas reglas que el trigger).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT "id" FROM "Venta" LOOP
    PERFORM fn_verificar_totales_venta(r."id");
  END LOOP;
END $$;
