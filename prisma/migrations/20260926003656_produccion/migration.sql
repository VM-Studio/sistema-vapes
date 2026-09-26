-- CreateEnum
CREATE TYPE "EstadoOperacionSync" AS ENUM ('PROCESANDO', 'APLICADA', 'RECHAZADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccionAuditoria" ADD VALUE 'ACCESO_DENEGADO';
ALTER TYPE "AccionAuditoria" ADD VALUE 'SESION_REVOCADA';

-- CreateTable
CREATE TABLE "Sesion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "revocadaAt" TIMESTAMP(3),
    "revocadaPorId" TEXT,

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperacionSincronizada" (
    "id" TEXT NOT NULL,
    "idOperacion" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "estado" "EstadoOperacionSync" NOT NULL,
    "payload" JSONB NOT NULL,
    "resultado" JSONB,
    "motivo" TEXT,
    "creadaEnCliente" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadaAt" TIMESTAMP(3),

    CONSTRAINT "OperacionSincronizada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "tamanio" BIGINT,
    "duracionMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'cron',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "clave" TEXT NOT NULL,
    "ventana" TIMESTAMP(3) NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("clave","ventana")
);

-- CreateIndex
CREATE INDEX "Sesion_usuarioId_revocadaAt_idx" ON "Sesion"("usuarioId", "revocadaAt");

-- CreateIndex
CREATE INDEX "Sesion_expiraAt_idx" ON "Sesion"("expiraAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperacionSincronizada_idOperacion_key" ON "OperacionSincronizada"("idOperacion");

-- CreateIndex
CREATE INDEX "OperacionSincronizada_usuarioId_estado_idx" ON "OperacionSincronizada"("usuarioId", "estado");

-- CreateIndex
CREATE INDEX "Backup_createdAt_idx" ON "Backup"("createdAt");

-- CreateIndex
CREATE INDEX "RateLimit_ventana_idx" ON "RateLimit"("ventana");

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_revocadaPorId_fkey" FOREIGN KEY ("revocadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacionSincronizada" ADD CONSTRAINT "OperacionSincronizada_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Reglas de integridad (Prompt 7)
-- =============================================================================

-- Sesión: solo se revoca (una vez) o se extiende; nunca cambia de dueño ni de token.
CREATE OR REPLACE FUNCTION trg_fn_sesion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."usuarioId" <> OLD."usuarioId" OR NEW."tokenHash" <> OLD."tokenHash" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Una sesión no cambia de usuario ni de token' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."revocadaAt" IS NOT NULL AND NEW."revocadaAt" IS DISTINCT FROM OLD."revocadaAt" THEN
    RAISE EXCEPTION 'La sesión ya está revocada' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sesion BEFORE UPDATE ON "Sesion" FOR EACH ROW EXECUTE FUNCTION trg_fn_sesion();

-- Operación sincronizada: no se borra (es la prueba de que ya se aplicó) y una
-- vez APLICADA no vuelve atrás.
CREATE TRIGGER trg_operacion_sync_no_delete BEFORE DELETE ON "OperacionSincronizada"
  FOR EACH ROW EXECUTE FUNCTION prevent_delete('una operación sincronizada es la garantía de idempotencia');
CREATE OR REPLACE FUNCTION trg_fn_operacion_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."idOperacion" <> OLD."idOperacion" OR NEW."usuarioId" <> OLD."usuarioId" THEN
    RAISE EXCEPTION 'La operación no cambia de id ni de usuario' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'APLICADA' THEN
    RAISE EXCEPTION 'Una operación aplicada no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_operacion_sync BEFORE UPDATE ON "OperacionSincronizada"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_operacion_sync();

-- Backup: registro histórico inmutable.
CREATE TRIGGER trg_backup_inmutable BEFORE UPDATE OR DELETE ON "Backup"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

ALTER TABLE "RateLimit" ADD CONSTRAINT "RateLimit_contador_chk" CHECK ("contador" >= 0);
