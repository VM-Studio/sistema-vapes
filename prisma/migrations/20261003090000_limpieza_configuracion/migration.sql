-- =============================================================================
-- CIERRE DE LA REFORMA: claves de configuración que ya no lee nadie.
--
-- - ConfiguracionGlobal."moneda": la app trabaja en pesos; los precios de
--   proveedores en dólares usan la clave por panel "cotizacionUsd".
-- - Configuracion "ventas": solo queda "redondeoVentas" (el resto eran datos
--   del comprobante y del cobro en cuenta corriente, que no existen más).
-- Solo datos: el esquema no cambia.
-- =============================================================================

DELETE FROM "ConfiguracionGlobal" WHERE "clave" = 'moneda';

UPDATE "Configuracion"
SET "valor" = jsonb_build_object('redondeoVentas', COALESCE("valor" -> 'redondeoVentas', '0'::jsonb)),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "clave" = 'ventas'
  AND jsonb_typeof("valor") = 'object'
  AND "valor" - 'redondeoVentas' <> '{}'::jsonb;
