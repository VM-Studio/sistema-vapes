-- A3, bloque 2: pago de la liquidación con remito firmado por mail.
-- Firmas dibujadas (FirmaRemito: dueño y vendedor), link de firma de un solo
-- uso (hash del token en la liquidación) y registro de envíos (EnvioRemito).
-- CreateEnum
CREATE TYPE "RolFirmaRemito" AS ENUM ('DUENO', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "TipoEnvioRemito" AS ENUM ('PARA_FIRMAR', 'FIRMADO');

-- CreateEnum
CREATE TYPE "ResultadoEnvioMail" AS ENUM ('ENVIADO', 'SIN_CONFIGURAR', 'ERROR');

-- AlterEnum
ALTER TYPE "EstadoLiquidacion" ADD VALUE 'FIRMADA';

-- AlterTable
ALTER TABLE "LiquidacionVendedor" ADD COLUMN     "firmaTokenHash" TEXT,
ADD COLUMN     "firmaTokenUsadoAt" TIMESTAMP(3),
ADD COLUMN     "firmaTokenVenceAt" TIMESTAMP(3),
ADD COLUMN     "firmadaAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FirmaRemito" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "liquidacionId" TEXT NOT NULL,
    "rol" "RolFirmaRemito" NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "imagen" BYTEA NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "medio" TEXT,
    "firmadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmaRemito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvioRemito" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "liquidacionId" TEXT NOT NULL,
    "tipo" "TipoEnvioRemito" NOT NULL,
    "destinatarios" TEXT[],
    "enviadoPorId" TEXT,
    "resultado" "ResultadoEnvioMail" NOT NULL,
    "detalle" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvioRemito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FirmaRemito_panelId_liquidacionId_idx" ON "FirmaRemito"("panelId", "liquidacionId");

-- CreateIndex
CREATE UNIQUE INDEX "FirmaRemito_liquidacionId_rol_key" ON "FirmaRemito"("liquidacionId", "rol");

-- CreateIndex
CREATE INDEX "EnvioRemito_panelId_liquidacionId_createdAt_idx" ON "EnvioRemito"("panelId", "liquidacionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionVendedor_firmaTokenHash_key" ON "LiquidacionVendedor"("firmaTokenHash");

-- AddForeignKey
ALTER TABLE "FirmaRemito" ADD CONSTRAINT "FirmaRemito_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmaRemito" ADD CONSTRAINT "FirmaRemito_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionVendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmaRemito" ADD CONSTRAINT "FirmaRemito_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioRemito" ADD CONSTRAINT "EnvioRemito_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioRemito" ADD CONSTRAINT "EnvioRemito_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionVendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioRemito" ADD CONSTRAINT "EnvioRemito_enviadoPorId_fkey" FOREIGN KEY ("enviadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- CHECKs (::text: el valor FIRMADA recién se agrega en esta misma migración)
-- -----------------------------------------------------------------------------
ALTER TABLE "LiquidacionVendedor"
  ADD CONSTRAINT "LiquidacionVendedor_firmada_chk"
    CHECK (("estado"::text = 'FIRMADA') = ("firmadaAt" IS NOT NULL)),
  ADD CONSTRAINT "LiquidacionVendedor_token_chk"
    CHECK ("firmaTokenHash" IS NULL OR ("firmaTokenVenceAt" IS NOT NULL AND "estado"::text <> 'PENDIENTE'));
ALTER TABLE "FirmaRemito"
  ADD CONSTRAINT "FirmaRemito_imagen_chk" CHECK (octet_length("imagen") BETWEEN 100 AND 300000),
  ADD CONSTRAINT "FirmaRemito_nombre_chk" CHECK (length(trim("nombre")) > 0);

-- -----------------------------------------------------------------------------
-- Aislamiento: la liquidación es del mismo panel; panelId no cambia.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_panel_firma_remito BEFORE INSERT OR UPDATE OF "panelId", "liquidacionId" ON "FirmaRemito"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('liquidacionId', 'LiquidacionVendedor');
CREATE TRIGGER trg_panel_envio_remito BEFORE INSERT OR UPDATE OF "panelId", "liquidacionId" ON "EnvioRemito"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('liquidacionId', 'LiquidacionVendedor');

-- -----------------------------------------------------------------------------
-- Firmas y envíos: inmutables (registro).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_remito_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es un registro inmutable: no se modifica ni se borra', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER trg_firma_remito_inmutable BEFORE UPDATE OR DELETE ON "FirmaRemito"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_remito_inmutable();
CREATE TRIGGER trg_envio_remito_inmutable BEFORE UPDATE OR DELETE ON "EnvioRemito"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_remito_inmutable();

-- -----------------------------------------------------------------------------
-- Liquidación: PENDIENTE → PAGADA → FIRMADA, sin volver atrás; firmada, el
-- link y la fecha de firma tampoco cambian.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_liquidacion_vendedor_pagada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."estado"::text <> 'PENDIENTE' THEN
      RAISE EXCEPTION 'La liquidación ya está pagada: no se borra' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW."usuarioId", NEW."mes") IS DISTINCT FROM (OLD."usuarioId", OLD."mes") THEN
    RAISE EXCEPTION 'El vendedor y el mes de una liquidación no cambian' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado"::text <> 'PENDIENTE'
     AND (NEW."total", NEW."cantidadVentas", NEW."unidades", NEW."totalVendido", NEW."categorias",
          NEW."detalle", NEW."tarifaMinorista", NEW."tarifaMayorista", NEW."tarifaMinoristaNuevo",
          NEW."tarifaMayoristaNuevo", NEW."montoPagado", NEW."medioPago", NEW."fechaPago",
          NEW."pagadaPorId", NEW."pagadaAt")
         IS DISTINCT FROM
         (OLD."total", OLD."cantidadVentas", OLD."unidades", OLD."totalVendido", OLD."categorias",
          OLD."detalle", OLD."tarifaMinorista", OLD."tarifaMayorista", OLD."tarifaMinoristaNuevo",
          OLD."tarifaMayoristaNuevo", OLD."montoPagado", OLD."medioPago", OLD."fechaPago",
          OLD."pagadaPorId", OLD."pagadaAt") THEN
    RAISE EXCEPTION 'La liquidación ya está pagada: no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado"::text <> 'PENDIENTE' AND NEW."estado"::text = 'PENDIENTE' THEN
    RAISE EXCEPTION 'Una liquidación pagada no vuelve a pendiente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado"::text = 'FIRMADA'
     AND (NEW."estado"::text <> 'FIRMADA'
          OR (NEW."firmaTokenHash", NEW."firmaTokenVenceAt", NEW."firmaTokenUsadoAt", NEW."firmadaAt")
             IS DISTINCT FROM
             (OLD."firmaTokenHash", OLD."firmaTokenVenceAt", OLD."firmaTokenUsadoAt", OLD."firmadaAt")) THEN
    RAISE EXCEPTION 'La liquidación ya está firmada: no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
