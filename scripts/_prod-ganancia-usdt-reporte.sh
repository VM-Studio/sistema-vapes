#!/usr/bin/env bash
# Producción (v2.10.0, USDT moneda principal): SIMULA la migración
# 20261116100000_ganancia_en_usdt dentro de una transacción que se DESHACE
# (ROLLBACK): no cambia nada. Muestra, antes de aplicarla de verdad, cómo queda
# el costo de cada sabor (y si se tomó como USDT o se convirtió desde pesos) y
# la ganancia de cada venta (antes en pesos → ahora en USDT, con su cotización).
#
# Uso:  DATABASE_URL=<url de producción> scripts/_prod-ganancia-usdt-reporte.sh [carpeta-salida]
# Deja también los CSV en la carpeta (por defecto ~/backups-sistema-vapes/reporte-usdt-<fecha>).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Falta DATABASE_URL}"
URL="${DATABASE_URL%%\?*}"
SALIDA="${1:-$HOME/backups-sistema-vapes/reporte-usdt-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$SALIDA"
MIG=prisma/migrations/20261116100000_ganancia_en_usdt/migration.sql

psql "$URL" -X -q -v ON_ERROR_STOP=1 --pset=footer=off <<SQL
BEGIN;
CREATE TEMP TABLE antes_variante AS
  SELECT v."id", pa."nombre" AS panel, p."nombreCompleto" AS producto, v."nombre" AS sabor, v."ultimoCosto"
  FROM "Variante" v JOIN "Producto" p ON p."id" = v."productoId" JOIN "Panel" pa ON pa."id" = v."panelId"
  WHERE v."ultimoCosto" IS NOT NULL AND v."deletedAt" IS NULL;
CREATE TEMP TABLE antes_venta AS
  SELECT "id", "codigo", "fecha", "estado", "total", "costoTotal", "gananciaBruta" FROM "Venta";

\i $MIG

CREATE TEMP TABLE r_sabores AS
  SELECT a.panel, a.producto, a.sabor, a."ultimoCosto" AS "costo guardado",
         v."ultimoCostoUsdt" AS "costo USDT",
         CASE WHEN a."ultimoCosto" = v."ultimoCostoUsdt" THEN 'ya era USDT' ELSE 'pasado de pesos a USDT' END AS "criterio"
  FROM antes_variante a JOIN "Variante" v USING ("id") ORDER BY 1, 2, 3;
CREATE TEMP TABLE r_ventas AS
  SELECT a."codigo", (a."fecha" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS "fecha",
         a."estado", a."total" AS "total \$", a."gananciaBruta" AS "ganancia \$ ANTES",
         v."tipoCambioUsdt" AS "cotiz. USDT", v."tipoCambioUsd" AS "cotiz. blue",
         v."totalUsdt" AS "total USDT", v."costoTotalUsdt" AS "costo USDT", v."gananciaUsdt" AS "ganancia USDT",
         v."gananciaBruta" AS "ganancia \$ AHORA"
  FROM antes_venta a JOIN "Venta" v USING ("id") ORDER BY a."fecha";

\echo
\echo '=== Compras: cotización USDT guardada (menos de 100 = absurda: se usa la de su fecha) ==='
SELECT c."numero", c."fecha"::date, c."estado", c."costosEnUsdt" AS "en USDT",
       c."tipoCambioUSDT" AS "cotización guardada",
       CASE WHEN c."tipoCambioUSDT" IS NULL OR c."tipoCambioUSDT" < 100 THEN 'NO SE USA' ELSE 'se usa' END AS "criterio"
FROM "Compra" c ORDER BY c."fecha";
\echo
\echo '=== Costos de los sabores ==='
SELECT * FROM r_sabores;
\echo
\echo '=== Ventas ==='
SELECT * FROM r_ventas;
\echo
\echo '=== Totales de ventas confirmadas ==='
SELECT COUNT(*) AS ventas, SUM("total") AS "total \$", SUM("totalUsdt") AS "total USDT",
       SUM("costoTotalUsdt") AS "costo USDT", SUM("gananciaUsdt") AS "ganancia USDT",
       COUNT(*) FILTER (WHERE "costoTotalUsdt" = 0) AS "ventas sin costo cargado",
       COUNT(*) FILTER (WHERE "gananciaUsdt" < 0) AS "ventas con pérdida"
FROM "Venta" WHERE "estado" = 'CONFIRMADA';

\copy r_sabores TO '$SALIDA/costos-sabores.csv' CSV HEADER
\copy r_ventas TO '$SALIDA/ventas.csv' CSV HEADER
ROLLBACK;
SQL
echo
echo "✔ Simulación hecha y DESHECHA (ROLLBACK): la base quedó igual. CSV en $SALIDA"
