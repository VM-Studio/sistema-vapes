-- =============================================================================
-- Prompt 6: gastos con categoría, caja con arqueo, resumen diario y notificaciones.
-- La parte generada por Prisma va primero; las reglas que Prisma no expresa
-- (índices parciales, CHECK, triggers) están al final.
-- =============================================================================

-- CreateEnum
CREATE TYPE "EstadoCaja" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('APERTURA', 'VENTA', 'PAGO_CLIENTE', 'DEVOLUCION', 'GASTO', 'RETIRO', 'INGRESO_EXTRA', 'CIERRE');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('STOCK_BAJO', 'SIN_STOCK', 'CAJA_DIFERENCIA', 'TRANSFERENCIA_PENDIENTE', 'DEUDA_CLIENTE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Modulo" ADD VALUE 'FINANZAS';
ALTER TYPE "Modulo" ADD VALUE 'GASTOS';
ALTER TYPE "Modulo" ADD VALUE 'CAJA';

-- Categorías de gasto: la columna de texto pasa a FK sin perder datos.
-- CreateTable
CREATE TABLE "CategoriaGasto" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CategoriaGasto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaGasto_nombre_key" ON "CategoriaGasto"("nombre");

INSERT INTO "CategoriaGasto" ("id", "nombre") VALUES
  ('cgasto_alquiler',  'Alquiler'),
  ('cgasto_servicios', 'Servicios'),
  ('cgasto_sueldos',   'Sueldos'),
  ('cgasto_envios',    'Envíos'),
  ('cgasto_insumos',   'Insumos'),
  ('cgasto_impuestos', 'Impuestos'),
  ('cgasto_marketing', 'Marketing'),
  ('cgasto_otros',     'Otros');

-- Las categorías de texto que ya existían se conservan como categorías nuevas.
INSERT INTO "CategoriaGasto" ("id", "nombre")
SELECT 'cgasto_' || md5(c), c FROM (SELECT DISTINCT btrim("categoria") AS c FROM "Gasto" WHERE btrim("categoria") <> '') x
ON CONFLICT ("nombre") DO NOTHING;

ALTER TABLE "Gasto"
ADD COLUMN     "cajaId" TEXT,
ADD COLUMN     "categoriaGastoId" TEXT,
ADD COLUMN     "comprobanteUrl" TEXT,
ADD COLUMN     "depositoId" TEXT,
ADD COLUMN     "recurrente" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Gasto" g
SET "categoriaGastoId" = COALESCE(
  (SELECT c."id" FROM "CategoriaGasto" c WHERE c."nombre" = btrim(g."categoria")),
  'cgasto_otros');

ALTER TABLE "Gasto" ALTER COLUMN "categoriaGastoId" SET NOT NULL, DROP COLUMN "categoria";

-- AlterTable
ALTER TABLE "PagoVenta" ADD COLUMN     "cajaId" TEXT;


-- CreateTable
CREATE TABLE "Caja" (
    "id" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "estado" "EstadoCaja" NOT NULL DEFAULT 'ABIERTA',
    "abiertaPorId" TEXT NOT NULL,
    "abiertaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montoInicial" DECIMAL(12,2) NOT NULL,
    "cerradaPorId" TEXT,
    "cerradaAt" TIMESTAMP(3),
    "montoEsperado" DECIMAL(12,2),
    "montoContado" DECIMAL(12,2),
    "diferencia" DECIMAL(12,2),
    "observaciones" TEXT,
    "requiereRevision" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "descripcion" TEXT,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumenDiario" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "depositoId" TEXT,
    "cantidadVentas" INTEGER NOT NULL DEFAULT 0,
    "unidadesVendidas" INTEGER NOT NULL DEFAULT 0,
    "totalVentas" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costoVentas" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gananciaBruta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalGastos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gananciaNeta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPorMedioPago" JSONB NOT NULL DEFAULT '{}',
    "devoluciones" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costoDevoluciones" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumenDiario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacion" (
    "id" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "datos" JSONB,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "Caja_depositoId_abiertaAt_idx" ON "Caja"("depositoId", "abiertaAt");

-- CreateIndex
CREATE INDEX "Caja_estado_idx" ON "Caja"("estado");

-- CreateIndex
CREATE INDEX "Caja_abiertaAt_idx" ON "Caja"("abiertaAt");

-- CreateIndex
CREATE INDEX "MovimientoCaja_cajaId_createdAt_idx" ON "MovimientoCaja"("cajaId", "createdAt");

-- CreateIndex
CREATE INDEX "MovimientoCaja_referenciaTipo_referenciaId_idx" ON "MovimientoCaja"("referenciaTipo", "referenciaId");

-- CreateIndex
CREATE INDEX "ResumenDiario_depositoId_fecha_idx" ON "ResumenDiario"("depositoId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "ResumenDiario_fecha_depositoId_key" ON "ResumenDiario"("fecha", "depositoId");

-- CreateIndex
CREATE INDEX "Notificacion_usuarioId_leida_createdAt_idx" ON "Notificacion"("usuarioId", "leida", "createdAt");

-- CreateIndex
CREATE INDEX "Notificacion_createdAt_idx" ON "Notificacion"("createdAt");

-- CreateIndex
CREATE INDEX "Gasto_categoriaGastoId_fecha_idx" ON "Gasto"("categoriaGastoId", "fecha");

-- CreateIndex
CREATE INDEX "Gasto_depositoId_fecha_idx" ON "Gasto"("depositoId", "fecha");

-- CreateIndex
CREATE INDEX "Gasto_cajaId_idx" ON "Gasto"("cajaId");

-- CreateIndex
CREATE INDEX "PagoVenta_cajaId_idx" ON "PagoVenta"("cajaId");

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_categoriaGastoId_fkey" FOREIGN KEY ("categoriaGastoId") REFERENCES "CategoriaGasto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_abiertaPorId_fkey" FOREIGN KEY ("abiertaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumenDiario" ADD CONSTRAINT "ResumenDiario_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Reglas de integridad
-- =============================================================================

-- 1. ResumenDiario: una fila por (fecha, depósito) y UNA consolidada (depositoId NULL).
--    Sin NULLS NOT DISTINCT, Postgres aceptaría infinitas filas (fecha, NULL).
DROP INDEX "ResumenDiario_fecha_depositoId_key";
CREATE UNIQUE INDEX "ResumenDiario_fecha_depositoId_key"
  ON "ResumenDiario" ("fecha", "depositoId") NULLS NOT DISTINCT;

-- 2. Gasto --------------------------------------------------------------------
-- (Gasto_monto_chk > 0 ya existe desde la migración "constraints".)
ALTER TABLE "Gasto"
  ADD CONSTRAINT "Gasto_caja_efectivo_chk" CHECK ("cajaId" IS NULL OR "medioPago" = 'EFECTIVO');

CREATE TRIGGER trg_categoria_gasto_no_delete BEFORE DELETE ON "CategoriaGasto"
  FOR EACH ROW EXECUTE FUNCTION prevent_delete('desactivala (activo = false)');

-- 3. PagoVenta: solo el efectivo pasa por la caja -------------------------------
ALTER TABLE "PagoVenta"
  ADD CONSTRAINT "PagoVenta_caja_efectivo_chk" CHECK ("cajaId" IS NULL OR "medioPago" = 'EFECTIVO');

-- 4. Caja -----------------------------------------------------------------------
-- Una sola caja ABIERTA por depósito.
CREATE UNIQUE INDEX "Caja_una_abierta_por_deposito" ON "Caja" ("depositoId") WHERE "estado" = 'ABIERTA';

ALTER TABLE "Caja"
  ADD CONSTRAINT "Caja_montoInicial_chk" CHECK ("montoInicial" >= 0),
  ADD CONSTRAINT "Caja_montoContado_chk" CHECK ("montoContado" IS NULL OR "montoContado" >= 0),
  ADD CONSTRAINT "Caja_estado_chk" CHECK (
    ("estado" = 'ABIERTA' AND "cerradaPorId" IS NULL AND "cerradaAt" IS NULL AND "montoEsperado" IS NULL
      AND "montoContado" IS NULL AND "diferencia" IS NULL AND NOT "requiereRevision")
    OR
    ("estado" = 'CERRADA' AND "cerradaPorId" IS NOT NULL AND "cerradaAt" IS NOT NULL
      AND "montoEsperado" IS NOT NULL AND "montoContado" IS NOT NULL
      AND "diferencia" = "montoContado" - "montoEsperado")
  );

CREATE TRIGGER trg_caja_no_delete BEFORE DELETE ON "Caja"
  FOR EACH ROW EXECUTE FUNCTION prevent_delete('una caja no se borra');

-- Solo ABIERTA → CERRADA (una vez), sin tocar los datos de apertura. Al cerrar,
-- el esperado tiene que ser exactamente la suma de los movimientos (sin el
-- CIERRE) y el CIERRE registrado tiene que retirar lo contado.
CREATE OR REPLACE FUNCTION trg_fn_caja() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_esperado numeric;
  v_cierre   numeric;
BEGIN
  IF OLD."estado" = 'CERRADA' THEN
    RAISE EXCEPTION 'La caja ya está cerrada: no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."depositoId" IS DISTINCT FROM OLD."depositoId"
     OR NEW."abiertaPorId" IS DISTINCT FROM OLD."abiertaPorId"
     OR NEW."abiertaAt" IS DISTINCT FROM OLD."abiertaAt"
     OR NEW."montoInicial" IS DISTINCT FROM OLD."montoInicial" THEN
    RAISE EXCEPTION 'Los datos de apertura de la caja no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."estado" = 'CERRADA' THEN
    SELECT COALESCE(SUM("monto") FILTER (WHERE "tipo" <> 'CIERRE'), 0),
           SUM("monto") FILTER (WHERE "tipo" = 'CIERRE')
      INTO v_esperado, v_cierre
      FROM "MovimientoCaja" WHERE "cajaId" = NEW."id";
    IF v_esperado <> NEW."montoEsperado" THEN
      RAISE EXCEPTION 'Caja %: el esperado (%) no coincide con sus movimientos (%)', NEW."id", NEW."montoEsperado", v_esperado
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_cierre IS NULL OR v_cierre <> -NEW."montoContado" THEN
      RAISE EXCEPTION 'Caja %: falta el movimiento de CIERRE por el monto contado', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_caja BEFORE UPDATE ON "Caja" FOR EACH ROW EXECUTE FUNCTION trg_fn_caja();

-- 5. MovimientoCaja: inmutable, con signo según el tipo, solo en cajas abiertas --
CREATE TRIGGER trg_movimiento_caja_inmutable BEFORE UPDATE OR DELETE ON "MovimientoCaja"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_movimiento_caja_no_truncate BEFORE TRUNCATE ON "MovimientoCaja"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- monto <> 0 salvo APERTURA / CIERRE, que se registran siempre (aunque la caja
-- abra o cierre en $0) para que el historial muestre quién y cuándo.
ALTER TABLE "MovimientoCaja"
  ADD CONSTRAINT "MovimientoCaja_signo_chk" CHECK (
    CASE "tipo"
      WHEN 'APERTURA'      THEN "monto" >= 0
      WHEN 'CIERRE'        THEN "monto" <= 0
      WHEN 'VENTA'         THEN "monto" > 0
      WHEN 'PAGO_CLIENTE'  THEN "monto" > 0
      WHEN 'INGRESO_EXTRA' THEN "monto" > 0
      ELSE "monto" < 0  -- DEVOLUCION, GASTO, RETIRO
    END),
  ADD CONSTRAINT "MovimientoCaja_referencia_chk" CHECK (("referenciaTipo" IS NULL) = ("referenciaId" IS NULL));

CREATE UNIQUE INDEX "MovimientoCaja_una_apertura" ON "MovimientoCaja" ("cajaId") WHERE "tipo" = 'APERTURA';
CREATE UNIQUE INDEX "MovimientoCaja_un_cierre"    ON "MovimientoCaja" ("cajaId") WHERE "tipo" = 'CIERRE';

CREATE OR REPLACE FUNCTION trg_fn_movimiento_caja_nuevo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_caja "Caja"%ROWTYPE;
BEGIN
  SELECT * INTO v_caja FROM "Caja" WHERE "id" = NEW."cajaId";
  IF v_caja."estado" <> 'ABIERTA' THEN
    RAISE EXCEPTION 'La caja está cerrada: no admite movimientos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."tipo" = 'APERTURA' AND NEW."monto" <> v_caja."montoInicial" THEN
    RAISE EXCEPTION 'La APERTURA tiene que ser el monto inicial de la caja' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movimiento_caja_nuevo BEFORE INSERT ON "MovimientoCaja"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_movimiento_caja_nuevo();
