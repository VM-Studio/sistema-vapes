-- «Mis clientes»: la cartera de cada vendedor. Cliente.vendedorId = vendedor en
-- cuya cartera está: los que ya tenía antes de usar el sistema (cargados desde
-- «Mis clientes», NO cuentan como nuevos para su ganancia) y los que se suman
-- con una venta suya (Cliente.creadoEnVentaId, Venta.clienteNuevo).
ALTER TABLE "Cliente" ADD COLUMN "vendedorId" TEXT;

CREATE INDEX "Cliente_panelId_vendedorId_nombre_idx" ON "Cliente"("panelId", "vendedorId", "nombre");

ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los clientes que ya dio de alta un vendedor (EMPLEADO; los dueños no tienen
-- cartera) quedan en su cartera: los de una venta suya, como nuevos de esa venta.
UPDATE "Cliente" c
SET "vendedorId" = c."creadoPorId"
FROM "Usuario" u
WHERE u."id" = c."creadoPorId"
  AND u."rol" <> 'OWNER'
  AND c."vendedorId" IS NULL;
