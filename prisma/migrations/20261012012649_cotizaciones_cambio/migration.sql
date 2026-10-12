-- CreateEnum
CREATE TYPE "MonedaCambio" AS ENUM ('USDT', 'USD_BLUE');

-- CreateEnum
CREATE TYPE "TipoCotizacionCambio" AS ENUM ('COMPRA', 'VENTA');

-- CreateTable
CREATE TABLE "TipoCambio" (
    "id" TEXT NOT NULL,
    "moneda" "MonedaCambio" NOT NULL,
    "tipo" "TipoCotizacionCambio" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "fuente" TEXT NOT NULL,
    "obtenidoAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipoCambio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TipoCambio_moneda_tipo_obtenidoAt_idx" ON "TipoCambio"("moneda", "tipo", "obtenidoAt" DESC);

-- Cotización positiva (el servicio además valida el rango contra la anterior).
ALTER TABLE "TipoCambio" ADD CONSTRAINT "TipoCambio_valor_positivo" CHECK ("valor" > 0);

-- Frecuencia de actualización por defecto (minutos). Los overrides manuales
-- (cambio.overrideUSDT / cambio.overrideUSD_BLUE) solo existen mientras están cargados.
INSERT INTO "ConfiguracionGlobal" ("id", "clave", "valor", "updatedAt")
VALUES ('cfg_cambio_actualizacion_minutos', 'cambio.actualizacionMinutos', '15'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("clave") DO NOTHING;
