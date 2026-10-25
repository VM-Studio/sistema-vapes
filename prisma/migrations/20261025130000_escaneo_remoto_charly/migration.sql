-- «Escanea Charly»: escaneo remoto de las ventas de un galpón (Vapes: Mercedes).
-- Modulo ESCANEO (permiso del usuario de escaneo), Deposito.escaneoRemoto y el
-- estado del escaneo en la Venta (quién lo pidió, quién lo hizo, qué escaneó).

CREATE TYPE "Escaneo" AS ENUM ('PENDIENTE', 'ESCANEADA');

-- El valor nuevo no se usa en esta migración (Postgres no deja usarlo en la misma transacción).
ALTER TYPE "Modulo" ADD VALUE 'ESCANEO';

ALTER TABLE "Deposito" ADD COLUMN "escaneoRemoto" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Venta"
  ADD COLUMN "escaneoRemoto" "Escaneo",
  ADD COLUMN "escaneoPedidoPorId" TEXT,
  ADD COLUMN "escaneoPedidoAt" TIMESTAMP(3),
  ADD COLUMN "escaneadaPorId" TEXT,
  ADD COLUMN "escaneadaAt" TIMESTAMP(3),
  ADD COLUMN "escaneoDetalle" JSONB;

-- Coherencia: pedido ⇒ quién y cuándo; escaneada ⇒ además quién escaneó y cuándo.
ALTER TABLE "Venta" ADD CONSTRAINT "venta_escaneo_remoto_coherente" CHECK (
  ("escaneoRemoto" IS NULL
     AND "escaneoPedidoPorId" IS NULL AND "escaneoPedidoAt" IS NULL
     AND "escaneadaPorId" IS NULL AND "escaneadaAt" IS NULL)
  OR ("escaneoRemoto" = 'PENDIENTE'
     AND "escaneoPedidoPorId" IS NOT NULL AND "escaneoPedidoAt" IS NOT NULL
     AND "escaneadaPorId" IS NULL AND "escaneadaAt" IS NULL)
  OR ("escaneoRemoto" = 'ESCANEADA'
     AND "escaneoPedidoPorId" IS NOT NULL AND "escaneoPedidoAt" IS NOT NULL
     AND "escaneadaPorId" IS NOT NULL AND "escaneadaAt" IS NOT NULL)
);

CREATE INDEX "Venta_panelId_escaneoRemoto_idx" ON "Venta"("panelId", "escaneoRemoto");

ALTER TABLE "Venta" ADD CONSTRAINT "Venta_escaneoPedidoPorId_fkey" FOREIGN KEY ("escaneoPedidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_escaneadaPorId_fkey" FOREIGN KEY ("escaneadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El galpón de Las Mercedes de Vapes admite el escaneo remoto (editable en Configuración → Depósitos).
UPDATE "Deposito" d SET "escaneoRemoto" = true
FROM "Panel" p
WHERE p."id" = d."panelId" AND p."slug" = 'vapes' AND d."nombre" = 'Mercedes';
