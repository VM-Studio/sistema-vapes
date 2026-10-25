-- A3, bloque 1: ganancia por unidad de los vendedores (TarifaVendedor) y su
-- liquidación mensual (LiquidacionVendedor, única por panel + vendedor + mes).
-- CreateEnum
CREATE TYPE "EstadoLiquidacion" AS ENUM ('PENDIENTE', 'PAGADA');


-- CreateTable
CREATE TABLE "TarifaVendedor" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "usuarioId" TEXT NOT NULL,
    "minorista" DECIMAL(12,2) NOT NULL,
    "mayorista" DECIMAL(12,2) NOT NULL,
    "minoristaNuevo" DECIMAL(12,2) NOT NULL,
    "mayoristaNuevo" DECIMAL(12,2) NOT NULL,
    "actualizadaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarifaVendedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionVendedor" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "usuarioId" TEXT NOT NULL,
    "mes" DATE NOT NULL,
    "estado" "EstadoLiquidacion" NOT NULL DEFAULT 'PENDIENTE',
    "tarifaMinorista" DECIMAL(12,2) NOT NULL,
    "tarifaMayorista" DECIMAL(12,2) NOT NULL,
    "tarifaMinoristaNuevo" DECIMAL(12,2) NOT NULL,
    "tarifaMayoristaNuevo" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "cantidadVentas" INTEGER NOT NULL,
    "unidades" INTEGER NOT NULL,
    "totalVendido" DECIMAL(12,2) NOT NULL,
    "categorias" JSONB NOT NULL,
    "detalle" JSONB NOT NULL,
    "generadaPorId" TEXT,
    "generadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montoPagado" DECIMAL(12,2),
    "medioPago" "MedioPago",
    "referencia" TEXT,
    "fechaPago" TIMESTAMP(3),
    "pagadaPorId" TEXT,
    "pagadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidacionVendedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TarifaVendedor_panelId_usuarioId_key" ON "TarifaVendedor"("panelId", "usuarioId");

-- CreateIndex
CREATE INDEX "LiquidacionVendedor_panelId_estado_idx" ON "LiquidacionVendedor"("panelId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionVendedor_panelId_usuarioId_mes_key" ON "LiquidacionVendedor"("panelId", "usuarioId", "mes");

-- AddForeignKey
ALTER TABLE "TarifaVendedor" ADD CONSTRAINT "TarifaVendedor_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifaVendedor" ADD CONSTRAINT "TarifaVendedor_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifaVendedor" ADD CONSTRAINT "TarifaVendedor_actualizadaPorId_fkey" FOREIGN KEY ("actualizadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionVendedor" ADD CONSTRAINT "LiquidacionVendedor_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionVendedor" ADD CONSTRAINT "LiquidacionVendedor_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionVendedor" ADD CONSTRAINT "LiquidacionVendedor_generadaPorId_fkey" FOREIGN KEY ("generadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionVendedor" ADD CONSTRAINT "LiquidacionVendedor_pagadaPorId_fkey" FOREIGN KEY ("pagadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- CHECKs
-- -----------------------------------------------------------------------------
ALTER TABLE "TarifaVendedor"
  ADD CONSTRAINT "TarifaVendedor_montos_chk"
    CHECK ("minorista" >= 0 AND "mayorista" >= 0 AND "minoristaNuevo" >= 0 AND "mayoristaNuevo" >= 0);

ALTER TABLE "LiquidacionVendedor"
  ADD CONSTRAINT "LiquidacionVendedor_mes_chk" CHECK (EXTRACT(DAY FROM "mes") = 1),
  ADD CONSTRAINT "LiquidacionVendedor_montos_chk"
    CHECK ("total" >= 0 AND "totalVendido" >= 0 AND "cantidadVentas" >= 0
       AND "tarifaMinorista" >= 0 AND "tarifaMayorista" >= 0
       AND "tarifaMinoristaNuevo" >= 0 AND "tarifaMayoristaNuevo" >= 0),
  ADD CONSTRAINT "LiquidacionVendedor_pago_chk"
    CHECK (("estado" = 'PENDIENTE' AND "montoPagado" IS NULL AND "medioPago" IS NULL
             AND "fechaPago" IS NULL AND "pagadaPorId" IS NULL AND "pagadaAt" IS NULL)
        OR ("estado" <> 'PENDIENTE' AND "montoPagado" > 0 AND "medioPago" IS NOT NULL
             AND "fechaPago" IS NOT NULL AND "pagadaPorId" IS NOT NULL AND "pagadaAt" IS NOT NULL));

-- -----------------------------------------------------------------------------
-- panelId inmutable; liquidación pagada: el snapshot y el pago no cambian, no se borra.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_panel_tarifa_vendedor BEFORE UPDATE OF "panelId" ON "TarifaVendedor"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();
CREATE TRIGGER trg_panel_liquidacion_vendedor BEFORE UPDATE OF "panelId" ON "LiquidacionVendedor"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel();

CREATE OR REPLACE FUNCTION trg_fn_liquidacion_vendedor_pagada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."estado" <> 'PENDIENTE' THEN
      RAISE EXCEPTION 'La liquidación ya está pagada: no se borra' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW."usuarioId", NEW."mes") IS DISTINCT FROM (OLD."usuarioId", OLD."mes") THEN
    RAISE EXCEPTION 'El vendedor y el mes de una liquidación no cambian' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" <> 'PENDIENTE'
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
  IF OLD."estado" <> 'PENDIENTE' AND NEW."estado" = 'PENDIENTE' THEN
    RAISE EXCEPTION 'Una liquidación pagada no vuelve a pendiente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_liquidacion_vendedor_pagada BEFORE UPDATE OR DELETE ON "LiquidacionVendedor"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_liquidacion_vendedor_pagada();

-- -----------------------------------------------------------------------------
-- Tarifas por defecto de Trinidad en Vapes: $1.500 minorista, $300 mayorista,
-- $2.000 minorista a cliente nuevo y $500 mayorista a cliente nuevo (por vape).
-- Se identifica por nombre ("Trinidad", empleada, como la crea el seed) con
-- acceso al panel Vapes: el email cambia entre entornos. Idempotente.
-- -----------------------------------------------------------------------------
INSERT INTO "TarifaVendedor"
  ("id", "panelId", "usuarioId", "minorista", "mayorista", "minoristaNuevo", "mayoristaNuevo",
   "createdAt", "updatedAt")
SELECT 'tvd_' || md5(p."id" || u."id"), p."id", u."id", 1500, 300, 2000, 500,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Usuario" u
JOIN "UsuarioPanel" up ON up."usuarioId" = u."id"
JOIN "Panel" p ON p."id" = up."panelId" AND p."slug" = 'vapes'
WHERE u."nombre" = 'Trinidad' AND u."rol" = 'EMPLEADO' AND u."deletedAt" IS NULL
ON CONFLICT ("panelId", "usuarioId") DO NOTHING;
