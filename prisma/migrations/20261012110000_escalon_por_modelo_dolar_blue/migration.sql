-- CreateEnum
CREATE TYPE "MonedaEscalon" AS ENUM ('USD', 'ARS');

-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "tipoCambioBlue" DECIMAL(14,2),
ADD COLUMN     "tipoCambioObtenidoAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CotizacionItem" ADD COLUMN     "precioUnitarioUSD" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "EscalonPrecio" ADD COLUMN     "moneda" "MonedaEscalon" NOT NULL DEFAULT 'USD';

-- Los escalones que ya existían estaban en pesos: quedan en ARS. Los nuevos
-- se cargan por defecto en dólares (blue venta).
UPDATE "EscalonPrecio" SET "moneda" = 'ARS';

-- El precio en USD (si lo hay) es positivo; y el snapshot del blue viene
-- completo (valor + fecha) o no viene.
ALTER TABLE "CotizacionItem"
  ADD CONSTRAINT "CotizacionItem_precioUSD_chk" CHECK ("precioUnitarioUSD" IS NULL OR "precioUnitarioUSD" > 0);
ALTER TABLE "Cotizacion"
  ADD CONSTRAINT "Cotizacion_tipoCambioBlue_chk" CHECK (
    ("tipoCambioBlue" IS NULL) = ("tipoCambioObtenidoAt" IS NULL)
    AND ("tipoCambioBlue" IS NULL OR "tipoCambioBlue" > 0)
  );

-- El escalón mayorista se determina SIEMPRE por producto: se elimina el modo
-- POR_TOTAL de la configuración del cotizador.
UPDATE "Configuracion"
  SET "valor" = "valor" - 'modoEscalonMayorista'
  WHERE "clave" = 'cotizacion' AND jsonb_typeof("valor") = 'object';
