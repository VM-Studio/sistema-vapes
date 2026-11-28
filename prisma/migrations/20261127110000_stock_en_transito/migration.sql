-- =============================================================================
-- v2.14.0 — Stock en tránsito (Cosmética: Casa → Mercado Libre Full).
--
-- Deposito.conTransito: lo que se le envía queda «en tránsito». Al registrar
-- el envío la SALIDA del origen se registra en el momento; la ENTRADA al
-- destino, al confirmar que llegó (o vuelve al origen si se anula).
-- Transferencia.enTransito: esa transferencia PENDIENTE ya sacó el stock del
-- origen.
-- Datos: en el panel de Cosmética, el depósito principal «Principal» pasa a
-- llamarse «Casa» y se crea «Mercado Libre» (Full, con tránsito).
-- =============================================================================

ALTER TABLE "Deposito" ADD COLUMN "conTransito" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transferencia" ADD COLUMN "enTransito" BOOLEAN NOT NULL DEFAULT false;

-- Solo una PENDIENTE puede estar en tránsito; al completarse o anularse deja de estarlo.
ALTER TABLE "Transferencia"
  ADD CONSTRAINT "Transferencia_en_transito_chk" CHECK (NOT "enTransito" OR "estado" = 'PENDIENTE');

-- Cosmética: Casa + Mercado Libre.
UPDATE "Deposito" d SET "nombre" = 'Casa', "updatedAt" = CURRENT_TIMESTAMP
FROM "Panel" p
WHERE p."id" = d."panelId" AND p."slug" = 'cosmetic' AND d."nombre" = 'Principal'
  AND NOT EXISTS (SELECT 1 FROM "Deposito" x WHERE x."panelId" = p."id" AND x."nombre" = 'Casa');

INSERT INTO "Deposito" ("id", "panelId", "nombre", "activo", "esPrincipal", "escaneoRemoto", "conTransito", "createdAt", "updatedAt")
SELECT 'dep_' || p."id" || '_mercado_libre', p."id", 'Mercado Libre', true, false, false, true,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Panel" p
WHERE p."slug" = 'cosmetic'
ON CONFLICT ("panelId", "nombre") DO UPDATE SET "conTransito" = true;
