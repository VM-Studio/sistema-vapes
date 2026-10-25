-- Cambio de contraseña con código por mail (A3, bloque 6): código de 6 dígitos
-- (solo su HMAC), vencimiento, intentos, un solo uso y el token de verificación
-- de corta vida que habilita el paso «contraseña nueva». Ligado a la sesión.

CREATE TYPE "PropositoCodigo" AS ENUM ('CAMBIO_PASSWORD');

CREATE TABLE "CodigoVerificacion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "sesionId" TEXT NOT NULL,
    "proposito" "PropositoCodigo" NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "venceAt" TIMESTAMP(3) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "usadoAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenVenceAt" TIMESTAMP(3),
    "tokenUsadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoVerificacion_pkey" PRIMARY KEY ("id")
);

-- Coherencia: intentos acotados; el token solo existe con el código ya usado
-- (y con su vencimiento); consumir el token exige tenerlo.
ALTER TABLE "CodigoVerificacion" ADD CONSTRAINT "codigo_verificacion_coherente" CHECK (
  "intentos" BETWEEN 0 AND 5
  AND ("tokenHash" IS NULL OR ("usadoAt" IS NOT NULL AND "tokenVenceAt" IS NOT NULL))
  AND ("tokenUsadoAt" IS NULL OR "tokenHash" IS NOT NULL)
);

CREATE INDEX "CodigoVerificacion_usuarioId_proposito_createdAt_idx" ON "CodigoVerificacion"("usuarioId", "proposito", "createdAt");
CREATE INDEX "CodigoVerificacion_venceAt_idx" ON "CodigoVerificacion"("venceAt");

ALTER TABLE "CodigoVerificacion" ADD CONSTRAINT "CodigoVerificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodigoVerificacion" ADD CONSTRAINT "CodigoVerificacion_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "Sesion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
