-- =============================================================================
-- v2.13.0 — «¿De quién viene este cliente?» (Cliente.origenId).
--
-- Dueño o vendedor que trajo al cliente. Obligatorio en toda alta nueva (lo
-- exigen los servicios); los clientes que ya estaban quedan en NULL hasta que
-- un dueño lo responde en Clientes → «Completar de quién viene».
-- Si el vendedor que vende es quien trajo al cliente, la venta cuenta como de
-- cliente nuevo en su ganancia por vape (src/lib/ganancia-vendedor.ts).
-- Cotizacion.clienteOrigenId: lo mismo para el cliente sin registrar de una
-- cotización (se da de alta al convertirla en venta).
-- =============================================================================

ALTER TABLE "Cliente" ADD COLUMN "origenId" TEXT;
ALTER TABLE "Cotizacion" ADD COLUMN "clienteOrigenId" TEXT;

CREATE INDEX "Cliente_panelId_origenId_idx" ON "Cliente"("panelId", "origenId");

ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_origenId_fkey"
  FOREIGN KEY ("origenId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_clienteOrigenId_fkey"
  FOREIGN KEY ("clienteOrigenId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
