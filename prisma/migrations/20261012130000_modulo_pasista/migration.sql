-- Bloque 7 (A2): módulo Pasista. Una fila por compra con comisión (ORIGINAL)
-- y, si cambia después de pagada, una de AJUSTE con la diferencia.
-- CreateEnum
CREATE TYPE "EstadoComisionPasista" AS ENUM ('PENDIENTE', 'PAGADA');

-- CreateEnum
CREATE TYPE "TipoComisionPasista" AS ENUM ('ORIGINAL', 'AJUSTE');

-- AlterEnum
ALTER TYPE "Modulo" ADD VALUE 'PASISTA';

-- CreateTable
CREATE TABLE "ComisionPasista" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "compraId" TEXT NOT NULL,
    "tipo" "TipoComisionPasista" NOT NULL DEFAULT 'ORIGINAL',
    "monto" DECIMAL(12,2) NOT NULL,
    "porcentaje" DECIMAL(5,2),
    "base" DECIMAL(12,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    -- Mes argentino de la compra. Argentina es UTC−3 fijo (sin horario de verano
    -- desde 2009): restar 3 h es inmutable (AT TIME ZONE no lo es).
    "mes" DATE GENERATED ALWAYS AS ((date_trunc('month', "fecha" - interval '3 hours'))::date) STORED,
    "estado" "EstadoComisionPasista" NOT NULL DEFAULT 'PENDIENTE',
    "pagadaAt" TIMESTAMP(3),
    "pagadaPorId" TEXT,
    "medioPago" "MedioPago",
    "referencia" TEXT,
    "observacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComisionPasista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComisionPasista_panelId_mes_estado_idx" ON "ComisionPasista"("panelId", "mes", "estado");

-- CreateIndex
CREATE INDEX "ComisionPasista_panelId_estado_idx" ON "ComisionPasista"("panelId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "ComisionPasista_panelId_compraId_tipo_key" ON "ComisionPasista"("panelId", "compraId", "tipo");

-- AddForeignKey
ALTER TABLE "ComisionPasista" ADD CONSTRAINT "ComisionPasista_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComisionPasista" ADD CONSTRAINT "ComisionPasista_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComisionPasista" ADD CONSTRAINT "ComisionPasista_pagadaPorId_fkey" FOREIGN KEY ("pagadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- CHECKs
-- -----------------------------------------------------------------------------
ALTER TABLE "ComisionPasista"
  ADD CONSTRAINT "ComisionPasista_monto_chk"
    CHECK (("tipo" = 'ORIGINAL' AND "monto" > 0) OR ("tipo" = 'AJUSTE' AND "monto" <> 0)),
  ADD CONSTRAINT "ComisionPasista_porcentaje_chk"
    CHECK ("porcentaje" IS NULL OR ("porcentaje" > 0 AND "porcentaje" <= 100)),
  ADD CONSTRAINT "ComisionPasista_base_chk" CHECK ("base" >= 0),
  ADD CONSTRAINT "ComisionPasista_pago_chk"
    CHECK (("estado" = 'PAGADA' AND "pagadaAt" IS NOT NULL AND "pagadaPorId" IS NOT NULL AND "medioPago" IS NOT NULL)
        OR ("estado" = 'PENDIENTE' AND "pagadaAt" IS NULL AND "pagadaPorId" IS NULL AND "medioPago" IS NULL AND "referencia" IS NULL));

-- -----------------------------------------------------------------------------
-- Pagada: no se modifica (salvo deshacer el pago, que la vuelve a PENDIENTE) ni se borra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_comision_pasista_pagada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."estado" = 'PAGADA' THEN
      RAISE EXCEPTION 'La comisión del pasista ya está pagada: no se borra' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."estado" = 'PAGADA' AND NEW."estado" = 'PAGADA'
     AND (NEW."compraId", NEW."tipo", NEW."monto", NEW."porcentaje", NEW."base", NEW."fecha",
          NEW."pagadaAt", NEW."pagadaPorId", NEW."medioPago", NEW."referencia")
         IS DISTINCT FROM
         (OLD."compraId", OLD."tipo", OLD."monto", OLD."porcentaje", OLD."base", OLD."fecha",
          OLD."pagadaAt", OLD."pagadaPorId", OLD."medioPago", OLD."referencia") THEN
    RAISE EXCEPTION 'La comisión del pasista ya está pagada: no se modifica (los cambios van como ajuste)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."compraId", NEW."tipo") IS DISTINCT FROM (OLD."compraId", OLD."tipo") THEN
    RAISE EXCEPTION 'La compra y el tipo de una comisión del pasista no cambian' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_comision_pasista_pagada BEFORE UPDATE OR DELETE ON "ComisionPasista"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_comision_pasista_pagada();
CREATE TRIGGER trg_panel_comision_pasista BEFORE INSERT OR UPDATE OF "panelId", "compraId" ON "ComisionPasista"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('compraId', 'Compra');
